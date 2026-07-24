import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineRuntime } from "../../../../define.ts";

export class ReviewIdentifierRuntime extends defineRuntime({ params: {}, deps: { randomUUID } }) {
  public sanitizePathSegment(params: { value: string }): string {
    return params.value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || this.deps.randomUUID();
  }
}

export const ReviewIdentifier = new ReviewIdentifierRuntime();

export class WebRoot extends defineRuntime({
  params: {},
  deps: {
    modulePath: function modulePath() {
      return fileURLToPath(import.meta.url);
    },
    stat: async function statPath(path: string): Promise<unknown> {
      return await stat(path);
    },
  },
}) {
  public async resolve(params: {}): Promise<string> {
    void params;
    const modulePath = this.deps.modulePath();
    const candidates = [
      process.env.LGTM_WEB_ROOT,
      resolve(modulePath, "..", "..", "..", "..", "..", "..", "dist", "web"),
      resolve(modulePath, "..", "..", "dist", "web"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
      try {
        await this.deps.stat(join(candidate, "index.html"));
        return candidate;
      } catch {
        // Try the next build location.
      }
    }
    throw new Error("The LGTM frontend build is missing. Run vp build first.");
  }
}

export class BuiltCliPath extends defineRuntime({
  params: { modulePath: fileURLToPath(import.meta.url) },
  deps: {
    stat: async function statPath(path: string): Promise<unknown> {
      return await stat(path);
    },
  },
}) {
  public async resolve(params: {}): Promise<string> {
    void params;
    const sourceServerPath =
      sep + ["src", "domains", "review", "runtime", "server"].join(sep) + sep;
    if (this.params.modulePath.includes(sourceServerPath)) {
      return await this.resolveExisting(
        resolve(this.params.modulePath, "..", "..", "..", "..", "..", "..", "dist", "cli.mjs"),
      );
    }
    const isExtension =
      this.params.modulePath.endsWith(sep + ["extensions", "index.js"].join(sep)) ||
      this.params.modulePath.endsWith(sep + ["extensions", "index.mjs"].join(sep));
    if (isExtension) {
      return await this.resolveExisting(
        resolve(this.params.modulePath, "..", "..", "dist", "cli.mjs"),
      );
    }
    if (this.params.modulePath.includes(sep + ["dist", "pi"].join(sep) + sep)) {
      return await this.resolveExisting(resolve(this.params.modulePath, "..", "..", "cli.mjs"));
    }
    return this.params.modulePath;
  }

  private async resolveExisting(cliPath: string): Promise<string> {
    try {
      await this.deps.stat(cliPath);
      return cliPath;
    } catch {
      throw new Error("LGTM CLI is not built. Run vp check and vp run package first.");
    }
  }
}
