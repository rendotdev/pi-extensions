import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defineRuntime } from "../../../../define.ts";
import { PackageService } from "../../service/package/package.ts";
import type {
  CliUpdatePlan,
  CliUpdateResult,
  CliUpdateStep,
} from "../../types/cli-update/cli-update.ts";

export class CliUpdateCommand extends defineRuntime({ params: {}, deps: { spawn } }) {
  private async execute(params: CliUpdateStep): Promise<string> {
    const spawnCommand = this.deps.spawn;
    return await new Promise<string>(function runCommand(resolvePromise, reject) {
      const child = spawnCommand(params.command, params.args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const output: Buffer[] = [];
      child.stdout.on("data", function captureStdout(chunk: Buffer | string) {
        output.push(Buffer.from(chunk));
      });
      child.stderr.on("data", function captureStderr(chunk: Buffer | string) {
        output.push(Buffer.from(chunk));
      });
      child.once("error", reject);
      child.once("exit", function handleExit(code, signal) {
        if (code === 0) {
          resolvePromise(Buffer.concat(output).toString("utf8"));
          return;
        }
        const detail = Buffer.concat(output).toString("utf8").trim();
        reject(
          new Error(
            `${params.command} exited with ${signal ?? `code ${code ?? "unknown"}`}.${detail ? `\n${detail}` : ""}`,
          ),
        );
      });
    });
  }

  public async run(params: CliUpdateStep): Promise<string> {
    return await this.execute(params);
  }

  public async read(params: CliUpdateStep): Promise<string> {
    return await this.execute(params);
  }
}

const cliUpdateCommand = new CliUpdateCommand();
const packageService = new PackageService();
const packageRoot = packageService.findRoot({ moduleUrl: import.meta.url });

export class CliUpdater extends defineRuntime({
  params: {
    packageRoot,
    currentVersion: packageService.readVersion({ packageRoot }),
  },
  deps: {
    executableExists: existsSync,
    readCommand: function readCommand(step: CliUpdateStep) {
      return cliUpdateCommand.read(step);
    },
    runCommand: function runCommand(step: CliUpdateStep) {
      return cliUpdateCommand.run(step);
    },
  },
}) {
  private parseLatestVersion(output: string): string {
    let value: unknown;
    try {
      value = JSON.parse(output);
    } catch {
      throw new Error("npm returned an invalid latest lgtm version.");
    }
    if (typeof value !== "string") {
      throw new Error("npm returned an invalid latest lgtm version.");
    }
    const isEmptyVersion = value.trim().length === 0;
    if (isEmptyVersion) {
      throw new Error("npm returned an invalid latest lgtm version.");
    }
    return value;
  }

  public async plan(params: {}): Promise<CliUpdatePlan> {
    void params;
    const packageRootPath = resolve(this.params.packageRoot);
    const scopeDirectory = dirname(packageRootPath);
    const nodeModulesDirectory = dirname(scopeDirectory);
    const libDirectory = dirname(nodeModulesDirectory);
    const isOutsideGlobalInstallation =
      basename(packageRootPath) !== "lgtm" ||
      basename(scopeDirectory) !== "@rendotdev" ||
      basename(nodeModulesDirectory) !== "node_modules" ||
      basename(libDirectory) !== "lib";
    if (isOutsideGlobalInstallation) {
      return {
        status: "skipped",
        reason: "lgtm is not running from a global npm installation.",
      };
    }

    const prefix = dirname(libDirectory);
    const npm = join(prefix, "bin", "npm");
    if (!this.deps.executableExists(npm)) {
      return {
        status: "skipped",
        reason: `The npm executable for this installation was not found at ${npm}.`,
      };
    }

    const latestVersion = this.parseLatestVersion(
      await this.deps.readCommand({
        command: npm,
        args: ["view", "@rendotdev/lgtm@latest", "version", "--json"],
      }),
    );
    if (latestVersion === this.params.currentVersion) {
      return { status: "current", version: this.params.currentVersion };
    }

    return {
      status: "ready",
      currentVersion: this.params.currentVersion,
      latestVersion,
      step: {
        command: npm,
        args: ["install", "--global", "--prefix", prefix, `@rendotdev/lgtm@${latestVersion}`],
      },
    };
  }

  public getCurrentVersion(params: {}): string {
    void params;
    return this.params.currentVersion;
  }

  public async update(params: { plan?: CliUpdatePlan }): Promise<CliUpdateResult> {
    const updatePlan = params.plan ?? (await this.plan({}));
    if (updatePlan.status !== "ready") {
      return updatePlan;
    }
    const output = await this.deps.runCommand(updatePlan.step);
    return {
      status: "updated",
      previousVersion: updatePlan.currentVersion,
      version: updatePlan.latestVersion,
      step: updatePlan.step,
      output,
    };
  }
}
