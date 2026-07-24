import { describe, expect, it, vi } from "vite-plus/test";
import type { ReviewJson, ReviewPayload } from "../../types/review.ts";
import { ReviewApi } from "./review-api.ts";

const review = {
  version: 2,
  kind: "diff",
  status: "open",
  name: "Review",
  sessionId: "session",
  reviewUUID: "uuid",
  reviewId: "review-id",
  cwd: "/repo",
  appDir: "/repo/.lgtm/review-id",
  reviewPath: "/repo/.lgtm/review-id/review.json",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  files: [],
  documentComments: [],
} satisfies ReviewJson;

const payload = {
  kind: "diff",
  name: "Review",
  sessionId: "session",
  reviewUUID: "uuid",
  reviewId: "review-id",
  cwd: "/repo",
  appDir: "/repo/.lgtm/review-id",
  reviewPath: "/repo/.lgtm/review-id/review.json",
  generatedAt: "2026-01-01T00:00:00.000Z",
  files: [],
} satisfies ReviewPayload;

describe("ReviewApi", () => {
  it("loads the review payload and review through injected fetch", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Response.json(url.endsWith("payload") ? payload : review);
    }) as typeof globalThis.fetch;
    const Api = new ReviewApi({ params: {}, deps: { fetch } });

    await expect(Api.load({})).resolves.toEqual({ payload, review });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("saves and finishes reviews through explicit operation params", async () => {
    const fetch = vi.fn(async () => Response.json(review)) as typeof globalThis.fetch;
    const Api = new ReviewApi({ params: {}, deps: { fetch } });

    await Api.save({ review });
    await Api.finish({ decision: "approved" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/review",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/finish",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
