import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ReviewJson, ReviewPayload, ReviewStatus } from "../../domain/review/review.ts";
import { ReviewSinceLastPlatform } from "./review-since-last-platform.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(function removeDirectory(directory) {
      return rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("ReviewSinceLastPlatformClass", () => {
  it("uses the newest compatible diff review in the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "lgtm-since-last-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "changed.ts"), "current", "utf8");
    await writePayload(root, {
      reviewId: "older",
      generatedAt: "2026-07-14T10:00:00.000Z",
      location: "changed.ts",
      newContent: "older",
    });
    await writePayload(root, {
      reviewId: "newer",
      generatedAt: "2026-07-14T11:00:00.000Z",
      location: "changed.ts",
      newContent: "reviewed",
    });
    await expect(
      ReviewSinceLastPlatform.collect({
        root,
        reviewRoots: [join(root, ".lgtm")],
        currentFiles: [{ location: "changed.ts", oldContent: "base", newContent: "current" }],
      }),
    ).resolves.toEqual({
      baselineReviewId: "newer",
      checkpoint: [{ location: "changed.ts", content: "current" }],
      files: [{ location: "changed.ts", oldContent: "reviewed", newContent: "current" }],
    });
  });

  it("falls back to the current Git review when no baseline exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "lgtm-since-last-"));
    temporaryDirectories.push(root);
    const currentFiles = [{ location: "new.ts", oldContent: "", newContent: "new" }];

    await expect(
      ReviewSinceLastPlatform.collect({
        root,
        reviewRoots: [join(root, ".lgtm")],
        currentFiles,
      }),
    ).resolves.toEqual({
      checkpoint: [{ location: "new.ts", content: "new" }],
      files: currentFiles,
    });
  });

  it("uses the hidden checkpoint when the previous review displayed only a follow-up delta", async () => {
    const root = await mkdtemp(join(tmpdir(), "lgtm-since-last-"));
    temporaryDirectories.push(root);
    await writePayload(root, {
      reviewId: "follow-up",
      generatedAt: "2026-07-14T12:00:00.000Z",
      location: "visible.ts",
      newContent: "reviewed-visible",
      checkpoint: [
        { location: "original.ts", content: "reviewed-original" },
        { location: "visible.ts", content: "reviewed-visible" },
      ],
    });

    await expect(
      ReviewSinceLastPlatform.collect({
        root,
        reviewRoots: [join(root, ".lgtm")],
        currentFiles: [
          { location: "original.ts", oldContent: "base", newContent: "reviewed-original" },
          { location: "visible.ts", oldContent: "base", newContent: "next-visible" },
        ],
      }),
    ).resolves.toEqual({
      baselineReviewId: "follow-up",
      checkpoint: [
        { location: "original.ts", content: "reviewed-original" },
        { location: "visible.ts", content: "next-visible" },
      ],
      files: [
        {
          location: "visible.ts",
          oldContent: "reviewed-visible",
          newContent: "next-visible",
        },
      ],
    });
  });

  it("recovers a legacy focused review from an earlier matching checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "lgtm-since-last-"));
    temporaryDirectories.push(root);
    await writePayload(root, {
      reviewId: "full-review",
      generatedAt: "2026-07-14T10:00:00.000Z",
      location: "visible.ts",
      newContent: "reviewed-visible",
      checkpoint: [
        { location: "original.ts", content: "reviewed-original" },
        { location: "visible.ts", content: "reviewed-visible" },
      ],
    });
    await writePayload(root, {
      reviewId: "legacy-focused-review",
      generatedAt: "2026-07-14T11:00:00.000Z",
      location: "visible.ts",
      newContent: "reviewed-visible",
    });

    await expect(
      ReviewSinceLastPlatform.collect({
        root,
        reviewRoots: [join(root, ".lgtm")],
        currentFiles: [
          { location: "original.ts", oldContent: "base", newContent: "reviewed-original" },
          { location: "visible.ts", oldContent: "base", newContent: "next-visible" },
        ],
      }),
    ).resolves.toEqual({
      baselineReviewId: "legacy-focused-review",
      checkpoint: [
        { location: "original.ts", content: "reviewed-original" },
        { location: "visible.ts", content: "next-visible" },
      ],
      files: [
        {
          location: "visible.ts",
          oldContent: "reviewed-visible",
          newContent: "next-visible",
        },
      ],
    });
  });

  it("ignores newer open and canceled reviews", async () => {
    const root = await mkdtemp(join(tmpdir(), "lgtm-since-last-"));
    temporaryDirectories.push(root);
    await writePayload(root, {
      reviewId: "completed",
      generatedAt: "2026-07-14T10:00:00.000Z",
      location: "changed.ts",
      newContent: "reviewed",
    });
    await writePayload(root, {
      reviewId: "open",
      generatedAt: "2026-07-14T12:00:00.000Z",
      location: "changed.ts",
      newContent: "open-content",
      status: "open",
    });
    await writePayload(root, {
      reviewId: "canceled",
      generatedAt: "2026-07-14T11:00:00.000Z",
      location: "changed.ts",
      newContent: "canceled-content",
      status: "canceled",
    });

    await expect(
      ReviewSinceLastPlatform.collect({
        root,
        reviewRoots: [join(root, ".lgtm")],
        currentFiles: [{ location: "changed.ts", oldContent: "base", newContent: "follow-up" }],
      }),
    ).resolves.toEqual({
      baselineReviewId: "completed",
      checkpoint: [{ location: "changed.ts", content: "follow-up" }],
      files: [{ location: "changed.ts", oldContent: "reviewed", newContent: "follow-up" }],
    });
  });

  it("prefers the newest completed review from the requested session", async () => {
    const root = await mkdtemp(join(tmpdir(), "lgtm-since-last-"));
    temporaryDirectories.push(root);
    await writePayload(root, {
      reviewId: "current-session",
      generatedAt: "2026-07-14T10:00:00.000Z",
      location: "changed.ts",
      newContent: "reviewed-here",
      sessionId: "current-session",
    });
    await writePayload(root, {
      reviewId: "other-session",
      generatedAt: "2026-07-14T11:00:00.000Z",
      location: "changed.ts",
      newContent: "reviewed-elsewhere",
      sessionId: "other-session",
    });

    await expect(
      ReviewSinceLastPlatform.collect({
        root,
        reviewRoots: [join(root, ".lgtm")],
        currentFiles: [{ location: "changed.ts", oldContent: "base", newContent: "follow-up" }],
        sessionId: "current-session",
      }),
    ).resolves.toEqual({
      baselineReviewId: "current-session",
      checkpoint: [{ location: "changed.ts", content: "follow-up" }],
      files: [{ location: "changed.ts", oldContent: "reviewed-here", newContent: "follow-up" }],
    });
  });

  it("isolates remote baselines by SSH source key and reads current content remotely", async () => {
    const root = await mkdtemp(join(tmpdir(), "lgtm-since-last-"));
    temporaryDirectories.push(root);
    await writePayload(root, {
      reviewId: "other-host",
      generatedAt: "2026-07-14T12:00:00.000Z",
      location: "changed.ts",
      newContent: "other",
      sourceKey: "ssh://ren@other:22/repo",
    });
    await writePayload(root, {
      reviewId: "matching-host",
      generatedAt: "2026-07-14T11:00:00.000Z",
      location: "changed.ts",
      newContent: "reviewed",
      sourceKey: "ssh://ren@host:22/repo",
    });
    const readCurrentContent = vi.fn(async () => "follow-up");

    await expect(
      ReviewSinceLastPlatform.collect({
        root: "/repo",
        reviewRoots: [join(root, ".lgtm")],
        currentFiles: [{ location: "changed.ts", oldContent: "base", newContent: "follow-up" }],
        sourceKey: "ssh://ren@host:22/repo",
        readCurrentContent,
      }),
    ).resolves.toEqual({
      baselineReviewId: "matching-host",
      checkpoint: [{ location: "changed.ts", content: "follow-up" }],
      files: [{ location: "changed.ts", oldContent: "reviewed", newContent: "follow-up" }],
    });
    expect(readCurrentContent).toHaveBeenCalledWith("changed.ts");
  });
});

async function writePayload(
  root: string,
  params: {
    reviewId: string;
    generatedAt: string;
    location: string;
    newContent: string;
    checkpoint?: ReviewPayload["checkpoint"];
    status?: ReviewStatus;
    sessionId?: string;
    sourceKey?: string;
  },
) {
  const appDir = join(root, ".lgtm", params.reviewId);
  await mkdir(appDir, { recursive: true });
  const payload: ReviewPayload = {
    kind: "diff",
    name: params.reviewId,
    sessionId: params.sessionId ?? "session",
    reviewUUID: params.reviewId,
    reviewId: params.reviewId,
    cwd: root,
    appDir,
    reviewPath: join(appDir, "review.json"),
    generatedAt: params.generatedAt,
    checkpoint: params.checkpoint,
    source: params.sourceKey
      ? {
          kind: "git",
          transport: "ssh",
          key: params.sourceKey,
          label: "host:/repo",
        }
      : undefined,
    files: [
      {
        id: "file-0",
        location: params.location,
        language: "typescript",
        oldContent: "base",
        newContent: params.newContent,
        added: 1,
        removed: 1,
      },
    ],
  };
  await writeFile(join(appDir, "payload.json"), JSON.stringify(payload), "utf8");
  const review: ReviewJson = {
    version: 2,
    kind: "diff",
    status: params.status ?? "approved",
    name: params.reviewId,
    sessionId: params.sessionId ?? "session",
    reviewUUID: params.reviewId,
    reviewId: params.reviewId,
    cwd: root,
    appDir,
    reviewPath: join(appDir, "review.json"),
    createdAt: params.generatedAt,
    updatedAt: params.generatedAt,
    files: payload.files.map(function createReviewFile(file) {
      return { location: file.location, added: file.added, removed: file.removed, comments: [] };
    }),
    source: payload.source,
    documentComments: [],
  };
  await writeFile(join(appDir, "review.json"), JSON.stringify(review), "utf8");
}
