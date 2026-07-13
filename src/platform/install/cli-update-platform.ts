import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DomainClass } from "../../domain/domain-class.ts";

export type CliUpdateStep = {
  command: string;
  args: string[];
};

export type CliUpdateResult =
  | { status: "updated"; step: CliUpdateStep }
  | { status: "skipped"; reason: string };

type CliUpdaterDependencies = {
  executableExists: (path: string) => boolean;
  runCommand: (step: CliUpdateStep) => Promise<void>;
};

type CliUpdateCommandRunnerDependencies = {
  spawn: typeof spawn;
};

export class CliUpdateCommandRunnerClass extends DomainClass<
  {},
  CliUpdateCommandRunnerDependencies
> {
  public async run(params: CliUpdateStep): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const child = this.deps.spawn(params.command, params.args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const output: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer | string) => output.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk: Buffer | string) => output.push(Buffer.from(chunk)));
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) {
          resolvePromise();
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

export class CliUpdaterClass extends DomainClass<{ packageRoot: string }, CliUpdaterDependencies> {
  private readonly packageRoot: string;

  public constructor(params: { packageRoot: string }, deps: CliUpdaterDependencies) {
    super(params, deps);
    this.packageRoot = resolve(params.packageRoot);
  }

  public plan(): CliUpdateResult {
    const scopeDirectory = dirname(this.packageRoot);
    const nodeModulesDirectory = dirname(scopeDirectory);
    const libDirectory = dirname(nodeModulesDirectory);
    if (
      basename(this.packageRoot) !== "lgtm" ||
      basename(scopeDirectory) !== "@rendotdev" ||
      basename(nodeModulesDirectory) !== "node_modules" ||
      basename(libDirectory) !== "lib"
    ) {
      return {
        status: "skipped",
        reason: "LGTM is not running from a global npm installation.",
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

    return {
      status: "updated",
      step: {
        command: npm,
        args: ["install", "--global", "--prefix", prefix, "@rendotdev/lgtm@latest"],
      },
    };
  }

  public async update(): Promise<CliUpdateResult> {
    const result = this.plan();
    if (result.status === "updated") await this.deps.runCommand(result.step);
    return result;
  }
}

function findPackageRoot(moduleUrl: string): string {
  let directory = dirname(fileURLToPath(moduleUrl));
  const root = parse(directory).root;
  while (directory !== root) {
    const packageJson = join(directory, "package.json");
    if (existsSync(packageJson)) {
      const manifest = JSON.parse(readFileSync(packageJson, "utf8")) as { name?: unknown };
      if (manifest.name === "@rendotdev/lgtm") return directory;
    }
    directory = dirname(directory);
  }
  throw new Error("Could not locate the LGTM package root.");
}

const cliUpdateCommandRunner = new CliUpdateCommandRunnerClass({}, { spawn });

export const cliUpdater = new CliUpdaterClass(
  { packageRoot: findPackageRoot(import.meta.url) },
  { executableExists: existsSync, runCommand: (step) => cliUpdateCommandRunner.run(step) },
);
