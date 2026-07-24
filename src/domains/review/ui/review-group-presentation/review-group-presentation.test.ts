import { describe, expect, it } from "vite-plus/test";
import type { ReviewSourceFile } from "../../types/review.ts";
import { ReviewGroupPresentation } from "./review-group-presentation.ts";

const files = ["runtime.ts", "runtime.test.ts", "README.md"].map(
  function createFile(location, index): ReviewSourceFile {
    return {
      id: `file-${index}`,
      location,
      language: "typescript",
      oldContent: "",
      newContent: "",
      added: 0,
      removed: 0,
    };
  },
);

describe("ReviewGroupPresentation", () => {
  it("returns one untitled group for a flat review", () => {
    expect(ReviewGroupPresentation.build({ files, groups: undefined })).toEqual([
      { title: null, files },
    ]);
  });

  it("preserves authored ordering and keeps uncovered files visible", () => {
    expect(
      ReviewGroupPresentation.build({
        files,
        groups: [
          { title: "Tests", files: ["runtime.test.ts"] },
          { title: "Runtime", files: ["runtime.ts"] },
        ],
      }),
    ).toEqual([
      { title: "Tests", files: [files[1]] },
      { title: "Runtime", files: [files[0]] },
      { title: "Other changes", files: [files[2]] },
    ]);
  });

  it("removes empty groups after file search", () => {
    expect(
      ReviewGroupPresentation.build({
        files: [files[1]],
        groups: [
          { title: "Runtime", files: ["runtime.ts"] },
          { title: "Tests", files: ["runtime.test.ts"] },
        ],
      }),
    ).toEqual([{ title: "Tests", files: [files[1]] }]);
  });
});
