import { describe, expect, it } from "vite-plus/test";
import { CliArguments } from "./arguments.ts";

describe("CliArguments", () => {
  it("parses commands, flags, options, and positional values", () => {
    const args = new CliArguments(["--", "review", "document", "--name", "Plan", "--json"]);

    expect(args.takeCommand({ fallback: "help" })).toBe("review");
    expect(args.takePositional({})).toBe("document");
    expect(args.takeOption({ option: "--name" })).toBe("Plan");
    expect(args.takeFlag({ flag: "--json" })).toBe(true);
  });

  it("maps help flags to the help command", () => {
    expect(new CliArguments(["review", "--help"]).takeCommand({ fallback: "help" })).toBe("help");
  });

  it("rejects options without values", () => {
    const args = new CliArguments(["--cwd"]);
    expect(() => args.takeOption({ option: "--cwd" })).toThrow("--cwd requires a value.");
  });
});
