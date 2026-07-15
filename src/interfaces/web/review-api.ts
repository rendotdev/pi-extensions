import { DomainClass } from "../../domain/domain-class.ts";
import type { ReviewJson, ReviewPayload } from "../../domain/review/review.ts";

export type ReviewAppState = {
  payload: ReviewPayload;
  review: ReviewJson;
};

export class ReviewApiClass extends DomainClass<{}, { fetch: typeof fetch }> {
  public constructor(params: {}, deps: { fetch: typeof fetch }) {
    super(params, { fetch: deps.fetch.bind(globalThis) });
  }

  public async load(params: {}): Promise<ReviewAppState> {
    void params;
    const [payloadResponse, reviewResponse] = await Promise.all([
      this.deps.fetch("/api/payload"),
      this.deps.fetch("/api/review"),
    ]);
    if (!payloadResponse.ok) {
      throw new Error("Failed to load payload.");
    }
    if (!reviewResponse.ok) {
      throw new Error("Failed to load review.");
    }
    return {
      payload: (await payloadResponse.json()) as ReviewPayload,
      review: (await reviewResponse.json()) as ReviewJson,
    };
  }

  public async save(params: { review: ReviewJson }): Promise<ReviewJson> {
    const response = await this.deps.fetch("/api/review", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params.review),
    });
    return await this.readReview({ response, failureMessage: "Failed to save review." });
  }

  public async finish(params: { decision: "approved" | "changes_requested" }): Promise<ReviewJson> {
    const response = await this.deps.fetch("/api/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: params.decision }),
    });
    return await this.readReview({ response, failureMessage: "Failed to finish review." });
  }

  public async cancel(params: {}): Promise<ReviewJson> {
    void params;
    const response = await this.deps.fetch("/api/cancel", { method: "POST" });
    return await this.readReview({ response, failureMessage: "Failed to cancel review." });
  }

  private async readReview(params: {
    response: Response;
    failureMessage: string;
  }): Promise<ReviewJson> {
    if (!params.response.ok) {
      const details = await params.response.text();
      throw new Error(details || params.failureMessage);
    }
    return (await params.response.json()) as ReviewJson;
  }
}

export const ReviewApi = new ReviewApiClass({}, { fetch });
