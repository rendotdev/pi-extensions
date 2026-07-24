import { describe, expect, it } from "vite-plus/test";
import { ReviewHandoff } from "./handoff.ts";

describe("ReviewHandoff", () => {
  it("preserves unsaved diff comments in an agent-ready clipboard handoff", () => {
    expect(
      ReviewHandoff.fallbackText({
        review: {
          kind: "diff",
          name: "Authentication review",
          reviewPath: "/Users/example/project/.lgtm/session/review.json",
          files: [
            {
              location: "src/auth.ts",
              comments: [
                {
                  selectedText: "return token;",
                  startLine: 12,
                  endLine: 12,
                  comment: "Please validate this token first.",
                },
                {
                  selectedText: "ignored",
                  startLine: 20,
                  endLine: 21,
                  comment: "   ",
                },
              ],
            },
          ],
          documentComments: [],
        },
      }),
    )
      .toBe(`PTAL, please address the review comments: /Users/example/project/.lgtm/session/review.json

# Authentication review

## src/auth.ts:12

Please validate this token first.

Selected text:

> return token;
`);
  });

  it("preserves document comments and their source range", () => {
    expect(
      ReviewHandoff.fallbackText({
        review: {
          kind: "document",
          name: "Skill draft",
          reviewPath: "/tmp/review.json",
          files: [],
          document: { location: "skills/lgtm/SKILL.md" },
          documentComments: [
            {
              selectedText: "Keep context",
              startLine: 8,
              endLine: 10,
              comment: "Explain what context means here.",
            },
          ],
        },
      }),
    ).toContain("## skills/lgtm/SKILL.md:8-10\n\nExplain what context means here.");
  });

  it("formats concise clipboard handoffs for each review outcome", () => {
    const review = {
      kind: "diff" as const,
      name: "Authentication review",
      reviewPath: "/Users/example/project/.lgtm/session/review.json",
      files: [
        {
          location: "src/auth.ts",
          comments: [
            {
              selectedText: "return token;",
              startLine: 12,
              endLine: 12,
              comment: "Please validate this token first.",
            },
          ],
        },
      ],
      documentComments: [],
    };

    expect(ReviewHandoff.clipboardText({ decision: "approved", review })).toBe(
      "LGTM, approving the following changes: /Users/example/project/.lgtm/session/review.json",
    );
    expect(ReviewHandoff.clipboardText({ decision: "changes_requested", review })).toBe(
      "PTAL, please address the review comments: /Users/example/project/.lgtm/session/review.json",
    );
  });
});
