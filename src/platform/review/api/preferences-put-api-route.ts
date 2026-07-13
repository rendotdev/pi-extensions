import { LgtmPreferencesPlatformClass } from "../../preferences/preferences-platform.ts";
import { ApiRouteClass, type ApiRouteRequest } from "./api-route.ts";
import { preferencesSchema } from "./api-schemas.ts";

export class PreferencesPutApiRouteClass extends ApiRouteClass<
  {},
  {
    preferencesPlatform: LgtmPreferencesPlatformClass;
  }
> {
  public constructor(params: {}, deps: { preferencesPlatform: LgtmPreferencesPlatformClass }) {
    super(params, deps);
  }

  public async handle(params: ApiRouteRequest): Promise<boolean> {
    if (!this.matches(params, "PUT", "/api/preferences")) return false;
    const preferences = await this.readRequest({
      request: params.request,
      schema: preferencesSchema,
    });
    const savedPreferences = preferencesSchema.parse(
      await this.deps.preferencesPlatform.write({ preferences }),
    );
    this.send({
      response: params.response,
      status: 200,
      schema: preferencesSchema,
      value: savedPreferences,
    });
    return true;
  }
}
