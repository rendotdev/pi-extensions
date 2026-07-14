import { ApiRouteClass, type ApiRouteRequest } from "./api-route.ts";
import { reviewSchema } from "./api-schemas.ts";

export class ReviewPutApiRouteClass extends ApiRouteClass<{ reviewPath: string }, {}> {
  public constructor(params: { reviewPath: string }, deps: {}) {
    super(params, deps);
  }

  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!this.matches(params, "PUT", "/api/review")) {
      return false;
    }
    const review = await this.readRequest({ request: params.request, schema: reviewSchema });
    const nextReview = await this.writeFile({
      path: this.params.reviewPath,
      schema: reviewSchema,
      value: { ...review, updatedAt: new Date().toISOString() },
    });
    this.send({ response: params.response, status: 200, schema: reviewSchema, value: nextReview });
    return true;
  }
}
