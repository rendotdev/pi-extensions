import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const ReactHooks = vi.hoisted(function createReactHooks() {
  let effect: (() => void | (() => void)) | undefined;
  let getCommentCountRef: { current: () => number } | undefined;

  return {
    reset: function reset() {
      effect = undefined;
      getCommentCountRef = undefined;
    },
    start: function start(this: void) {
      return effect?.();
    },
    useEffect: function useEffect(this: void, nextEffect: () => void | (() => void)) {
      effect ??= nextEffect;
    },
    useRef: function useRef<Value>(this: void, initialValue: Value) {
      getCommentCountRef ??= {
        current: initialValue as unknown as () => number,
      };
      return getCommentCountRef as unknown as { current: Value };
    },
  };
});

vi.mock("react", function mockReact() {
  return {
    useEffect: ReactHooks.useEffect,
    useRef: ReactHooks.useRef,
  };
});

import { useReviewServerMonitor } from "./review-server-monitor.ts";

afterEach(function restoreGlobals() {
  vi.unstubAllGlobals();
});

function createHookHarness(params: { fetch: typeof fetch }) {
  ReactHooks.reset();
  let intervalCallback: (() => void) | undefined;
  const closeWindow = vi.fn();
  const clearInterval = vi.fn();
  const timer = 1 as unknown as ReturnType<typeof setInterval>;

  vi.stubGlobal("fetch", params.fetch);
  vi.stubGlobal("setInterval", function setInterval(callback: () => void) {
    intervalCallback = callback;
    return timer;
  });
  vi.stubGlobal("clearInterval", clearInterval);
  vi.stubGlobal("window", {
    close: closeWindow,
    setTimeout: function setWindowTimeout() {
      return 1;
    },
  });

  function ReviewServerMonitorHookHarness(hookParams: { getCommentCount: () => number }) {
    useReviewServerMonitor(hookParams);
  }

  return {
    check: function check() {
      intervalCallback?.();
    },
    clearInterval,
    closeWindow,
    render: ReviewServerMonitorHookHarness,
    start: ReactHooks.start,
    timer,
  };
}

async function flushHealthCheck() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useReviewServerMonitor", () => {
  it("keeps a healthy review tab open and clears its timer on cleanup", async () => {
    const Harness = createHookHarness({
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    });
    Harness.render({ getCommentCount: () => 0 });
    const cleanup = Harness.start();

    Harness.check();
    await flushHealthCheck();

    expect(Harness.closeWindow).not.toHaveBeenCalled();

    cleanup?.();
    expect(Harness.clearInterval).toHaveBeenCalledWith(Harness.timer);
  });

  it("closes a comment-free tab when its review server is gone", async () => {
    const Harness = createHookHarness({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    Harness.render({ getCommentCount: () => 0 });
    Harness.start();

    Harness.check();
    await flushHealthCheck();

    expect(Harness.closeWindow).toHaveBeenCalledOnce();
  });

  it("reads the latest comment count after a rerender", async () => {
    const Harness = createHookHarness({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    Harness.render({ getCommentCount: () => 1 });
    Harness.start();

    Harness.check();
    await flushHealthCheck();
    expect(Harness.closeWindow).not.toHaveBeenCalled();

    Harness.render({ getCommentCount: () => 0 });
    Harness.check();
    await flushHealthCheck();

    expect(Harness.closeWindow).toHaveBeenCalledOnce();
  });
});
