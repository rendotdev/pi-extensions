import { defineRuntime } from "../../../../define.ts";
import { SystemTime } from "../../../../providers/index.ts";

export class ReviewExpiration extends defineRuntime({
  params: { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString() },
  deps: {
    now: function now() {
      return SystemTime.now({});
    },
    onError: function onError(error: unknown) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    },
    onExpire: function onExpire() {},
    setTimer: function setTimer(callback: () => void, milliseconds: number) {
      return SystemTime.setTimer({ callback, milliseconds });
    },
  },
}) {
  public schedule(params: {}) {
    void params;
    const expiresAt = Date.parse(this.params.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      throw new Error("Review expiresAt must be a valid date.");
    }
    const milliseconds = Math.max(0, expiresAt - this.deps.now().getTime());
    const timer = this.deps.setTimer(() => {
      void Promise.resolve(this.deps.onExpire()).catch(this.deps.onError);
    }, milliseconds);
    timer.unref?.();
    return timer;
  }
}
