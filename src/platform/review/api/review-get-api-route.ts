import { ApiRouteClass, type ApiRouteRequest } from "./api-route.ts";
import { reviewSchema } from "./api-schemas.ts";

export class ReviewGetApiRouteClass extends ApiRouteClass<{ reviewPath: string }, {}> {
  public constructor(params: { reviewPath: string }, deps: {}) {
    super(params, deps);
  }

  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!this.matches(params, "GET", "/api/review")) {
      return false;
    }
    const review = await this.readFile({ path: this.params.reviewPath, schema: reviewSchema });
    this.send({ response: params.response, status: 200, schema: reviewSchema, value: review });
    return true;
  }
}
