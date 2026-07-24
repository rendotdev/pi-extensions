import { defineService } from "../../../../define.ts";
import { REVIEW_RETENTION_MILLISECONDS } from "../../config/retention.ts";
import type { ReviewManifest } from "../../types/review.ts";

export class ReviewRetention extends defineService({
  params: { retentionMilliseconds: REVIEW_RETENTION_MILLISECONDS },
  deps: {},
}) {
  public expiresAt(params: { createdAt: string }): string {
    const createdAt = Date.parse(params.createdAt);
    if (!Number.isFinite(createdAt)) {
      throw new Error("Review createdAt must be a valid date.");
    }
    return new Date(createdAt + this.params.retentionMilliseconds).toISOString();
  }

  public createManifest(params: { reviewId: string; createdAt: string }): ReviewManifest {
    return {
      version: 1,
      reviewId: params.reviewId,
      createdAt: params.createdAt,
      expiresAt: this.expiresAt({ createdAt: params.createdAt }),
    };
  }

  public isExpired(params: { expiresAt: string; now: Date }): boolean {
    const expirationTime = Date.parse(params.expiresAt);
    if (!Number.isFinite(expirationTime)) {
      return false;
    }
    return expirationTime <= params.now.getTime();
  }
}
