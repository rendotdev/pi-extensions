import { defineService } from "../../../../define.ts";
import { defaultPreferences } from "../../config/preferences-config/preferences-config.ts";
import { PreferencesStore } from "../../repo/preferences-store/preferences-store.ts";
import {
  parseLgtmPreferences,
  type LgtmPreferences as LgtmPreferencesType,
} from "../../types/preferences/preferences.ts";

export type LgtmPreferences = LgtmPreferencesType;

export class PreferencesService extends defineService({
  params: { defaults: defaultPreferences },
  deps: { preferencesStore: new PreferencesStore() },
}) {
  public readonly defaults = this.params.defaults;

  public parse(params: { value: unknown }): LgtmPreferencesType {
    return parseLgtmPreferences({ value: params.value, defaults: this.params.defaults });
  }

  public async read(params: {}): Promise<LgtmPreferencesType> {
    return await this.deps.preferencesStore.read(params);
  }

  public async write(params: { preferences: LgtmPreferencesType }): Promise<LgtmPreferencesType> {
    return await this.deps.preferencesStore.write(params);
  }
}

export const LgtmPreferences = new PreferencesService();
