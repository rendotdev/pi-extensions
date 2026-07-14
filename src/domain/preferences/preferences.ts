import { DomainClass } from "../domain-class.ts";

export type DiffStyle = "unified" | "split";

export type LgtmPreferences = {
  diffStyle: DiffStyle;
  lineWrap: boolean;
  sidebarWidth: number;
};

export class LgtmPreferencesClass extends DomainClass<{}, {}> {
  public readonly defaults: LgtmPreferences = {
    diffStyle: "unified",
    lineWrap: false,
    sidebarWidth: 256,
  };

  public parse(params: { value: unknown }): LgtmPreferences {
    if (params.value === undefined || params.value === null) {
      return { ...this.defaults };
    }
    if (typeof params.value !== "object" || Array.isArray(params.value)) {
      throw new Error("LGTM preferences must be an object.");
    }

    const preferences = params.value as {
      diffStyle?: unknown;
      lineWrap?: unknown;
      sidebarWidth?: unknown;
    };
    const diffStyle = preferences.diffStyle ?? this.defaults.diffStyle;
    if (diffStyle !== "unified" && diffStyle !== "split") {
      throw new Error('diffStyle must be "unified" or "split".');
    }
    const lineWrap = preferences.lineWrap ?? this.defaults.lineWrap;
    if (typeof lineWrap !== "boolean") {
      throw new Error("lineWrap must be a boolean.");
    }
    const sidebarWidth = preferences.sidebarWidth ?? this.defaults.sidebarWidth;
    if (
      typeof sidebarWidth !== "number" ||
      !Number.isInteger(sidebarWidth) ||
      sidebarWidth < 192 ||
      sidebarWidth > 480
    ) {
      throw new Error("sidebarWidth must be an integer between 192 and 480.");
    }
    return { diffStyle, lineWrap, sidebarWidth };
  }
}

export const LgtmPreferences = new LgtmPreferencesClass({}, {});
