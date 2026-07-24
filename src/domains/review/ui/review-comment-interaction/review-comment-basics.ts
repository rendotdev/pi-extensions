import { defineService } from "../../../../define.ts";
import type { ReviewSourceFile } from "../../types/review.ts";

export class ReviewCommentBasics extends defineService({
  params: { minimumTextareaHeight: 44 },
  deps: {
    documentSelection: function documentSelection() {
      return document.getSelection();
    },
    now: function now() {
      return Date.now();
    },
    random: function random() {
      return Math.random();
    },
    randomUUID:
      typeof globalThis.crypto?.randomUUID === "function"
        ? (globalThis.crypto.randomUUID.bind(globalThis.crypto) as () => string)
        : undefined,
  },
}) {
  public createId(params: {}): string {
    void params;
    return (
      this.deps.randomUUID?.() ??
      `comment-${this.deps.now()}-${this.deps.random().toString(16).slice(2)}`
    );
  }

  public selectedText(params: {
    file: ReviewSourceFile;
    side: "additions" | "deletions";
    startLine: number;
    endLine: number;
  }): string {
    const source = params.side === "additions" ? params.file.newContent : params.file.oldContent;
    return source
      .split(/\r\n|\r|\n/)
      .slice(params.startLine - 1, params.endLine)
      .join("\n");
  }

  public resizeTextarea(params: { textarea: HTMLTextAreaElement; allowShrink?: boolean }): void {
    const currentHeight = Number.parseFloat(params.textarea.style.height);
    if (params.allowShrink) {
      params.textarea.style.height = "auto";
    }
    const nextHeight = Math.max(this.params.minimumTextareaHeight, params.textarea.scrollHeight);
    const isHeightUnchanged = !params.allowShrink && currentHeight === nextHeight;
    if (isHeightUnchanged) {
      return;
    }
    params.textarea.style.height = nextHeight + "px";
  }

  public elementFromNode(params: { node: Node | null }): Element | null {
    if (!params.node) {
      return null;
    }
    return params.node.nodeType === Node.ELEMENT_NODE
      ? (params.node as Element)
      : params.node.parentElement;
  }

  public currentTextSelection(params: { root: ShadowRoot | HTMLElement }) {
    const selection = this.selectionFromRoot({ root: params.root });
    const selectedText = selection?.toString() ?? "";
    const isSelectionMissing =
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      selectedText.trim().length === 0;
    if (isSelectionMissing) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const startElement = this.elementFromNode({ node: range.startContainer });
    const endElement = this.elementFromNode({ node: range.endContainer });
    const touchesComment = [startElement, endElement].some((element) =>
      element?.closest("[data-review-comment]"),
    );
    return touchesComment ? null : { selection, selectedText, range, startElement, endElement };
  }

  public selectedDocumentLineRange(params: {
    root: HTMLElement;
    range: Range;
  }): { startLine: number; endLine: number } | null {
    const lineNumbers: number[] = [];
    for (const element of params.root.querySelectorAll<HTMLElement>("[data-document-line]")) {
      try {
        if (params.range.intersectsNode(element)) {
          const lineNumber = Number.parseInt(element.dataset.documentLine ?? "", 10);
          if (Number.isFinite(lineNumber)) {
            lineNumbers.push(lineNumber);
          }
        }
      } catch {
        // Detached nodes cannot intersect the current range.
      }
    }
    return lineNumbers.length === 0
      ? null
      : { startLine: Math.min(...lineNumbers), endLine: Math.max(...lineNumbers) };
  }

  private selectionFromRoot(params: { root: ShadowRoot | HTMLElement }): Selection | null {
    const shadowSelection =
      params.root instanceof ShadowRoot
        ? (
            params.root as ShadowRoot & {
              getSelection?: () => Selection | null;
            }
          ).getSelection?.()
        : null;
    return shadowSelection && !shadowSelection.isCollapsed
      ? shadowSelection
      : this.deps.documentSelection();
  }
}
