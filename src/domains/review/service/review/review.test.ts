import { describe, expect, it } from "vite-plus/test";
import { ReviewBuilder, ReviewFormatter, ReviewSource } from "./review.ts";

describe("review domain", () => {
  it("builds review source metadata from changed content", () => {
    const source = ReviewSource.build({
      file: {
        location: "src/review.ts",
        oldContent: "one\ntwo",
        newContent: "one\nthree\nfour",
      },
      index: 2,
    });

    expect(source).toMatchObject({
      id: "file-2",
      language: "typescript",
      added: 2,
      removed: 1,
    });
  });

  it("preserves existing comments when rebuilding a review", () => {
    const existingReview = ReviewBuilder.build({
      kind: "diff",
      name: "Existing review",
      sessionId: "session",
      reviewUUID: "review-uuid",
      reviewId: "review-id",
      cwd: "/project",
      appDir: "/project/.lgtm/review-id",
      reviewPath: "/project/.lgtm/review-id/review.json",
      generatedAt: "2026-07-12T00:00:00.000Z",
      files: [
        ReviewSource.build({
          file: { location: "file.ts", oldContent: "old", newContent: "new" },
          index: 0,
        }),
      ],
    });
    existingReview.files[0].comments.push({
      id: "comment",
      fileLocation: "file.ts",
      selectedRowIds: [],
      selectedText: "new",
      side: "additions",
      selectedRange: { start: 1, end: 1 },
      startLine: 1,
      endLine: 1,
      lineNumbers: [1],
      comment: "Keep this comment",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });

    const rebuilt = ReviewBuilder.build({
      ...existingReview,
      generatedAt: "2026-07-12T00:01:00.000Z",
      existingReview,
      files: [
        ReviewSource.build({
          file: { location: "file.ts", oldContent: "old", newContent: "newer" },
          index: 0,
        }),
      ],
    });

    expect(rebuilt.files[0].comments[0]?.comment).toBe("Keep this comment");
  });

  it("preserves SSH source identity in review state", () => {
    const source = {
      kind: "git" as const,
      transport: "ssh" as const,
      key: "ssh://ren@host:22/repo",
      label: "host:/repo",
    };
    const review = ReviewBuilder.build({
      kind: "diff",
      name: "Remote review",
      sessionId: "session",
      reviewUUID: "review-uuid",
      reviewId: "review-id",
      cwd: "/project",
      appDir: "/project/.lgtm/review-id",
      reviewPath: "/project/.lgtm/review-id/review.json",
      generatedAt: "2026-07-12T00:00:00.000Z",
      files: [],
      source,
    });

    expect(review.source).toEqual(source);
  });

  it("formats a completed review for an agent", () => {
    const review = ReviewBuilder.build({
      kind: "diff",
      name: "Domain review",
      sessionId: "session",
      reviewUUID: "review-uuid",
      reviewId: "review-id",
      cwd: "/project",
      appDir: "/project/.lgtm/review-id",
      reviewPath: "/project/.lgtm/review-id/review.json",
      generatedAt: "2026-07-12T00:00:00.000Z",
      files: [],
    });
    review.status = "approved";

    expect(ReviewFormatter.format({ review, reviewPath: review.reviewPath })).toContain(
      "Status: approved",
    );
  });

  it("formats only files with written comments", () => {
    const review = ReviewBuilder.build({
      kind: "diff",
      name: "Commented review",
      sessionId: "session",
      reviewUUID: "review-uuid",
      reviewId: "review-id",
      cwd: "/project",
      appDir: "/project/.lgtm/review-id",
      reviewPath: "/project/.lgtm/review-id/review.json",
      generatedAt: "2026-07-12T00:00:00.000Z",
      files: [
        ReviewSource.build({
          file: { location: "commented.ts", oldContent: "old", newContent: "new" },
          index: 0,
        }),
        ReviewSource.build({
          file: { location: "uncommented.ts", oldContent: "old", newContent: "new" },
          index: 1,
        }),
      ],
    });
    review.files[0]?.comments.push({
      id: "comment",
      fileLocation: "commented.ts",
      selectedRowIds: [],
      selectedText: "new",
      side: "additions",
      selectedRange: { start: 1, end: 1 },
      startLine: 1,
      endLine: 1,
      lineNumbers: [1],
      comment: "Keep this change",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });

    const formatted = ReviewFormatter.format({ review, reviewPath: review.reviewPath });

    expect(formatted).toContain("## commented.ts");
    expect(formatted).not.toContain("uncommented.ts");
    expect(formatted).not.toContain("No comments for this file.");
  });
});
