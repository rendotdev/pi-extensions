import { useEffect, useRef } from "react";
import { defineUIHook } from "../../../../../../../define.ts";

export const useSidebarResize = defineUIHook({
  params: { maximumWidth: 480, minimumWidth: 192, resizeStep: 16 },
  deps: { useEffect, useRef },
  hook(props: {
    setSidebarWidth: (sidebarWidth: number) => void;
    sidebarWidth: number;
    updateSidebarWidth: (sidebarWidth: number) => void;
  }) {
    const deps = this.deps;
    const config = this.params;
    const resizeStartRef = deps.useRef<{ clientX: number; width: number } | null>(null);
    const widthRef = deps.useRef(props.sidebarWidth);
    deps.useEffect(
      function rememberSidebarWidth() {
        widthRef.current = props.sidebarWidth;
      },
      [props.sidebarWidth],
    );
    deps.useEffect(function cleanUpResizeStyles() {
      return function removeResizeStyles() {
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };
    }, []);
    function resize(nextWidth: number) {
      const maximumWidth = Math.min(config.maximumWidth, window.innerWidth * 0.5);
      const resizedWidth = Math.round(
        Math.max(config.minimumWidth, Math.min(maximumWidth, nextWidth)),
      );
      widthRef.current = resizedWidth;
      props.setSidebarWidth(resizedWidth);
      return resizedWidth;
    }
    function start(event: React.PointerEvent<HTMLDivElement>) {
      resizeStartRef.current = { clientX: event.clientX, width: props.sidebarWidth };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    function continueResize(event: React.PointerEvent<HTMLDivElement>) {
      const resizeStart = resizeStartRef.current;
      if (resizeStart) {
        resize(resizeStart.width + event.clientX - resizeStart.clientX);
      }
    }
    function finish(event: React.PointerEvent<HTMLDivElement>) {
      resizeStartRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      props.updateSidebarWidth(widthRef.current);
    }
    function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
      const isResizeKey = event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!isResizeKey) {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const resizedWidth = resize(props.sidebarWidth + direction * config.resizeStep);
      props.updateSidebarWidth(resizedWidth);
    }
    return { continueResize, finish, resizeWithKeyboard, start };
  },
});
