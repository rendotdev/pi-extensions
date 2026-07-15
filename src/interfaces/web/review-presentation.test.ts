import { describe, expect, it } from "vite-plus/test";
import type { ReviewJson, ReviewPayload } from "../../domain/review/review.ts";
import { ReviewPresentationClass } from "./review-presentation.ts";

function review(params: Partial<ReviewJson> = {}): ReviewJson {
  return {
    version: 2,
    kind: "diff",
    status: "open",
    name: "Review",
    sessionId: "session",
    reviewUUID: "uuid",
    reviewId: "review-id",
    cwd: "/repo",
    appDir: "/repo/.lgtm/review-id",
    reviewPath: "/repo/.lgtm/review-id/review.json",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    files: [],
    documentComments: [],
    ...params,
  };
}

const payload = {
  kind: "diff",
  name: "Review",
  sessionId: "session",
  reviewUUID: "uuid",
  reviewId: "review-id",
  cwd: "/repo",
  appDir: "/repo/.lgtm/review-id",
  reviewPath: "/repo/.lgtm/review-id/review.json",
  generatedAt: "2026-01-01T00:00:00.000Z",
  files: [
    {
      id: "large.ts",
      location: "large.ts",
      language: "typescript",
      oldContent: "",
      newContent: "",
      added: 600,
      removed: 0,
    },
  ],
} satisfies ReviewPayload;

describe("ReviewPresentation", () => {
  it("counts meaningful comments and ignores empty drafts", () => {
    const Presentation = new ReviewPresentationClass(
      { defaultCollapsedChangedLineThreshold: 500 },
      { now: () => new Date("2026-01-02T00:00:00.000Z") },
    );
    const value = review({
      files: [
        {
          location: "file.ts",
          added: 1,
          removed: 0,
          comments: [
            {
              id: "comment",
              fileLocation: "file.ts",
              selectedRowIds: [],
              selectedText: "line",
              side: "additions",
              selectedRange: { start: 1, end: 1 },
              startLine: 1,
              endLine: 1,
              lineNumbers: [1],
              comment: "Keep this",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    expect(Presentation.commentCount({ review: value })).toBe(1);
  });

  it("collapses large uncommented files by default", () => {
    const Presentation = new ReviewPresentationClass(
      { defaultCollapsedChangedLineThreshold: 500 },
      { now: () => new Date("2026-01-02T00:00:00.000Z") },
    );

    expect(
      Presentation.initialCollapsedFileIds({
        state: { payload, review: review() },
        fileExpansion: "auto",
        fileExpansionOverrides: {},
      }),
    ).toEqual(new Set(["large.ts"]));
  });
});
