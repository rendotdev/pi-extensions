import { describe, expect, it } from "vite-plus/test";
import { ReviewDiffPresentation } from "./review-diff-presentation.ts";

describe("ReviewDiffPresentation", () => {
  it("shares themes and diff behavior across review renderers", () => {
    expect(new ReviewDiffPresentation().resolveTheme({ resolvedTheme: "light" })).toEqual({
      name: "github-light",
      type: "light",
    });
    expect(new ReviewDiffPresentation().resolveTheme({ resolvedTheme: "dark" })).toEqual({
      name: "github-dark",
      type: "dark",
    });
    expect(new ReviewDiffPresentation().highlighterOptions({})).toEqual({
      lineDiffType: "word",
      theme: { light: "github-light", dark: "github-dark" },
    });
    expect(new ReviewDiffPresentation().fileOptions({})).toMatchObject({
      diffIndicators: "classic",
      hunkSeparators: "metadata",
      disableFileHeader: true,
      lineDiffType: "word",
    });
    expect(new ReviewDiffPresentation().fileOptions({}).unsafeCSS).toContain(
      "[data-line] { user-select: none",
    );
  });

  it("derives the GitHub diff palette from Pierre's configured themes", async () => {
    const styles = await new ReviewDiffPresentation().themeStyles({});

    expect(styles).toContain("--diffs-light-bg:#fff");
    expect(styles).toContain("--diffs-dark-bg:#24292e");
    expect(styles).toContain("--diffs-light-addition-color:#28a745");
    expect(styles).toContain("--diffs-dark-addition-color:#34d058");
    expect(styles).toContain("--diffs-light-deletion-color:#d73a49");
    expect(styles).toContain("--diffs-dark-deletion-color:#ea4a5a");
  });
});
