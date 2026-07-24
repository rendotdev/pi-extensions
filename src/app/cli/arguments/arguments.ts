export class CliArguments {
  private readonly values: string[];

  public constructor(values: readonly string[]) {
    this.values = [...values];
    if (this.values[0] === "--") {
      this.values.shift();
    }
  }

  public takeCommand(params: { fallback: string }): string {
    const isHelpRequested = this.values.includes("--help") || this.values.includes("-h");
    if (isHelpRequested) {
      return "help";
    }
    const candidate = this.values[0];
    const isMissingCommand = !candidate || candidate.startsWith("--");
    if (isMissingCommand) {
      return params.fallback;
    }
    this.values.shift();
    return candidate;
  }

  public takeFlag(params: { flag: string }): boolean {
    const index = this.values.indexOf(params.flag);
    if (index < 0) {
      return false;
    }
    this.values.splice(index, 1);
    return true;
  }

  public takeOption(params: { option: string }): string | undefined {
    const index = this.values.indexOf(params.option);
    if (index < 0) {
      return undefined;
    }
    const value = this.values[index + 1];
    const isMissingValue = !value || value.startsWith("--");
    if (isMissingValue) {
      throw new Error(`${params.option} requires a value.`);
    }
    this.values.splice(index, 2);
    return value;
  }

  public takePositional(params: {}): string | undefined {
    void params;
    const candidate = this.values[0];
    const isMissingPositional = !candidate || candidate.startsWith("--");
    if (isMissingPositional) {
      return undefined;
    }
    this.values.shift();
    return candidate;
  }
}
