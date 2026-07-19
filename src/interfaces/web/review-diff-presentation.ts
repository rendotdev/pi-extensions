import { getHighlighterThemeStyles, getSharedHighlighter } from "@pierre/diffs";
import { DomainClass } from "../../domain/domain-class.ts";

export class ReviewDiffPresentationClass extends DomainClass<
  {
    themes: { light: "github-light"; dark: "github-dark" };
    lineDiffType: "word";
    diffIndicators: "classic";
    hunkSeparators: "metadata";
    unsafeCSS: string;
  },
  {
    getHighlighterThemeStyles: typeof getHighlighterThemeStyles;
    getSharedHighlighter: typeof getSharedHighlighter;
  }
> {
  private themeStylesPromise: Promise<string> | null = null;

  public themes() {
    return this.params.themes;
  }

  public resolveTheme(params: { resolvedTheme?: string }) {
    const type = params.resolvedTheme === "dark" ? ("dark" as const) : ("light" as const);
    return { name: this.params.themes[type], type };
  }

  public highlighterOptions() {
    return {
      lineDiffType: this.params.lineDiffType,
      theme: this.params.themes,
    };
  }

  public fileOptions() {
    return {
      diffIndicators: this.params.diffIndicators,
      hunkSeparators: this.params.hunkSeparators,
      disableFileHeader: true,
      lineDiffType: this.params.lineDiffType,
      unsafeCSS: this.params.unsafeCSS,
    };
  }

  public themeStyles(): Promise<string> {
    this.themeStylesPromise ??= this.loadThemeStyles();
    return this.themeStylesPromise;
  }

  private async loadThemeStyles(): Promise<string> {
    const themes = this.themes();
    const highlighter = await this.deps.getSharedHighlighter({
      themes: [themes.light, themes.dark],
      langs: ["diff"],
    });
    return this.deps.getHighlighterThemeStyles({ theme: themes, highlighter });
  }
}

export const ReviewDiffPresentation = new ReviewDiffPresentationClass(
  {
    themes: { light: "github-light", dark: "github-dark" },
    lineDiffType: "word",
    diffIndicators: "classic",
    hunkSeparators: "metadata",
    unsafeCSS: [
      ':host { --review-radius: 6px; --diffs-font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --diffs-header-font-family: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --diffs-bg-hover-override: #0070f3; --diffs-bg-selection-override: #0070f3; --diffs-bg-selection-number-override: #0070f3; --diffs-selection-number-fg: #0070f3; }',
      '[data-diffs-header="default"] { padding-inline: 0 !important; border-radius: var(--review-radius) var(--review-radius) 0 0 !important; }',
      '[data-diffs-header="default"] [data-header-content] { margin-left: 0 !important; }',
      '[data-diffs-header="default"] [data-metadata] { padding-right: 0 !important; }',
      // Pierre adds vertical inset around the rows when its file header is disabled.
      "[data-code] { padding-block: 0 !important; }",
      // Pierre's scroll mode otherwise reserves a scrollbar gutter even when every line fits.
      "[data-code] { overflow-x: auto !important; }",
      // Comment selection uses whole rows instead of the browser's character ranges.
      "[data-line] { user-select: none !important; -webkit-user-select: none !important; }",
      "[data-change-icon] { opacity: 0.72; transform: scale(0.9); transform-origin: center; }",
      "[data-diff-span] { border-radius: var(--review-radius) !important; }",
      "[data-separator-content], [data-expand-button], [data-separator-wrapper] { border-color: var(--border) !important; border-radius: var(--review-radius) !important; }",
      "[data-separator-wrapper] { background-color: var(--border) !important; }",
    ].join("\n"),
  },
  { getHighlighterThemeStyles, getSharedHighlighter },
);
