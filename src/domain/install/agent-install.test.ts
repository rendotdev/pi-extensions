import { describe, expect, it } from "vite-plus/test";
import { AgentInstallPlanner, AgentUpdatePlanner, isAgentInstallTarget } from "./agent-install.ts";

describe("AgentInstallPlanner", () => {
  it("plans every supported integration in installation order", () => {
    expect(AgentInstallPlanner.createPlan({ target: "all" })).toEqual([
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

  it("plans only the requested integration and validates target names", () => {
    expect(AgentInstallPlanner.createPlan({ target: "codex" })).toEqual([
      {
        target: "codex",
        command: "codex",
        args: ["plugin", "marketplace", "add", "rendotdev/lgtm"],
      },
      { target: "codex", command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
    ]);
    expect(isAgentInstallTarget("pi")).toBe(true);
    expect(isAgentInstallTarget("other")).toBe(false);
  });

  it("updates every installed integration through its native CLI", () => {
    expect(AgentUpdatePlanner.createPlan({ target: "all" })).toEqual([
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
    ]);
  });
});
