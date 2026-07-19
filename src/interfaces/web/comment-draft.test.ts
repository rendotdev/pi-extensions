import { describe, expect, it, vi } from "vite-plus/test";
import type { ReviewJson } from "../../domain/review/review.ts";
import { CommentDraftClass } from "./comment-draft.ts";

function commentDraft() {
  return new CommentDraftClass(
    { syncWaitMs: 250 },
    {
      clearTimeout: vi.fn(),
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      setTimeout: function setTimeout() {
        return 1;
      },
    },
  );
}

describe("CommentDraftClass", () => {
  it.each(["", "   ", "\n\t"])('deletes an empty draft on blur: "%s"', (value) => {
    const onDelete = vi.fn();
    const onFinish = vi.fn();

    commentDraft().finish({ id: "comment", value, onDelete, onFinish });

    expect(onDelete).toHaveBeenCalledOnce();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("finishes a written comment without trimming its content", () => {
    const onDelete = vi.fn();
    const onFinish = vi.fn();

    commentDraft().finish({
      id: "comment",
      value: "  Keep this comment.  ",
      onDelete,
      onFinish,
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledExactlyOnceWith("  Keep this comment.  ");
  });

  it("keeps rapid input local until the deferred review sync runs", () => {
    const onSync = vi.fn();
    let synchronize: (() => void) | undefined;
    const CommentDraft = new CommentDraftClass(
      { syncWaitMs: 250 },
      {
        clearTimeout: vi.fn(),
        now: () => new Date("2026-07-18T00:00:00.000Z"),
        setTimeout: function setTimeout(callback) {
          synchronize = callback;
          return 1;
        },
      },
    );

    CommentDraft.update({ id: "comment", value: "Fast typing", onSync });

    expect(CommentDraft.value({ id: "comment", fallback: "" })).toBe("Fast typing");
    expect(onSync).not.toHaveBeenCalled();
    synchronize?.();
    expect(onSync).toHaveBeenCalledExactlyOnceWith("Fast typing");
  });

  it("applies an unsynchronized draft before finishing a review", () => {
    const CommentDraft = commentDraft();
    const review: ReviewJson = {
      version: 2,
      kind: "diff",
      status: "open",
      name: "Draft review",
      sessionId: "session",
      reviewUUID: "review-uuid",
      reviewId: "review-id",
      cwd: "/repo",
      appDir: "/repo/.lgtm/review",
      reviewPath: "/repo/.lgtm/review/review.json",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      files: [
        {
          location: "file.ts",
          added: 1,
          removed: 0,
          comments: [
            {
              id: "comment",
              fileLocation: "file.ts",
              selectedRowIds: ["additions:1-1"],
              selectedText: "line",
              side: "additions",
              selectedRange: { start: 1, end: 1, side: "additions" },
              startLine: 1,
              endLine: 1,
              lineNumbers: [1],
              comment: "",
              createdAt: "2026-07-17T00:00:00.000Z",
              updatedAt: "2026-07-17T00:00:00.000Z",
            },
          ],
        },
      ],
      documentComments: [],
    };
    CommentDraft.update({ id: "comment", value: "Unsynchronized draft", onSync: vi.fn() });

    const reviewWithDraft = CommentDraft.applyToReview({ review });

    expect(reviewWithDraft.files[0]?.comments[0]?.comment).toBe("Unsynchronized draft");
    expect(reviewWithDraft.updatedAt).toBe("2026-07-18T00:00:00.000Z");
  });
});
