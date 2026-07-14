import type { ServerResponse } from "node:http";
import { DomainClass } from "../../../domain/domain-class.ts";
import { CancelApiRouteClass } from "./cancel-api-route.ts";
import { errorSchema } from "./api-schemas.ts";
import { FinishApiRouteClass } from "./finish-api-route.ts";
import { HealthApiRouteClass } from "./health-api-route.ts";
import { PayloadApiRouteClass } from "./payload-api-route.ts";
import { PreferencesGetApiRouteClass } from "./preferences-get-api-route.ts";
import { PreferencesPutApiRouteClass } from "./preferences-put-api-route.ts";
import { ReviewGetApiRouteClass } from "./review-get-api-route.ts";
import { ReviewPutApiRouteClass } from "./review-put-api-route.ts";
import type { ApiRouteClass, ApiRouteRequest } from "./api-route.ts";
import { LgtmPreferencesPlatformClass } from "../../preferences/preferences-platform.ts";

type ReviewApiRouterParams = {
  payloadPath: string;
  reviewPath: string;
};
type ReviewApiRouterDeps = {
  closeServer: () => void;
  preferencesPlatform: LgtmPreferencesPlatformClass;
};

export class ReviewApiRouterClass extends DomainClass<ReviewApiRouterParams, ReviewApiRouterDeps> {
  private readonly routes: ApiRouteClass<unknown, unknown>[];

  public constructor(params: ReviewApiRouterParams, deps: ReviewApiRouterDeps) {
    super(params, deps);
    this.routes = [
      new PayloadApiRouteClass({ payloadPath: this.params.payloadPath }, {}),
      new ReviewGetApiRouteClass({ reviewPath: this.params.reviewPath }, {}),
      new ReviewPutApiRouteClass({ reviewPath: this.params.reviewPath }, {}),
      new PreferencesGetApiRouteClass({}, { preferencesPlatform: this.deps.preferencesPlatform }),
      new PreferencesPutApiRouteClass({}, { preferencesPlatform: this.deps.preferencesPlatform }),
      new FinishApiRouteClass(
        { reviewPath: this.params.reviewPath },
        { closeServer: this.deps.closeServer },
      ),
      new CancelApiRouteClass(
        { reviewPath: this.params.reviewPath },
        { closeServer: this.deps.closeServer },
      ),
      new HealthApiRouteClass({}, {}),
    ];
  }

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
