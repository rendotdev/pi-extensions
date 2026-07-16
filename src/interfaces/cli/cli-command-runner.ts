import { DomainClass } from "../../domain/domain-class.ts";
import type { CommandUiRendererClass, CommandUiReporter } from "./command-ui.tsx";

export class CliCommandRunnerClass extends DomainClass<
  { jsonOutput: boolean },
  {
    markErrorRendered: () => void;
    renderer: Pick<CommandUiRendererClass, "createSilentReporter" | "run">;
    writeJson: (value: unknown) => void;
  }
> {
  public async run<Result>(params: {
    label: string;
    successLabel?: string;
    execute: (report: CommandUiReporter) => Promise<Result>;
    renderSuccess: (result: Result) => string;
  }): Promise<Result> {
    if (this.params.jsonOutput) {
      const result = await params.execute(this.deps.renderer.createSilentReporter());
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
