import { describe, expect, it } from "vite-plus/test";
import type { ReviewSourceFile } from "../../types/review.ts";
import { ReviewGrouping } from "./grouping.ts";

const files = ["src/runtime.ts", "src/runtime.test.ts", "README.md"].map(
  function createReviewSourceFile(location, index): ReviewSourceFile {
    return {
      id: `file-${index}`,
      location,
      language: "typescript",
      oldContent: "before",
      newContent: "after",
      added: 1,
      removed: 1,
    };
  },
);

describe("ReviewGrouping", () => {
  it("preserves authored group and file order", () => {
    expect(
      new ReviewGrouping().build({
        files,
        groups: [
          { title: "Tests", files: ["src/runtime.test.ts"] },
          { title: "Runtime", files: ["src/runtime.ts"] },
        ],
      }),
    ).toEqual([
      { title: "Tests", files: ["src/runtime.test.ts"] },
      { title: "Runtime", files: ["src/runtime.ts"] },
      { title: "Other changes", files: ["README.md"] },
    ]);
  });

  it("keeps every changed file visible when groups are stale or duplicate assignments", () => {
    expect(
      new ReviewGrouping().build({
        files,
        groups: [
          {
            title: "  Runtime  ",
            files: ["missing.ts", "src/runtime.ts", "src/runtime.ts"],
          },
          { title: "Duplicate", files: ["src/runtime.ts"] },
          { title: "   ", files: ["README.md"] },
        ],
      }),
    ).toEqual([
      { title: "Runtime", files: ["src/runtime.ts"] },
      { title: "Other changes", files: ["src/runtime.test.ts", "README.md"] },
    ]);
  });

  it("leaves reviews without authored groups flat", () => {
    expect(new ReviewGrouping().build({ files, groups: undefined })).toBeUndefined();
  });
});
