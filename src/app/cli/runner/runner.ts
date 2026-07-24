import { defineRuntime } from "../../../define.ts";
import { CommandUiRenderer, type CommandUiReporter } from "../ui/ui.tsx";

export class CliCommandRunner extends defineRuntime({
  params: { jsonOutput: false },
  deps: {
    markErrorRendered: function markErrorRendered() {},
    renderer: new CommandUiRenderer(),
    writeJson: function writeJson(value: unknown) {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    },
  },
}) {
  public async run<Result>(params: {
    label: string;
    successLabel?: string;
    execute: (report: CommandUiReporter) => Promise<Result>;
    renderSuccess: (result: Result) => string;
  }): Promise<Result> {
    if (this.params.jsonOutput) {
      const result = await params.execute(this.deps.renderer.createSilentReporter({}));
      this.deps.writeJson(result);
      return result;
    }
    try {
      return await this.deps.renderer.run(params);
    } catch (error) {
      this.deps.markErrorRendered();
      throw error;
    }
  }
}
