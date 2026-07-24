import type {
  AgentInstallTarget,
  AgentUpdateEvent,
  CliUpdatePlan,
  CliUpdateResult,
} from "../../../../domains/setup/index.ts";
import { AgentInstall } from "../../../../domains/setup/index.ts";
import type { CliContext } from "../../context/context.ts";
import type { CommandUiReporter } from "../../ui/ui.tsx";

export async function runUpdateCommand(context: CliContext): Promise<void> {
  const targetValue = context.args.takeOption({ option: "--target" }) ?? "all";
  const target = AgentInstall.parseTarget({ value: targetValue });
  if (!target) {
    throw new Error("update --target must be one of: all, pi, claude, codex.");
  }
  const plan = AgentInstall.createUpdatePlan({ target });
  if (context.args.takeFlag({ flag: "--dry-run" })) {
    await runDryUpdate(context, target, plan);
    return;
  }
  await context.runner.run({
    label: "Preparing lgtm update",
    successLabel: "Update finished",
    execute: async (report) => await executeUpdate(context, target, report),
    renderSuccess: function renderSuccess() {
      return "• Restart your agent session to reload lgtm integrations, or use the lgtm CLI now.";
    },
  });
}

async function runDryUpdate(
  context: CliContext,
  target: AgentInstallTarget,
  steps: ReturnType<typeof AgentInstall.createUpdatePlan>,
): Promise<void> {
  await context.runner.run({
    label: "Planning lgtm update",
    execute: async () => ({
      action: "update" as const,
      target,
      steps,
      cli: await context.cliUpdater.plan({}),
      dryRun: true,
    }),
    renderSuccess: function renderSuccess(result) {
      return context.renderer.formatIntegrationResult(result);
    },
  });
}

async function executeUpdate(
  context: CliContext,
  target: AgentInstallTarget,
  report: CommandUiReporter,
) {
  report.complete({ label: `Current version: ${context.cliUpdater.getCurrentVersion({})}` });
  const cli = await updateCli(context, report);
  report("Checking integrations");
  const integrations = await context.agentUpdater.update({
    target,
    onUpdate: (event) => reportIntegrationUpdate(context, report, event),
  });
  return { action: "update" as const, target, cli, ...integrations };
}

async function updateCli(
  context: CliContext,
  report: CommandUiReporter,
): Promise<CliUpdatePlan | CliUpdateResult> {
  report("Checking for updates");
  const plan = await context.cliUpdater.plan({});
  if (plan.status === "current") {
    report.complete({ label: "Already up to date" });
    return plan;
  }
  if (plan.status === "skipped") {
    report.complete({ label: "CLI update unavailable", detail: `  ${plan.reason}` });
    return plan;
  }
  report.complete({ label: `Update available: ${plan.currentVersion} to ${plan.latestVersion}` });
  report("Updating CLI");
  const result = await context.cliUpdater.update({ plan });
  if (result.status !== "updated") {
    throw new Error("lgtm did not apply the available CLI update.");
  }
  report.complete({
    label: `Updated CLI: ${result.previousVersion} to ${result.version}`,
    detail: context.renderer.formatCommandOutputGroups({
      steps: [result.step],
      outputs: [result.output],
    }),
    mutedDetail: true,
  });
  return result;
}

function reportIntegrationUpdate(
  context: CliContext,
  report: CommandUiReporter,
  event: AgentUpdateEvent,
): void {
  const name = context.renderer.formatIntegrationName({ target: event.target });
  const label = `Updating integration: ${name}`;
  if (event.phase === "started") {
    report(label);
    return;
  }
  report.complete({
    label,
    detail: context.renderer.formatCommandOutputGroups({
      steps: event.steps,
      outputs: event.outputs,
    }),
    mutedDetail: true,
  });
}
