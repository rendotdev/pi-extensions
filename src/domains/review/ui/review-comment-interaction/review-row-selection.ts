import type { SelectedLineRange } from "@pierre/diffs/react";
import { defineRuntime } from "../../../../define.ts";
import type { LineSelectionPoint, LineSelectionRenderer } from "./review-comment-types.ts";

type RowSelectionSessionParams = {
  node: HTMLElement;
  root: ShadowRoot | HTMLElement;
  eventTarget: EventTarget;
  renderer: LineSelectionRenderer;
  previewSelection: (range: SelectedLineRange) => void;
  commitSelection: (range: SelectedLineRange) => void;
};

class RowSelectionSession extends defineRuntime({
  params: {} as RowSelectionSessionParams,
  deps: {
    cancelAnimationFrame: function cancelScheduledFrame(handle: number) {
      globalThis.cancelAnimationFrame(handle);
    },
    requestAnimationFrame: function scheduleFrame(callback: FrameRequestCallback): number {
      return globalThis.requestAnimationFrame(callback);
    },
  },
}) {
  private anchor: LineSelectionPoint | null = null;
  private pointerId: number | null = null;
  private renderedRange: SelectedLineRange | null = null;
  private pendingRange: SelectedLineRange | null = null;
  private renderFrame: number | null = null;

  public mount(): void {
    this.params.root.addEventListener("pointerdown", this.handlePointerDown, true);
    this.params.eventTarget.addEventListener("pointermove", this.handlePointerMove, true);
    this.params.eventTarget.addEventListener("pointerup", this.handlePointerUp, true);
    this.params.eventTarget.addEventListener("pointercancel", this.handlePointerCancel, true);
  }

  public unmount(): void {
    this.params.root.removeEventListener("pointerdown", this.handlePointerDown, true);
    this.params.eventTarget.removeEventListener("pointermove", this.handlePointerMove, true);
    this.params.eventTarget.removeEventListener("pointerup", this.handlePointerUp, true);
    this.params.eventTarget.removeEventListener("pointercancel", this.handlePointerCancel, true);
    this.reset();
  }

  private readonly handlePointerDown = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    const isPrimaryMouseButton = pointerEvent.pointerType === "mouse" && pointerEvent.button === 0;
    const shouldIgnore =
      !isPrimaryMouseButton || this.pointerId !== null || touchesLineNumber({ event });
    if (shouldIgnore) {
      return;
    }
    const point = lineSelectionPoint({ event: pointerEvent, root: this.params.root });
    if (!point) {
      return;
    }
    pointerEvent.preventDefault();
    blurActiveReviewComment({ node: this.params.node, root: this.params.root });
    this.anchor = point;
    this.pointerId = pointerEvent.pointerId;
    const range = this.rangeFromPoint(point);
    if (range) {
      this.renderedRange = range;
      this.params.previewSelection(range);
      this.params.renderer.setSelectedLines(range, { notify: false });
    }
  };

  private readonly handlePointerMove = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerId !== this.pointerId) {
      return;
    }
    pointerEvent.preventDefault();
    const point = lineSelectionPoint({
      event: pointerEvent,
      root: this.params.root,
      useCoordinates: true,
    });
    const range = point ? this.rangeFromPoint(point) : null;
    if (range) {
      this.queueRange(range);
    }
  };

  private readonly handlePointerUp = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerId !== this.pointerId) {
      return;
    }
    pointerEvent.preventDefault();
    const point = lineSelectionPoint({
      event: pointerEvent,
      root: this.params.root,
      useCoordinates: true,
    });
    const range = point ? this.rangeFromPoint(point) : this.renderedRange;
    if (range) {
      this.pendingRange = range;
      this.finishRender();
      this.params.commitSelection(range);
    }
    this.reset();
  };

  private readonly handlePointerCancel = (event: Event): void => {
    if ((event as PointerEvent).pointerId !== this.pointerId) {
      return;
    }
    this.params.renderer.setSelectedLines(null, { notify: false });
    this.reset();
  };

  private rangeFromPoint(point: LineSelectionPoint): SelectedLineRange | null {
    return this.anchor
      ? {
          start: this.anchor.lineNumber,
          end: point.lineNumber,
          side: this.anchor.side,
          endSide: point.side,
        }
      : null;
  }

  private queueRange(range: SelectedLineRange): void {
    const currentRange = this.pendingRange ?? this.renderedRange;
    const isUnchanged =
      currentRange?.start === range.start &&
      currentRange.end === range.end &&
      currentRange.side === range.side &&
      currentRange.endSide === range.endSide;
    if (!isUnchanged) {
      this.pendingRange = range;
      this.renderFrame ??= this.deps.requestAnimationFrame(this.renderPendingRange);
    }
  }

  private readonly renderPendingRange = (): void => {
    this.renderFrame = null;
    if (!this.pendingRange) {
      return;
    }
    this.renderedRange = this.pendingRange;
    this.pendingRange = null;
    this.params.renderer.setSelectedLines(this.renderedRange, { notify: false });
  };

  private finishRender(): void {
    if (this.renderFrame !== null) {
      this.deps.cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
    this.renderPendingRange();
  }

  private reset(): void {
    this.anchor = null;
    this.pointerId = null;
    this.pendingRange = null;
    this.renderedRange = null;
    if (this.renderFrame !== null) {
      this.deps.cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  }
}

export class ReviewRowSelection extends defineRuntime({
  params: { cleanupByNode: new WeakMap<HTMLElement, () => void>() },
  deps: {
    cancelAnimationFrame: function cancelScheduledFrame(handle: number) {
      if (globalThis.cancelAnimationFrame) {
        globalThis.cancelAnimationFrame(handle);
        return;
      }
      globalThis.clearTimeout(handle);
    },
    requestAnimationFrame: function scheduleFrame(callback: FrameRequestCallback): number {
      if (globalThis.requestAnimationFrame) {
        return globalThis.requestAnimationFrame(callback);
      }
      return globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number;
    },
  },
}) {
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
    const session = new RowSelectionSession({
      params: {
        ...params,
        root: params.node.shadowRoot ?? params.node,
        eventTarget: params.node.ownerDocument.defaultView ?? window,
      },
      deps: this.deps,
    });
    session.mount();
    this.params.cleanupByNode.set(params.node, () => session.unmount());
  }
}

function lineSelectionPoint(params: {
  event: PointerEvent;
  root: ShadowRoot | HTMLElement;
  useCoordinates?: boolean;
}): LineSelectionPoint | null {
  const rootNode =
    params.root instanceof ShadowRoot ? params.root : params.root.getRootNode({ composed: false });
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
  const element = pathLine ?? (coordinateElement instanceof HTMLElement ? coordinateElement : null);
  const line = element?.closest<HTMLElement>("[data-line][data-line-index]") ?? null;
  const shouldIgnore =
    !line || !params.root.contains(line) || element?.closest("[data-review-comment]") !== null;
  if (shouldIgnore) {
    return null;
  }
  const lineNumber = Number.parseInt(line.getAttribute("data-line") ?? "", 10);
  return Number.isFinite(lineNumber) ? { lineNumber, side: lineSide({ element: line }) } : null;
}

function touchesLineNumber(params: { event: Event }): boolean {
  return params.event
    .composedPath()
    .some((target) => target instanceof HTMLElement && target.hasAttribute("data-column-number"));
}

function blurActiveReviewComment(params: {
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

function lineSide(params: { element: HTMLElement }): "additions" | "deletions" {
  if (params.element.closest?.("[data-deletions]")) {
    return "deletions";
  }
  const lineType = params.element.getAttribute("data-line-type") ?? "";
  return lineType.includes("deletion") ? "deletions" : "additions";
}
