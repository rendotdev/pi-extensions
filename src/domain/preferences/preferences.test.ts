import { describe, expect, it } from "vite-plus/test";
import { LgtmPreferencesClass } from "./preferences.ts";

describe("LgtmPreferencesClass", () => {
  const preferences = new LgtmPreferencesClass({}, {});

  it("defaults to a unified diff", () => {
    expect(preferences.parse({ value: {} })).toEqual({ diffStyle: "unified" });
  });

  it("accepts a split diff", () => {
    expect(preferences.parse({ value: { diffStyle: "split" } })).toEqual({
      diffStyle: "split",
    });
  });

  it("rejects an unsupported diff style", () => {
    expect(() => preferences.parse({ value: { diffStyle: "stacked" } })).toThrow(
      'diffStyle must be "unified" or "split".',
    );
  });
});
