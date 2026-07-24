import { describe, expect, it } from "vite-plus/test";
import { AgentInstall } from "./agent-install.ts";

describe("AgentInstall", () => {
  it("plans every supported integration in installation order", () => {
    expect(AgentInstall.createInstallPlan({ target: "all" })).toEqual([
      { target: "pi", command: "pi", args: ["install", "npm:@rendotdev/lgtm"] },
      {
        target: "claude",
        command: "claude",
        args: ["plugin", "marketplace", "add", "https://github.com/rendotdev/lgtm"],
      },
      { target: "claude", command: "claude", args: ["plugin", "install", "lgtm@rendotdev"] },
      {
        target: "codex",
        command: "codex",
        args: ["plugin", "marketplace", "add", "rendotdev/lgtm"],
      },
      { target: "codex", command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
    ]);
  });

  it("plans only the requested integration and parses target names", () => {
    expect(AgentInstall.createInstallPlan({ target: "codex" })).toEqual([
      {
        target: "codex",
        command: "codex",
        args: ["plugin", "marketplace", "add", "rendotdev/lgtm"],
      },
      { target: "codex", command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
    ]);
    expect(AgentInstall.parseTarget({ value: "pi" })).toBe("pi");
    expect(AgentInstall.parseTarget({ value: "other" })).toBeUndefined();
  });

  it("updates every installed integration through its native CLI", () => {
    expect(AgentInstall.createUpdatePlan({ target: "all" })).toEqual([
      { target: "pi", command: "pi", args: ["update", "npm:@rendotdev/lgtm"] },
      {
        target: "claude",
        command: "claude",
        args: ["plugin", "marketplace", "update", "rendotdev"],
      },
      { target: "claude", command: "claude", args: ["plugin", "update", "lgtm@rendotdev"] },
      {
        target: "codex",
        command: "codex",
        args: ["plugin", "marketplace", "upgrade", "rendotdev"],
      },
      { target: "codex", command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
    ]);
  });
});
