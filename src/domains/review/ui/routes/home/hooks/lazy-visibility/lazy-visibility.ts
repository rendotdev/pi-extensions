import { useEffect, useRef, useState } from "react";
import { defineUIHook } from "../../../../../../../define.ts";

export const useLazyVisibility = defineUIHook({
  params: { rootMargin: "1000px 0px" },
  deps: {
    IntersectionObserver: window.IntersectionObserver,
    useEffect,
    useRef,
    useState,
  },
  hook(_props: {}) {
    const deps = this.deps;
    const params = this.params;
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
  },
});
