import type { TextProps } from "ink";
import { DomainClass } from "../../domain/domain-class.ts";

export class TerminalColorsClass extends DomainClass<{}, {}> {
  public readonly loading: NonNullable<TextProps["color"]> = "cyan";
  public readonly success: NonNullable<TextProps["color"]> = "green";
  public readonly error: NonNullable<TextProps["color"]> = "red";
  public readonly muted: NonNullable<TextProps["color"]> = "gray";
}

export class TerminalIconsClass extends DomainClass<{}, {}> {
  public readonly success = "✔";
  public readonly error = "✖";
  private readonly loadingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  public loading(params: { frame: number }): string {
    return this.loadingFrames[params.frame % this.loadingFrames.length];
  }
}

export const TerminalColors = new TerminalColorsClass({}, {});
export const TerminalIcons = new TerminalIconsClass({}, {});
