import { codeToHtml } from "@pierre/diffs";
import { describe, expect, it, vi } from "vite-plus/test";
import { DocumentCodeHighlighter } from "./document-code-highlighter.ts";

function highlighter(params: { codeToHtml?: typeof codeToHtml } = {}) {
  return new DocumentCodeHighlighter({
    params: {},
    deps: {
      codeToHtml: params.codeToHtml ?? codeToHtml,
      reviewDiffPresentation: {
        themes: () => ({ light: "github-light", dark: "github-dark" }),
        themeStyles: async () =>
          "--diffs-light-bg:#fff;--diffs-dark-bg:#24292e;--diffs-light-addition-color:#28a745;--diffs-dark-addition-color:#34d058;",
      },
    },
  });
}

describe("DocumentCodeHighlighter", () => {
  it("reads fenced languages and treats patch blocks as diffs", () => {
    const Highlighter = highlighter();

    expect(Highlighter.languageFromClassName({ className: "language-typescript" })).toBe(
      "typescript",
    );
    expect(Highlighter.languageFromClassName({ className: "language-patch" })).toBe("diff");
    expect(Highlighter.languageFromClassName({})).toBe("text");
  });

  it("renders syntax colors for light and dark themes", async () => {
    const html = await highlighter().highlight({
      code: "const answer = 42;",
      className: "language-typescript",
    });

    expect(html).toContain('class="shiki shiki-themes github-light github-dark"');
    expect(html).toContain("--shiki-light:#D73A49");
    expect(html).toContain("--shiki-dark:#F97583");
    expect(html).toContain("--diffs-light-addition-color:#28a745");
    expect(html).toContain("--diffs-dark-addition-color:#34d058");
  });

  it("marks semantic diff lines without treating file headers as changes", async () => {
    const html = await highlighter().highlight({
      code: [
        "diff --git a/task.ts b/task.ts",
        "--- a/task.ts",
        "+++ b/task.ts",
        "@@ -1 +1 @@",
        "-const attempts = 1;",
        "+const attempts = 3;",
      ].join("\n"),
      className: "language-patch",
      sourceStartLine: 14,
    });

    expect(html).toContain('data-document-line="14"');
    expect(html).toContain('data-document-line="19"');
    expect(html.match(/data-diff-line="header"/g)).toHaveLength(3);
    expect(html).toContain('data-diff-line="hunk"');
    expect(html).toContain('data-diff-line="deletion"');
    expect(html).toContain('data-diff-line="addition"');
  });

  it("falls back to escaped plain text for unknown languages", async () => {
    const html = await highlighter().highlight({
      code: '<script>alert("unsafe")</script>',
      className: "language-made-up",
    });

    expect(html).toContain('&#x3C;script>alert("unsafe")&#x3C;/script>');
    expect(html).not.toContain("<script>");
  });

  it("caches repeated highlighted blocks", async () => {
    const codeToHtmlSpy = vi.fn(codeToHtml);
    const Highlighter = highlighter({ codeToHtml: codeToHtmlSpy });

    await Highlighter.highlight({
      code: "const value = 1;",
      className: "language-ts",
    });
    await Highlighter.highlight({
      code: "const value = 1;",
      className: "language-ts",
    });

    expect(codeToHtmlSpy).toHaveBeenCalledTimes(1);
  });

  it("caches the same code separately when its document line changes", async () => {
    const codeToHtmlSpy = vi.fn(codeToHtml);
    const Highlighter = highlighter({ codeToHtml: codeToHtmlSpy });

    await Highlighter.highlight({ code: "value", sourceStartLine: 2 });
    await Highlighter.highlight({ code: "value", sourceStartLine: 3 });

    expect(codeToHtmlSpy).toHaveBeenCalledTimes(2);
  });
});
