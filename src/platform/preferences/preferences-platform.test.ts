import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { LgtmPreferencesPlatformClass } from "./preferences-platform.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makePlatform() {
  const cwd = await mkdtemp(join(tmpdir(), "lgtm-preferences-"));
  temporaryDirectories.push(cwd);
  return { cwd, platform: new LgtmPreferencesPlatformClass({ cwd }) };
}

describe("LgtmPreferencesPlatformClass", () => {
  it("returns defaults when no config exists", async () => {
    const { platform } = await makePlatform();
    await expect(platform.read()).resolves.toEqual({ diffStyle: "unified" });
  });

  it("writes the config under the repository .lgtm directory", async () => {
    const { platform } = await makePlatform();
    await platform.write({ preferences: { diffStyle: "split" } });

    expect(await readFile(platform.path, "utf8")).toBe('{\n  "diffStyle": "split"\n}\n');
  });

  it("preserves comments and unrelated config keys", async () => {
    const { cwd, platform } = await makePlatform();
    await (await import("node:fs/promises")).mkdir(join(cwd, ".lgtm"), { recursive: true });
    await writeFile(
      platform.path,
      '{\n  // Keep this note.\n  "futurePreference": true,\n}\n',
      "utf8",
    );

    await platform.write({ preferences: { diffStyle: "split" } });
    const source = await readFile(platform.path, "utf8");
    expect(source).toContain("// Keep this note.");
    expect(source).toContain('"futurePreference": true');
    expect(source).toContain('"diffStyle": "split"');
  });
});
