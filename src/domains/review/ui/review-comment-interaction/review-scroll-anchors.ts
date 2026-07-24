import type { SelectedLineRange } from "@pierre/diffs/react";
import { defineService } from "../../../../define.ts";
import type { DiffScrollAnchor, ElementScrollAnchor } from "./review-comment-types.ts";

export class ReviewScrollAnchors extends defineService({ params: {}, deps: {} }) {
  public captureDiffScrollAnchor(params: {
    node: HTMLElement;
    range: SelectedLineRange;
  }): DiffScrollAnchor | null {
    const root = params.node;
    const side = params.range.endSide || params.range.side || "additions";
    const lineNumber = params.range.end;
    const line = this.diffLineElement({ root, lineNumber, side });
    const scrollElement = params.node.closest<HTMLElement>("[data-review-diff-scroll]");
    const isMissingScrollContext = !line || !scrollElement;
    if (isMissingScrollContext) {
      return null;
    }
    return {
      lineNumber,
      root,
      scrollElement,
      side,
      top: line.getBoundingClientRect().top,
    };
  }

  public restoreDiffScrollAnchor(params: { anchor: DiffScrollAnchor }): void {
    const line = this.diffLineElement(params.anchor);
    if (!line) {
      return;
    }
    const offset = line.getBoundingClientRect().top - params.anchor.top;
    if (Math.abs(offset) >= 0.5) {
      params.anchor.scrollElement.scrollTop += offset;
    }
  }

  public captureElementScrollAnchor(params: {
    element: HTMLElement;
    scrollElement: HTMLElement;
  }): ElementScrollAnchor {
    return {
      element: params.element,
      scrollElement: params.scrollElement,
      top: params.element.getBoundingClientRect().top,
    };
  }

  public restoreElementScrollAnchor(params: { anchor: ElementScrollAnchor }): void {
    const offset = params.anchor.element.getBoundingClientRect().top - params.anchor.top;
    if (Math.abs(offset) >= 0.5) {
      params.anchor.scrollElement.scrollTop += offset;
    }
  }

  private diffLineElement(params: {
    root: ShadowRoot | HTMLElement;
    lineNumber: number;
    side: "additions" | "deletions";
  }): HTMLElement | null {
    const root =
      "shadowRoot" in params.root ? (params.root.shadowRoot ?? params.root) : params.root;
    const lines = Array.from(
      root.querySelectorAll<HTMLElement>(
        `[data-column-number="${params.lineNumber}"][data-line-index]`,
      ),
    );
    const requestedChangeType = params.side === "additions" ? "addition" : "deletion";
    const requestedIndexPosition = params.side === "additions" ? 1 : 0;
    const requestedLineIndex = params.lineNumber - 1;
    let changeTypeMatch: HTMLElement | null = null;
    let sideMatch: HTMLElement | null = null;
    for (const line of lines) {
      const lineIndexes = (line.getAttribute("data-line-index") ?? "").split(",");
      const isRequestedLine =
        Number.parseInt(lineIndexes[requestedIndexPosition] ?? "", 10) === requestedLineIndex;
      if (isRequestedLine) {
        return line;
      }
      const lineType = line.getAttribute("data-line-type") ?? "";
      const isRequestedChangeType =
        changeTypeMatch === null && lineType.includes(requestedChangeType);
      if (isRequestedChangeType) {
        changeTypeMatch = line;
      }
      const isRequestedSide = sideMatch === null && lineSide({ element: line }) === params.side;
      if (isRequestedSide) {
        sideMatch = line;
      }
    }
    return changeTypeMatch ?? sideMatch ?? lines[0] ?? null;
  }
}

function lineSide(params: { element: HTMLElement }): "additions" | "deletions" {
  if (params.element.closest?.("[data-deletions]")) {
    return "deletions";
  }
  const lineType = params.element.getAttribute("data-line-type") ?? "";
  return lineType.includes("deletion") ? "deletions" : "additions";
}
