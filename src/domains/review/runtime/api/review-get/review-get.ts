import { join } from "node:path";
import { defineRuntime } from "../../../../../define.ts";
import { ApiRoute, type ApiRouteRequest } from "../route/route.ts";
import { reviewSchema } from "../../../types/schemas/schemas.ts";

export class ReviewGetApiRoute extends defineRuntime({
  params: { reviewPath: join(process.cwd(), ".lgtm", "review.json") },
  deps: {},
}) {
  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!ApiRoute.matches({ ...params, method: "GET", path: "/api/review" })) {
      return false;
    }
    const review = await ApiRoute.readJsonFile({
      path: this.params.reviewPath,
      schema: reviewSchema,
    });
    ApiRoute.send({
      response: params.response,
      status: 200,
      schema: reviewSchema,
      value: review,
    });
    return true;
  }
}
