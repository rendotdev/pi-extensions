import { defineRuntime } from "../../../../../define.ts";
import { ApiRoute, type ApiRouteRequest } from "../route/route.ts";
import { healthSchema } from "../../../types/schemas/schemas.ts";

export class HealthApiRoute extends defineRuntime({ params: {}, deps: {} }) {
  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!ApiRoute.matches({ ...params, method: "GET", path: "/health" })) {
      return false;
    }
    ApiRoute.send({
      response: params.response,
      status: 200,
      schema: healthSchema,
      value: { ok: true },
    });
    return true;
  }
}
