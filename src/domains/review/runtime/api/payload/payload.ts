import { join } from "node:path";
import { defineRuntime } from "../../../../../define.ts";
import { ApiRoute, type ApiRouteRequest } from "../route/route.ts";
import { reviewPayloadSchema } from "../../../types/schemas/schemas.ts";

export class PayloadApiRoute extends defineRuntime({
  params: { payloadPath: join(process.cwd(), ".lgtm", "payload.json") },
  deps: {},
}) {
  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!ApiRoute.matches({ ...params, method: "GET", path: "/api/payload" })) {
      return false;
    }
    const payload = await ApiRoute.readJsonFile({
      path: this.params.payloadPath,
      schema: reviewPayloadSchema,
    });
    ApiRoute.send({
      response: params.response,
      status: 200,
      schema: reviewPayloadSchema,
      value: payload,
    });
    return true;
  }
}
