import { Text, render, useAnimation, type Instance } from "ink";
import type { ReactElement } from "react";
import { DomainClass } from "../../domain/domain-class.ts";

const brailleFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type CommandUiState = "loading" | "success" | "error";
type CommandUiRendererParams = {};
type CommandUiRendererDeps = {
  stdout: Pick<NodeJS.WriteStream, "isTTY" | "write">;
  render: (
    tree: ReactElement,
    options: { stdout: NodeJS.WriteStream; patchConsole: boolean },
  ) => Pick<Instance, "rerender" | "unmount" | "waitUntilRenderFlush">;
};

export function CommandUi(props: { state: CommandUiState; label: string; detail?: string }) {
  const { frame } = useAnimation({ interval: 80, isActive: props.state === "loading" });
  const symbol =
    props.state === "loading"
      ? brailleFrames[frame % brailleFrames.length]
      : props.state === "success"
        ? "✔"
        : "✖";
  const color = props.state === "success" ? "green" : props.state === "error" ? "red" : "cyan";

  return (
    <Text color={color}>
      {symbol} {props.label}
      {props.detail ? `\n${props.detail}` : ""}
    </Text>
  );
}

export class CommandUiRendererClass extends DomainClass<
  CommandUiRendererParams,
  CommandUiRendererDeps
> {
  public async run<Result>(params: {
    label: string;
    execute: (report: (label: string) => void) => Promise<Result>;
    renderSuccess: (result: Result) => string;
  }): Promise<Result> {
    if (!this.deps.stdout.isTTY) {
      const result = await params.execute(function ignoreReport() {});
      this.deps.stdout.write(`✔ ${params.label}\n${params.renderSuccess(result)}\n`);
      return result;
    }

    const instance = this.deps.render(<CommandUi state="loading" label={params.label} />, {
      stdout: this.deps.stdout as NodeJS.WriteStream,
      patchConsole: false,
    });
    function report(label: string) {
      instance.rerender(<CommandUi state="loading" label={label} />);
    }

    try {
      const result = await params.execute(report);
      instance.rerender(
        <CommandUi state="success" label={params.label} detail={params.renderSuccess(result)} />,
      );
      await instance.waitUntilRenderFlush();
      instance.unmount();
      return result;
    } catch (error) {
      instance.rerender(
        <CommandUi
          state="error"
          label={params.label}
          detail={error instanceof Error ? error.message : String(error)}
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
}

export const CommandUiRenderer = new CommandUiRendererClass(
  {},
  {
    stdout: process.stdout,
    render,
  },
);
