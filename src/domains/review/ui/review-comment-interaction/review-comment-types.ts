import type { SelectedLineRange } from "@pierre/diffs/react";

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

export type LineSelectionPoint = {
  lineNumber: number;
  side: "additions" | "deletions";
};

export type LineSelectionRenderer = {
  setSelectedLines: (range: SelectedLineRange | null, options?: { notify?: boolean }) => void;
};

export type ReviewCommentInteractionParams = {
  minimumTextareaHeight: number;
  cleanupByNode: WeakMap<HTMLElement, () => void>;
  pointerCleanupByNode: WeakMap<EventTarget, () => void>;
};

export type ReviewCommentInteractionDeps = {
  cancelAnimationFrame: (handle: number) => void;
  documentSelection: () => Selection | null;
  now: () => number;
  random: () => number;
  randomUUID: (() => string) | undefined;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  setTimeout: (callback: () => void, milliseconds: number) => number;
};
