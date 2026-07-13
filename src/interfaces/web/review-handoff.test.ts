import { describe, expect, it } from "vite-plus/test";
import { ReviewHandoffClass } from "./review-handoff.ts";

describe("ReviewHandoffClass", () => {
  it("preserves unsaved diff comments in an agent-ready clipboard handoff", () => {
    const handoff = new ReviewHandoffClass();

    expect(
      handoff.recoveryText({
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
      }),
    ).toBe(`PTAL: /Users/example/project/.lgtm/session/review.json

# Authentication review

## src/auth.ts:12

Please validate this token first.

Selected text:

> return token;
`);
  });

  it("preserves document comments and their source range", () => {
    const handoff = new ReviewHandoffClass();

    expect(
      handoff.recoveryText({
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
      }),
    ).toContain("## skills/lgtm/SKILL.md:8-10\n\nExplain what context means here.");
  });
});
