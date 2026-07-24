import { describe, expect, it } from "vite-plus/test";
import { TerminalColors, TerminalIcons } from "./theme.ts";

describe("TerminalColors", () => {
  it("defines the shared terminal palette", () => {
    const Colors = TerminalColors;

    expect(Colors).toMatchObject({
      loading: "cyan",
      success: "green",
      error: "red",
      muted: "gray",
    });
  });
});

describe("TerminalIcons", () => {
  it("defines status icons and cycles loading frames", () => {
    const Icons = TerminalIcons;

    expect(Icons.success).toBe("✔");
    expect(Icons.error).toBe("✖");
    expect(Icons.loading({ frame: 0 })).toBe("⠋");
    expect(Icons.loading({ frame: 10 })).toBe("⠋");
  });
});
