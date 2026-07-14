import { ApiRouteClass, type ApiRouteRequest } from "./api-route.ts";
import { reviewSchema } from "./api-schemas.ts";

export class CancelApiRouteClass extends ApiRouteClass<
  { reviewPath: string },
  {
    closeServer: () => void;
  }
> {
  public constructor(params: { reviewPath: string }, deps: { closeServer: () => void }) {
    super(params, deps);
  }

  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!this.matches(params, "POST", "/api/cancel")) {
      return false;
    }
    const review = await this.readFile({ path: this.params.reviewPath, schema: reviewSchema });
    const now = new Date().toISOString();
    const nextReview = await this.writeFile({
      path: this.params.reviewPath,
      schema: reviewSchema,
      value: {
        ...review,
        status: "canceled",
        updatedAt: now,
        finishedAt: now,
        files: review.files.map((file) => ({ ...file, comments: [] })),
        documentComments: [],
      },
    });
    params.response.once("finish", this.deps.closeServer);
    this.send({ response: params.response, status: 200, schema: reviewSchema, value: nextReview });
    return true;
  }
}
