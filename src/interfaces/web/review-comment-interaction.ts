import type { SelectedLineRange } from "@pierre/diffs/react";
import { DomainClass } from "../../domain/domain-class.ts";
import type { ReviewSourceFile } from "../../domain/review/review.ts";

export class ReviewCommentInteractionClass extends DomainClass<
  { minimumTextareaHeight: number; cleanupByNode: WeakMap<HTMLElement, () => void> },
  {
    documentSelection: () => Selection | null;
    now: () => number;
    random: () => number;
    randomUUID: (() => string) | undefined;
    setTimeout: (callback: () => void, milliseconds: number) => number;
  }
> {
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

  public resizeTextarea(params: { textarea: HTMLTextAreaElement }): void {
    params.textarea.style.height = "auto";
    params.textarea.style.height =
      Math.max(this.params.minimumTextareaHeight, params.textarea.scrollHeight) + "px";
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
      !selection || !this.hasMeaningfulTextSelection({ selection, selectedText });
    if (isSelectionMissing) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const startElement = this.elementFromNode({ node: range.startContainer });
    const endElement = this.elementFromNode({ node: range.endContainer });
    if (this.touchesReviewComment({ startElement, endElement })) {
      return null;
    }
    return { selection, selectedText, range, startElement, endElement };
  }

  public installTextSelection(params: {
    node: HTMLElement;
    phase: string;
    file: ReviewSourceFile;
    addComment: (range: SelectedLineRange, selectedText: string) => void;
  }): void {
    if (params.phase === "unmount") {
      this.params.cleanupByNode.get(params.node)?.();
      this.params.cleanupByNode.delete(params.node);
      return;
    }
    if (this.params.cleanupByNode.has(params.node)) {
      return;
    }
    const root = params.node.shadowRoot ?? params.node;
    const handleMouseUp = () => {
      this.deps.setTimeout(() => {
        const textSelection = this.currentTextSelection({ root });
        if (!textSelection) {
          return;
        }
        const selectedRange = this.selectedLineRange({ root, range: textSelection.range });
        if (!selectedRange) {
          return;
        }
        params.addComment(selectedRange, textSelection.selectedText);
        textSelection.selection.removeAllRanges();
      }, 0);
    };
    root.addEventListener("mouseup", handleMouseUp);
    this.params.cleanupByNode.set(params.node, () =>
      root.removeEventListener("mouseup", handleMouseUp),
    );
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

  private hasMeaningfulTextSelection(params: {
    selection: Selection;
    selectedText: string;
  }): boolean {
    return (
      !params.selection.isCollapsed &&
      params.selection.rangeCount > 0 &&
      params.selectedText.trim().length > 0
    );
  }

  private touchesReviewComment(params: {
    startElement: Element | null;
    endElement: Element | null;
  }): boolean {
    for (const element of [params.startElement, params.endElement]) {
      if (element?.closest("[data-review-comment]")) {
        return true;
      }
    }
    return false;
  }

  private selectedLineRange(params: {
    root: ShadowRoot | HTMLElement;
    range: Range;
  }): SelectedLineRange | null {
    const lineElements = Array.from(
      params.root.querySelectorAll<HTMLElement>("[data-line][data-line-index]"),
    ).filter((element) => {
      try {
        return params.range.intersectsNode(element);
      } catch {
        return false;
      }
    });
    if (lineElements.length === 0) {
      return null;
    }
    const hasAddition = lineElements.some((element) => this.lineSide({ element }) === "additions");
    const side = hasAddition ? "additions" : "deletions";
    const lineNumbers = lineElements
      .filter((element) => this.lineSide({ element }) === side)
      .map((element) => Number.parseInt(element.getAttribute("data-line") ?? "", 10))
      .filter((lineNumber) => Number.isFinite(lineNumber));
    if (lineNumbers.length === 0) {
      return null;
    }
    return {
      start: Math.min(...lineNumbers),
      end: Math.max(...lineNumbers),
      side,
      endSide: side,
    };
  }

  private lineSide(params: { element: HTMLElement }): "additions" | "deletions" {
    const lineType = params.element.getAttribute("data-line-type") ?? "";
    return lineType.includes("deletion") ? "deletions" : "additions";
  }
}

export const ReviewCommentInteraction = new ReviewCommentInteractionClass(
  { minimumTextareaHeight: 44, cleanupByNode: new WeakMap() },
  {
    documentSelection: () => document.getSelection(),
    now: () => Date.now(),
    random: () => Math.random(),
    randomUUID:
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
        : undefined,
    setTimeout: globalThis.setTimeout.bind(globalThis),
  },
);
