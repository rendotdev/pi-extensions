import { describe, expect, it, vi } from "vite-plus/test";
import { AgentInstallerClass, AgentUpdaterClass } from "./agent-install-platform.ts";

describe("AgentInstallerClass", () => {
  it("runs each planned command in order", async () => {
    const runCommand = vi.fn(async () => undefined);
    const installer = new AgentInstallerClass({ runCommand });

    const steps = await installer.install({ target: "pi" });

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith({
      target: "pi",
      command: "pi",
      args: ["install", "npm:@rendotdev/lgtm"],
    });
    expect(steps).toEqual([
      { target: "pi", command: "pi", args: ["install", "npm:@rendotdev/lgtm"] },
    ]);
  });

  it("stops when an installation command fails", async () => {
    const runCommand = vi
      .fn<(_: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Codex is unavailable."));
    const installer = new AgentInstallerClass({ runCommand });

    await expect(installer.install({ target: "codex" })).rejects.toThrow("Codex is unavailable.");
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});

describe("AgentUpdaterClass", () => {
  it("runs the update plan through the command runner", async () => {
    const runCommand = vi.fn(async () => undefined);
    const readCommand = vi.fn(async () =>
      JSON.stringify({ installed: [{ pluginId: "lgtm@rendotdev" }] }),
    );
    const updater = new AgentUpdaterClass({ runCommand, readCommand });

    const result = await updater.update({ target: "codex" });

    expect(runCommand).toHaveBeenCalledWith({
      target: "codex",
      command: "codex",
      args: ["plugin", "marketplace", "upgrade", "rendotdev"],
    });
    expect(result).toEqual({
      steps: [
        {
          target: "codex",
          command: "codex",
          args: ["plugin", "marketplace", "upgrade", "rendotdev"],
        },
      ],
      skippedTargets: [],
    });
  });

  it("skips agent integrations that are not installed", async () => {
    const runCommand = vi.fn(async () => undefined);
    const readCommand = vi.fn(async () => "No plugins installed.");
    const updater = new AgentUpdaterClass({ runCommand, readCommand });

    const result = await updater.update({ target: "all" });

    expect(runCommand).not.toHaveBeenCalled();
    expect(result).toEqual({ steps: [], skippedTargets: ["pi", "claude", "codex"] });
  });
});
