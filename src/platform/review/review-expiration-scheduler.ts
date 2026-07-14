import { DomainClass } from "../../domain/domain-class.ts";

type ReviewExpirationTimer = ReturnType<typeof setTimeout> & { unref?: () => void };

export class ReviewExpirationSchedulerClass extends DomainClass<
  { expiresAt: string },
  {
    now: () => Date;
    onError: (error: unknown) => void;
    onExpire: () => void | Promise<void>;
    setTimer: (callback: () => void, milliseconds: number) => ReviewExpirationTimer;
  }
> {
  public schedule(): ReviewExpirationTimer {
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
