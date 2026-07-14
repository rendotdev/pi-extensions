import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DomainClass } from "../../domain/domain-class.ts";

export type CliUpdateStep = {
  command: string;
  args: string[];
};

export type CliUpdatePlan =
  | {
      status: "ready";
      currentVersion: string;
      latestVersion: string;
      step: CliUpdateStep;
    }
  | { status: "current"; version: string }
  | { status: "skipped"; reason: string };

export type CliUpdateResult =
  | {
      status: "updated";
      previousVersion: string;
      version: string;
      step: CliUpdateStep;
      output: string;
    }
  | { status: "current"; version: string }
  | { status: "skipped"; reason: string };

type CliUpdaterDependencies = {
  executableExists: (path: string) => boolean;
  readCommand: (step: CliUpdateStep) => Promise<string>;
  runCommand: (step: CliUpdateStep) => Promise<string>;
};

type CliUpdateCommandRunnerDependencies = {
  spawn: typeof spawn;
};

type PackageRootFinderDependencies = {
  existsSync: typeof existsSync;
  readFileSync: typeof readFileSync;
};

type PackageVersionReaderDependencies = {
  readFileSync: typeof readFileSync;
};

export class CliUpdateCommandRunnerClass extends DomainClass<
  {},
  CliUpdateCommandRunnerDependencies
> {
  public async run(params: CliUpdateStep): Promise<string> {
    return await this.execute(params);
  }

  public async read(params: CliUpdateStep): Promise<string> {
    return await this.execute(params);
  }

  private async execute(params: CliUpdateStep): Promise<string> {
    const { spawn: spawnCommand } = this.deps;
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
}

export class CliUpdaterClass extends DomainClass<
  { packageRoot: string; currentVersion: string },
  CliUpdaterDependencies
> {
  public constructor(
    params: { packageRoot: string; currentVersion: string },
    deps: CliUpdaterDependencies,
  ) {
    super({ ...params, packageRoot: resolve(params.packageRoot) }, deps);
  }

  public async plan(): Promise<CliUpdatePlan> {
    const scopeDirectory = dirname(this.params.packageRoot);
    const nodeModulesDirectory = dirname(scopeDirectory);
    const libDirectory = dirname(nodeModulesDirectory);
    if (
      basename(this.params.packageRoot) !== "lgtm" ||
      basename(scopeDirectory) !== "@rendotdev" ||
      basename(nodeModulesDirectory) !== "node_modules" ||
      basename(libDirectory) !== "lib"
    ) {
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

  public getCurrentVersion(): string {
    return this.params.currentVersion;
  }

  public async update(params: { plan?: CliUpdatePlan }): Promise<CliUpdateResult> {
    const plan = params.plan ?? (await this.plan());
    if (plan.status !== "ready") {
      return plan;
    }
    const output = await this.deps.runCommand(plan.step);
    return {
      status: "updated",
      previousVersion: plan.currentVersion,
      version: plan.latestVersion,
      step: plan.step,
      output,
    };
  }

  private parseLatestVersion(output: string): string {
    let value: unknown;
    try {
      value = JSON.parse(output);
    } catch {
      throw new Error("npm returned an invalid latest lgtm version.");
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("npm returned an invalid latest lgtm version.");
    }
    return value;
  }
}

export class PackageRootFinderClass extends DomainClass<{}, PackageRootFinderDependencies> {
  public find(params: { moduleUrl: string }): string {
    let directory = dirname(fileURLToPath(params.moduleUrl));
    const root = parse(directory).root;
    while (directory !== root) {
      const packageJson = join(directory, "package.json");
      if (this.deps.existsSync(packageJson)) {
        const manifest = JSON.parse(this.deps.readFileSync(packageJson, "utf8")) as {
          name?: unknown;
        };
        if (manifest.name === "@rendotdev/lgtm") {
          return directory;
        }
      }
      directory = dirname(directory);
    }
    throw new Error("Could not locate the lgtm package root.");
  }
}

export class PackageVersionReaderClass extends DomainClass<{}, PackageVersionReaderDependencies> {
  public read(params: { packageRoot: string }): string {
    const manifest = JSON.parse(
      this.deps.readFileSync(join(params.packageRoot, "package.json"), "utf8"),
    ) as { version?: unknown };
    if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
      throw new Error("The lgtm package does not declare a valid version.");
    }
    return manifest.version;
  }
}

const CliUpdateCommandRunner = new CliUpdateCommandRunnerClass({}, { spawn });
const PackageRootFinder = new PackageRootFinderClass({}, { existsSync, readFileSync });
const PackageVersionReader = new PackageVersionReaderClass({}, { readFileSync });
const packageRoot = PackageRootFinder.find({ moduleUrl: import.meta.url });

export const CliUpdater = new CliUpdaterClass(
  { packageRoot, currentVersion: PackageVersionReader.read({ packageRoot }) },
  {
    executableExists: existsSync,
    readCommand: function readCommand(step) {
      return CliUpdateCommandRunner.read(step);
    },
    runCommand: function runCommand(step) {
      return CliUpdateCommandRunner.run(step);
    },
  },
);
