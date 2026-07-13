import { describe, expect, it, vi } from "vite-plus/test";
import { AgentInstallerClass } from "./agent-install-platform.ts";

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
