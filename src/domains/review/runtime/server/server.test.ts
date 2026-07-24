import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ReviewJson, ReviewOutcome, ReviewPointer } from "../../types/review.ts";
import {
  BuiltCliPath,
  finishReview,
  openReview,
  stopReview,
  waitForReview,
  WebRoot,
} from "./server.ts";

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

describe("WebRoot", () => {
  it("uses the built frontend before alternate build locations", async () => {
    const stat = vi.fn(async (path: string) => {
      if (path === "/project/dist/web/index.html") {
        return;
      }
      throw new Error("Missing frontend");
    });
    const Resolver = new WebRoot({
      params: {},
      deps: {
        modulePath: () => "/project/src/domains/review/runtime/server/server.ts",
        stat,
      },
    });

    await expect(Resolver.resolve({})).resolves.toBe("/project/dist/web");
    expect(stat).toHaveBeenCalledWith("/project/dist/web/index.html");
  });
});

describe("BuiltCliPath", () => {
  it("uses the built CLI when running from source", async () => {
    const stat = vi.fn(async () => undefined);
    const Resolver = new BuiltCliPath({
      params: { modulePath: "/project/src/domains/review/runtime/server/server.ts" },
      deps: { stat },
    });

    await expect(Resolver.resolve({})).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).toHaveBeenCalledWith("/project/dist/cli.mjs");
  });

  it("uses the packaged CLI when running from the Pi extension entrypoint", async () => {
    const stat = vi.fn(async () => undefined);
    const Resolver = new BuiltCliPath({
      params: { modulePath: "/project/extensions/index.mjs" },
      deps: { stat },
    });

    await expect(Resolver.resolve({})).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).toHaveBeenCalledWith("/project/dist/cli.mjs");
  });

  it("uses the packaged CLI when running from the legacy Pi extension entrypoint", async () => {
    const stat = vi.fn(async () => undefined);
    const Resolver = new BuiltCliPath({
      params: { modulePath: "/project/dist/pi/lgtm.mjs" },
      deps: { stat },
    });

    await expect(Resolver.resolve({})).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).toHaveBeenCalledWith("/project/dist/cli.mjs");
  });

  it("uses the current bundled CLI path", async () => {
    const stat = vi.fn(async () => undefined);
    const Resolver = new BuiltCliPath({
      params: { modulePath: "/project/dist/cli.mjs" },
      deps: { stat },
    });

    await expect(Resolver.resolve({})).resolves.toBe("/project/dist/cli.mjs");
    expect(stat).not.toHaveBeenCalled();
  });
});

describe("openReview", () => {
  it("keeps a durable review running when its opening request is later aborted", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lgtm-durable-open-"));
    temporaryDirectories.push(cwd);
    const controller = new AbortController();
    const pointer = await openReview(
      { kind: "document", name: "Durable", document: { markdown: "# Durable" } },
      {
        cwd,
        signal: controller.signal,
        stopOnAbort: false,
        cleanupOnExit: false,
        openBrowser: false,
        detachedServer: false,
      },
    );

    try {
      controller.abort(new DOMException("transport closed", "AbortError"));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));

      expect(await fetch(new URL("/health", pointer.url))).toHaveProperty("ok", true);
    } finally {
      await stopReview(cwd, pointer.reviewPath);
    }
  });

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
        restartedServer: false,
        stoppedServer: false,
      });
      expect(await fetch(new URL("/health", pointer.url))).toHaveProperty("ok", true);
    } finally {
      await stopReview(cwd, pointer.reviewPath);
    }
  });

  it("restarts an open review whose server stopped", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lgtm-finish-restart-"));
    temporaryDirectories.push(cwd);
    const pointer = await openReview(
      { kind: "document", name: "Restart review", document: { markdown: "# Restart" } },
      { cwd, openBrowser: false, detachedServer: false },
    );
    await stopReview(cwd, pointer.reviewPath);

    const result = await finishReview(cwd, pointer.reviewPath);
    if (!result.found) {
      throw new Error("Expected the open review to be found.");
    }

    try {
      expect(result).toMatchObject({
        review: { status: "open", url: expect.any(String) },
        restartedServer: true,
        stoppedServer: false,
      });
      expect(await fetch(new URL("/health", result.review.url))).toHaveProperty("ok", true);
    } finally {
      await stopReview(cwd, pointer.reviewPath);
    }
  });
});
