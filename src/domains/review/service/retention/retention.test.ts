import { describe, expect, it } from "vite-plus/test";
import { REVIEW_RETENTION_MILLISECONDS } from "../../config/retention.ts";
import { ReviewRetention } from "./retention.ts";

describe("ReviewRetention", () => {
  it("creates a hard seven-day expiration", () => {
    const Policy = new ReviewRetention({
      params: { retentionMilliseconds: REVIEW_RETENTION_MILLISECONDS },
      deps: {},
    });

    expect(
      Policy.createManifest({
        reviewId: "review-1",
        createdAt: "2026-07-13T20:00:00.000Z",
      }),
    ).toEqual({
      version: 1,
      reviewId: "review-1",
      createdAt: "2026-07-13T20:00:00.000Z",
      expiresAt: "2026-07-20T20:00:00.000Z",
    });
  });

  it("expires a review at the boundary even when it remains open", () => {
    const Policy = new ReviewRetention({
      params: { retentionMilliseconds: REVIEW_RETENTION_MILLISECONDS },
      deps: {},
    });

    expect(
      Policy.isExpired({
        expiresAt: "2026-07-20T20:00:00.000Z",
        now: new Date("2026-07-20T20:00:00.000Z"),
      }),
    ).toBe(true);
  });
});
