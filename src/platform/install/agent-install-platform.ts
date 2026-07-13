import { spawn } from "node:child_process";
import {
  agentInstallPlanner,
  type AgentInstallStep,
  type AgentInstallTarget,
} from "../../domain/install/agent-install.ts";

type AgentInstallDependencies = {
  runCommand: (step: AgentInstallStep) => Promise<void>;
};

export class AgentInstallerClass {
  private readonly deps: AgentInstallDependencies;

  public constructor(deps: AgentInstallDependencies) {
    this.deps = deps;
  }

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

export const agentInstaller = new AgentInstallerClass({ runCommand });
