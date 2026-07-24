import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { REVIEW_RETENTION_MILLISECONDS } from "../../config/retention.ts";
import { ReviewRetention } from "../../service/retention/retention.ts";
import { ReviewGarbageCollection } from "./garbage-collection.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(function removeTemporaryDirectory(directory) {
      return rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("ReviewGarbageCollection", () => {
  it("removes expired reviews, including open reviews, and preserves fresh reviews", async () => {
    const root = await mkdtemp(join(tmpdir(), "lgtm-cleanup-"));
    temporaryDirectories.push(root);
    const expiredAppDir = join(root, "expired");
    const freshAppDir = join(root, "fresh");
    await mkdir(expiredAppDir);
    await mkdir(freshAppDir);
    await writeFile(
      join(expiredAppDir, "manifest.json"),
      JSON.stringify({
        version: 1,
        reviewId: "expired",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-08T00:00:00.000Z",
      }),
    );
    await writeFile(join(expiredAppDir, "review.json"), JSON.stringify({ status: "open" }));
    await writeFile(
      join(freshAppDir, "manifest.json"),
      JSON.stringify({
        version: 1,
        reviewId: "fresh",
        createdAt: "2026-07-10T00:00:00.000Z",
        expiresAt: "2026-07-17T00:00:00.000Z",
      }),
    );
    const stopServer = vi.fn(async () => true);
    const Collector = new ReviewGarbageCollection({
      params: {},
      deps: {
        retentionPolicy: new ReviewRetention({
          params: { retentionMilliseconds: REVIEW_RETENTION_MILLISECONDS },
          deps: {},
        }),
        stopServer,
      },
    });

    const result = await Collector.cleanExpired({
      root,
      now: new Date("2026-07-13T00:00:00.000Z"),
    });

    expect(result).toEqual({
      removedAppDirs: [expiredAppDir],
      failures: [],
      skippedBecauseLocked: false,
    });
    expect(stopServer).toHaveBeenCalledWith(expiredAppDir);
    await expect(readFile(join(expiredAppDir, "review.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(freshAppDir, "manifest.json"), "utf8")).resolves.toContain(
      '"reviewId":"fresh"',
    );
  });

  it("uses legacy review creation dates and excludes the review currently opening", async () => {
    const root = await mkdtemp(join(tmpdir(), "lgtm-cleanup-legacy-"));
    temporaryDirectories.push(root);
    const legacyAppDir = join(root, "legacy");
    await mkdir(legacyAppDir);
    await writeFile(
      join(legacyAppDir, "review.json"),
      JSON.stringify({ status: "open", createdAt: "2026-07-01T00:00:00.000Z" }),
    );
    const stopServer = vi.fn(async () => true);
    const Collector = new ReviewGarbageCollection({
      params: {},
      deps: {
        retentionPolicy: new ReviewRetention({
          params: { retentionMilliseconds: REVIEW_RETENTION_MILLISECONDS },
          deps: {},
        }),
        stopServer,
      },
    });

    const result = await Collector.cleanExpired({
      root,
      excludeAppDir: legacyAppDir,
      now: new Date("2026-07-13T00:00:00.000Z"),
    });

    expect(result.removedAppDirs).toEqual([]);
    expect(stopServer).not.toHaveBeenCalled();
    await expect(readFile(join(legacyAppDir, "review.json"), "utf8")).resolves.toContain(
      '"status":"open"',
    );
  });
});
