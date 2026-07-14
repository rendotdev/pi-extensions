import { DomainClass } from "../domain-class.ts";

export const REVIEW_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export type ReviewManifest = {
  version: 1;
  reviewId: string;
  createdAt: string;
  expiresAt: string;
};

export class ReviewRetentionPolicyClass extends DomainClass<{ retentionMilliseconds: number }, {}> {
  public createManifest(params: { reviewId: string; createdAt: string }): ReviewManifest {
    return {
      version: 1,
      reviewId: params.reviewId,
      createdAt: params.createdAt,
      expiresAt: this.expiresAt({ createdAt: params.createdAt }),
    };
  }

  public expiresAt(params: { createdAt: string }): string {
    const createdAt = Date.parse(params.createdAt);
    if (!Number.isFinite(createdAt)) {
      throw new Error("Review createdAt must be a valid date.");
    }
    return new Date(createdAt + this.params.retentionMilliseconds).toISOString();
  }

  public isExpired(params: { expiresAt: string; now: Date }): boolean {
    const expiresAt = Date.parse(params.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      return false;
    }
    return expiresAt <= params.now.getTime();
  }
}

export const ReviewRetentionPolicy = new ReviewRetentionPolicyClass(
  { retentionMilliseconds: REVIEW_RETENTION_MILLISECONDS },
  {},
);
