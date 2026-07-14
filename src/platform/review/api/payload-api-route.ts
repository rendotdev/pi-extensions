import { ApiRouteClass, type ApiRouteRequest } from "./api-route.ts";
import { reviewPayloadSchema } from "./api-schemas.ts";

export class PayloadApiRouteClass extends ApiRouteClass<{ payloadPath: string }, {}> {
  public constructor(params: { payloadPath: string }, deps: {}) {
    super(params, deps);
  }

  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!this.matches(params, "GET", "/api/payload")) {
      return false;
    }
    const payload = await this.readFile({
      path: this.params.payloadPath,
      schema: reviewPayloadSchema,
    });
    this.send({
      response: params.response,
      status: 200,
      schema: reviewPayloadSchema,
      value: payload,
    });
    return true;
  }
}
