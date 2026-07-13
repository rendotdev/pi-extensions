import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vite-plus/test";
import { CliUpdateCommandRunnerClass, CliUpdaterClass } from "./cli-update-platform.ts";

describe("CliUpdateCommandRunnerClass", () => {
  it("captures successful command output instead of writing through the active terminal", async () => {
    const runner = new CliUpdateCommandRunnerClass({}, { spawn });

    await expect(
      runner.run({ command: process.execPath, args: ["--eval", 'console.log("npm output")'] }),
    ).resolves.toBeUndefined();
  });

  it("includes captured command output when an update fails", async () => {
    const runner = new CliUpdateCommandRunnerClass({}, { spawn });

    await expect(
      runner.run({
        command: process.execPath,
        args: ["--eval", 'console.error("npm failed"); process.exit(2)'],
      }),
    ).rejects.toThrow(`exited with code 2.\nnpm failed`);
  });
});

describe("CliUpdaterClass", () => {
  it("updates through the npm executable belonging to the active global installation", async () => {
    const runCommand = vi.fn(async () => undefined);
    const updater = new CliUpdaterClass(
      { packageRoot: "/runtime/lib/node_modules/@rendotdev/lgtm" },
      { executableExists: () => true, runCommand },
    );

    const result = await updater.update();

    expect(result).toEqual({
      status: "updated",
      step: {
        command: "/runtime/bin/npm",
        args: ["install", "--global", "--prefix", "/runtime", "@rendotdev/lgtm@latest"],
      },
    });
    expect(runCommand).toHaveBeenCalledWith(result.status === "updated" ? result.step : undefined);
  });

  it("skips local and npx installations", async () => {
    const runCommand = vi.fn(async () => undefined);
    const updater = new CliUpdaterClass(
      { packageRoot: "/project/node_modules/@rendotdev/lgtm" },
      { executableExists: () => true, runCommand },
    );

    await expect(updater.update()).resolves.toEqual({
      status: "skipped",
      reason: "LGTM is not running from a global npm installation.",
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("skips a global installation whose matching npm executable is unavailable", () => {
    const updater = new CliUpdaterClass(
      { packageRoot: "/runtime/lib/node_modules/@rendotdev/lgtm" },
      { executableExists: () => false, runCommand: vi.fn(async () => undefined) },
    );

    expect(updater.plan()).toEqual({
      status: "skipped",
      reason: "The npm executable for this installation was not found at /runtime/bin/npm.",
    });
  });
});
