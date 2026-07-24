import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ReviewFormatter } from "../../service/review/review.ts";
import type { ReviewJson, ReviewPointer } from "../../types/review.ts";
import { ReviewServerLifecycle } from "./server-process.ts";
import type { OpenReviewOptions } from "./server-types.ts";

const finishWatchersByReviewPath = new Map<string, ReturnType<typeof setInterval>>();

export function startReviewFinishWatcher(
  cwd: string,
  pointer: ReviewPointer,
  onFinished: NonNullable<OpenReviewOptions["onFinished"]>,
) {
  void cwd;
  stopReviewFinishWatcher(pointer.reviewPath);
  const interval = setInterval(async () => {
    const review = await readReview(pointer.reviewPath);
    const shouldContinueWaiting = !review || review.status === "open";
    if (shouldContinueWaiting) {
      return;
    }
    stopReviewFinishWatcher(pointer.reviewPath);
    await new ReviewServerLifecycle()
      .stopForReview({ review, reviewPath: pointer.reviewPath })
      .catch(() => false);
    await onFinished(review, ReviewFormatter.format({ review, reviewPath: pointer.reviewPath }));
  }, 1_000);
  (interval as unknown as { unref?: () => void }).unref?.();
  finishWatchersByReviewPath.set(pointer.reviewPath, interval);
}

export function stopReviewFinishWatcher(reviewPath: string) {
  const interval = finishWatchersByReviewPath.get(reviewPath);
  if (!interval) {
    return;
  }
  clearInterval(interval);
  finishWatchersByReviewPath.delete(reviewPath);
}

export function stopReviewFinishWatchers(cwd: string) {
  const reviewRoot = `${join(resolve(cwd), ".lgtm")}${sep}`;
  for (const reviewPath of finishWatchersByReviewPath.keys()) {
    if (reviewPath.startsWith(reviewRoot)) {
      stopReviewFinishWatcher(reviewPath);
    }
  }
}

async function readReview(reviewPath: string): Promise<ReviewJson | undefined> {
  try {
    return JSON.parse(await readFile(reviewPath, "utf8")) as ReviewJson;
  } catch {
    return undefined;
  }
}
