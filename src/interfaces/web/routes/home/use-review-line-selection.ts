import { useCallback, useEffect, useRef, useState } from "react";
import type { SelectedLineRange } from "@pierre/diffs/react";

export function buildUseReviewLineSelection(
  params: {},
  deps: {
    cancelAnimationFrame: typeof window.cancelAnimationFrame;
    requestAnimationFrame: typeof window.requestAnimationFrame;
    useCallback: typeof useCallback;
    useEffect: typeof useEffect;
    useRef: typeof useRef;
    useState: typeof useState;
  },
) {
  void params;
  return function useReviewLineSelection() {
    const [selectedLines, setSelectedLines] = deps.useState<SelectedLineRange | null | undefined>();
    const clearFrameRef = deps.useRef<number | null>(null);
    const selectedLinesRef = deps.useRef<SelectedLineRange | null | undefined>(undefined);

    const cancelPendingClear = deps.useCallback(function cancelPendingClear() {
      if (clearFrameRef.current === null) {
        return;
      }
      deps.cancelAnimationFrame(clearFrameRef.current);
      clearFrameRef.current = null;
    }, []);

    const selectLines = deps.useCallback(
      function selectLines(range: SelectedLineRange) {
        cancelPendingClear();
        selectedLinesRef.current = range;
        setSelectedLines(range);
      },
      [cancelPendingClear],
    );

    const clearSelectedLines = deps.useCallback(
      function clearSelectedLines(expectedRange?: SelectedLineRange) {
        const currentRange = selectedLinesRef.current;
        const isExpectedRangePresent = expectedRange !== undefined;
        const doesCurrentRangeMatch =
          isExpectedRangePresent &&
          currentRange !== null &&
          currentRange !== undefined &&
          currentRange.start === expectedRange.start &&
          currentRange.end === expectedRange.end &&
          currentRange.side === expectedRange.side &&
          currentRange.endSide === expectedRange.endSide;
        const shouldClearSelection = !isExpectedRangePresent || doesCurrentRangeMatch;
        if (!shouldClearSelection) {
          return;
        }
        cancelPendingClear();
        selectedLinesRef.current = null;
        setSelectedLines(null);
        clearFrameRef.current = deps.requestAnimationFrame(function releaseControlledSelection() {
          clearFrameRef.current = null;
          if (selectedLinesRef.current !== null) {
            return;
          }
          selectedLinesRef.current = undefined;
          setSelectedLines(undefined);
        });
      },
      [cancelPendingClear],
    );

    deps.useEffect(
      function cleanUpPendingSelectionClear() {
        return cancelPendingClear;
      },
      [cancelPendingClear],
    );

    return { clearSelectedLines, selectedLines, selectLines };
  };
}

export const useReviewLineSelection = buildUseReviewLineSelection(
  {},
  {
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    useCallback,
    useEffect,
    useRef,
    useState,
  },
);
