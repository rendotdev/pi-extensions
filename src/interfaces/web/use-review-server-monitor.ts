import { useEffect, useRef } from "react";

export function buildUseReviewServerMonitor(
  params: { intervalMilliseconds: number },
  deps: {
    useEffect: typeof useEffect;
    useRef: typeof useRef;
    fetch: typeof fetch;
    setInterval: (
      callback: () => void,
      intervalMilliseconds: number,
    ) => ReturnType<typeof setInterval>;
    clearInterval: (timer: ReturnType<typeof setInterval>) => void;
    closeWindow: () => void;
  },
) {
  const fetchHealth = deps.fetch.bind(globalThis);
  const scheduleInterval = deps.setInterval.bind(globalThis);
  const clearScheduledInterval = deps.clearInterval.bind(globalThis);

  return function useReviewServerMonitor(hookParams: { getCommentCount: () => number }): void {
    const latestGetCommentCountRef = deps.useRef(hookParams.getCommentCount);
    latestGetCommentCountRef.current = hookParams.getCommentCount;

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
  };
}

export const useReviewServerMonitor = buildUseReviewServerMonitor(
  { intervalMilliseconds: 1_500 },
  {
    useEffect,
    useRef,
    fetch,
    setInterval,
    clearInterval,
    closeWindow: function closeReviewWindow() {
      window.close();
      window.setTimeout(function retryCloseReviewWindow() {
        window.close();
      }, 50);
    },
  },
);
