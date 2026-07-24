import { codeToHtml, type ShikiTransformer } from "@pierre/diffs";
import { defineService } from "../../../../define.ts";
import { ReviewDiffPresentation } from "../review-diff-presentation/review-diff-presentation.ts";

const reviewDiffPresentation: Pick<ReviewDiffPresentation, "themes" | "themeStyles"> =
  new ReviewDiffPresentation();

export class DocumentCodeHighlighter extends defineService({
  params: {},
  deps: {
    codeToHtml,
    reviewDiffPresentation,
  },
}) {
  private readonly cache = new Map<string, Promise<string>>();

  public languageFromClassName(params: { className?: string }): string {
    const language = params.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? "text";
    return language === "patch" ? "diff" : language;
  }

  public highlight(params: {
    code: string;
    className?: string;
    sourceStartLine?: number;
  }): Promise<string> {
    const language = this.languageFromClassName({ className: params.className });
    const sourceStartLine = params.sourceStartLine ?? 1;
    const cacheKey = `${language}\0${sourceStartLine}\0${params.code}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const highlighted = this.render({ code: params.code, language, sourceStartLine });
    this.cache.set(cacheKey, highlighted);
    return highlighted;
  }

  private async render(params: {
    code: string;
    language: string;
    sourceStartLine: number;
  }): Promise<string> {
    const themeStyles = await this.deps.reviewDiffPresentation.themeStyles({});
    const codeTransformers = this.transformers({ ...params, themeStyles });
    try {
      return await this.deps.codeToHtml(params.code, {
        lang: params.language,
        themes: this.deps.reviewDiffPresentation.themes({}),
        defaultColor: false,
        transformers: codeTransformers,
      });
    } catch {
      return await this.deps.codeToHtml(params.code, {
        lang: "text",
        themes: this.deps.reviewDiffPresentation.themes({}),
        defaultColor: false,
        transformers: this.transformers({ ...params, language: "text", themeStyles }),
      });
    }
  }

  private transformers(params: {
    code: string;
    language: string;
    sourceStartLine: number;
    themeStyles: string;
  }): ShikiTransformer[] {
    const lines = params.code.split(/\r?\n/);
    return [
      themeStylesTransformer({ themeStyles: params.themeStyles }),
      {
        name: "lgtm-document-diff-lines",
        line: (node, lineNumber) => {
          node.properties["data-document-line"] = params.sourceStartLine + lineNumber - 1;
          const kind =
            params.language === "diff" ? diffLineKind({ line: lines[lineNumber - 1] ?? "" }) : null;
          if (kind) {
            node.properties["data-diff-line"] = kind;
          }
          return node;
        },
      },
    ];
  }
}

function themeStylesTransformer(params: { themeStyles: string }): ShikiTransformer {
  return {
    name: "lgtm-review-diff-theme",
    pre: (node) => {
      const existingStyle = typeof node.properties.style === "string" ? node.properties.style : "";
      node.properties.style = `${existingStyle}${params.themeStyles}`;
      return node;
    },
  };
}

function diffLineKind(params: {
  line: string;
}): "addition" | "deletion" | "header" | "hunk" | null {
  const isHeader =
    params.line.startsWith("diff --git ") ||
    params.line.startsWith("index ") ||
    params.line.startsWith("--- ") ||
    params.line.startsWith("+++ ");
  if (isHeader) {
    return "header";
  }
  if (params.line.startsWith("@@")) {
    return "hunk";
  }
  if (params.line.startsWith("+")) {
    return "addition";
  }
  if (params.line.startsWith("-")) {
    return "deletion";
  }
  return null;
}
