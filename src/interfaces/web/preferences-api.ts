import { DomainClass } from "../../domain/domain-class.ts";
import type { LgtmPreferences } from "../../domain/preferences/preferences.ts";

export class PreferencesApiClass extends DomainClass<{}, { fetch: typeof fetch }> {
  public async get(): Promise<LgtmPreferences> {
    const response = await this.deps.fetch("/api/preferences");
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as LgtmPreferences;
  }

  public async update(params: { preferences: LgtmPreferences }): Promise<LgtmPreferences> {
    const response = await this.deps.fetch("/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params.preferences),
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as LgtmPreferences;
  }
}

export const preferencesApi = new PreferencesApiClass({}, { fetch });
