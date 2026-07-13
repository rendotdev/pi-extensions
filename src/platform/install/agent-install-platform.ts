import { spawn } from "node:child_process";
import {
  agentInstallPlanner,
  agentUpdatePlanner,
  type AgentInstallStep,
  type AgentInstallTarget,
} from "../../domain/install/agent-install.ts";
import { DomainClass } from "../../domain/domain-class.ts";

type AgentInstallDependencies = {
  runCommand: (step: AgentInstallStep) => Promise<void>;
};

type AgentUpdateDependencies = AgentInstallDependencies & {
  readCommand: (params: { command: string; args: string[] }) => Promise<string>;
};

export type AgentUpdateResult = {
  steps: AgentInstallStep[];
  skippedTargets: Exclude<AgentInstallTarget, "all">[];
};

export class AgentInstallerClass extends DomainClass<{}, AgentInstallDependencies> {
  public async install(params: { target: AgentInstallTarget }): Promise<AgentInstallStep[]> {
    const steps = agentInstallPlanner.createPlan(params);
    for (const step of steps) await this.deps.runCommand(step);
    return steps;
  }
}

async function runCommand(step: AgentInstallStep): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(step.command, step.args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${step.command} exited with ${signal ?? `code ${code ?? "unknown"}`}.`));
    });
  });
}

export const agentInstaller = new AgentInstallerClass({}, { runCommand });

export class AgentUpdaterClass extends DomainClass<{}, AgentUpdateDependencies> {
  public async update(params: { target: AgentInstallTarget }): Promise<AgentUpdateResult> {
    const targets =
      params.target === "all" ? (["pi", "claude", "codex"] as const) : [params.target];
    const installed = await Promise.all(
      targets.map(async (target) => ({ target, installed: await this.isInstalled(target) })),
    );
    const skippedTargets = installed
      .filter((result) => !result.installed)
      .map((result) => result.target);
    const steps = installed
      .filter((result) => result.installed)
      .flatMap((result) => agentUpdatePlanner.createPlan({ target: result.target }));
    for (const step of steps) await this.deps.runCommand(step);
    return { steps, skippedTargets };
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

async function readCommand(params: { command: string; args: string[] }): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(params.command, params.args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${params.command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

export const agentUpdater = new AgentUpdaterClass({}, { runCommand, readCommand });
