import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vite-plus/test";
import { AgentInstallCommand, AgentInstaller, AgentUpdater } from "./agent.ts";

describe("AgentInstallCommand", () => {
  it("captures successful integration output", async () => {
    const Runner = new AgentInstallCommand({ params: {}, deps: { spawn } });

    await expect(
      Runner.read({ command: process.execPath, args: ["--eval", 'console.log("updated")'] }),
    ).resolves.toBe("updated\n");
  });

  it("includes captured output when an integration command fails", async () => {
    const Runner = new AgentInstallCommand({ params: {}, deps: { spawn } });

    await expect(
      Runner.run({
        command: process.execPath,
        args: ["--eval", 'console.error("marketplace failed"); process.exit(2)'],
      }),
    ).rejects.toThrow("marketplace failed");
  });
});

describe("AgentInstaller", () => {
  it("runs each planned command in order", async () => {
    const runCommand = vi.fn(async () => "");
    const Installer = new AgentInstaller({ params: {}, deps: { runCommand } });

    const steps = await Installer.install({ target: "pi" });

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
      .fn<(_: unknown) => Promise<string>>()
      .mockRejectedValueOnce(new Error("Codex is unavailable."));
    const Installer = new AgentInstaller({ params: {}, deps: { runCommand } });

    await expect(Installer.install({ target: "codex" })).rejects.toThrow("Codex is unavailable.");
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});

describe("AgentUpdater", () => {
  it("runs the update plan through the command runner", async () => {
    const runCommand = vi.fn(async () => "Codex marketplace updated.\n");
    const readCommand = vi.fn(async () =>
      JSON.stringify({ installed: [{ pluginId: "lgtm@rendotdev" }] }),
    );
    const Updater = new AgentUpdater({ params: {}, deps: { runCommand, readCommand } });

    const onUpdate = vi.fn();
    const result = await Updater.update({ target: "codex", onUpdate });

    expect(runCommand).toHaveBeenCalledWith({
      target: "codex",
      command: "codex",
      args: ["plugin", "marketplace", "upgrade", "rendotdev"],
    });
    expect(runCommand).toHaveBeenCalledWith({
      target: "codex",
      command: "codex",
      args: ["plugin", "add", "lgtm@rendotdev"],
    });
    expect(result).toEqual({
      steps: [
        {
          target: "codex",
          command: "codex",
          args: ["plugin", "marketplace", "upgrade", "rendotdev"],
        },
        { target: "codex", command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
      ],
      skippedTargets: [],
      integrations: [
        {
          target: "codex",
          steps: [
            {
              target: "codex",
              command: "codex",
              args: ["plugin", "marketplace", "upgrade", "rendotdev"],
            },
            { target: "codex", command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
          ],
          outputs: ["Codex marketplace updated.\n", "Codex marketplace updated.\n"],
        },
      ],
    });
    expect(onUpdate).toHaveBeenNthCalledWith(1, { phase: "started", target: "codex" });
    expect(onUpdate).toHaveBeenNthCalledWith(2, {
      phase: "completed",
      target: "codex",
      steps: [
        {
          target: "codex",
          command: "codex",
          args: ["plugin", "marketplace", "upgrade", "rendotdev"],
        },
        { target: "codex", command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
      ],
      outputs: ["Codex marketplace updated.\n", "Codex marketplace updated.\n"],
    });
  });

  it("repairs a Codex marketplace-only installation", async () => {
    const runCommand = vi.fn(async () => "done\n");
    const readCommand = vi
      .fn<(_: { command: string; args: string[] }) => Promise<string>>()
      .mockResolvedValueOnce(JSON.stringify({ installed: [] }))
      .mockResolvedValueOnce(JSON.stringify({ marketplaces: [{ name: "rendotdev" }] }));
    const Updater = new AgentUpdater({ params: {}, deps: { runCommand, readCommand } });

    const result = await Updater.update({ target: "codex" });

    expect(runCommand).toHaveBeenCalledWith({
      target: "codex",
      command: "codex",
      args: ["plugin", "add", "lgtm@rendotdev"],
    });
    expect(result.skippedTargets).toEqual([]);
  });
});

describe("AgentUpdater discovery", () => {
  it("skips agent integrations that are not installed", async () => {
    const runCommand = vi.fn(async () => "");
    const readCommand = vi.fn(async () => "No plugins installed.");
    const Updater = new AgentUpdater({ params: {}, deps: { runCommand, readCommand } });

    const result = await Updater.update({ target: "all" });

    expect(runCommand).not.toHaveBeenCalled();
    expect(result).toEqual({
      steps: [],
      skippedTargets: ["pi", "claude", "codex"],
      integrations: [],
    });
  });
});
