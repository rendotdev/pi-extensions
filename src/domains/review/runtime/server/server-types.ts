import type { ReviewJson, ReviewOutcome } from "../../types/review.ts";

export type OpenReviewOptions = {
  cwd: string;
  sessionId?: string;
  reviewUUID?: string;
  signal?: AbortSignal;
  stopOnAbort?: boolean;
  cleanupOnExit?: boolean;
  detachedServer?: boolean;
  openBrowser?: boolean;
  replaceActiveReview?: boolean;
  trackAsActiveReview?: boolean;
  onUpdate?: (message: string) => void;
  onFinished?: (review: ReviewJson, formattedReview: string) => void | Promise<void>;
};

export type FinishReviewResult =
  | { found: false }
  | {
      found: true;
      reviewPath: string;
      review: ReviewJson;
      restartedServer: boolean;
      stoppedServer: boolean;
      formattedReview: string;
    };

export type WaitForReviewOptions = {
  cwd: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  stopServer?: boolean;
};

export type CompletedReview = {
  reviewPath: string;
  review: ReviewJson & { status: ReviewOutcome };
  stoppedServer: boolean;
  formattedReview: string;
};
