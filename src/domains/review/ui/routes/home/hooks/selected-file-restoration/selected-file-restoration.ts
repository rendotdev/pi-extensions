import { useEffect, type RefObject } from "react";
import { defineUIHook } from "../../../../../../../define.ts";
import type { ReviewSourceFile } from "../../../../../types/review.ts";

type RestorationProps = {
  files: ReviewSourceFile[];
  listRef: RefObject<HTMLDivElement | null>;
  scrollElementRef: RefObject<HTMLElement | null>;
  scrollMargin: number;
  scrollToFile: (params: { fileId: string; updateUrl: boolean }) => void;
  selectedFileLocation: string | null;
};

type RestorationState = {
  fileId: string;
  frame: number | null;
  settleTimer: number | null;
  stopped: boolean;
};

type RestorationDeps = {
  cancelAnimationFrame: (handle: number) => void;
  clearTimeout: (handle: number) => void;
  createObserver: (callback: MutationCallback) => MutationObserver;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  setTimeout: (callback: () => void, delay: number) => number;
};

const inputEvents = ["keydown", "pointerdown", "touchstart", "wheel"] as const;

const useSelectedFileRestorationDefinition = defineUIHook({
  params: {},
  deps: {
    cancelAnimationFrame: (handle: number) => window.cancelAnimationFrame(handle),
    clearTimeout: (handle: number) => window.clearTimeout(handle),
    createObserver: (callback: MutationCallback) => new MutationObserver(callback),
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      window.requestAnimationFrame(callback),
    setTimeout: (callback: () => void, delay: number) => window.setTimeout(callback, delay),
    useEffect,
  },
  hook(props: RestorationProps) {
    const deps = this.deps;
    deps.useEffect(
      function restoreSelectedFileFromLocation() {
        return beginSelectedFileRestoration({ deps, props });
      },
      [
        props.files,
        props.listRef,
        props.scrollElementRef,
        props.scrollMargin,
        props.scrollToFile,
        props.selectedFileLocation,
      ],
    );
  },
});

export const useSelectedFileRestoration = useSelectedFileRestorationDefinition;

function beginSelectedFileRestoration(params: { deps: RestorationDeps; props: RestorationProps }) {
  const { deps, props } = params;
  const file = props.files.find((candidate) => candidate.location === props.selectedFileLocation);
  const list = props.listRef.current;
  const isRestorationTargetMissing = !file || !list;
  if (isRestorationTargetMissing) {
    return;
  }
  const state: RestorationState = {
    fileId: file.id,
    frame: null,
    settleTimer: null,
    stopped: false,
  };
  function stop() {
    stopSelectedFileRestoration({ deps, observer, props, state, stop });
  }
  function restore() {
    restoreSelectedFile({ deps, props, state, stop, restore });
  }
  const observer = deps.createObserver(restore);
  observer.observe(list, {
    attributeFilter: ["style"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  for (const eventName of inputEvents) {
    props.scrollElementRef.current?.addEventListener(eventName, stop, {
      capture: true,
      passive: eventName === "touchstart" || eventName === "wheel",
    });
  }
  restore();
  return stop;
}

function stopSelectedFileRestoration(params: {
  deps: RestorationDeps;
  observer: MutationObserver;
  props: RestorationProps;
  state: RestorationState;
  stop: () => void;
}) {
  params.state.stopped = true;
  params.observer.disconnect();
  for (const eventName of inputEvents) {
    params.props.scrollElementRef.current?.removeEventListener(eventName, params.stop, true);
  }
  if (params.state.frame !== null) {
    params.deps.cancelAnimationFrame(params.state.frame);
  }
  if (params.state.settleTimer !== null) {
    params.deps.clearTimeout(params.state.settleTimer);
  }
}

function restoreSelectedFile(params: {
  deps: RestorationDeps;
  props: RestorationProps;
  state: RestorationState;
  stop: () => void;
  restore: () => void;
}) {
  if (params.state.stopped) {
    return;
  }
  const scrollElement = params.props.scrollElementRef.current;
  const item = params.props.listRef.current?.querySelector<HTMLElement>(
    `[data-review-file-item="${CSS.escape(params.state.fileId)}"]`,
  );
  const heading = item?.querySelector<HTMLElement>("[data-review-file-heading]");
  const isRenderedTargetMissing = !heading || !scrollElement;
  if (isRenderedTargetMissing) {
    clearSettleTimer(params);
    params.props.scrollToFile({ fileId: params.state.fileId, updateUrl: false });
    return;
  }
  const offset = heading.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top;
  const maximumScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
  const targetScrollTop = Math.max(0, Math.min(maximumScrollTop, scrollElement.scrollTop + offset));
  const shouldSettle =
    Math.abs(offset) <= 1 || Math.abs(targetScrollTop - scrollElement.scrollTop) <= 1;
  if (shouldSettle) {
    params.state.settleTimer ??= params.deps.setTimeout(params.stop, 250);
    return;
  }
  clearSettleTimer(params);
  scrollElement.scrollTo({ behavior: "auto", top: targetScrollTop });
  params.state.frame = params.deps.requestAnimationFrame(params.restore);
}

function clearSettleTimer(params: { deps: RestorationDeps; state: RestorationState }) {
  if (params.state.settleTimer === null) {
    return;
  }
  params.deps.clearTimeout(params.state.settleTimer);
  params.state.settleTimer = null;
}
