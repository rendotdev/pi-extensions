import { join } from "node:path";
import { defineRuntime } from "../../../../../define.ts";
import { ApiRoute, type ApiRouteRequest } from "../route/route.ts";
import { reviewSchema } from "../../../types/schemas/schemas.ts";

export class ReviewPutApiRoute extends defineRuntime({
  params: { reviewPath: join(process.cwd(), ".lgtm", "review.json") },
  deps: {},
}) {
  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!ApiRoute.matches({ ...params, method: "PUT", path: "/api/review" })) {
      return false;
    }
    const review = await ApiRoute.readRequest({
      request: params.request,
      schema: reviewSchema,
    });
    const nextReview = await ApiRoute.writeJsonFile({
      path: this.params.reviewPath,
      schema: reviewSchema,
      value: { ...review, updatedAt: new Date().toISOString() },
    });
    ApiRoute.send({
      response: params.response,
      status: 200,
      schema: reviewSchema,
      value: nextReview,
    });
    return true;
  }
}
