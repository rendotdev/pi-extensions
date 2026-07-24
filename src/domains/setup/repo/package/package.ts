import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { defineRepo } from "../../../../define.ts";

export class PackageRoot extends defineRepo({ params: {}, deps: { existsSync, readFileSync } }) {
  public find(params: { moduleUrl: string }): string {
    let directory = dirname(fileURLToPath(params.moduleUrl));
    const root = parse(directory).root;
    while (directory !== root) {
      const packageJson = join(directory, "package.json");
      if (this.deps.existsSync(packageJson)) {
        const manifest = JSON.parse(this.deps.readFileSync(packageJson, "utf8")) as {
          name?: unknown;
        };
        if (manifest.name === "@rendotdev/lgtm") {
          return directory;
        }
      }
      directory = dirname(directory);
    }
    throw new Error("Could not locate the lgtm package root.");
  }
}

export class PackageVersion extends defineRepo({ params: {}, deps: { readFileSync } }) {
  public read(params: { packageRoot: string }): string {
    const manifest = JSON.parse(
      this.deps.readFileSync(join(params.packageRoot, "package.json"), "utf8"),
    ) as { version?: unknown };
    if (typeof manifest.version !== "string") {
      throw new Error("The lgtm package does not declare a valid version.");
    }
    const isEmptyVersion = manifest.version.trim().length === 0;
    if (isEmptyVersion) {
      throw new Error("The lgtm package does not declare a valid version.");
    }
    return manifest.version;
  }
}
