import { spawn } from "node:child_process";
import {
  AgentInstallPlanner,
  AgentUpdatePlanner,
  type AgentInstallStep,
  type AgentInstallTarget,
} from "../../domain/install/agent-install.ts";
import { DomainClass } from "../../domain/domain-class.ts";

type AgentInstallCommandRunnerDependencies = {
  spawn: typeof spawn;
};

type AgentInstallDependencies = {
  runCommand: (step: AgentInstallStep) => Promise<string>;
};

type AgentUpdateDependencies = AgentInstallDependencies & {
  readCommand: (params: { command: string; args: string[] }) => Promise<string>;
};

export type AgentUpdateResult = {
  steps: AgentInstallStep[];
  skippedTargets: Exclude<AgentInstallTarget, "all">[];
  integrations: {
    target: Exclude<AgentInstallTarget, "all">;
    outputs: string[];
  }[];
};

export type AgentUpdateEvent =
  | { phase: "started"; target: Exclude<AgentInstallTarget, "all"> }
  | {
      phase: "completed";
      target: Exclude<AgentInstallTarget, "all">;
      outputs: string[];
    };

export class AgentInstallCommandRunnerClass extends DomainClass<
  {},
  AgentInstallCommandRunnerDependencies
> {
  public async run(params: { command: string; args: string[] }): Promise<string> {
    return await this.execute(params);
  }

  public async read(params: { command: string; args: string[] }): Promise<string> {
    return await this.execute(params);
  }

  private async execute(params: { command: string; args: string[] }): Promise<string> {
    const { spawn: spawnCommand } = this.deps;
    return await new Promise<string>(function runCommand(resolve, reject) {
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
          resolve(Buffer.concat(output).toString("utf8"));
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

export class AgentInstallerClass extends DomainClass<{}, AgentInstallDependencies> {
  public async install(params: { target: AgentInstallTarget }): Promise<AgentInstallStep[]> {
    const steps = AgentInstallPlanner.createPlan(params);
    for (const step of steps) {
      await this.deps.runCommand(step);
    }
    return steps;
  }
}

export class AgentUpdaterClass extends DomainClass<{}, AgentUpdateDependencies> {
  public async update(params: {
    target: AgentInstallTarget;
    onUpdate?: (event: AgentUpdateEvent) => void;
  }): Promise<AgentUpdateResult> {
    const targets =
      params.target === "all" ? (["pi", "claude", "codex"] as const) : [params.target];
    const installed = await Promise.all(
      targets.map(async (target) => ({ target, installed: await this.isInstalled(target) })),
    );
    const skippedTargets = installed
      .filter((result) => !result.installed)
      .map((result) => result.target);
    const integrations: AgentUpdateResult["integrations"] = [];
    const steps: AgentInstallStep[] = [];
    for (const integration of installed.filter((result) => result.installed)) {
      const integrationSteps = AgentUpdatePlanner.createPlan({ target: integration.target });
      const outputs: string[] = [];
      params.onUpdate?.({ phase: "started", target: integration.target });
      for (const step of integrationSteps) {
        steps.push(step);
        outputs.push(await this.deps.runCommand(step));
      }
      integrations.push({ target: integration.target, outputs });
      params.onUpdate?.({ phase: "completed", target: integration.target, outputs });
    }
    return { steps, skippedTargets, integrations };
  }

  private async isInstalled(target: Exclude<AgentInstallTarget, "all">): Promise<boolean> {
    try {
      if (target === "pi") {
        return (await this.deps.readCommand({ command: "pi", args: ["list"] })).includes(
          "npm:@rendotdev/lgtm",
        );
      }
      if (target === "claude") {
        return (
          await this.deps.readCommand({ command: "claude", args: ["plugin", "list"] })
        ).includes("lgtm@rendotdev");
      }
      const output = await this.deps.readCommand({
        command: "codex",
        args: ["plugin", "list", "--json"],
      });
      const plugins = JSON.parse(output) as { installed?: { pluginId?: unknown }[] };
      return plugins.installed?.some((plugin) => plugin.pluginId === "lgtm@rendotdev") ?? false;
    } catch {
      return false;
    }
  }
}

const AgentInstallCommandRunner = new AgentInstallCommandRunnerClass({}, { spawn });

export const AgentInstaller = new AgentInstallerClass(
  {},
  {
    runCommand: function runCommand(step) {
      return AgentInstallCommandRunner.run(step);
    },
  },
);

export const AgentUpdater = new AgentUpdaterClass(
  {},
  {
    runCommand: function runCommand(step) {
      return AgentInstallCommandRunner.run(step);
    },
    readCommand: function readCommand(params) {
      return AgentInstallCommandRunner.read(params);
    },
  },
);
