import { defineProvider } from "../../define.ts";

export class TimeProvider extends defineProvider({
  params: {},
  deps: {
    now: function now() {
      return new Date();
    },
    setTimer: function setTimer(callback: () => void, milliseconds: number) {
      return setTimeout(callback, milliseconds);
    },
  },
}) {
  public now(params: {}) {
    void params;
    return this.deps.now();
  }

  public setTimer(params: { callback: () => void; milliseconds: number }) {
    return this.deps.setTimer(params.callback, params.milliseconds);
  }
}

export const SystemTime = new TimeProvider();
