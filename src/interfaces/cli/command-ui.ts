import { Text, render } from "ink";
import { createElement, useEffect, useState } from "react";
import { DomainClass } from "../../domain/domain-class.ts";

const brailleFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type CommandUiState = "loading" | "success" | "error";
type CommandUiRendererParams = {};
type CommandUiRendererDeps = {};

function CommandUi(props: { state: CommandUiState; label: string; detail?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (props.state !== "loading") return;
    const interval = setInterval(() => {
      setFrame((currentFrame) => (currentFrame + 1) % brailleFrames.length);
    }, 80);
    return () => clearInterval(interval);
  }, [props.state]);

  const symbol =
    props.state === "loading" ? brailleFrames[frame] : props.state === "success" ? "✔" : "✖";
  const color = props.state === "success" ? "green" : props.state === "error" ? "red" : "cyan";
  return createElement(
    Text,
    { color },
    `${symbol} ${props.label}${props.detail ? `\n${props.detail}` : ""}`,
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
    if (!process.stdout.isTTY) {
      const result = await params.execute(() => undefined);
      console.log(`✔ ${params.label}\n${params.renderSuccess(result)}`);
      return result;
    }
    const instance = render(createElement(CommandUi, { state: "loading", label: params.label }), {
      patchConsole: false,
    });
    const report = (label: string) => {
      instance.rerender(createElement(CommandUi, { state: "loading", label }));
    };

    try {
      const result = await params.execute(report);
      instance.rerender(
        createElement(CommandUi, {
          state: "success",
          label: params.label,
          detail: params.renderSuccess(result),
        }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      instance.unmount();
      return result;
    } catch (error) {
      instance.rerender(
        createElement(CommandUi, {
          state: "error",
          label: params.label,
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      instance.unmount();
      throw error;
    }
  }

  public formatDetail(params: { lines: string[] }): string {
    return params.lines.join("\n");
  }
}

export const CommandUiRenderer = new CommandUiRendererClass({}, {});
