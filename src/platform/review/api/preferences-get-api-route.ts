import { LgtmPreferencesPlatformClass } from "../../preferences/preferences-platform.ts";
import { ApiRouteClass, type ApiRouteRequest } from "./api-route.ts";
import { preferencesSchema } from "./api-schemas.ts";

export class PreferencesGetApiRouteClass extends ApiRouteClass<
  {},
  {
    preferencesPlatform: LgtmPreferencesPlatformClass;
  }
> {
  public constructor(params: {}, deps: { preferencesPlatform: LgtmPreferencesPlatformClass }) {
    super(params, deps);
  }

  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!this.matches(params, "GET", "/api/preferences")) return false;
    const preferences = preferencesSchema.parse(await this.deps.preferencesPlatform.read());
    this.send({
      response: params.response,
      status: 200,
      schema: preferencesSchema,
      value: preferences,
    });
    return true;
  }
}
