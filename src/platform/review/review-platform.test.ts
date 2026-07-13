import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ReviewJson, ReviewOutcome, ReviewPointer } from "../../domain/review/review.ts";
import {
  BuiltCliPathResolverClass,
  openReview,
  stopReview,
  waitForReview,
  WebRootResolverClass,
} from "./review-platform.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function reviewFixture(status: ReviewOutcome) {
  const appDir = await mkdtemp(join(tmpdir(), "lgtm-wait-"));
  temporaryDirectories.push(appDir);
  const reviewPath = join(appDir, "review.json");
  const review: ReviewJson = {
    version: 2,
    kind: "diff",
    status,
    name: "Runtime review",
    sessionId: "session",
    reviewUUID: "uuid",
    reviewId: "session-uuid",
    cwd: appDir,
    appDir,
    reviewPath,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:01.000Z",
    files: [],
    documentComments: [],
  };
  await writeFile(reviewPath, `${JSON.stringify(review)}\n`, "utf8");
  const pointer: ReviewPointer = {
    name: review.name,
    sessionId: review.sessionId,
    reviewUUID: review.reviewUUID,
    reviewId: review.reviewId,
    appDir,
    url: "http://localhost:1/",
    reviewPath,
  };
  return { appDir, pointer };
}

describe("waitForReview", () => {
  for (const status of ["approved", "changes_requested", "canceled"] as const) {
    it(`returns the ${status} browser outcome`, async () => {
      const { appDir, pointer } = await reviewFixture(status);
      const result = await waitForReview(pointer, {
        cwd: appDir,
        pollIntervalMs: 10,
        stopServer: false,
      });

      expect(result.review.status).toBe(status);
      expect(result.reviewPath).toBe(pointer.reviewPath);
      expect(result.formattedReview).toContain(`Status: ${status}`);
    });
  }

  it("stops waiting promptly when the tool call is aborted", async () => {
    const { appDir, pointer } = await reviewFixture("approved");
    const openReview = JSON.parse(
      await (await import("node:fs/promises")).readFile(pointer.reviewPath, "utf8"),
    ) as ReviewJson;
    await writeFile(pointer.reviewPath, JSON.stringify({ ...openReview, status: "open" }), "utf8");
    const controller = new AbortController();
    const waiting = waitForReview(pointer, {
      cwd: appDir,
      signal: controller.signal,
      pollIntervalMs: 10,
      stopServer: false,
    });
    controller.abort(new DOMException("test cancellation", "AbortError"));

    await expect(waiting).rejects.toThrow("test cancellation");
  });
});

describe("WebRootResolverClass", () => {
  it("uses the built frontend before alternate build locations", async () => {
    const stat = vi.fn(async (path: string) => {
      if (path === "/project/dist/web/index.html") return;
      throw new Error("Missing frontend");
    });
    const resolver = new WebRootResolverClass(
      {},
      { modulePath: () => "/project/src/platform/review/review-platform.ts", stat },
    );

    await expect(resolver.resolve()).resolves.toBe("/project/dist/web");
    expect(stat).toHaveBeenCalledWith("/project/dist/web/index.html");
  });
});

describe("BuiltCliPathResolverClass", () => {
  it("uses the built CLI when running from source", async () => {
    const stat = vi.fn(async () => undefined);
    const resolver = new BuiltCliPathResolverClass(
      { modulePath: "/project/src/platform/review/review-platform.ts" },
      { stat },
    );

    await expect(resolver.resolve()).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).toHaveBeenCalledWith("/project/dist/cli.mjs");
  });

  it("uses the current bundled CLI path", async () => {
    const stat = vi.fn(async () => undefined);
    const resolver = new BuiltCliPathResolverClass(
      { modulePath: "/project/dist/cli.mjs" },
      { stat },
    );

    await expect(resolver.resolve()).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).not.toHaveBeenCalled();
  });
});

describe("openReview", () => {
  it("keeps simultaneous reviews in the same checkout independent", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lgtm-concurrent-"));
    temporaryDirectories.push(cwd);
    const first = await openReview(
      { kind: "document", name: "First", document: { markdown: "# First" } },
      { cwd, openBrowser: false, detachedServer: false },
    );
    const second = await openReview(
      { kind: "document", name: "Second", document: { markdown: "# Second" } },
      { cwd, openBrowser: false, detachedServer: false },
    );

    try {
      expect(first.reviewPath).not.toBe(second.reviewPath);
      expect(await fetch(new URL("/api/payload", first.url))).toHaveProperty("ok", true);
      expect(await fetch(new URL("/api/payload", second.url))).toHaveProperty("ok", true);

      expect(await stopReview(cwd, first.reviewPath)).toBe(true);
      await expect(fetch(new URL("/api/payload", first.url))).rejects.toThrow();
      expect(await fetch(new URL("/api/payload", second.url))).toHaveProperty("ok", true);
    } finally {
      await stopReview(cwd, first.reviewPath);
      await stopReview(cwd, second.reviewPath);
    }
  });
});
