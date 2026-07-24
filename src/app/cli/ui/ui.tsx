import { basename } from "node:path";
import { Text, render, useAnimation, type Instance } from "ink";
import type { ReactElement } from "react";
import { defineRuntime, defineUIComponent } from "../../../define.ts";
import type {
  AgentInstallStep,
  AgentInstallTarget,
  CliUpdatePlan,
  CliUpdateResult,
} from "../../../domains/setup/index.ts";
import { TerminalColors, TerminalIcons } from "../theme/theme.ts";

const integrationNames: Record<Exclude<AgentInstallTarget, "all">, string> = {
  pi: "Pi",
  claude: "Claude Code",
  codex: "Codex",
};

type CommandUiState = "loading" | "success" | "error";
type CommandUiCompletedItem = { label: string; detail?: string; mutedDetail?: boolean };
export type CommandUiReporter = ((label: string) => void) & {
  complete: (params: CommandUiCompletedItem) => void;
};

function asCommandUiStdout(
  stdout: Pick<NodeJS.WriteStream, "isTTY" | "write">,
): Pick<NodeJS.WriteStream, "isTTY" | "write"> {
  return stdout;
}
export const CommandUi = defineUIComponent({
  params: {},
  deps: { useAnimation },
  component(props: {
    state: CommandUiState;
    label: string;
    detail?: string;
    completed?: CommandUiCompletedItem[];
  }) {
    const animation = this.deps.useAnimation({ interval: 80, isActive: props.state === "loading" });
    const symbol =
      props.state === "loading"
        ? TerminalIcons.loading({ frame: animation.frame })
        : props.state === "success"
          ? TerminalIcons.success
          : TerminalIcons.error;
    const color =
      props.state === "success"
        ? TerminalColors.success
        : props.state === "error"
          ? TerminalColors.error
          : TerminalColors.loading;
    const hasCompleted = Boolean(props.completed?.length);
    const current = props.label ? `${symbol} ${props.label}` : "";

    return (
      <Text>
        {props.completed?.map(function renderCompleted(item, index) {
          return (
            <Text key={`${index}-${item.label}`}>
              {index > 0 ? "\n" : ""}
              <Text color={TerminalColors.success}>
                {TerminalIcons.success} {item.label}
              </Text>
              {item.detail ? (
                <Text color={item.mutedDetail ? TerminalColors.muted : TerminalColors.success}>
                  {`\n${item.detail}`}
                </Text>
              ) : null}
            </Text>
          );
        })}
        {hasCompleted && current ? "\n" : ""}
        {current ? <Text color={color}>{current}</Text> : null}
        {props.detail ? (
          <Text color={props.state === "success" ? TerminalColors.foreground : color}>
            {`${current ? "\n" : ""}${props.detail}`}
          </Text>
        ) : null}
      </Text>
    );
  },
});

export class CommandUiRenderer extends defineRuntime({
  params: {},
  deps: {
    stdout: asCommandUiStdout(process.stdout),
    render: function renderCommandUi(
      tree: ReactElement,
      options: {
        stdout: Pick<NodeJS.WriteStream, "isTTY" | "write">;
        patchConsole: boolean;
      },
    ): Pick<Instance, "rerender" | "unmount" | "waitUntilRenderFlush"> {
      return render(tree, {
        stdout: options.stdout as NodeJS.WriteStream,
        patchConsole: options.patchConsole,
      });
    },
  },
}) {
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
      const output = [
        this.formatCompleted({ completed }),
        `${TerminalIcons.success} ${successLabel}`,
        detail,
      ]
        .filter(Boolean)
        .join("\n");
      this.deps.stdout.write(`${output}\n`);
      return result;
    }

    const instance = this.deps.render(<CommandUi state="loading" label={params.label} />, {
      stdout: this.deps.stdout,
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
    return this.formatDetail({
      lines: params.lines.map((line) => `${TerminalIcons.success} ${line}`),
    });
  }

  public createSilentReporter(params: {}): CommandUiReporter {
    void params;
    return this.createReporter({
      onUpdate: function ignoreUpdate() {},
      onComplete: function ignoreComplete() {},
    });
  }

  public formatIntegrationName(params: { target: Exclude<AgentInstallTarget, "all"> }): string {
    return integrationNames[params.target];
  }

  public formatCommandOutputGroups(params: {
    steps: { command: string; args: string[] }[];
    outputs: string[];
  }): string | undefined {
    const groups = params.steps.flatMap(function formatStep(step, index) {
      const output = params.outputs[index]?.trim();
      if (!output) {
        return [];
      }
      const command = [basename(step.command), ...step.args].join(" ");
      return [
        `  ${command}`,
        ...output.split("\n").map(function indent(line) {
          return `    ${line}`;
        }),
      ];
    });
    if (groups.length === 0) {
      return undefined;
    }
    return groups.join("\n");
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
        return `${TerminalIcons.success} ${item.label}${item.detail ? `\n${item.detail}` : ""}`;
      })
      .join("\n");
  }
}
