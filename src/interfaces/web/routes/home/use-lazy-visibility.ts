import { useEffect, useRef, useState } from "react";

export function buildUseLazyVisibility(
  params: { rootMargin: string },
  deps: {
    IntersectionObserver: typeof window.IntersectionObserver | undefined;
    useEffect: typeof useEffect;
    useRef: typeof useRef;
    useState: typeof useState;
  },
) {
  return function useLazyVisibility() {
    const targetRef = deps.useRef<HTMLDivElement | null>(null);
    const [isVisible, setIsVisible] = deps.useState(false);

    deps.useEffect(
      function observeLazyTarget() {
        const target = targetRef.current;
        const shouldSkipObservation = isVisible || !target;
        if (shouldSkipObservation) {
          return;
        }
        if (!deps.IntersectionObserver) {
          setIsVisible(true);
          return;
        }
        const observer = new deps.IntersectionObserver(
          function revealIntersectingTarget(entries) {
            if (!entries.some((entry) => entry.isIntersecting)) {
              return;
            }
            setIsVisible(true);
            observer.disconnect();
          },
          { rootMargin: params.rootMargin },
        );
        observer.observe(target);
        return function stopObservingLazyTarget() {
          observer.disconnect();
        };
      },
      [isVisible],
    );

    return { isVisible, targetRef };
  };
}

export const useLazyVisibility = buildUseLazyVisibility(
  { rootMargin: "1000px 0px" },
  {
    IntersectionObserver: window.IntersectionObserver,
    useEffect,
    useRef,
    useState,
  },
);
