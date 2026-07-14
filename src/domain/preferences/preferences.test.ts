import { describe, expect, it } from "vite-plus/test";
import { LgtmPreferencesClass } from "./preferences.ts";

describe("LgtmPreferencesClass", () => {
  const Preferences = new LgtmPreferencesClass({}, {});

  it("defaults to a unified diff", () => {
    expect(Preferences.parse({ value: {} })).toEqual({ diffStyle: "unified" });
  });

  it("accepts a split diff", () => {
    expect(Preferences.parse({ value: { diffStyle: "split" } })).toEqual({
      diffStyle: "split",
    });
  });

  it("rejects an unsupported diff style", () => {
    expect(() => Preferences.parse({ value: { diffStyle: "stacked" } })).toThrow(
      'diffStyle must be "unified" or "split".',
    );
  });
});
