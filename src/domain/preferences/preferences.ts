import { DomainClass } from "../domain-class.ts";

export type DiffStyle = "unified" | "split";

export type LgtmPreferences = {
  diffStyle: DiffStyle;
};

export class LgtmPreferencesClass extends DomainClass<{}, {}> {
  public readonly defaults: LgtmPreferences = {
    diffStyle: "unified",
  };

  public parse(params: { value: unknown }): LgtmPreferences {
    if (params.value === undefined || params.value === null) return { ...this.defaults };
    if (typeof params.value !== "object" || Array.isArray(params.value)) {
      throw new Error("LGTM preferences must be an object.");
    }

    const diffStyle = (params.value as { diffStyle?: unknown }).diffStyle;
    if (diffStyle === undefined) return { ...this.defaults };
    if (diffStyle !== "unified" && diffStyle !== "split") {
      throw new Error('diffStyle must be "unified" or "split".');
    }
    return { diffStyle };
  }
}

export const lgtmPreferences = new LgtmPreferencesClass({}, {});
