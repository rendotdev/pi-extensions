import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ReviewJson, ReviewOutcome, ReviewPointer } from "../../domain/review/review.ts";
import {
  BuiltCliPathResolverClass,
  collectGitReviewFilesSinceLast,
  finishReview,
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
      if (path === "/project/dist/web/index.html") {
        return;
      }
      throw new Error("Missing frontend");
    });
    const Resolver = new WebRootResolverClass(
      {},
      { modulePath: () => "/project/src/platform/review/review-platform.ts", stat },
    );

    await expect(Resolver.resolve()).resolves.toBe("/project/dist/web");
    expect(stat).toHaveBeenCalledWith("/project/dist/web/index.html");
  });
});

describe("BuiltCliPathResolverClass", () => {
  it("uses the built CLI when running from source", async () => {
    const stat = vi.fn(async () => undefined);
    const Resolver = new BuiltCliPathResolverClass(
      { modulePath: "/project/src/platform/review/review-platform.ts" },
      { stat },
    );

    await expect(Resolver.resolve()).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).toHaveBeenCalledWith("/project/dist/cli.mjs");
  });

  it("uses the packaged CLI when running from the Pi extension entrypoint", async () => {
    const stat = vi.fn(async () => undefined);
    const Resolver = new BuiltCliPathResolverClass(
      { modulePath: "/project/extensions/index.mjs" },
      { stat },
    );

    await expect(Resolver.resolve()).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).toHaveBeenCalledWith("/project/dist/cli.mjs");
  });

  it("uses the packaged CLI when running from the legacy Pi extension entrypoint", async () => {
    const stat = vi.fn(async () => undefined);
    const Resolver = new BuiltCliPathResolverClass(
      { modulePath: "/project/dist/pi/lgtm.mjs" },
      { stat },
    );

    await expect(Resolver.resolve()).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).toHaveBeenCalledWith("/project/dist/cli.mjs");
  });

  it("uses the current bundled CLI path", async () => {
    const stat = vi.fn(async () => undefined);
    const Resolver = new BuiltCliPathResolverClass(
      { modulePath: "/project/dist/cli.mjs" },
      { stat },
    );

    await expect(Resolver.resolve()).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).not.toHaveBeenCalled();
  });
});

describe("collectGitReviewFilesSinceLast", () => {
  it("compares the working tree with the latest retained review payload", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lgtm-since-last-git-"));
    temporaryDirectories.push(cwd);
    execFileSync("git", ["init", "--quiet"], { cwd });
    execFileSync("git", ["config", "user.email", "lgtm@example.com"], { cwd });
    execFileSync("git", ["config", "user.name", "LGTM Test"], { cwd });
    await Promise.all([
      writeFile(join(cwd, ".gitignore"), ".lgtm/\n", "utf8"),
      writeFile(join(cwd, "changed.ts"), "base", "utf8"),
    ]);
    execFileSync("git", ["add", ".gitignore", "changed.ts"], { cwd });
    execFileSync("git", ["commit", "--quiet", "-m", "Initial"], { cwd });

    const appDir = join(cwd, ".lgtm", "previous-review");
    await mkdir(appDir, { recursive: true });
    await writeFile(
      join(appDir, "payload.json"),
      JSON.stringify({
        kind: "diff",
        name: "Previous review",
        sessionId: "session",
        reviewUUID: "uuid",
        reviewId: "previous-review",
        cwd,
        appDir,
        reviewPath: join(appDir, "review.json"),
        generatedAt: "2026-07-14T11:00:00.000Z",
        files: [
          {
            id: "file-0",
            location: "changed.ts",
            language: "typescript",
            oldContent: "base",
            newContent: "reviewed",
            added: 1,
            removed: 1,
          },
        ],
      }),
      "utf8",
    );
    const previousReview: ReviewJson = {
      version: 2,
      kind: "diff",
      status: "approved",
      name: "Previous review",
      sessionId: "session",
      reviewUUID: "uuid",
      reviewId: "previous-review",
      cwd,
      appDir,
      reviewPath: join(appDir, "review.json"),
      createdAt: "2026-07-14T11:00:00.000Z",
      updatedAt: "2026-07-14T11:00:00.000Z",
      files: [{ location: "changed.ts", added: 1, removed: 1, comments: [] }],
      documentComments: [],
    };
    await writeFile(join(appDir, "review.json"), JSON.stringify(previousReview), "utf8");
    await writeFile(join(cwd, "changed.ts"), "follow-up", "utf8");
    await writeFile(join(cwd, "added.ts"), "added", "utf8");

    await expect(collectGitReviewFilesSinceLast(cwd)).resolves.toEqual({
      checkpoint: [
        { location: "changed.ts", content: "follow-up" },
        { location: "added.ts", content: "added" },
      ],
      files: [
        { location: "changed.ts", oldContent: "reviewed", newContent: "follow-up" },
        { location: "added.ts", oldContent: "", newContent: "added" },
      ],
      baselineReviewId: "previous-review",
    });
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
      const manifest = JSON.parse(await readFile(join(first.appDir, "manifest.json"), "utf8")) as {
        createdAt: string;
        expiresAt: string;
        reviewId: string;
      };
      expect(manifest.reviewId).toBe(first.reviewId);
      expect(Date.parse(manifest.expiresAt) - Date.parse(manifest.createdAt)).toBe(
        7 * 24 * 60 * 60 * 1_000,
      );
      expect(await fetch(new URL("/api/payload", first.url))).toHaveProperty("ok", true);
      expect(await fetch(new URL("/api/payload", second.url))).toHaveProperty("ok", true);

      const healthResponse = await fetch(new URL("/health", first.url));
      await expect(healthResponse.json()).resolves.toEqual({ ok: true });

      const invalidPreferencesResponse = await fetch(new URL("/api/preferences", first.url), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          diffStyle: "invalid",
          lineWrap: false,
          sidebarWidth: 256,
          fileExpansion: "auto",
          fileExpansionOverrides: {},
        }),
      });
      expect(invalidPreferencesResponse.status).toBe(400);
      await expect(invalidPreferencesResponse.json()).resolves.toEqual(
        expect.objectContaining({ error: expect.any(String) }),
      );

      expect(await stopReview(cwd, first.reviewPath)).toBe(true);
      await expect(fetch(new URL("/api/payload", first.url))).rejects.toThrow();
      expect(await fetch(new URL("/api/payload", second.url))).toHaveProperty("ok", true);
    } finally {
      await stopReview(cwd, first.reviewPath);
      await stopReview(cwd, second.reviewPath);
    }
  });
});

describe("finishReview", () => {
  it("leaves an open review server running", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lgtm-finish-open-"));
    temporaryDirectories.push(cwd);
    const pointer = await openReview(
      { kind: "document", name: "Open review", document: { markdown: "# Open" } },
      { cwd, openBrowser: false, detachedServer: false },
    );

    try {
      const result = await finishReview(cwd, pointer.reviewPath);

      expect(result).toMatchObject({
        found: true,
        review: { status: "open" },
        stoppedServer: false,
      });
      expect(await fetch(new URL("/health", pointer.url))).toHaveProperty("ok", true);
    } finally {
      await stopReview(cwd, pointer.reviewPath);
    }
  });
});
