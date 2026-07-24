import { useCallback, useEffect, useRef } from "react";
import { defineUIHook } from "../../../../../../../define.ts";

type ScrollAnchor = { scrollElement: HTMLElement };

const definedUseScrollAnchorStabilizer = defineUIHook({
  params: {},
  deps: {
    cancelAnimationFrame: function cancelScheduledFrame(handle: number): void {
      window.cancelAnimationFrame(handle);
    },
    requestAnimationFrame: function scheduleFrame(callback: FrameRequestCallback): number {
      return window.requestAnimationFrame(callback);
    },
    useCallback,
    useEffect,
    useRef,
  },
  hook(props: { frameCount: number; restore: (anchor: ScrollAnchor) => void }) {
    const deps = this.deps;
    const anchorRef = deps.useRef<ScrollAnchor | null>(null);
    const frameRef = deps.useRef<number | null>(null);
    const releaseInputListenersRef = deps.useRef<(() => void) | null>(null);
    const latestHookParamsRef = deps.useRef(props);
    latestHookParamsRef.current = props;

    const cancel = deps.useCallback(function cancel() {
      if (frameRef.current !== null) {
        deps.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      anchorRef.current = null;
      const releaseInputListeners = releaseInputListenersRef.current;
      releaseInputListenersRef.current = null;
      releaseInputListeners?.();
    }, []);

    const capture = deps.useCallback(
      function capture(anchor: ScrollAnchor | null) {
        cancel();
        if (!anchor) {
          return;
        }
        anchorRef.current = anchor;
        function stopStabilizing() {
          cancel();
        }
        const inputEvents = ["keydown", "pointerdown", "touchstart", "wheel"] as const;
        for (const eventName of inputEvents) {
          anchor.scrollElement.addEventListener(eventName, stopStabilizing, {
            capture: true,
            passive: eventName === "touchstart" || eventName === "wheel",
          });
        }
        releaseInputListenersRef.current = function releaseInputListeners() {
          for (const eventName of inputEvents) {
            anchor.scrollElement.removeEventListener(eventName, stopStabilizing, true);
          }
        };
      },
      [cancel],
    );

    const stabilize = deps.useCallback(
      function stabilize() {
        const anchor = anchorRef.current;
        if (!anchor) {
          return;
        }
        if (frameRef.current !== null) {
          deps.cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        const capturedAnchor = anchor;
        let remainingFrames = latestHookParamsRef.current.frameCount;
        function restoreScrollAnchor() {
          if (anchorRef.current !== capturedAnchor) {
            return;
          }
          latestHookParamsRef.current.restore(capturedAnchor);
          remainingFrames -= 1;
          if (remainingFrames > 0) {
            frameRef.current = deps.requestAnimationFrame(restoreScrollAnchor);
            return;
          }
          cancel();
        }
        restoreScrollAnchor();
      },
      [cancel],
    );

    deps.useEffect(
      function cleanUpScrollAnchorStabilizer() {
        return cancel;
      },
      [cancel],
    );

    return { cancel, capture, stabilize };
  },
});

export const useScrollAnchorStabilizer = definedUseScrollAnchorStabilizer as unknown as <
  Anchor extends ScrollAnchor,
>(props: {
  frameCount: number;
  restore: (anchor: Anchor) => void;
}) => {
  cancel: () => void;
  capture: (anchor: Anchor | null) => void;
  stabilize: () => void;
};
