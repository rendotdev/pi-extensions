import { defineConfig, type ViteUserConfig } from "vite-plus";
import type { Plugin } from "@voidzero-dev/vite-plus-core";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { DomainClass } from "./src/domain/domain-class.ts";
import type { ReviewPointer } from "./src/domain/review/review.ts";
import {
  collectGitReviewFiles,
  openReview,
  stopReview,
} from "./src/platform/review/review-platform.ts";

type LgtmDevEnvironmentDependencies = {
  collectGitReviewFiles: typeof collectGitReviewFiles;
  openReview: typeof openReview;
  stopReview: typeof stopReview;
};

export class LgtmDevEnvironmentClass extends DomainClass<
  { cwd: string; sessionId: string },
  LgtmDevEnvironmentDependencies
> {
  private review: ReviewPointer | undefined;
  private stopPromise: Promise<boolean> | undefined;

  public async start() {
    const files = await this.deps.collectGitReviewFiles(this.params.cwd);
    this.review = await this.deps.openReview(
      { kind: "diff", name: "LGTM development", files },
      {
        cwd: this.params.cwd,
        sessionId: this.params.sessionId,
        cleanupOnExit: true,
        detachedServer: false,
        openBrowser: false,
        replaceActiveReview: false,
        trackAsActiveReview: false,
      },
    );
    return this.review;
  }

  public plugin(): Plugin {
    return {
      name: "lgtm-dev-environment",
      apply: "serve",
      configureServer: (server) => {
        server.httpServer?.once("close", () => void this.stop());
      },
      closeBundle: async () => {
        await this.stop();
      },
    };
  }

  public async stop() {
    if (!this.review) {
      return false;
    }
    this.stopPromise ??= this.deps.stopReview(this.params.cwd, this.review.reviewPath);
    return await this.stopPromise;
  }
}

export default defineConfig(async ({ command, mode }): Promise<ViteUserConfig> => {
  const isDev = command === "serve" && mode !== "test" && !process.argv.includes("preview");
  const DevEnvironment = isDev
    ? new LgtmDevEnvironmentClass(
        {
          cwd: resolve(process.env.LGTM_DEV_CWD ?? process.cwd()),
          sessionId: `dev-${process.pid}`,
        },
        { collectGitReviewFiles, openReview, stopReview },
      )
    : undefined;
  const devReview = await DevEnvironment?.start();

  return {
    root: "src/interfaces/web",
    plugins: [tailwindcss(), ...(DevEnvironment ? [DevEnvironment.plugin()] : [])],
    server: devReview
      ? {
          proxy: {
            "/api": { target: devReview.url },
            "/health": { target: devReview.url },
          },
        }
      : undefined,
    worker: {
      format: "es",
    },
    build: {
      outDir: "../../../dist/web",
      emptyOutDir: true,
    },
    fmt: {
      ignorePatterns: ["dist/**", "extensions/**", ".lgtm/**"],
      sortPackageJson: true,
    },
    lint: {
      ignorePatterns: ["dist/**", "extensions/**", ".lgtm/**"],
      jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
      rules: {
        curly: ["error", "all"],
        "func-style": ["error", "declaration", { allowArrowFunctions: false }],
        "vite-plus/prefer-vite-plus-imports": "error",
      },
      options: { typeAware: true, typeCheck: true },
    },
    test: {
      include: [
        "./**/*.test.ts",
        "../cli/**/*.test.{ts,tsx}",
        "../mcp/**/*.test.ts",
        "../pi/**/*.test.ts",
        "../../domain/**/*.test.ts",
        "../../platform/**/*.test.ts",
      ],
      passWithNoTests: true,
    },
    pack: {
      entry: ["src/interfaces/cli/cli.ts"],
      format: ["esm"],
      outDir: "dist",
      clean: false,
      deps: { neverBundle: ["ink", "jsonc-parser", "react"] },
      outExtensions({ options }) {
        const entries = Array.isArray(options.input)
          ? options.input
          : typeof options.input === "string"
            ? [options.input]
            : Object.values(options.input ?? {});
        return entries.some((entry) => entry.endsWith("/interfaces/pi/index.ts"))
          ? { js: ".js" }
          : undefined;
      },
    },
    run: {
      tasks: {
        "artifact:pack": {
          command: "bun pm pack --dry-run --ignore-scripts",
          dependsOn: ["artifact:prepare"],
          cache: false,
        },
        "artifact:prepare": {
          command: 'bun -e "void 0"',
          dependsOn: ["metadata:verify", "build:package"],
          cache: false,
        },
        "artifact:verify": {
          command: "bun scripts/verify-package.ts",
          cache: false,
        },
        "build:web": {
          command: "vp build",
          cache: true,
          output: ["dist/web/**"],
        },
        "build:cli": {
          command: "vp pack",
          cache: true,
          output: ["dist/cli.mjs"],
        },
        "build:pi": {
          command: "vp pack src/interfaces/pi/index.ts --out-dir extensions --clean",
          cache: true,
          output: ["extensions/index.js"],
        },
        "build:package": {
          command: 'bun -e "void 0"',
          dependsOn: ["build:web", "build:cli", "build:pi"],
          cache: false,
        },
        "lgtm:cli": {
          command: "node dist/cli.mjs",
          dependsOn: ["validate", "build:package"],
          cache: false,
        },
        "metadata:verify": {
          command: "bun scripts/sync-plugin-metadata.ts --check",
          cache: false,
        },
        "metadata:write": {
          command: "bun scripts/sync-plugin-metadata.ts",
          cache: false,
        },
        "release:major:task": {
          command: "bun scripts/release.ts major",
          cache: false,
        },
        "release:minor:task": {
          command: "bun scripts/release.ts minor",
          cache: false,
        },
        "release:patch:task": {
          command: "bun scripts/release.ts patch",
          cache: false,
        },
        validate: {
          command: "vp check",
          cache: false,
        },
      },
    },
  };
});
