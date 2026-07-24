import { defineRuntime } from "../../../../../define.ts";
import { LgtmPreferences } from "../../../service/preferences/preferences.ts";
import {
  matchesPreferencesRequest,
  sendPreferencesResponse,
  type PreferencesApiRouteRequest,
} from "../preferences/preferences-api.ts";

export class PreferencesGetApiRoute extends defineRuntime({
  params: {},
  deps: { preferencesStore: LgtmPreferences },
}) {
  public async handle(params: PreferencesApiRouteRequest): Promise<boolean> {
    if (!matchesPreferencesRequest({ ...params, method: "GET" })) {
      return false;
    }
    sendPreferencesResponse({
      response: params.response,
      status: 200,
      preferences: await this.deps.preferencesStore.read({}),
    });
    return true;
  }
}
