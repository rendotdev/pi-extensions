import { useEffect, useRef } from "react";
import { defineUIHook } from "../../../../define.ts";

export const useReviewServerMonitor = defineUIHook({
  params: { intervalMilliseconds: 1_500 },
  deps: {
    useEffect,
    useRef,
    fetch: function fetchReviewServer(input: RequestInfo | URL, init?: RequestInit) {
      return globalThis.fetch(input, init);
    },
    setInterval: function scheduleInterval(
      callback: () => void,
      intervalMilliseconds: number,
    ): ReturnType<typeof setInterval> {
      return globalThis.setInterval(callback, intervalMilliseconds);
    },
    clearInterval: function clearScheduledInterval(timer: ReturnType<typeof setInterval>) {
      globalThis.clearInterval(timer);
    },
    closeWindow: function closeReviewWindow() {
      window.close();
      window.setTimeout(function retryCloseReviewWindow() {
        window.close();
      }, 50);
    },
  },
  hook(props: { getCommentCount: () => number }): void {
    const deps = this.deps;
    const params = this.params;
    const fetchHealth = deps.fetch.bind(globalThis);
    const scheduleInterval = deps.setInterval.bind(globalThis);
    const clearScheduledInterval = deps.clearInterval.bind(globalThis);

    const latestGetCommentCountRef = deps.useRef(props.getCommentCount);
    latestGetCommentCountRef.current = props.getCommentCount;

    deps.useEffect(function monitorReviewServer() {
      let isChecking = false;

      async function checkReviewServer() {
        if (isChecking) {
          return;
        }
        isChecking = true;
        try {
          const response = await fetchHealth("/health", { cache: "no-store" });
          const shouldCloseWindow = !response.ok && latestGetCommentCountRef.current() === 0;
          if (shouldCloseWindow) {
            deps.closeWindow();
          }
        } catch {
          if (latestGetCommentCountRef.current() === 0) {
            deps.closeWindow();
          }
        } finally {
          isChecking = false;
        }
      }

      const timer = scheduleInterval(function checkReviewServerOnInterval() {
        void checkReviewServer();
      }, params.intervalMilliseconds);

      return function stopReviewServerMonitor() {
        clearScheduledInterval(timer);
      };
    }, []);
  },
});
