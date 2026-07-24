import { describe, expect, it, vi } from "vite-plus/test";
import { PreferencesApi } from "./preferences-api.ts";

describe("PreferencesApi", () => {
  it("binds fetch to the browser global", async () => {
    const fetch = vi.fn(function fetchWithBrowserReceiver(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            diffStyle: "unified",
            lineWrap: false,
            sidebarWidth: 256,
            fileExpansion: "auto",
            fileExpansionOverrides: {},
          }),
          {
            status: 200,
          },
        ),
      );
    }) as unknown as typeof globalThis.fetch;

    await expect(new PreferencesApi({ params: {}, deps: { fetch } }).get({})).resolves.toEqual({
      diffStyle: "unified",
      lineWrap: false,
      sidebarWidth: 256,
      fileExpansion: "auto",
      fileExpansionOverrides: {},
    });
  });

  it("loads preferences from the review API", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            diffStyle: "split",
            lineWrap: true,
            sidebarWidth: 320,
            fileExpansion: "collapsed",
            fileExpansionOverrides: { "src/example.ts": "expanded" },
          }),
          {
            status: 200,
          },
        ),
    );

    await expect(new PreferencesApi({ params: {}, deps: { fetch } }).get({})).resolves.toEqual({
      diffStyle: "split",
      lineWrap: true,
      sidebarWidth: 320,
      fileExpansion: "collapsed",
      fileExpansionOverrides: { "src/example.ts": "expanded" },
    });
    expect(fetch).toHaveBeenCalledWith("/api/preferences");
  });

  it("updates preferences through a JSON mutation", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            diffStyle: "unified",
            lineWrap: false,
            sidebarWidth: 288,
            fileExpansion: "expanded",
            fileExpansionOverrides: { "src/example.ts": "collapsed" },
          }),
          {
            status: 200,
          },
        ),
    );

    await expect(
      new PreferencesApi({ params: {}, deps: { fetch } }).update({
        preferences: {
          diffStyle: "unified",
          lineWrap: false,
          sidebarWidth: 288,
          fileExpansion: "expanded",
          fileExpansionOverrides: { "src/example.ts": "collapsed" },
        },
      }),
    ).resolves.toEqual({
      diffStyle: "unified",
      lineWrap: false,
      sidebarWidth: 288,
      fileExpansion: "expanded",
      fileExpansionOverrides: { "src/example.ts": "collapsed" },
    });
    expect(fetch).toHaveBeenCalledWith("/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        diffStyle: "unified",
        lineWrap: false,
        sidebarWidth: 288,
        fileExpansion: "expanded",
        fileExpansionOverrides: { "src/example.ts": "collapsed" },
      }),
    });
  });
});
