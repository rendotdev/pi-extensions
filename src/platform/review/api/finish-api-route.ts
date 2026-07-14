import { ApiRouteClass, type ApiRouteRequest } from "./api-route.ts";
import { finishRequestSchema, reviewSchema } from "./api-schemas.ts";

export class FinishApiRouteClass extends ApiRouteClass<
  { reviewPath: string },
  {
    closeServer: () => void;
  }
> {
  public constructor(params: { reviewPath: string }, deps: { closeServer: () => void }) {
    super(params, deps);
  }

  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!this.matches(params, "POST", "/api/finish")) {
      return false;
    }
    const body = await this.readRequest({ request: params.request, schema: finishRequestSchema });
    const review = await this.readFile({ path: this.params.reviewPath, schema: reviewSchema });
    const now = new Date().toISOString();
    const nextReview = await this.writeFile({
      path: this.params.reviewPath,
      schema: reviewSchema,
      value: { ...review, status: body.decision, updatedAt: now, finishedAt: now },
    });
    params.response.once("finish", this.deps.closeServer);
    this.send({ response: params.response, status: 200, schema: reviewSchema, value: nextReview });
    return true;
  }
}
