import type { SelectedLineRange } from "@pierre/diffs/react";
import { DomainClass } from "../../domain/domain-class.ts";
import type { ReviewSourceFile } from "../../domain/review/review.ts";

export type DiffScrollAnchor = {
  lineNumber: number;
  root: ShadowRoot | HTMLElement;
  scrollElement: HTMLElement;
  side: "additions" | "deletions";
  top: number;
};

export type ElementScrollAnchor = {
  element: HTMLElement;
  scrollElement: HTMLElement;
  top: number;
};

type LineSelectionPoint = {
  lineNumber: number;
  side: "additions" | "deletions";
};

type LineSelectionRenderer = {
  setSelectedLines: (range: SelectedLineRange | null, options?: { notify?: boolean }) => void;
};

export class ReviewCommentInteractionClass extends DomainClass<
  {
    minimumTextareaHeight: number;
    cleanupByNode: WeakMap<HTMLElement, () => void>;
    pointerCleanupByNode: WeakMap<EventTarget, () => void>;
  },
  {
    cancelAnimationFrame: (handle: number) => void;
    documentSelection: () => Selection | null;
    now: () => number;
    random: () => number;
    randomUUID: (() => string) | undefined;
    requestAnimationFrame: (callback: FrameRequestCallback) => number;
    setTimeout: (callback: () => void, milliseconds: number) => number;
  }
> {
  private isPointerInteractionActive = false;
  private readonly pointerReleaseCallbacks = new Set<() => void>();

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

  public finishAfterPointerInteraction(params: { callback: () => void }): void {
    if (this.isPointerInteractionActive) {
      this.pointerReleaseCallbacks.add(params.callback);
      return;
    }
    params.callback();
  }

  public installPointerTracking(params: { node: EventTarget; phase: string }): void {
    if (params.phase === "unmount") {
      this.params.pointerCleanupByNode.get(params.node)?.();
      this.params.pointerCleanupByNode.delete(params.node);
      this.isPointerInteractionActive = false;
      this.pointerReleaseCallbacks.clear();
      return;
    }
    if (this.params.pointerCleanupByNode.has(params.node)) {
      return;
    }
    function beginPointerInteraction(this: ReviewCommentInteractionClass) {
      this.isPointerInteractionActive = true;
    }
    const boundBeginPointerInteraction = beginPointerInteraction.bind(this);
    const finishPointerInteraction = () => {
      if (!this.isPointerInteractionActive) {
        return;
      }
      this.isPointerInteractionActive = false;
      const callbacks = Array.from(this.pointerReleaseCallbacks);
      this.pointerReleaseCallbacks.clear();
      const scheduleTimeout = this.deps.setTimeout;
      scheduleTimeout(function waitForDeferredSelectionComments() {
        scheduleTimeout(function finishDeferredComments() {
          for (const callback of callbacks) {
            callback();
          }
        }, 0);
      }, 0);
    };
    params.node.addEventListener("pointerdown", boundBeginPointerInteraction, true);
    params.node.addEventListener("pointercancel", finishPointerInteraction, true);
    params.node.addEventListener("pointerup", finishPointerInteraction, true);
    this.params.pointerCleanupByNode.set(params.node, function cleanUpPointerTracking() {
      params.node.removeEventListener("pointerdown", boundBeginPointerInteraction, true);
      params.node.removeEventListener("pointercancel", finishPointerInteraction, true);
      params.node.removeEventListener("pointerup", finishPointerInteraction, true);
    });
  }

  public captureDiffScrollAnchor(params: {
    node: HTMLElement;
    range: SelectedLineRange;
  }): DiffScrollAnchor | null {
    const root = params.node.shadowRoot ?? params.node;
    const side = params.range.endSide || params.range.side || "additions";
    const lineNumber = params.range.end;
    const line = this.diffLineElement({ root, lineNumber, side });
    const scrollElement = params.node.closest<HTMLElement>("[data-review-diff-scroll]");
    const isAnchorMissing = !line || !scrollElement;
    if (isAnchorMissing) {
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
    if (Math.abs(offset) < 0.5) {
      return;
    }
    params.anchor.scrollElement.scrollTop += offset;
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
    if (Math.abs(offset) < 0.5) {
      return;
    }
    params.anchor.scrollElement.scrollTop += offset;
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
    if (lineNumbers.length === 0) {
      return null;
    }
    return {
      startLine: Math.min(...lineNumbers),
      endLine: Math.max(...lineNumbers),
    };
  }

  public installRowSelection(params: {
    node: HTMLElement;
    phase: string;
    renderer: LineSelectionRenderer;
    previewSelection: (range: SelectedLineRange) => void;
    commitSelection: (range: SelectedLineRange) => void;
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
    const eventTarget = params.node.ownerDocument.defaultView ?? window;
    let anchor: LineSelectionPoint | null = null;
    let pointerId: number | null = null;
    let renderedRange: SelectedLineRange | null = null;
    let pendingRange: SelectedLineRange | null = null;
    let renderFrame: number | null = null;

    function renderPendingRange() {
      renderFrame = null;
      if (!pendingRange) {
        return;
      }
      renderedRange = pendingRange;
      pendingRange = null;
      params.renderer.setSelectedLines(renderedRange, { notify: false });
    }
    const queueRange = (range: SelectedLineRange) => {
      const currentRange = pendingRange ?? renderedRange;
      const isRangeUnchanged =
        currentRange?.start === range.start &&
        currentRange.end === range.end &&
        currentRange.side === range.side &&
        currentRange.endSide === range.endSide;
      if (isRangeUnchanged) {
        return;
      }
      pendingRange = range;
      renderFrame ??= this.deps.requestAnimationFrame(renderPendingRange);
    };
    const finishRender = () => {
      if (renderFrame !== null) {
        this.deps.cancelAnimationFrame(renderFrame);
        renderFrame = null;
      }
      renderPendingRange();
    };
    const resetPointerSession = () => {
      anchor = null;
      pointerId = null;
      pendingRange = null;
      renderedRange = null;
      if (renderFrame !== null) {
        this.deps.cancelAnimationFrame(renderFrame);
        renderFrame = null;
      }
    };
    function rangeFromPoint(point: LineSelectionPoint): SelectedLineRange | null {
      return anchor
        ? {
            start: anchor.lineNumber,
            end: point.lineNumber,
            side: anchor.side,
            endSide: point.side,
          }
        : null;
    }
    const handlePointerDown = (event: Event) => {
      const pointerEvent = event as PointerEvent;
      const isPrimaryMouseButton =
        pointerEvent.pointerType === "mouse" && pointerEvent.button === 0;
      const shouldIgnorePointerDown =
        !isPrimaryMouseButton || pointerId !== null || this.touchesLineNumber({ event });
      if (shouldIgnorePointerDown) {
        return;
      }
      const point = this.lineSelectionPoint({ event: pointerEvent, root });
      if (!point) {
        return;
      }
      pointerEvent.preventDefault();
      this.blurActiveReviewComment({ node: params.node, root });
      anchor = point;
      pointerId = pointerEvent.pointerId;
      const range = rangeFromPoint(point);
      if (range) {
        renderedRange = range;
        params.previewSelection(range);
        params.renderer.setSelectedLines(range, { notify: false });
      }
    };
    const handlePointerMove = (event: Event) => {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      pointerEvent.preventDefault();
      const point = this.lineSelectionPoint({ event: pointerEvent, root, useCoordinates: true });
      const range = point ? rangeFromPoint(point) : null;
      if (range) {
        queueRange(range);
      }
    };
    const handlePointerUp = (event: Event) => {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      pointerEvent.preventDefault();
      const point = this.lineSelectionPoint({ event: pointerEvent, root, useCoordinates: true });
      const range = point ? rangeFromPoint(point) : renderedRange;
      if (range) {
        pendingRange = range;
        finishRender();
        params.commitSelection(range);
      }
      resetPointerSession();
    };
    function handlePointerCancel(event: Event) {
      if ((event as PointerEvent).pointerId !== pointerId) {
        return;
      }
      params.renderer.setSelectedLines(null, { notify: false });
      resetPointerSession();
    }

    root.addEventListener("pointerdown", handlePointerDown, true);
    eventTarget.addEventListener("pointermove", handlePointerMove, true);
    eventTarget.addEventListener("pointerup", handlePointerUp, true);
    eventTarget.addEventListener("pointercancel", handlePointerCancel, true);
    this.params.cleanupByNode.set(params.node, () => {
      root.removeEventListener("pointerdown", handlePointerDown, true);
      eventTarget.removeEventListener("pointermove", handlePointerMove, true);
      eventTarget.removeEventListener("pointerup", handlePointerUp, true);
      eventTarget.removeEventListener("pointercancel", handlePointerCancel, true);
      resetPointerSession();
    });
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

  private lineSelectionPoint(params: {
    event: PointerEvent;
    root: ShadowRoot | HTMLElement;
    useCoordinates?: boolean;
  }): LineSelectionPoint | null {
    const rootNode =
      params.root instanceof ShadowRoot
        ? params.root
        : params.root.getRootNode({ composed: false });
    const coordinateElement = params.useCoordinates
      ? rootNode instanceof ShadowRoot
        ? rootNode.elementFromPoint(params.event.clientX, params.event.clientY)
        : params.root.ownerDocument.elementFromPoint(params.event.clientX, params.event.clientY)
      : null;
    const pathLine = params.event
      .composedPath()
      .find(
        (target): target is HTMLElement =>
          target instanceof HTMLElement && target.hasAttribute("data-line"),
      );
    const element = coordinateElement instanceof HTMLElement ? coordinateElement : pathLine;
    const line = element?.closest<HTMLElement>("[data-line][data-line-index]") ?? null;
    const isOutsideRoot = !line || !params.root.contains(line);
    const isComment = element?.closest("[data-review-comment]") !== null;
    const shouldIgnorePoint = isOutsideRoot || isComment;
    if (shouldIgnorePoint) {
      return null;
    }
    const lineNumber = Number.parseInt(line.getAttribute("data-line") ?? "", 10);
    if (!Number.isFinite(lineNumber)) {
      return null;
    }
    return { lineNumber, side: this.lineSide({ element: line }) };
  }

  private touchesLineNumber(params: { event: Event }): boolean {
    return params.event
      .composedPath()
      .some((target) => target instanceof HTMLElement && target.hasAttribute("data-column-number"));
  }

  private blurActiveReviewComment(params: {
    node: HTMLElement;
    root: ShadowRoot | HTMLElement;
  }): void {
    const documentActiveElement = params.node.ownerDocument.activeElement;
    const rootActiveElement =
      params.root instanceof ShadowRoot ? params.root.activeElement : documentActiveElement;
    for (const activeElement of [rootActiveElement, documentActiveElement]) {
      const isActiveReviewComment =
        activeElement instanceof HTMLElement && activeElement.closest("[data-review-comment]");
      if (isActiveReviewComment) {
        activeElement.blur();
        return;
      }
    }
  }

  private lineSide(params: { element: HTMLElement }): "additions" | "deletions" {
    if (params.element.closest?.("[data-deletions]")) {
      return "deletions";
    }
    const lineType = params.element.getAttribute("data-line-type") ?? "";
    return lineType.includes("deletion") ? "deletions" : "additions";
  }

  private diffLineElement(params: {
    root: ShadowRoot | HTMLElement;
    lineNumber: number;
    side: "additions" | "deletions";
  }): HTMLElement | null {
    const lines = Array.from(
      params.root.querySelectorAll<HTMLElement>(
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
      const shouldRememberChangeType =
        changeTypeMatch === null && lineType.indexOf(requestedChangeType) >= 0;
      if (shouldRememberChangeType) {
        changeTypeMatch = line;
      }
      const shouldRememberSide =
        sideMatch === null && this.lineSide({ element: line }) === params.side;
      if (shouldRememberSide) {
        sideMatch = line;
      }
    }
    return changeTypeMatch ?? sideMatch ?? lines[0] ?? null;
  }
}

export const ReviewCommentInteraction = new ReviewCommentInteractionClass(
  {
    minimumTextareaHeight: 44,
    cleanupByNode: new WeakMap(),
    pointerCleanupByNode: new WeakMap(),
  },
  {
    cancelAnimationFrame:
      globalThis.cancelAnimationFrame?.bind(globalThis) ?? globalThis.clearTimeout.bind(globalThis),
    documentSelection: () => document.getSelection(),
    now: () => Date.now(),
    random: () => Math.random(),
    randomUUID:
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
        : undefined,
    requestAnimationFrame:
      globalThis.requestAnimationFrame?.bind(globalThis) ??
      function requestAnimationFrame(callback) {
        return globalThis.setTimeout(() => callback(performance.now()), 16);
      },
    setTimeout: globalThis.setTimeout.bind(globalThis),
  },
);
