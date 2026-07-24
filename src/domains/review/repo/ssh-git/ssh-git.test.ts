import { describe, expect, it, vi } from "vite-plus/test";
import { SSHCommand, SSHControlConnectionManager, SSHGitRepository } from "./ssh-git.ts";

describe("SSHCommand", () => {
  it("single-quotes remote arguments and preserves apostrophes", () => {
    const Encoder = new SSHCommand({
      params: { maximumCommandLength: 10_000 },
      deps: {},
    });

    expect(Encoder.quote({ value: "a b'c" })).toBe(`'a b'"'"'c'`);
    expect(
      Encoder.executable({
        marker: "LGTM_FRAME_test",
        executable: "git",
        args: ["-C", "/repo with spaces", "show", "HEAD:file's.ts"],
      }),
    ).toContain(`'HEAD:file'"'"'s.ts'`);
  });

  it("rejects NUL bytes and oversized commands", () => {
    const Encoder = new SSHCommand({ params: { maximumCommandLength: 30 }, deps: {} });

    expect(() => Encoder.quote({ value: "bad\0path" })).toThrow("NUL");
    expect(() =>
      Encoder.executable({ marker: "marker", executable: "git", args: ["x".repeat(100)] }),
    ).toThrow("safety limit");
  });
});

describe("SSHControlConnectionManager", () => {
  it("opens one control connection, reads a framed response, and cleans up", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: Buffer.alloc(0), stderr: "", code: 0 })
      .mockResolvedValueOnce({
        stdout: Buffer.from("shell banner\nLGTM_FRAME_test\npayload"),
        stderr: "",
        code: 0,
      })
      .mockResolvedValueOnce({ stdout: Buffer.alloc(0), stderr: "", code: 0 });
    const removeDirectory = vi.fn(async () => undefined);
    const Connection = new SSHControlConnectionManager({
      params: {},
      deps: {
        makeTemporaryDirectory: vi.fn(async () => "/tmp/lgtm-ssh-test"),
        removeDirectory,
        processRunner: { run },
      },
    });

    const state = await Connection.open({ destination: "build-mac" });
    await expect(
      Connection.execute({
        connection: state,
        command: "command",
        marker: "LGTM_FRAME_test",
      }),
    ).resolves.toEqual(Buffer.from("payload"));
    await Connection.close({ connection: state });

    expect(run.mock.calls[0][0].args).toEqual([
      "-M",
      "-S",
      "/tmp/lgtm-ssh-test/control",
      "-o",
      "ControlPersist=no",
      "-fN",
      "--",
      "build-mac",
    ]);
    expect(run.mock.calls[1][0].args).toContain("/tmp/lgtm-ssh-test/control");
    expect(run.mock.calls[2][0].args).toContain("exit");
    expect(removeDirectory).toHaveBeenCalledWith("/tmp/lgtm-ssh-test");
  });
});

describe("SSHGitRepository", () => {
  it("collects tracked and untracked remote changes without remote lgtm", async () => {
    const execute = vi.fn(async ({ command }: { command: string }) => {
      const readsRepositoryRoot =
        command.includes("rev-parse") && command.includes("--show-toplevel");
      if (readsRepositoryRoot) {
        return Buffer.from("/repo\n");
      }
      const verifiesHead = command.includes("rev-parse") && command.includes("--verify");
      if (verifiesHead) {
        return Buffer.from("true\n");
      }
      const readsNameStatus = command.includes("diff") && command.includes("--name-status");
      if (readsNameStatus) {
        return Buffer.from("M\0src/a.ts\0A\0new.ts\0");
      }
      const readsUntrackedFiles = command.includes("ls-files") && command.includes("--others");
      if (readsUntrackedFiles) {
        return Buffer.from("new.ts\0");
      }
      const readsHeadFile = command.includes("show") && command.includes("HEAD:src/a.ts");
      if (readsHeadFile) {
        return Buffer.from("old");
      }
      if (command.includes("/repo/src/a.ts")) {
        return Buffer.from("new");
      }
      if (command.includes("/repo/new.ts")) {
        return Buffer.from("added");
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const close = vi.fn(async () => undefined);
    const Encoder = new SSHCommand({
      params: { maximumCommandLength: 65_536 },
      deps: {},
    });
    const Reader = new SSHGitRepository({
      params: { fileConcurrency: 2, maximumFileBytes: 1_000_000 },
      deps: {
        commandEncoder: Encoder,
        connection: {
          open: vi.fn(async () => ({
            destination: "build-mac",
            socketDirectory: "/tmp/ssh",
            socketPath: "/tmp/ssh/control",
          })),
          execute,
          close,
        },
        randomUUID: vi.fn(() => "test"),
        processRunner: {
          run: vi.fn(async () => ({
            stdout: Buffer.from("host build-mac\nhostname devbox.example\nuser ren\nport 22\n"),
            stderr: "",
            code: 0,
          })),
        },
      },
    });

    await expect(
      Reader.collect({
        localCwd: "/local",
        remote: "build-mac",
        remoteCwd: "/repo",
      }),
    ).resolves.toEqual({
      files: [
        { location: "src/a.ts", oldContent: "old", newContent: "new" },
        { location: "new.ts", oldContent: "", newContent: "added" },
      ],
      source: {
        kind: "git",
        transport: "ssh",
        key: "ssh://ren@devbox.example:22/repo",
        label: "build-mac:/repo",
      },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("requires an absolute remote repository path", async () => {
    const Reader = new SSHGitRepository({
      params: { fileConcurrency: 1, maximumFileBytes: 1_000 },
      deps: {
        commandEncoder: new SSHCommand({
          params: { maximumCommandLength: 1_000 },
          deps: {},
        }),
        connection: {
          open: vi.fn(),
          execute: vi.fn(),
          close: vi.fn(),
        },
        randomUUID: vi.fn(() => "test"),
        processRunner: { run: vi.fn() },
      },
    });

    await expect(
      Reader.collect({ localCwd: "/local", remote: "host", remoteCwd: "relative" }),
    ).rejects.toThrow("must be absolute");
  });
});
