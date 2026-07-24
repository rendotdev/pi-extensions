import { defineConfig, type ViteUserConfig } from "vite-plus";
import type { Plugin } from "@voidzero-dev/vite-plus-core";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineRuntime } from "./src/define.ts";
import {
  GitReview,
  openReview,
  type ReviewPointer,
  stopReview,
} from "./src/domains/review/index.ts";

async function collectGitReviewFiles(cwd: string) {
  const collection = await new GitReview().collect({ cwd });
  return collection.files;
}

export class LgtmDevEnvironment extends defineRuntime({
  params: { cwd: process.cwd(), sessionId: `dev-${process.pid}` },
  deps: {
    collectGitReviewFiles,
    openReview,
    stopReview,
  },
}) {
  private review: ReviewPointer | undefined;
  private stopPromise: Promise<boolean> | undefined;

  public async stop(params: {}) {
    void params;
    if (!this.review) {
      return false;
    }
    this.stopPromise ??= this.deps.stopReview(this.params.cwd, this.review.reviewPath);
    return await this.stopPromise;
  }

  public async start(params: {}) {
    void params;
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

  public plugin(params: {}): Plugin {
    void params;
    const stop = this.stop.bind(this);
    return {
      name: "lgtm-dev-environment",
      apply: "serve",
      configureServer(server) {
        server.httpServer?.once("close", function closeReview() {
          void stop({});
        });
      },
      async closeBundle() {
        await stop({});
      },
    };
  }
}

export default defineConfig(async ({ command, mode }): Promise<ViteUserConfig> => {
  const isDev = command === "serve" && mode !== "test" && !process.argv.includes("preview");
  const DevEnvironment = isDev
    ? new LgtmDevEnvironment({
        params: {
          cwd: resolve(process.env.LGTM_DEV_CWD ?? process.cwd()),
          sessionId: `dev-${process.pid}`,
        },
        deps: { collectGitReviewFiles, openReview, stopReview },
      })
    : undefined;
  const devReview = await DevEnvironment?.start({});

  return {
    root: "src/app/web",
    plugins: [tailwindcss(), ...(DevEnvironment ? [DevEnvironment.plugin({})] : [])],
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
      rolldownOptions: {
        output: {
          manualChunks(id) {
            const isDocumentMarkdownDependency =
              id.includes("/react-markdown/") ||
              id.includes("/remark-") ||
              id.includes("/rehype-") ||
              id.includes("/unified/") ||
              id.includes("/micromark") ||
              id.includes("/mdast-") ||
              id.includes("/hast-");
            if (isDocumentMarkdownDependency) {
              return "document-markdown";
            }
            const isCodeRenderingDependency = id.includes("/@pierre/diffs/");
            if (isCodeRenderingDependency) {
              return "code-rendering";
            }
            const isUiDependency = id.includes("/@heroui/") || id.includes("/framer-motion/");
            if (isUiDependency) {
              return "ui";
            }
            return undefined;
          },
        },
      },
    },
    fmt: {
      ignorePatterns: ["dist/**", "extensions/**", ".lgtm/**"],
      sortPackageJson: true,
    },
    lint: {
      ignorePatterns: ["dist/**", "extensions/**", ".lgtm/**"],
      jsPlugins: [
        {
          name: "lgtm",
          specifier: "./src/tooling/oxlint/oxlint-plugin.ts",
        },
        { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      ],
      rules: {
        curly: ["error", "all"],
        "func-style": ["error", "declaration", { allowArrowFunctions: false }],
        "lgtm/named-compound-if-condition": "error",
        "lgtm/domain-public-api": "error",
        "lgtm/definition-helpers": "error",
        "lgtm/layer-boundaries": "error",
        "lgtm/max-file-lines": "error",
        "lgtm/max-function-lines": "error",
        "lgtm/source-location": "error",
        "new-cap": ["error", { capIsNew: false, newIsCap: true }],
        "typescript/explicit-member-accessibility": "error",
        "typescript/no-inferrable-types": "error",
        "typescript/no-unnecessary-type-arguments": "error",
        "typescript/no-unnecessary-type-assertion": "error",
        "typescript/no-unnecessary-type-parameters": "error",
        "vite-plus/prefer-vite-plus-imports": "error",
      },
      options: { typeAware: true, typeCheck: true },
    },
    test: {
      include: [
        "./**/*.test.{ts,tsx}",
        "../../define.test.ts",
        "../**/*.test.{ts,tsx}",
        "../../domains/**/*.test.{ts,tsx}",
        "../../tooling/**/*.test.{ts,tsx}",
      ],
      passWithNoTests: true,
    },
    pack: {
      entry: ["src/app/cli/cli.ts"],
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
        return entries.some((entry) => entry.endsWith("/app/pi/index.ts"))
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
          command: "vp pack src/app/pi/index.ts --out-dir extensions --clean",
          cache: true,
          output: ["extensions/index.js"],
        },
        "build:package": {
          command: 'bun -e "void 0"',
          dependsOn: ["build:web", "build:cli", "build:pi"],
          cache: false,
        },
        "demo:assets": {
          command: "bun scripts/render-demo-images.ts",
          dependsOn: ["build:package"],
          cache: true,
          output: [
            "assets/lgtm-demo-diff.jpg",
            "assets/lgtm-demo-diff-dark.jpg",
            "assets/lgtm-demo-document.jpg",
            "assets/lgtm-demo-document-dark.jpg",
          ],
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
        "test:e2e:fixtures": {
          command: "bun scripts/generate-large-review-fixtures.ts",
          cache: true,
          output: ["e2e/.generated/**"],
        },
        "test:e2e:performance": {
          command: "vp exec playwright test --config e2e/playwright.config.ts",
          dependsOn: ["build:package", "test:e2e:fixtures"],
          cache: false,
        },
        "release:beta:task": {
          command: "bun scripts/release.ts beta",
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
