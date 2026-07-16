import { describe, expect, it, vi } from "vite-plus/test";
import { GitReviewCommandClass } from "./git-review-command.ts";

describe("GitReviewCommandClass", () => {
  it("preserves local Git collection", async () => {
    const collectLocal = vi.fn(async () => [
      { location: "local.ts", oldContent: "old", newContent: "new" },
    ]);
    const Command = new GitReviewCommandClass(
      {},
      {
        collectLocal,
        collectLocalSinceLast: vi.fn(),
        collectRemote: vi.fn(),
      },
    );

    await expect(Command.collect({ cwd: "/repo" })).resolves.toEqual({
      files: [{ location: "local.ts", oldContent: "old", newContent: "new" }],
    });
    expect(collectLocal).toHaveBeenCalledWith("/repo", undefined);
  });

  it("routes SSH reviews through the remote collector", async () => {
    const collectRemote = vi.fn(async () => ({
      files: [{ location: "remote.ts", oldContent: "old", newContent: "new" }],
      source: {
        kind: "git" as const,
        transport: "ssh" as const,
        key: "ssh://ren@host:22/repo",
        label: "host:/repo",
      },
    }));
    const Command = new GitReviewCommandClass(
      {},
      {
        collectLocal: vi.fn(),
        collectLocalSinceLast: vi.fn(),
        collectRemote,
      },
    );

    await Command.collect({
      cwd: "/local",
      remote: "host",
      remoteCwd: "/repo",
      sinceLast: true,
    });

    expect(collectRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        localCwd: "/local",
        remote: "host",
        remoteCwd: "/repo",
        sinceLast: true,
      }),
    );
  });

  it("requires remote and remoteCwd together", async () => {
    const Command = new GitReviewCommandClass(
      {},
      {
        collectLocal: vi.fn(),
        collectLocalSinceLast: vi.fn(),
        collectRemote: vi.fn(),
      },
    );

    await expect(Command.collect({ cwd: "/local", remote: "host" })).rejects.toThrow(
      "require --remote-cwd",
    );
    await expect(Command.collect({ cwd: "/local", remoteCwd: "/repo" })).rejects.toThrow(
      "requires --remote",
    );
  });
});
