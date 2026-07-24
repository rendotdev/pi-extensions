import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { PreferencesStore } from "./preferences-store.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeStore() {
  const cwd = await mkdtemp(join(tmpdir(), "lgtm-preferences-"));
  temporaryDirectories.push(cwd);
  return {
    cwd,
    store: new PreferencesStore({ params: { cwd }, deps: {} }),
  };
}

describe("PreferencesStore", () => {
  it("returns defaults when no config exists", async () => {
    const fixture = await makeStore();
    await expect(fixture.store.read({})).resolves.toEqual({
      diffStyle: "unified",
      lineWrap: false,
      sidebarWidth: 256,
      fileExpansion: "auto",
      fileExpansionOverrides: {},
    });
  });

  it("writes the config under the repository .lgtm directory", async () => {
    const fixture = await makeStore();
    await fixture.store.write({
      preferences: {
        diffStyle: "split",
        lineWrap: true,
        sidebarWidth: 320,
        fileExpansion: "collapsed",
        fileExpansionOverrides: { "src/example.ts": "expanded" },
      },
    });

    expect(await readFile(fixture.store.getPath({}), "utf8")).toBe(
      '{\n  "diffStyle": "split",\n  "lineWrap": true,\n  "sidebarWidth": 320,\n  "fileExpansion": "collapsed",\n  "fileExpansionOverrides": {\n    "src/example.ts": "expanded"\n  }\n}\n',
    );
  });

  it("preserves comments and unrelated config keys", async () => {
    const fixture = await makeStore();
    await mkdir(join(fixture.cwd, ".lgtm"), { recursive: true });
    await writeFile(
      fixture.store.getPath({}),
      '{\n  // Keep this note.\n  "futurePreference": true,\n}\n',
      "utf8",
    );

    await fixture.store.write({
      preferences: {
        diffStyle: "split",
        lineWrap: true,
        sidebarWidth: 320,
        fileExpansion: "expanded",
        fileExpansionOverrides: { "src/example.ts": "collapsed" },
      },
    });
    const source = await readFile(fixture.store.getPath({}), "utf8");
    expect(source).toContain("// Keep this note.");
    expect(source).toContain('"futurePreference": true');
    expect(source).toContain('"diffStyle": "split"');
    expect(source).toContain('"lineWrap": true');
    expect(source).toContain('"sidebarWidth": 320');
    expect(source).toContain('"fileExpansion": "expanded"');
    expect(source).toContain('"src/example.ts": "collapsed"');
  });

  it("keeps the config valid when preference writes overlap", async () => {
    const fixture = await makeStore();

    await Promise.all(
      Array.from({ length: 100 }, function writePreference(_value, index) {
        return fixture.store.write({
          preferences: {
            diffStyle: index % 2 === 0 ? "split" : "unified",
            lineWrap: index % 3 === 0,
            sidebarWidth: 192 + (index % 19) * 16,
            fileExpansion: index % 2 === 0 ? "collapsed" : "expanded",
            fileExpansionOverrides: {
              ["src/example-" + index + ".ts"]: index % 2 === 0 ? "expanded" : "collapsed",
            },
          },
        });
      }),
    );

    await expect(fixture.store.read({})).resolves.toMatchObject({
      diffStyle: expect.stringMatching(/^(split|unified)$/),
      lineWrap: expect.any(Boolean),
      sidebarWidth: expect.any(Number),
      fileExpansion: expect.stringMatching(/^(collapsed|expanded)$/),
      fileExpansionOverrides: expect.any(Object),
    });
  });
});
