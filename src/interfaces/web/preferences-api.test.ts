import { describe, expect, it, vi } from "vite-plus/test";
import { PreferencesApiClass } from "./preferences-api.ts";

describe("PreferencesApiClass", () => {
  it("loads preferences from the review API", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ diffStyle: "split" }), { status: 200 }),
    );

    await expect(new PreferencesApiClass({}, { fetch }).get()).resolves.toEqual({
      diffStyle: "split",
    });
    expect(fetch).toHaveBeenCalledWith("/api/preferences");
  });

  it("updates preferences through a JSON mutation", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ diffStyle: "unified" }), { status: 200 }),
    );

    await expect(
      new PreferencesApiClass({}, { fetch }).update({ preferences: { diffStyle: "unified" } }),
    ).resolves.toEqual({ diffStyle: "unified" });
    expect(fetch).toHaveBeenCalledWith("/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ diffStyle: "unified" }),
    });
  });
});
