import { describe, expect, it } from "vite-plus/test";
import { ReviewCommentInteractionClass } from "./review-comment-interaction.ts";

function interaction() {
  return new ReviewCommentInteractionClass(
    { minimumTextareaHeight: 44, cleanupByNode: new WeakMap() },
    {
      documentSelection: () => null,
      now: () => 42,
      random: () => 0.5,
      randomUUID: undefined,
      setTimeout: function setTimeout() {
        return 1;
      },
    },
  );
}

describe("ReviewCommentInteraction", () => {
  it("creates deterministic fallback IDs from injected dependencies", () => {
    expect(interaction().createId({})).toBe("comment-42-8");
  });

  it("reads selected source lines from the requested diff side", () => {
    expect(
      interaction().selectedText({
        file: {
          id: "file",
          location: "file.ts",
          language: "typescript",
          oldContent: "old one\nold two",
          newContent: "new one\nnew two",
          added: 2,
          removed: 2,
        },
        side: "additions",
        startLine: 2,
        endLine: 2,
      }),
    ).toBe("new two");
  });

  it("resizes textareas with the configured minimum height", () => {
    const textarea = { style: { height: "" }, scrollHeight: 20 } as HTMLTextAreaElement;

    interaction().resizeTextarea({ textarea });

    expect(textarea.style.height).toBe("44px");
  });
});
