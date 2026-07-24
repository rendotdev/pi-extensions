import { spawn } from "node:child_process";
import { defineRuntime } from "../../../../define.ts";
import { AgentInstall } from "../../service/agent-install/agent-install.ts";
import type {
  AgentInstallStep,
  AgentInstallTarget,
  AgentUpdateEvent,
  AgentUpdateResult,
} from "../../types/agent-install/agent-install.ts";

export class AgentInstallCommand extends defineRuntime({ params: {}, deps: { spawn } }) {
  private async execute(params: { command: string; args: string[] }): Promise<string> {
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

  public async run(params: { command: string; args: string[] }): Promise<string> {
    return await this.execute(params);
  }

  public async read(params: { command: string; args: string[] }): Promise<string> {
    return await this.execute(params);
  }
}

const agentInstallCommand = new AgentInstallCommand();

export class AgentInstaller extends defineRuntime({
  params: {},
  deps: {
    runCommand: function runCommand(step: AgentInstallStep) {
      return agentInstallCommand.run(step);
    },
  },
}) {
  public async install(params: { target: AgentInstallTarget }): Promise<AgentInstallStep[]> {
    const steps = AgentInstall.createInstallPlan(params);
    for (const step of steps) {
      await this.deps.runCommand(step);
    }
    return steps;
  }
}

export class AgentUpdater extends defineRuntime({
  params: {},
  deps: {
    runCommand: function runCommand(step: AgentInstallStep) {
      return agentInstallCommand.run(step);
    },
    readCommand: function readCommand(params: { command: string; args: string[] }) {
      return agentInstallCommand.read(params);
    },
  },
}) {
  private async tryIsCodexPluginInstalled(): Promise<boolean> {
    try {
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

  private async tryIsCodexMarketplaceConfigured(): Promise<boolean> {
    try {
      const output = await this.deps.readCommand({
        command: "codex",
        args: ["plugin", "marketplace", "list", "--json"],
      });
      const marketplaces = JSON.parse(output) as { marketplaces?: { name?: unknown }[] };
      return (
        marketplaces.marketplaces?.some((marketplace) => marketplace.name === "rendotdev") ?? false
      );
    } catch {
      return false;
    }
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
      return (
        (await this.tryIsCodexPluginInstalled()) || (await this.tryIsCodexMarketplaceConfigured())
      );
    } catch {
      return false;
    }
  }

  private async checkTarget(target: Exclude<AgentInstallTarget, "all">) {
    return { target, installed: await this.isInstalled(target) };
  }

  public async update(params: {
    target: AgentInstallTarget;
    onUpdate?: (event: AgentUpdateEvent) => void;
  }): Promise<AgentUpdateResult> {
    const targets =
      params.target === "all" ? (["pi", "claude", "codex"] as const) : [params.target];
    const installed = await Promise.all(targets.map(this.checkTarget.bind(this)));
    const skippedTargets = installed
      .filter(function isNotInstalled(result) {
        return !result.installed;
      })
      .map(function getTarget(result) {
        return result.target;
      });
    const integrations: AgentUpdateResult["integrations"] = [];
    const steps: AgentInstallStep[] = [];
    for (const integration of installed.filter(function isInstalledResult(result) {
      return result.installed;
    })) {
      const integrationSteps = AgentInstall.createUpdatePlan({ target: integration.target });
      const outputs: string[] = [];
      params.onUpdate?.({ phase: "started", target: integration.target });
      for (const step of integrationSteps) {
        steps.push(step);
        outputs.push(await this.deps.runCommand(step));
      }
      integrations.push({ target: integration.target, steps: integrationSteps, outputs });
      params.onUpdate?.({
        phase: "completed",
        target: integration.target,
        steps: integrationSteps,
        outputs,
      });
    }
    return { steps, skippedTargets, integrations };
  }
}
