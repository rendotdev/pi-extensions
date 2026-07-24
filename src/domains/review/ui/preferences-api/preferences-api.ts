import { defineRuntime } from "../../../../define.ts";
import type { LgtmPreferences } from "../../../settings/index.ts";

export class PreferencesApi extends defineRuntime({
  params: {},
  deps: { fetch: globalThis.fetch },
}) {
  private readonly fetchRequest = this.deps.fetch.bind(globalThis);

  public async get(params: {}): Promise<LgtmPreferences> {
    void params;
    const response = await this.fetchRequest("/api/preferences");
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as LgtmPreferences;
  }

  public async update(params: { preferences: LgtmPreferences }): Promise<LgtmPreferences> {
    const response = await this.fetchRequest("/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params.preferences),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as LgtmPreferences;
  }
}
