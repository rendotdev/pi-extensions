import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { defineRuntime } from "../../../../define.ts";
import type { DemoReviewComments } from "../../service/demo/demo.ts";
import type { OpenReviewInput, ReviewJson } from "../../types/review.ts";
import { openReview, stopReview } from "../server/server.ts";
import { createDemoImageShellMarkup } from "./demo-image-shell.ts";

export type DemoImageTheme = "light" | "dark";

export class PlaywrightDemoImage extends defineRuntime({
  params: { width: 1920, height: 1080, quality: 92, captureDelayMs: 1_500, timeoutMs: 20_000 },
  deps: {
    launchBrowser: chromium.launch.bind(chromium),
    mkdir,
    createShellMarkup: createDemoImageShellMarkup,
  },
}) {
  public async render(params: {
    url: string;
    output: string;
    theme: DemoImageTheme;
  }): Promise<string> {
    const output = resolve(params.output);
    await this.deps.mkdir(dirname(output), { recursive: true });
    const browser = await this.deps.launchBrowser({ headless: true });
    try {
      const page = await browser.newPage({
        colorScheme: params.theme,
        deviceScaleFactor: 1,
        viewport: { width: this.params.width, height: this.params.height },
      });
      await page.setContent(this.deps.createShellMarkup({ theme: params.theme, url: params.url }), {
        timeout: this.params.timeoutMs,
        waitUntil: "networkidle",
      });
      await page.frameLocator("iframe").locator("[data-review-ready]").waitFor({
        state: "visible",
        timeout: this.params.timeoutMs,
      });
      await page.waitForTimeout(this.params.captureDelayMs);
      await page.screenshot({
        animations: "disabled",
        path: output,
        quality: this.params.quality,
        scale: "css",
        type: "jpeg",
      });
      return output;
    } finally {
      await browser.close();
    }
  }
}

export class DemoImage extends defineRuntime({
  params: {},
  deps: {
    mkdtemp,
    openReview,
    readFile,
    rm,
    stopReview,
    writeFile,
    renderBrowserImage(params: Parameters<PlaywrightDemoImage["render"]>[0]) {
      return new PlaywrightDemoImage().render(params);
    },
  },
}) {
  public async render(params: {
    comments: DemoReviewComments;
    input: OpenReviewInput;
    output: string;
    theme: DemoImageTheme;
  }): Promise<string> {
    const deps = this.deps;
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

    async function renderImage(params: {
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

    return await renderImage(params);
  }
}
