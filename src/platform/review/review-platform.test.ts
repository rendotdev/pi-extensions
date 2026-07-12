import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { ReviewJson, ReviewOutcome, ReviewPointer } from "../../domain/review/review.ts";
import { waitForReview } from "./review-platform.ts";

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
