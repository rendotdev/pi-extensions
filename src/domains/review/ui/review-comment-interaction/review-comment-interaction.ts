import { defineRuntime } from "../../../../define.ts";
import { ReviewCommentBasics } from "./review-comment-basics.ts";
import type {
  ReviewCommentInteractionDeps,
  ReviewCommentInteractionParams,
} from "./review-comment-types.ts";
import { ReviewPointerTracking } from "./review-pointer-tracking.ts";
import { ReviewRowSelection } from "./review-row-selection.ts";
import { ReviewScrollAnchors } from "./review-scroll-anchors.ts";

export type { DiffScrollAnchor, ElementScrollAnchor } from "./review-comment-types.ts";

const defaultParams: ReviewCommentInteractionParams = {
  minimumTextareaHeight: 44,
  cleanupByNode: new WeakMap(),
  pointerCleanupByNode: new WeakMap(),
};

const defaultDeps: ReviewCommentInteractionDeps = {
  cancelAnimationFrame: function cancelScheduledFrame(handle: number) {
    if (globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(handle);
      return;
    }
    globalThis.clearTimeout(handle);
  },
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
      ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
      : undefined,
  requestAnimationFrame: function scheduleFrame(callback: FrameRequestCallback): number {
    if (globalThis.requestAnimationFrame) {
      return globalThis.requestAnimationFrame(callback);
    }
    return globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number;
  },
  setTimeout: function scheduleTimeout(callback: () => void, milliseconds: number): number {
    return globalThis.setTimeout(callback, milliseconds) as unknown as number;
  },
};

export class ReviewCommentInteraction extends defineRuntime({
  params: defaultParams,
  deps: defaultDeps,
}) {
  private readonly basics = new ReviewCommentBasics({
    params: { minimumTextareaHeight: this.params.minimumTextareaHeight },
    deps: {
      documentSelection: this.deps.documentSelection,
      now: this.deps.now,
      random: this.deps.random,
      randomUUID: this.deps.randomUUID,
    },
  });

  private readonly pointerTracking = new ReviewPointerTracking({
    params: { cleanupByNode: this.params.pointerCleanupByNode },
    deps: { setTimeout: this.deps.setTimeout },
  });

  private readonly rowSelection = new ReviewRowSelection({
    params: { cleanupByNode: this.params.cleanupByNode },
    deps: {
      cancelAnimationFrame: this.deps.cancelAnimationFrame,
      requestAnimationFrame: this.deps.requestAnimationFrame,
    },
  });

  private readonly scrollAnchors = new ReviewScrollAnchors();

  public readonly captureDiffScrollAnchor = this.scrollAnchors.captureDiffScrollAnchor.bind(
    this.scrollAnchors,
  );
  public readonly captureElementScrollAnchor = this.scrollAnchors.captureElementScrollAnchor.bind(
    this.scrollAnchors,
  );
  public readonly createId = this.basics.createId.bind(this.basics);
  public readonly currentTextSelection = this.basics.currentTextSelection.bind(this.basics);
  public readonly elementFromNode = this.basics.elementFromNode.bind(this.basics);
  public readonly finishAfterPointerInteraction =
    this.pointerTracking.finishAfterPointerInteraction.bind(this.pointerTracking);
  public readonly installPointerTracking = this.pointerTracking.installPointerTracking.bind(
    this.pointerTracking,
  );
  public readonly installRowSelection = this.rowSelection.installRowSelection.bind(
    this.rowSelection,
  );
  public readonly resizeTextarea = this.basics.resizeTextarea.bind(this.basics);
  public readonly restoreDiffScrollAnchor = this.scrollAnchors.restoreDiffScrollAnchor.bind(
    this.scrollAnchors,
  );
  public readonly restoreElementScrollAnchor = this.scrollAnchors.restoreElementScrollAnchor.bind(
    this.scrollAnchors,
  );
  public readonly selectedDocumentLineRange = this.basics.selectedDocumentLineRange.bind(
    this.basics,
  );
  public readonly selectedText = this.basics.selectedText.bind(this.basics);
}
