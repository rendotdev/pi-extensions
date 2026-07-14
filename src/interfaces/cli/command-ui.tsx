import { Text, render, useAnimation, type Instance } from "ink";
import type { ReactElement } from "react";
import { DomainClass } from "../../domain/domain-class.ts";
import type { AgentInstallStep, AgentInstallTarget } from "../../domain/install/agent-install.ts";
import type { CliUpdatePlan, CliUpdateResult } from "../../platform/install/cli-update-platform.ts";

const brailleFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const integrationNames: Record<Exclude<AgentInstallTarget, "all">, string> = {
  pi: "Pi",
  claude: "Claude Code",
  codex: "Codex",
};

type CommandUiState = "loading" | "success" | "error";
type CommandUiCompletedItem = { label: string; detail?: string };
export type CommandUiReporter = ((label: string) => void) & {
  complete: (params: CommandUiCompletedItem) => void;
};
type CommandUiRendererParams = {};
type CommandUiRendererDeps = {
  stdout: Pick<NodeJS.WriteStream, "isTTY" | "write">;
  render: (
    tree: ReactElement,
    options: { stdout: NodeJS.WriteStream; patchConsole: boolean },
  ) => Pick<Instance, "rerender" | "unmount" | "waitUntilRenderFlush">;
};

export function CommandUi(props: {
  state: CommandUiState;
  label: string;
  detail?: string;
  completed?: CommandUiCompletedItem[];
}) {
  const { frame } = useAnimation({ interval: 80, isActive: props.state === "loading" });
  const symbol =
    props.state === "loading"
      ? brailleFrames[frame % brailleFrames.length]
      : props.state === "success"
        ? "✔"
        : "✖";
  const color = props.state === "success" ? "green" : props.state === "error" ? "red" : "cyan";
  const completed = props.completed
    ?.map(function formatCompleted(item) {
      return `✔ ${item.label}${item.detail ? `\n${item.detail}` : ""}`;
    })
    .join("\n");
  const current = props.label
    ? `${symbol} ${props.label}${props.detail ? `\n${props.detail}` : ""}`
    : "";

  return (
    <Text>
      {completed ? <Text color="green">{completed}</Text> : null}
      {completed && current ? "\n" : ""}
      {current ? <Text color={color}>{current}</Text> : null}
    </Text>
  );
}

export class CommandUiRendererClass extends DomainClass<
  CommandUiRendererParams,
  CommandUiRendererDeps
> {
  public async run<Result>(params: {
    label: string;
    successLabel?: string;
    execute: (report: CommandUiReporter) => Promise<Result>;
    renderSuccess: (result: Result) => string;
  }): Promise<Result> {
    const successLabel = params.successLabel ?? params.label;
    const completed: CommandUiCompletedItem[] = [];
    if (!this.deps.stdout.isTTY) {
      const reporter = this.createReporter({
        onUpdate: function ignoreUpdate() {},
        onComplete: function captureCompleted(item) {
          completed.push(item);
        },
      });
      const result = await params.execute(reporter);
      const detail = params.renderSuccess(result);
      const output = [this.formatCompleted({ completed }), `✔ ${successLabel}`, detail]
        .filter(Boolean)
        .join("\n");
      this.deps.stdout.write(`${output}\n`);
      return result;
    }

    const instance = this.deps.render(<CommandUi state="loading" label={params.label} />, {
      stdout: this.deps.stdout as NodeJS.WriteStream,
      patchConsole: false,
    });
    let currentLabel = params.label;
    function report(label: string) {
      currentLabel = label;
      instance.rerender(<CommandUi state="loading" label={label} completed={completed} />);
    }
    const reporter = this.createReporter({
      onUpdate: report,
      onComplete: function complete(item) {
        completed.push(item);
        currentLabel = "";
        instance.rerender(<CommandUi state="loading" label="" completed={completed} />);
      },
    });

    try {
      const result = await params.execute(reporter);
      instance.rerender(
        <CommandUi
          state="success"
          label={successLabel}
          detail={params.renderSuccess(result)}
          completed={completed}
        />,
      );
      await instance.waitUntilRenderFlush();
      instance.unmount();
      return result;
    } catch (error) {
      instance.rerender(
        <CommandUi
          state="error"
          label={currentLabel || params.label}
          detail={error instanceof Error ? error.message : String(error)}
          completed={completed}
        />,
      );
      await instance.waitUntilRenderFlush();
      instance.unmount();
      throw error;
    }
  }

  public formatDetail(params: { lines: string[] }): string {
    return params.lines.join("\n");
  }

  public formatChecklist(params: { lines: string[] }): string {
    return this.formatDetail({ lines: params.lines.map((line) => `✔ ${line}`) });
  }

  public createSilentReporter(): CommandUiReporter {
    return this.createReporter({
      onUpdate: function ignoreUpdate() {},
      onComplete: function ignoreComplete() {},
    });
  }

  public formatIntegrationName(params: { target: Exclude<AgentInstallTarget, "all"> }): string {
    return integrationNames[params.target];
  }

  public formatLogGroup(params: { outputs: string[] }): string | undefined {
    const lines = params.outputs
      .flatMap(function splitOutput(output) {
        return output.trim().split("\n");
      })
      .filter(function removeEmptyLines(line) {
        return line.trim().length > 0;
      });
    if (lines.length === 0) {
      return undefined;
    }
    return `  Logs:\n${lines
      .map(function indent(line) {
        return `    ${line}`;
      })
      .join("\n")}`;
  }

  public formatIntegrationResult(params: {
    action: "setup" | "update";
    target: AgentInstallTarget;
    steps: AgentInstallStep[];
    skippedTargets?: Exclude<AgentInstallTarget, "all">[];
    cli?: CliUpdatePlan | CliUpdateResult;
    dryRun?: boolean;
  }): string {
    const lines: string[] = [];
    if (params.action === "setup") {
      lines.push(
        params.dryRun
          ? `Would set up lgtm integrations for ${params.target}.`
          : `Set up lgtm integrations for ${params.target}. Start a new agent session to load the plugin and skill.`,
      );
      return this.formatChecklist({ lines });
    }

    if (params.cli?.status === "ready") {
      lines.push(
        `  CLI: would update from ${params.cli.currentVersion} to ${params.cli.latestVersion}`,
      );
    }
    if (params.cli?.status === "updated") {
      lines.push(`  CLI: updated from ${params.cli.previousVersion} to ${params.cli.version}`);
    }
    if (params.cli?.status === "current") {
      lines.push(`  CLI: already current at ${params.cli.version}`);
    }
    if (params.cli?.status === "skipped") {
      lines.push(`  CLI: skipped; ${params.cli.reason}`);
    }

    const updatedTargets = [
      ...new Set(
        params.steps.map(function selectTarget(step) {
          return step.target;
        }),
      ),
    ];
    const ListFormatter = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
    if (updatedTargets.length > 0) {
      const targets = ListFormatter.format(
        updatedTargets.map(function selectName(target) {
          return integrationNames[target];
        }),
      );
      lines.push(`  Integrations: ${params.dryRun ? "would update" : "updated"} (${targets})`);
      if (!params.dryRun) {
        lines.push("  Restart your agent session to load the updated plugin and skill.");
      }
    }
    return this.formatDetail({ lines });
  }

  private createReporter(params: {
    onUpdate: (label: string) => void;
    onComplete: (item: CommandUiCompletedItem) => void;
  }): CommandUiReporter {
    function report(label: string) {
      params.onUpdate(label);
    }
    const reporter = report as CommandUiReporter;
    reporter.complete = function complete(item) {
      params.onComplete(item);
    };
    return reporter;
  }

  private formatCompleted(params: { completed: CommandUiCompletedItem[] }): string {
    return params.completed
      .map(function formatItem(item) {
        return `✔ ${item.label}${item.detail ? `\n${item.detail}` : ""}`;
      })
      .join("\n");
  }
}

export const CommandUiRenderer = new CommandUiRendererClass(
  {},
  {
    stdout: process.stdout,
    render,
  },
);
