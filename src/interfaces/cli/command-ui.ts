import { DomainClass } from "../../domain/domain-class.ts";

const brailleFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const clearLine = "\r\u001B[2K";

type CommandUiTimer = ReturnType<typeof setInterval>;
type CommandUiRendererParams = {};
type CommandUiRendererDeps = {
  stdout: Pick<NodeJS.WriteStream, "isTTY" | "write">;
  setInterval: (callback: () => void, milliseconds: number) => CommandUiTimer;
  clearInterval: (timer: CommandUiTimer) => void;
};

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
      const result = await params.execute(() => undefined);
      this.deps.stdout.write(`✔ ${params.label}\n${params.renderSuccess(result)}\n`);
      return result;
    }

    let frame = 0;
    let label = params.label;
    const renderLoading = () => {
      this.renderLine({ color: 36, content: `${brailleFrames[frame]} ${label}` });
    };
    const report = (nextLabel: string) => {
      label = nextLabel;
      renderLoading();
    };

    renderLoading();
    const timer = this.deps.setInterval(() => {
      frame = (frame + 1) % brailleFrames.length;
      renderLoading();
    }, 80);

    try {
      const result = await params.execute(report);
      this.deps.clearInterval(timer);
      this.renderResult({
        color: 32,
        symbol: "✔",
        label: params.label,
        detail: params.renderSuccess(result),
      });
      return result;
    } catch (error) {
      this.deps.clearInterval(timer);
      this.renderResult({
        color: 31,
        symbol: "✖",
        label: params.label,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public formatDetail(params: { lines: string[] }): string {
    return params.lines.join("\n");
  }

  public formatChecklist(params: { lines: string[] }): string {
    return this.formatDetail({ lines: params.lines.map((line) => `✔ ${line}`) });
  }

  private renderLine(params: { color: number; content: string }): void {
    this.deps.stdout.write(`${clearLine}\u001B[${params.color}m${params.content}\u001B[39m`);
  }

  private renderResult(params: {
    color: number;
    symbol: string;
    label: string;
    detail: string;
  }): void {
    this.renderLine({ color: params.color, content: `${params.symbol} ${params.label}` });
    this.deps.stdout.write(`\n${params.detail}\n`);
  }
}

export const CommandUiRenderer = new CommandUiRendererClass(
  {},
  {
    stdout: process.stdout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  },
);
