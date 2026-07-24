import { AgentInstall } from "../../../../domains/setup/index.ts";
import type { CliContext } from "../../context/context.ts";

export async function runSetupCommand(context: CliContext): Promise<void> {
  const targetValue = context.args.takeOption({ option: "--target" }) ?? "all";
  const target = AgentInstall.parseTarget({ value: targetValue });
  if (!target) {
    throw new Error("setup --target must be one of: all, pi, claude, codex.");
  }
  const plan = AgentInstall.createInstallPlan({ target });
  if (context.args.takeFlag({ flag: "--dry-run" })) {
    await context.runner.run({
      label: "Planning lgtm setup",
      execute: async () => ({ action: "setup" as const, target, steps: plan, dryRun: true }),
      renderSuccess: function renderSuccess(result) {
        return context.renderer.formatIntegrationResult(result);
      },
    });
    return;
  }
  await context.runner.run({
    label: "Setting up lgtm integrations",
    execute: async () => ({
      action: "setup" as const,
      target,
      steps: await context.agentInstaller.install({ target }),
    }),
    renderSuccess: function renderSuccess(result) {
      return context.renderer.formatIntegrationResult(result);
    },
  });
}
