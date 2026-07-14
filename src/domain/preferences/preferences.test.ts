import { describe, expect, it } from "vite-plus/test";
import { LgtmPreferencesClass } from "./preferences.ts";

describe("LgtmPreferencesClass", () => {
  const Preferences = new LgtmPreferencesClass({}, {});

  it("defaults to a unified diff", () => {
    expect(Preferences.parse({ value: {} })).toEqual({
      diffStyle: "unified",
      lineWrap: false,
      sidebarWidth: 256,
      fileExpansion: "auto",
      fileExpansionOverrides: {},
    });
  });

  it("accepts a split diff with line wrapping", () => {
    expect(
      Preferences.parse({
        value: {
          diffStyle: "split",
          lineWrap: true,
          sidebarWidth: 320,
          fileExpansion: "collapsed",
          fileExpansionOverrides: { "src/example.ts": "expanded" },
        },
      }),
    ).toEqual({
      diffStyle: "split",
      lineWrap: true,
      sidebarWidth: 320,
      fileExpansion: "collapsed",
      fileExpansionOverrides: { "src/example.ts": "expanded" },
    });
  });

  it("rejects an unsupported diff style", () => {
    expect(() => Preferences.parse({ value: { diffStyle: "stacked" } })).toThrow(
      'diffStyle must be "unified" or "split".',
    );
  });

  it("rejects a sidebar width outside the supported range", () => {
    expect(() => Preferences.parse({ value: { sidebarWidth: 640 } })).toThrow(
      "sidebarWidth must be an integer between 192 and 480.",
    );
  });

  it("rejects a non-boolean line wrap preference", () => {
    expect(() => Preferences.parse({ value: { lineWrap: "yes" } })).toThrow(
      "lineWrap must be a boolean.",
    );
  });

  it("rejects an unsupported file expansion preference", () => {
    expect(() => Preferences.parse({ value: { fileExpansion: "manual" } })).toThrow(
      'fileExpansion must be "auto", "expanded", or "collapsed".',
    );
  });

  it("rejects unsupported per-file expansion overrides", () => {
    expect(() =>
      Preferences.parse({ value: { fileExpansionOverrides: { "src/example.ts": "auto" } } }),
    ).toThrow('fileExpansionOverrides values must be "expanded" or "collapsed".');
  });
});
