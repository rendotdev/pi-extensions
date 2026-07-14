import { describe, expect, it, vi } from "vite-plus/test";
import { PreferencesApiClass } from "./preferences-api.ts";

describe("PreferencesApiClass", () => {
  it("binds fetch to the browser global", async () => {
    const fetch = vi.fn(function fetchWithBrowserReceiver(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(
        new Response(JSON.stringify({ diffStyle: "unified", lineWrap: false, sidebarWidth: 256 }), {
          status: 200,
        }),
      );
    }) as unknown as typeof globalThis.fetch;

    await expect(new PreferencesApiClass({}, { fetch }).get()).resolves.toEqual({
      diffStyle: "unified",
      lineWrap: false,
      sidebarWidth: 256,
    });
  });

  it("loads preferences from the review API", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ diffStyle: "split", lineWrap: true, sidebarWidth: 320 }), {
          status: 200,
        }),
    );

    await expect(new PreferencesApiClass({}, { fetch }).get()).resolves.toEqual({
      diffStyle: "split",
      lineWrap: true,
      sidebarWidth: 320,
    });
    expect(fetch).toHaveBeenCalledWith("/api/preferences");
  });

  it("updates preferences through a JSON mutation", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ diffStyle: "unified", lineWrap: false, sidebarWidth: 288 }), {
          status: 200,
        }),
    );

    await expect(
      new PreferencesApiClass({}, { fetch }).update({
        preferences: { diffStyle: "unified", lineWrap: false, sidebarWidth: 288 },
      }),
    ).resolves.toEqual({ diffStyle: "unified", lineWrap: false, sidebarWidth: 288 });
    expect(fetch).toHaveBeenCalledWith("/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ diffStyle: "unified", lineWrap: false, sidebarWidth: 288 }),
    });
  });
});
