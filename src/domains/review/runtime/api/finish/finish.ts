import { join } from "node:path";
import { defineRuntime } from "../../../../../define.ts";
import { ApiRoute, type ApiRouteRequest } from "../route/route.ts";
import { finishRequestSchema, reviewSchema } from "../../../types/schemas/schemas.ts";

export class FinishApiRoute extends defineRuntime({
  params: { reviewPath: join(process.cwd(), ".lgtm", "review.json") },
  deps: { closeServer: function closeServer() {} },
}) {
  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!ApiRoute.matches({ ...params, method: "POST", path: "/api/finish" })) {
      return false;
    }
    const body = await ApiRoute.readRequest({
      request: params.request,
      schema: finishRequestSchema,
    });
    const review = await ApiRoute.readJsonFile({
      path: this.params.reviewPath,
      schema: reviewSchema,
    });
    const now = new Date().toISOString();
    const nextReview = await ApiRoute.writeJsonFile({
      path: this.params.reviewPath,
      schema: reviewSchema,
      value: { ...review, status: body.decision, updatedAt: now, finishedAt: now },
    });
    params.response.once("finish", this.deps.closeServer);
    ApiRoute.send({
      response: params.response,
      status: 200,
      schema: reviewSchema,
      value: nextReview,
    });
    return true;
  }
}
