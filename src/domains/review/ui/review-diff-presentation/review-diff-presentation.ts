import { getHighlighterThemeStyles, getSharedHighlighter } from "@pierre/diffs";
import { defineService } from "../../../../define.ts";

export class ReviewDiffPresentation extends defineService({
  params: {
    themes: { light: "github-light" as const, dark: "github-dark" as const },
    lineDiffType: "word" as const,
    diffIndicators: "classic" as const,
    hunkSeparators: "metadata" as const,
    unsafeCSS: [
      ':host { --review-radius: 6px; --diffs-font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --diffs-header-font-family: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --diffs-bg-hover-override: #0070f3; --diffs-bg-selection-override: #0070f3; --diffs-bg-selection-number-override: #0070f3; --diffs-selection-number-fg: #0070f3; }',
      '[data-diffs-header="default"] { padding-inline: 0 !important; border-radius: var(--review-radius) var(--review-radius) 0 0 !important; }',
      '[data-diffs-header="default"] [data-header-content] { margin-left: 0 !important; }',
      '[data-diffs-header="default"] [data-metadata] { padding-right: 0 !important; }',
      "[data-code] { padding-block: 0 !important; }",
      "[data-code] { overflow-x: auto !important; }",
      "[data-line] { user-select: none !important; -webkit-user-select: none !important; }",
      "[data-change-icon] { opacity: 0.72; transform: scale(0.9); transform-origin: center; }",
      "[data-diff-span] { border-radius: var(--review-radius) !important; }",
      "[data-separator-content], [data-expand-button], [data-separator-wrapper] { border-color: var(--border) !important; border-radius: var(--review-radius) !important; }",
      "[data-separator-wrapper] { background-color: var(--border) !important; }",
    ].join("\n"),
  },
  deps: { getHighlighterThemeStyles, getSharedHighlighter },
}) {
  private themeStylesPromise: Promise<string> | null = null;

  public themes(params: {}) {
    void params;
    return this.params.themes;
  }

  public resolveTheme(params: { resolvedTheme?: string }) {
    const type = params.resolvedTheme === "dark" ? ("dark" as const) : ("light" as const);
    return { name: this.params.themes[type], type };
  }

  public highlighterOptions(params: {}) {
    void params;
    return { lineDiffType: this.params.lineDiffType, theme: this.params.themes };
  }

  public fileOptions(params: {}) {
    void params;
    return {
      diffIndicators: this.params.diffIndicators,
      hunkSeparators: this.params.hunkSeparators,
      disableFileHeader: true,
      lineDiffType: this.params.lineDiffType,
      unsafeCSS: this.params.unsafeCSS,
    };
  }

  private async loadThemeStyles(): Promise<string> {
    const highlighter = await this.deps.getSharedHighlighter({
      themes: [this.params.themes.light, this.params.themes.dark],
      langs: ["diff"],
    });
    return this.deps.getHighlighterThemeStyles({ theme: this.params.themes, highlighter });
  }

  public themeStyles(params: {}): Promise<string> {
    void params;
    this.themeStylesPromise ??= this.loadThemeStyles();
    return this.themeStylesPromise;
  }
}
