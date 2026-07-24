import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { defineRuntime } from "../../../../../define.ts";
import {
  PreferencesGetApiRoute,
  LgtmPreferences,
  PreferencesPutApiRoute,
} from "../../../../settings/index.ts";
import { CancelApiRoute } from "../cancel/cancel.ts";
import { FinishApiRoute } from "../finish/finish.ts";
import { HealthApiRoute } from "../health/health.ts";
import { PayloadApiRoute } from "../payload/payload.ts";
import { ReviewGetApiRoute } from "../review-get/review-get.ts";
import { ReviewPutApiRoute } from "../review-put/review-put.ts";
import type { ApiRoute, ApiRouteRequest } from "../route/route.ts";
import { errorSchema } from "../../../types/schemas/schemas.ts";

export class ReviewApiRouter extends defineRuntime({
  params: {
    payloadPath: join(process.cwd(), ".lgtm", "payload.json"),
    reviewPath: join(process.cwd(), ".lgtm", "review.json"),
  },
  deps: {
    closeServer: function closeServer() {},
    preferences: LgtmPreferences,
  },
}) {
  private readonly routes: ApiRoute[] = [
    new PayloadApiRoute({
      params: { payloadPath: this.params.payloadPath },
      deps: {},
    }),
    new ReviewGetApiRoute({ params: { reviewPath: this.params.reviewPath }, deps: {} }),
    new ReviewPutApiRoute({ params: { reviewPath: this.params.reviewPath }, deps: {} }),
    new PreferencesGetApiRoute({
      params: {},
      deps: { preferencesStore: this.deps.preferences },
    }),
    new PreferencesPutApiRoute({
      params: {},
      deps: { preferencesStore: this.deps.preferences },
    }),
    new FinishApiRoute({
      params: { reviewPath: this.params.reviewPath },
      deps: { closeServer: this.deps.closeServer },
    }),
    new CancelApiRoute({
      params: { reviewPath: this.params.reviewPath },
      deps: { closeServer: this.deps.closeServer },
    }),
    new HealthApiRoute(),
  ];

  public async handle(params: ApiRouteRequest): Promise<boolean> {
    for (const route of this.routes) {
      if (await route.handle(params)) {
        return true;
      }
    }
    return false;
  }

  public sendError(params: { response: ServerResponse; status: number; error: unknown }): void {
    const error = params.error instanceof Error ? params.error.message : String(params.error);
    const body = Buffer.from(JSON.stringify(errorSchema.parse({ error })));
    params.response.writeHead(params.status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    params.response.end(body);
  }
}
