import { resolve } from "node:path";
import { ReviewFormatter } from "../../service/review/review.ts";
import type { ReviewJson, ReviewOutcome, ReviewPointer } from "../../types/review.ts";
import {
  ReviewServerLifecycle,
  ensureReviewServerForReview,
  readReviewIfExists,
  stopActiveReviewServers,
  stopReviewImplementation,
} from "./server-process.ts";
import { stopReviewFinishWatcher, stopReviewFinishWatchers } from "./server-watcher.ts";
import type { CompletedReview, FinishReviewResult, WaitForReviewOptions } from "./server-types.ts";

/** Wait for the browser checkpoint to reach a terminal decision. */
export async function waitForReviewImplementation(
  pointer: ReviewPointer,
  options: WaitForReviewOptions,
): Promise<CompletedReview> {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const isInvalidPollInterval = !Number.isFinite(pollIntervalMs) || pollIntervalMs < 10;
  if (isInvalidPollInterval) {
    throw new Error("pollIntervalMs must be at least 10 milliseconds.");
  }

  try {
    while (true) {
      throwIfAborted(options.signal);
      const review = await readReviewIfExists(pointer.reviewPath);
      const isReviewComplete = review && review.status !== "open";
      if (isReviewComplete) {
        stopReviewFinishWatcher(pointer.reviewPath);
        const stoppedServer =
          options.stopServer === false
            ? false
            : await new ReviewServerLifecycle().stopForReview({
                review,
                reviewPath: pointer.reviewPath,
              });
        return {
          reviewPath: pointer.reviewPath,
          review: review as ReviewJson & { status: ReviewOutcome },
          stoppedServer,
          formattedReview: formatReviewForModelImplementation(review, pointer.reviewPath),
        };
      }
      await abortableDelay(pollIntervalMs, options.signal);
    }
  } catch (error) {
    const shouldStopAbortedReview = options.signal?.aborted && options.stopServer !== false;
    if (shouldStopAbortedReview) {
      await stopReviewImplementation(options.cwd, pointer.reviewPath).catch(() => false);
    }
    throw error;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The review was canceled.", "AbortError");
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(finish, milliseconds);
    function abort() {
      cleanup();
      rejectPromise(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("The review was canceled.", "AbortError"),
      );
    }
    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
    function finish() {
      cleanup();
      resolvePromise();
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}

export async function finishReviewImplementation(
  cwd: string,
  reviewPathInput: string,
): Promise<FinishReviewResult> {
  const resolvedCwd = resolve(cwd);
  const reviewPath = resolve(resolvedCwd, reviewPathInput);
  const review = await readReviewIfExists(reviewPath);
  if (!review) {
    return { found: false };
  }
  if (review.status === "open") {
    const resumed = await ensureReviewServerForReview(review, reviewPath);
    return {
      found: true,
      reviewPath,
      review: resumed.review,
      restartedServer: resumed.restartedServer,
      stoppedServer: false,
      formattedReview: formatReviewForModelImplementation(resumed.review, reviewPath),
    };
  }
  stopReviewFinishWatcher(reviewPath);
  const stoppedServer = await new ReviewServerLifecycle().stopForReview({ review, reviewPath });
  return {
    found: true,
    reviewPath,
    review,
    restartedServer: false,
    stoppedServer,
    formattedReview: formatReviewForModelImplementation(review, reviewPath),
  };
}

export async function stopReviewsImplementation(cwd: string) {
  const resolvedCwd = resolve(cwd);
  stopReviewFinishWatchers(resolvedCwd);
  return await stopActiveReviewServers(resolvedCwd);
}

export function formatReviewForModelImplementation(review: ReviewJson, reviewPath: string): string {
  return ReviewFormatter.format({ review, reviewPath });
}
