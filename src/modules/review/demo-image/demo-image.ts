import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { build, defineBuilderDeps } from "../../../builder.ts";
import type { DemoReviewComments } from "../demo/demo.ts";
import type { OpenReviewInput, ReviewJson } from "../review/review.ts";
import { openReview, stopReview } from "../server/server.ts";

export type DemoImageTheme = "light" | "dark";

export const { DemoImageShellSingleton, DemoImageShellSingletonBuilder } = build().singleton(
  "DemoImageShellSingleton",
  {
    build() {
      function createMarkup(params: { theme: DemoImageTheme; url: string }): string {
        const url = params.url
          .replaceAll("&", "&amp;")
          .replaceAll('"', "&quot;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");

        return `<!doctype html>
<html lang="en" data-theme="${params.theme}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>lgtm review preview</title>
    <style>
      :root {
        color-scheme: light;
        --canvas: #08090a;
        --floor: #d0d6e0;
        --floor-shade: rgba(8, 9, 10, 0.5);
        --shell: #ffffff;
        --toolbar: rgba(248, 248, 249, 0.96);
        --border: rgba(31, 29, 39, 0.14);
        --divider: rgba(31, 29, 39, 0.1);
        --address: rgba(31, 29, 39, 0.055);
        --address-border: rgba(31, 29, 39, 0.08);
        --address-text: rgba(31, 29, 39, 0.58);
        --shadow: 0 38px 100px rgba(30, 25, 50, 0.2), 0 8px 28px rgba(30, 25, 50, 0.12);
      }

      :root[data-theme="dark"] {
        color-scheme: dark;
        --shell: #111214;
        --toolbar: rgba(21, 22, 24, 0.97);
        --border: rgba(255, 255, 255, 0.14);
        --divider: rgba(255, 255, 255, 0.09);
        --address: rgba(255, 255, 255, 0.055);
        --address-border: rgba(255, 255, 255, 0.075);
        --address-text: rgba(255, 255, 255, 0.52);
        --shadow: 0 42px 110px rgba(0, 0, 0, 0.56), 0 10px 34px rgba(0, 0, 0, 0.38);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
      }

      body {
        position: relative;
        display: grid;
        place-items: center;
        background: var(--canvas);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body::before {
        position: absolute;
        top: 52.7%;
        right: 0;
        left: 0;
        height: 83.2%;
        background:
          radial-gradient(
            52.53% 57.5% at 50% 100%,
            transparent 0%,
            var(--floor-shade) 100%
          ),
          linear-gradient(var(--canvas) 10%, var(--floor) 100%);
        content: "";
        pointer-events: none;
      }

      .browser {
        position: relative;
        z-index: 1;
        width: min(1280px, calc(100vw - 160px));
        height: calc(100vh - 288px);
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: var(--shell);
        box-shadow: var(--shadow);
        transform: translateY(-48px);
      }

      .browser::before {
        position: absolute;
        inset: 0;
        z-index: 2;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: inherit;
        content: "";
        pointer-events: none;
      }

      .toolbar {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 1fr minmax(320px, 560px) 1fr;
        align-items: center;
        height: 52px;
        padding: 0 18px;
        border-bottom: 1px solid var(--divider);
        background: var(--toolbar);
        backdrop-filter: blur(18px);
      }

      .traffic-lights {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .traffic-light {
        width: 12px;
        height: 12px;
        border: 0.5px solid rgba(0, 0, 0, 0.12);
        border-radius: 999px;
        box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.45);
      }

      .traffic-light.close {
        background: #ff5f57;
      }

      .traffic-light.minimize {
        background: #febc2e;
      }

      .traffic-light.maximize {
        background: #28c840;
      }

      .address {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: center;
        height: 30px;
        border: 1px solid var(--address-border);
        border-radius: 8px;
        background: var(--address);
        color: var(--address-text);
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.01em;
      }

      .address svg {
        width: 11px;
        height: 11px;
        opacity: 0.72;
      }

      .review {
        display: block;
        width: 100%;
        height: calc(100% - 52px);
        border: 0;
        background: var(--shell);
      }
    </style>
  </head>
  <body>
    <main class="browser" aria-label="macOS browser preview">
      <header class="toolbar">
        <div class="traffic-lights" aria-hidden="true">
          <span class="traffic-light close"></span>
          <span class="traffic-light minimize"></span>
          <span class="traffic-light maximize"></span>
        </div>
        <div class="address">
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
            <path d="M4.75 7V5.25a3.25 3.25 0 0 1 6.5 0V7M3.5 7h9v6.5h-9V7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>lgtm review</span>
        </div>
        <div></div>
      </header>
      <iframe class="review" title="lgtm review" src="${url}"></iframe>
    </main>
  </body>
</html>`;
      }

      return { createMarkup };
    },
  },
);

export const { PlaywrightDemoImageService, PlaywrightDemoImageServiceBuilder } = build().service(
  "PlaywrightDemoImageService",
  {
    config: { width: 1920, height: 1080, quality: 92, captureDelayMs: 1_500, timeoutMs: 20_000 },
    deps: defineBuilderDeps<{
      launchBrowser: typeof chromium.launch;
      mkdir: typeof mkdir;
      createShellMarkup: typeof DemoImageShellSingleton.createMarkup;
    }>({
      launchBrowser: chromium.launch.bind(chromium),
      mkdir,
      createShellMarkup: DemoImageShellSingleton.createMarkup,
    }),
    build({ config, deps }) {
      async function render(params: {
        url: string;
        output: string;
        theme: DemoImageTheme;
      }): Promise<string> {
        const output = resolve(params.output);
        await deps.mkdir(dirname(output), { recursive: true });
        const browser = await deps.launchBrowser({ headless: true });
        try {
          const page = await browser.newPage({
            colorScheme: params.theme,
            deviceScaleFactor: 1,
            viewport: { width: config.width, height: config.height },
          });
          await page.setContent(deps.createShellMarkup({ theme: params.theme, url: params.url }), {
            timeout: config.timeoutMs,
            waitUntil: "networkidle",
          });
          await page.frameLocator("iframe").locator("[data-review-ready]").waitFor({
            state: "visible",
            timeout: config.timeoutMs,
          });
          await page.waitForTimeout(config.captureDelayMs);
          await page.screenshot({
            animations: "disabled",
            path: output,
            quality: config.quality,
            scale: "css",
            type: "jpeg",
          });
          return output;
        } finally {
          await browser.close();
        }
      }

      return { render };
    },
  },
);

export const { DemoImageService, DemoImageServiceBuilder } = build().service("DemoImageService", {
  config: {},
  deps: {
    mkdtemp,
    openReview,
    readFile,
    rm,
    stopReview,
    writeFile,
    renderBrowserImage: PlaywrightDemoImageService.render,
  },
  build({ deps }) {
    async function addComments(params: {
      comments: DemoReviewComments;
      reviewPath: string;
    }): Promise<void> {
      const review = JSON.parse(await deps.readFile(params.reviewPath, "utf8")) as ReviewJson;
      const files = review.files.map(function addFileComments(file) {
        const comments = params.comments.files.find(function findCommentedFile(commentedFile) {
          return commentedFile.location === file.location;
        })?.comments;
        return comments ? { ...file, comments } : file;
      });
      await deps.writeFile(
        params.reviewPath,
        `${JSON.stringify(
          { ...review, files, documentComments: params.comments.documentComments },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }

    async function render(params: {
      comments: DemoReviewComments;
      input: OpenReviewInput;
      output: string;
      theme: DemoImageTheme;
    }): Promise<string> {
      const reviewCwd = await deps.mkdtemp(join(tmpdir(), "lgtm-demo-review-"));
      let pointer;
      try {
        pointer = await deps.openReview(params.input, {
          cwd: reviewCwd,
          openBrowser: false,
          reviewUUID: "preview",
          sessionId: "demo",
          trackAsActiveReview: false,
        });
      } catch (error) {
        await deps.rm(reviewCwd, { force: true, recursive: true });
        throw error;
      }
      try {
        await addComments({ comments: params.comments, reviewPath: pointer.reviewPath });
        return await deps.renderBrowserImage({
          url: pointer.url,
          output: params.output,
          theme: params.theme,
        });
      } finally {
        try {
          await deps.stopReview(reviewCwd, pointer.reviewPath);
        } finally {
          await deps.rm(reviewCwd, { force: true, recursive: true });
        }
      }
    }

    return { render };
  },
});
