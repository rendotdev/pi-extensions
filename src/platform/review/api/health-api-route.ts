import { ApiRouteClass, type ApiRouteRequest } from "./api-route.ts";
import { healthSchema } from "./api-schemas.ts";

export class HealthApiRouteClass extends ApiRouteClass<{}, {}> {
  public constructor(params: {}, deps: {}) {
    super(params, deps);
  }

  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!this.matches(params, "GET", "/health")) return false;
    this.send({
      response: params.response,
      status: 200,
      schema: healthSchema,
      value: { ok: true },
    });
    return true;
  }
}
