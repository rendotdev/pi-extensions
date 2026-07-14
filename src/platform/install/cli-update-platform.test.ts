import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vite-plus/test";
import { CliUpdateCommandRunnerClass, CliUpdaterClass } from "./cli-update-platform.ts";

describe("CliUpdateCommandRunnerClass", () => {
  it("captures successful command output instead of writing through the active terminal", async () => {
    const Runner = new CliUpdateCommandRunnerClass({}, { spawn });

    await expect(
      Runner.run({ command: process.execPath, args: ["--eval", 'console.log("npm output")'] }),
    ).resolves.toBe("npm output\n");
  });

  it("returns successful command output when requested", async () => {
    const Runner = new CliUpdateCommandRunnerClass({}, { spawn });

    await expect(
      Runner.read({ command: process.execPath, args: ["--eval", 'console.log("0.2.0")'] }),
    ).resolves.toBe("0.2.0\n");
  });

  it("includes captured command output when an update fails", async () => {
    const Runner = new CliUpdateCommandRunnerClass({}, { spawn });

    await expect(
      Runner.run({
        command: process.execPath,
        args: ["--eval", 'console.error("npm failed"); process.exit(2)'],
      }),
    ).rejects.toThrow(`exited with code 2.\nnpm failed`);
  });
});

describe("CliUpdaterClass", () => {
  it("updates through the npm executable belonging to the active global installation", async () => {
    const readCommand = vi.fn(async () => '"0.2.0"\n');
    const runCommand = vi.fn(async () => "added 1 package\n");
    const Updater = new CliUpdaterClass(
      { packageRoot: "/runtime/lib/node_modules/@rendotdev/lgtm", currentVersion: "0.1.12" },
      { executableExists: () => true, readCommand, runCommand },
    );

    const result = await Updater.update({});

    expect(result).toEqual({
      status: "updated",
      previousVersion: "0.1.12",
      version: "0.2.0",
      output: "added 1 package\n",
      step: {
        command: "/runtime/bin/npm",
        args: ["install", "--global", "--prefix", "/runtime", "@rendotdev/lgtm@0.2.0"],
      },
    });
    expect(readCommand).toHaveBeenCalledWith({
      command: "/runtime/bin/npm",
      args: ["view", "@rendotdev/lgtm@latest", "version", "--json"],
    });
    expect(runCommand).toHaveBeenCalledWith(result.status === "updated" ? result.step : undefined);
  });

  it("does not reinstall a CLI that is already current", async () => {
    const runCommand = vi.fn(async () => "");
    const Updater = new CliUpdaterClass(
      { packageRoot: "/runtime/lib/node_modules/@rendotdev/lgtm", currentVersion: "0.2.0" },
      {
        executableExists: () => true,
        readCommand: async () => '"0.2.0"',
        runCommand,
      },
    );

    await expect(Updater.update({})).resolves.toEqual({ status: "current", version: "0.2.0" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("skips local and npx installations", async () => {
    const runCommand = vi.fn(async () => "");
    const Updater = new CliUpdaterClass(
      { packageRoot: "/project/node_modules/@rendotdev/lgtm", currentVersion: "0.1.12" },
      { executableExists: () => true, readCommand: vi.fn(), runCommand },
    );

    await expect(Updater.update({})).resolves.toEqual({
      status: "skipped",
      reason: "lgtm is not running from a global npm installation.",
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("skips a global installation whose matching npm executable is unavailable", async () => {
    const Updater = new CliUpdaterClass(
      { packageRoot: "/runtime/lib/node_modules/@rendotdev/lgtm", currentVersion: "0.1.12" },
      {
        executableExists: () => false,
        readCommand: vi.fn(),
        runCommand: vi.fn(async () => ""),
      },
    );

    await expect(Updater.plan()).resolves.toEqual({
      status: "skipped",
      reason: "The npm executable for this installation was not found at /runtime/bin/npm.",
    });
  });

  it("rejects an invalid latest version response", async () => {
    const Updater = new CliUpdaterClass(
      { packageRoot: "/runtime/lib/node_modules/@rendotdev/lgtm", currentVersion: "0.1.12" },
      {
        executableExists: () => true,
        readCommand: async () => "not json",
        runCommand: vi.fn(async () => ""),
      },
    );

    await expect(Updater.plan()).rejects.toThrow("npm returned an invalid latest lgtm version.");
  });
});
