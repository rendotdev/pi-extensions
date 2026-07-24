import { join } from "node:path";
import { defineRuntime } from "../../../../../define.ts";
import { ApiRoute, type ApiRouteRequest } from "../route/route.ts";
import { reviewSchema } from "../../../types/schemas/schemas.ts";

export class CancelApiRoute extends defineRuntime({
  params: { reviewPath: join(process.cwd(), ".lgtm", "review.json") },
  deps: { closeServer: function closeServer() {} },
}) {
  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!ApiRoute.matches({ ...params, method: "POST", path: "/api/cancel" })) {
      return false;
    }
    const review = await ApiRoute.readJsonFile({
      path: this.params.reviewPath,
      schema: reviewSchema,
    });
    const now = new Date().toISOString();
    const nextReview = await ApiRoute.writeJsonFile({
      path: this.params.reviewPath,
      schema: reviewSchema,
      value: {
        ...review,
        status: "canceled",
        updatedAt: now,
        finishedAt: now,
        files: review.files.map(function removeComments(file) {
          return { ...file, comments: [] };
        }),
        documentComments: [],
      },
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
