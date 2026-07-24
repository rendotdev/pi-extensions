import { defineRuntime } from "../../../../../define.ts";
import { LgtmPreferences } from "../../../service/preferences/preferences.ts";
import {
  matchesPreferencesRequest,
  readPreferencesRequest,
  sendPreferencesResponse,
  type PreferencesApiRouteRequest,
} from "../preferences/preferences-api.ts";

export class PreferencesPutApiRoute extends defineRuntime({
  params: {},
  deps: { preferencesStore: LgtmPreferences },
}) {
  public async handle(params: PreferencesApiRouteRequest): Promise<boolean> {
    if (!matchesPreferencesRequest({ ...params, method: "PUT" })) {
      return false;
    }
    const preferences = await readPreferencesRequest({ request: params.request });
    sendPreferencesResponse({
      response: params.response,
      status: 200,
      preferences: await this.deps.preferencesStore.write({ preferences }),
    });
    return true;
  }
}
