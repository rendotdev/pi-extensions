import { describe, expect, it, vi } from "vite-plus/test";
import { ReviewExpirationSchedulerClass } from "./review-expiration-scheduler.ts";

describe("ReviewExpirationSchedulerClass", () => {
  it("schedules expiration at the persisted deadline", async () => {
    let expire: (() => void) | undefined;
    const timer = { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout> & {
      unref: () => void;
    };
    const setTimer = vi.fn((callback: () => void) => {
      expire = callback;
      return timer;
    });
    const onExpire = vi.fn(async () => undefined);
    const Scheduler = new ReviewExpirationSchedulerClass(
      { expiresAt: "2026-07-20T20:00:00.000Z" },
      {
        now: () => new Date("2026-07-13T20:00:00.000Z"),
        onError: vi.fn(),
        onExpire,
        setTimer,
      },
    );

    Scheduler.schedule();
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 7 * 24 * 60 * 60 * 1_000);
    expect(timer.unref).toHaveBeenCalled();

    expire?.();
    await Promise.resolve();
    expect(onExpire).toHaveBeenCalled();
  });
});
