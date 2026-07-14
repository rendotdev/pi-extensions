import { DomainClass } from "../domain-class.ts";

export type DiffStyle = "unified" | "split";
export type FileExpansion = "auto" | "expanded" | "collapsed";
export type FileExpansionOverride = Exclude<FileExpansion, "auto">;

export type LgtmPreferences = {
  diffStyle: DiffStyle;
  lineWrap: boolean;
  sidebarWidth: number;
  fileExpansion: FileExpansion;
  fileExpansionOverrides: Record<string, FileExpansionOverride>;
};

export class LgtmPreferencesClass extends DomainClass<{}, {}> {
  public readonly defaults: LgtmPreferences = {
    diffStyle: "unified",
    lineWrap: false,
    sidebarWidth: 256,
    fileExpansion: "auto",
    fileExpansionOverrides: {},
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
      fileExpansion?: unknown;
      fileExpansionOverrides?: unknown;
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
    const fileExpansion = preferences.fileExpansion ?? this.defaults.fileExpansion;
    if (fileExpansion !== "auto" && fileExpansion !== "expanded" && fileExpansion !== "collapsed") {
      throw new Error('fileExpansion must be "auto", "expanded", or "collapsed".');
    }
    const fileExpansionOverridesValue =
      preferences.fileExpansionOverrides ?? this.defaults.fileExpansionOverrides;
    if (
      typeof fileExpansionOverridesValue !== "object" ||
      fileExpansionOverridesValue === null ||
      Array.isArray(fileExpansionOverridesValue)
    ) {
      throw new Error("fileExpansionOverrides must be an object.");
    }
    const fileExpansionOverrides: Record<string, FileExpansionOverride> = {};
    for (const [location, override] of Object.entries(fileExpansionOverridesValue)) {
      if (override !== "expanded" && override !== "collapsed") {
        throw new Error('fileExpansionOverrides values must be "expanded" or "collapsed".');
      }
      fileExpansionOverrides[location] = override;
    }
    return { diffStyle, lineWrap, sidebarWidth, fileExpansion, fileExpansionOverrides };
  }
}

export const LgtmPreferences = new LgtmPreferencesClass({}, {});
