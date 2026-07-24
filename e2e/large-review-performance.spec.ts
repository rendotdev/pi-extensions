import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "playwright/test";
import { defineRuntime } from "../src/define.ts";
import { stopReview, type ReviewPointer } from "../src/domains/review/index.ts";
import type { LargeReviewFixtureManifest } from "../scripts/generate-large-review-fixtures.ts";

type PerformanceMetric = {
  budgetMs: number;
  durationMs: number;
  label: string;
};

type FrameTiming = {
  frameCount: number;
  framesOverBudget: number;
  maxFrameMs: number;
  p95FrameMs: number;
};

class ReviewEnvironment extends defineRuntime({
  params: {
    cliPath: resolve(process.cwd(), "dist/cli.mjs"),
    fixtureDirectory: resolve(process.cwd(), "e2e/.generated"),
    nodeExecutable: process.execPath,
    projectDirectory: process.cwd(),
  },
  deps: { execFileSync, mkdtemp, rm, stopReview },
}) {
  private cwd: string | undefined;
  private pointer: ReviewPointer | undefined;

  public async startDiff(params: {}): Promise<ReviewPointer> {
    void params;
    return await this.start({
      command: "json",
      fixture: resolve(this.params.fixtureDirectory, "large-diff.json"),
      name: "Extremely large diff",
    });
  }

  public async startDocument(params: {}): Promise<ReviewPointer> {
    void params;
    return await this.start({
      command: "document",
      fixture: resolve(this.params.fixtureDirectory, "large-document.md"),
      name: "Extremely large document",
    });
  }

  public async stop(params: {}): Promise<void> {
    void params;
    const reviewCwd = this.cwd;
    const reviewPointer = this.pointer;
    this.pointer = undefined;
    this.cwd = undefined;
    try {
      const shouldStopReview = reviewCwd !== undefined && reviewPointer !== undefined;
      if (shouldStopReview) {
        await this.deps.stopReview(reviewCwd, reviewPointer.reviewPath);
      }
    } finally {
      if (reviewCwd) {
        await this.deps.rm(reviewCwd, { force: true, recursive: true });
      }
    }
  }

  private async start(params: {
    command: "document" | "json";
    fixture: string;
    name: string;
  }): Promise<ReviewPointer> {
    this.cwd = await this.deps.mkdtemp(join(tmpdir(), "lgtm-large-e2e-"));
    try {
      const output = this.deps.execFileSync(
        this.params.nodeExecutable,
        [
          this.params.cliPath,
          "review",
          params.command,
          params.fixture,
          "--name",
          params.name,
          "--cwd",
          this.cwd,
          "--json",
        ],
        { cwd: this.params.projectDirectory, encoding: "utf8" },
      );
      this.pointer = JSON.parse(output) as ReviewPointer;
      return this.pointer;
    } catch (error) {
      await this.stop({});
      throw error;
    }
  }
}

class PerformanceDriver extends defineRuntime({
  params: {
    budgets: {
      commentMs: 2_000,
      initialRenderMs: 15_000,
      interactionMs: 2_000,
      scrollMs: 1_500,
      typingMs: 2_000,
    },
  },
  deps: {},
}) {
  public async open(params: {
    page: Page;
    ready: Locator;
    url: string;
  }): Promise<PerformanceMetric> {
    return await this.measure({
      budgetMs: this.params.budgets.initialRenderMs,
      label: "initial render",
      operation: async function renderReview() {
        await params.page.goto(params.url, { waitUntil: "domcontentloaded" });
        await params.ready.waitFor({ state: "visible" });
      },
    });
  }

  public async interact(params: {
    label: string;
    operation: () => Promise<void>;
  }): Promise<PerformanceMetric> {
    return await this.measure({
      budgetMs: this.params.budgets.interactionMs,
      label: params.label,
      operation: params.operation,
    });
  }

  public async scroll(params: {
    label: string;
    operation: () => Promise<void>;
  }): Promise<PerformanceMetric> {
    return await this.measure({
      budgetMs: this.params.budgets.scrollMs,
      label: params.label,
      operation: params.operation,
    });
  }

  public async wheelScrollAndHold(params: {
    deltaY: number;
    page: Page;
    scrollElement: Locator;
  }): Promise<void> {
    const bounds = await params.scrollElement.boundingBox();
    if (!bounds) {
      throw new Error("The review scroll container is not visible.");
    }
    const scrollTopBefore = await params.scrollElement.evaluate((element) => element.scrollTop);
    await params.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await params.page.mouse.wheel(0, params.deltaY);
    await params.page.waitForTimeout(500);
    const scrollTopAfter = await params.scrollElement.evaluate((element) => element.scrollTop);
    expect(scrollTopAfter - scrollTopBefore).toBeGreaterThan(params.deltaY / 2);
  }

  public async addComment(params: {
    label: string;
    operation: () => Promise<void>;
  }): Promise<PerformanceMetric> {
    return await this.measure({
      budgetMs: this.params.budgets.commentMs,
      label: params.label,
      operation: params.operation,
    });
  }

  public async typeComment(params: {
    label: string;
    operation: () => Promise<void>;
  }): Promise<PerformanceMetric> {
    return await this.measure({
      budgetMs: this.params.budgets.typingMs,
      label: params.label,
      operation: params.operation,
    });
  }

  public async lineTop(params: { host: Locator; lineNumber: number }): Promise<number> {
    await this.waitForLine({ host: params.host, lineNumber: params.lineNumber });
    return await params.host.evaluate((host, lineNumber) => {
      const line = Array.from(
        host.shadowRoot?.querySelectorAll<HTMLElement>(
          `[data-column-number="${lineNumber}"][data-line-index]`,
        ) ?? [],
      ).at(-1);
      return line?.getBoundingClientRect().top ?? Number.NaN;
    }, params.lineNumber);
  }

  public async scrollLineIntoView(params: { host: Locator; lineNumber: number }): Promise<void> {
    await this.waitForLine({ host: params.host, lineNumber: params.lineNumber });
    await params.host.evaluate((host, lineNumber) => {
      const line = Array.from(
        host.shadowRoot?.querySelectorAll<HTMLElement>(
          `[data-column-number="${lineNumber}"][data-line-index]`,
        ) ?? [],
      ).at(-1);
      line?.scrollIntoView({ block: "center" });
    }, params.lineNumber);
  }

  public async clickLine(params: { host: Locator; lineNumber: number }): Promise<void> {
    await this.waitForLine({ host: params.host, lineNumber: params.lineNumber });
    await params.host.evaluate((host, lineNumber) => {
      const lines = Array.from(
        host.shadowRoot?.querySelectorAll<HTMLElement>(
          `[data-line="${lineNumber}"][data-line-index]:not([data-column-number])`,
        ) ?? [],
      ).filter((line) => !line.closest("[data-deletions]"));
      const line = lines.at(-1);
      if (!line) {
        throw new Error(`Missing rendered line ${lineNumber}.`);
      }
      line.scrollIntoView({ block: "center" });
      const bounds = line.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        button: 0,
        clientX: bounds.left + Math.min(24, bounds.width / 2),
        clientY: bounds.top + bounds.height / 2,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
      };
      line.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, buttons: 1 }));
      line.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, buttons: 0 }));
    }, params.lineNumber);
  }

  public async dragAcrossCodeRow(params: {
    host: Locator;
    lineNumber: number;
    page: Page;
  }): Promise<void> {
    await this.waitForLine({ host: params.host, lineNumber: params.lineNumber });
    const points = await params.host.evaluate((host, lineNumber) => {
      const gutterLines = Array.from(
        host.shadowRoot?.querySelectorAll<HTMLElement>(
          `[data-column-number="${lineNumber}"][data-line-index]`,
        ) ?? [],
      );
      const gutterLine = gutterLines.at(-1);
      const lineIndex = gutterLine?.getAttribute("data-line-index");
      const line = Array.from(
        host.shadowRoot?.querySelectorAll<HTMLElement>(
          `[data-line-index]:not([data-column-number])`,
        ) ?? [],
      )
        .filter((candidate) => candidate.getAttribute("data-line-index") === lineIndex)
        .at(-1);
      if (!line) {
        throw new Error(`Missing rendered content for line ${lineNumber}.`);
      }
      const bounds = line.getBoundingClientRect();
      return {
        start: { x: bounds.left + 24, y: bounds.top + bounds.height / 2 },
        end: {
          x: bounds.left + Math.min(280, bounds.width - 24),
          y: bounds.top + bounds.height / 2,
        },
      };
    }, params.lineNumber);
    await params.page.mouse.move(points.start.x, points.start.y);
    await params.page.mouse.down();
    await params.page.mouse.move(points.end.x, points.end.y);
    const activeSelection = await params.host.evaluate((host, lineNumber) => {
      const root = host.shadowRoot;
      const selectedLineNumbers = Array.from(
        root?.querySelectorAll<HTMLElement>("[data-line][data-selected-line]") ?? [],
      ).map((line) => Number.parseInt(line.getAttribute("data-line") ?? "", 10));
      return {
        hasTargetRow: selectedLineNumbers.includes(lineNumber),
        nativeText: window.getSelection()?.toString() ?? "",
        selectedLineNumbers,
      };
    }, params.lineNumber);
    expect(activeSelection.hasTargetRow, JSON.stringify(activeSelection)).toBe(true);
    expect(activeSelection.nativeText).toBe("");
    await params.page.mouse.up();
  }

  public async selectDocumentText(params: { element: Locator }): Promise<number> {
    return await params.element.evaluate(async (element) => {
      const textNode = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0,
      );
      if (!textNode?.textContent) {
        throw new Error("The document element has no selectable text.");
      }
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(80, textNode.textContent.length));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const startedAt = performance.now();
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      while (!document.querySelector('[data-review-comment="true"] textarea')) {
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
      }
      return Math.round((performance.now() - startedAt) * 10) / 10;
    });
  }

  public async selectTableRow(params: { row: Locator }): Promise<void> {
    await params.row.evaluate((row) => {
      const cell = row.querySelector("td") ?? row;
      const range = document.createRange();
      range.selectNodeContents(cell);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  }

  public async measureFrameTiming(params: {
    operation: () => Promise<void>;
    page: Page;
  }): Promise<FrameTiming> {
    await params.page.evaluate(() => {
      const state = {
        frame: 0,
        intervals: [] as number[],
        previousTime: performance.now(),
      };
      function measureFrame(currentTime: number) {
        state.intervals.push(currentTime - state.previousTime);
        state.previousTime = currentTime;
        state.frame = requestAnimationFrame(measureFrame);
      }
      state.frame = requestAnimationFrame(measureFrame);
      (
        window as Window & {
          __reviewFrameTiming?: typeof state;
        }
      ).__reviewFrameTiming = state;
    });
    await params.operation();
    return await params.page.evaluate(async () => {
      await new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
      });
      const state = (
        window as Window & {
          __reviewFrameTiming?: {
            frame: number;
            intervals: number[];
            previousTime: number;
          };
        }
      ).__reviewFrameTiming;
      if (!state) {
        throw new Error("Frame timing was not initialized.");
      }
      cancelAnimationFrame(state.frame);
      const intervals = [...state.intervals].sort((left, right) => left - right);
      const p95Index = Math.max(0, Math.ceil(intervals.length * 0.95) - 1);
      return {
        frameCount: intervals.length,
        framesOverBudget: intervals.filter((duration) => duration > 100).length,
        maxFrameMs: Math.round((intervals.at(-1) ?? 0) * 10) / 10,
        p95FrameMs: Math.round((intervals[p95Index] ?? 0) * 10) / 10,
      };
    });
  }

  public async attachMetrics(params: {
    metrics: PerformanceMetric[];
    testInfo: TestInfo;
  }): Promise<void> {
    await params.testInfo.attach("performance-metrics", {
      body: Buffer.from(`${JSON.stringify(params.metrics, null, 2)}\n`),
      contentType: "application/json",
    });
  }

  private async measure(params: {
    budgetMs: number;
    label: string;
    operation: () => Promise<void>;
  }): Promise<PerformanceMetric> {
    const startedAt = performance.now();
    await params.operation();
    const durationMs = performance.now() - startedAt;
    expect(durationMs, `${params.label} exceeded ${params.budgetMs} ms`).toBeLessThan(
      params.budgetMs,
    );
    return {
      budgetMs: params.budgetMs,
      durationMs: Math.round(durationMs * 10) / 10,
      label: params.label,
    };
  }

  private async waitForLine(params: { host: Locator; lineNumber: number }): Promise<void> {
    await expect
      .poll(
        async function findRenderedLine() {
          return await params.host.evaluate((host, lineNumber) => {
            return Boolean(
              host.shadowRoot?.querySelector(
                `[data-column-number="${lineNumber}"][data-line-index]`,
              ),
            );
          }, params.lineNumber);
        },
        { timeout: this.params.budgets.initialRenderMs },
      )
      .toBe(true);
  }
}

const fixtureDirectory = resolve(process.cwd(), "e2e/.generated");
const ReviewPerformanceDriver = new PerformanceDriver({
  params: {
    budgets: {
      commentMs: 2_000,
      initialRenderMs: 15_000,
      interactionMs: 2_000,
      scrollMs: 1_500,
      typingMs: 2_000,
    },
  },
  deps: {},
});

test.describe("extremely large review performance", function describeLargeReviewPerformance() {
  test("keeps the eagerly loaded web entry below 1.2 MB", async function testWebEntrySize() {
    const assetsDirectory = resolve(process.cwd(), "dist/web/assets");
    const assetNames = await readdir(assetsDirectory);
    const entryAssetName = assetNames.find(
      (assetName) => assetName.startsWith("index-") && assetName.endsWith(".js"),
    );
    expect(entryAssetName).toBeDefined();
    const entryStats = await stat(resolve(assetsDirectory, entryAssetName ?? ""));
    expect(entryStats.size).toBeLessThan(1_200_000);

    async function eagerGraphSize(assetName: string, visited = new Set<string>()): Promise<number> {
      if (visited.has(assetName)) {
        return 0;
      }
      visited.add(assetName);
      const assetPath = resolve(assetsDirectory, assetName);
      const source = await readFile(assetPath, "utf8");
      const importedAssetNames = Array.from(
        source.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+\.js)["']/g),
        (match) => match[1],
      ).filter((importedAssetName): importedAssetName is string => importedAssetName !== undefined);
      const importedSizes = await Promise.all(
        importedAssetNames.map((importedAssetName) => eagerGraphSize(importedAssetName, visited)),
      );
      return source.length + importedSizes.reduce((total, size) => total + size, 0);
    }

    expect(await eagerGraphSize(entryAssetName ?? "")).toBeLessThan(1_250_000);
  });

  test("keeps a 64-file diff responsive through navigation and sequential comments", async function testLargeDiff({
    page,
  }, testInfo) {
    const LargeReviewEnvironment = new ReviewEnvironment({
      params: {
        cliPath: resolve(process.cwd(), "dist/cli.mjs"),
        fixtureDirectory,
        nodeExecutable: process.execPath,
        projectDirectory: process.cwd(),
      },
      deps: { execFileSync, mkdtemp, rm, stopReview },
    });
    const metrics: PerformanceMetric[] = [];
    try {
      const manifest = JSON.parse(
        await readFile(resolve(fixtureDirectory, "manifest.json"), "utf8"),
      ) as LargeReviewFixtureManifest;
      expect(manifest.diff.fileCount).toBe(64);
      expect(manifest.diff.fileCount * manifest.diff.linesPerFile).toBeGreaterThanOrEqual(32_000);
      const pointer = await LargeReviewEnvironment.startDiff({});
      metrics.push(
        await ReviewPerformanceDriver.open({
          page,
          ready: page.locator("[data-review-ready]"),
          url: pointer.url,
        }),
      );
      await expect(page.locator('[data-review-file-item="file-0"] diffs-container')).toBeVisible();

      const targetFileId = "file-56";
      const targetFileLink = page.locator(`[data-review-file-link="${targetFileId}"]`);
      metrics.push(
        await ReviewPerformanceDriver.interact({
          label: "filter 64-file sidebar",
          operation: async function filterSidebar() {
            const search = page.getByLabel("Filter changed files");
            await search.fill("extremely-large-file-056");
            await expect(targetFileLink).toBeVisible();
            await expect(page.getByText("Files (64)", { exact: true })).toBeVisible();
          },
        }),
      );
      metrics.push(
        await ReviewPerformanceDriver.scroll({
          label: "navigate to deep virtualized file",
          operation: async function navigateToDeepFile() {
            await targetFileLink.click();
            await expect(page.locator(`[data-review-file-item="${targetFileId}"]`)).toBeVisible();
            await page.getByLabel("Filter changed files").fill("");
          },
        }),
      );

      metrics.push(
        await ReviewPerformanceDriver.interact({
          label: "switch diff layout",
          operation: async function switchDiffLayout() {
            await page.getByRole("button", { name: "Side by side" }).click();
            await expect(page.getByRole("button", { name: "Side by side" })).toHaveAttribute(
              "aria-pressed",
              "true",
            );
          },
        }),
      );
      metrics.push(
        await ReviewPerformanceDriver.interact({
          label: "toggle line wrap",
          operation: async function toggleLineWrap() {
            await page.getByRole("button", { name: "Line wrap" }).click();
            await expect(page.getByRole("button", { name: "Line wrap" })).toHaveAttribute(
              "aria-pressed",
              "true",
            );
          },
        }),
      );

      const diffHost = page.locator(`[data-review-file-item="${targetFileId}"] diffs-container`);
      const diffScrollElement = page.locator("[data-review-diff-scroll]");
      const commentEditors = page.locator('[data-review-comment="true"] textarea');
      metrics.push(
        await ReviewPerformanceDriver.addComment({
          label: "add first deep diff comment",
          operation: async function addFirstDiffComment() {
            await ReviewPerformanceDriver.clickLine({ host: diffHost, lineNumber: 120 });
            await expect(commentEditors).toHaveCount(1);
          },
        }),
      );
      metrics.push(
        await ReviewPerformanceDriver.scroll({
          label: "keep manual scrolling after opening a diff comment",
          operation: async function keepManualDiffScroll() {
            await ReviewPerformanceDriver.wheelScrollAndHold({
              deltaY: 600,
              page,
              scrollElement: diffScrollElement,
            });
          },
        }),
      );
      await ReviewPerformanceDriver.scrollLineIntoView({ host: diffHost, lineNumber: 160 });
      const replacementLineTopBefore = await ReviewPerformanceDriver.lineTop({
        host: diffHost,
        lineNumber: 160,
      });
      metrics.push(
        await ReviewPerformanceDriver.addComment({
          label: "replace an unblurred empty diff comment",
          operation: async function replaceEmptyDiffComment() {
            await ReviewPerformanceDriver.clickLine({ host: diffHost, lineNumber: 160 });
            await expect(commentEditors).toHaveCount(1);
          },
        }),
      );
      await expect
        .poll(
          async function measureReplacementLineShift() {
            const replacementLineTopAfter = await ReviewPerformanceDriver.lineTop({
              host: diffHost,
              lineNumber: 160,
            });
            return Math.abs(replacementLineTopAfter - replacementLineTopBefore);
          },
          { timeout: 1_000 },
        )
        .toBeLessThanOrEqual(2);
      metrics.push(
        await ReviewPerformanceDriver.addComment({
          label: "replace an unblurred empty diff comment from highlighted text",
          operation: async function replaceEmptyDiffCommentFromHighlightedText() {
            await ReviewPerformanceDriver.dragAcrossCodeRow({
              host: diffHost,
              lineNumber: 158,
              page,
            });
            await expect(commentEditors).toHaveCount(1);
            await expect(commentEditors.first()).toBeFocused();
          },
        }),
      );
      const firstDraft =
        "First large diff comment remains responsive while every keystroke updates local form state.";
      let didKeepTypingLocal = false;
      const diffTypingFrameTiming = await ReviewPerformanceDriver.measureFrameTiming({
        page,
        operation: async function typeFirstDiffCommentWithFrameTiming() {
          metrics.push(
            await ReviewPerformanceDriver.typeComment({
              label: "type first diff comment",
              operation: async function typeFirstDiffComment() {
                await commentEditors.first().pressSequentially(firstDraft);
                didKeepTypingLocal = await page.evaluate(() =>
                  Boolean(document.querySelector('[aria-label="Approve this review"]')),
                );
              },
            }),
          );
        },
      });
      await testInfo.attach("diff-typing-frame-timing", {
        body: Buffer.from(`${JSON.stringify(diffTypingFrameTiming, null, 2)}\n`),
        contentType: "application/json",
      });
      const diffTypingFrameTimingMessage = JSON.stringify(diffTypingFrameTiming);
      expect(diffTypingFrameTiming.maxFrameMs, diffTypingFrameTimingMessage).toBeLessThanOrEqual(
        100,
      );
      expect(diffTypingFrameTiming.p95FrameMs, diffTypingFrameTimingMessage).toBeLessThanOrEqual(
        60,
      );
      expect(diffTypingFrameTiming.framesOverBudget, diffTypingFrameTimingMessage).toBe(0);
      expect(didKeepTypingLocal).toBe(true);
      await expect(page.getByRole("button", { name: "Send review comments" })).toBeVisible();
      await commentEditors.first().press("Enter");

      await ReviewPerformanceDriver.scrollLineIntoView({ host: diffHost, lineNumber: 260 });
      const secondLineTopBefore = await ReviewPerformanceDriver.lineTop({
        host: diffHost,
        lineNumber: 260,
      });
      metrics.push(
        await ReviewPerformanceDriver.addComment({
          label: "add second diff comment",
          operation: async function addSecondDiffComment() {
            await ReviewPerformanceDriver.clickLine({ host: diffHost, lineNumber: 260 });
            await expect(commentEditors).toHaveCount(2);
          },
        }),
      );
      await expect
        .poll(
          async function measureSecondLineShift() {
            const secondLineTopAfter = await ReviewPerformanceDriver.lineTop({
              host: diffHost,
              lineNumber: 260,
            });
            return Math.abs(secondLineTopAfter - secondLineTopBefore);
          },
          { timeout: 1_000 },
        )
        .toBeLessThanOrEqual(2);
      await expect(commentEditors.first()).toHaveValue(firstDraft);
      metrics.push(
        await ReviewPerformanceDriver.typeComment({
          label: "type second diff comment",
          operation: async function typeSecondDiffComment() {
            await commentEditors
              .last()
              .pressSequentially(
                "Second large diff comment verifies sequential editor performance.",
              );
          },
        }),
      );

      metrics.push(
        await ReviewPerformanceDriver.interact({
          label: "collapse all large diff files",
          operation: async function collapseAllFiles() {
            await page.getByLabel("Collapse all files").click();
            await expect(page.getByLabel("Expand all files")).toBeVisible();
          },
        }),
      );

      const collapsedTargetFileId = "file-8";
      const collapsedTargetFileLink = page.locator(
        `[data-review-file-link="${collapsedTargetFileId}"]`,
      );
      const search = page.getByLabel("Filter changed files");
      await search.fill("extremely-large-file-008");
      await expect(collapsedTargetFileLink).toHaveAttribute("data-collapsed", "true");
      await collapsedTargetFileLink.click();
      await expect(collapsedTargetFileLink).toHaveAttribute("data-collapsed", "false");
      await expect(
        page.locator(`[data-review-file-item="${collapsedTargetFileId}"] diffs-container`),
      ).toBeVisible();
      await search.fill("");

      const lastFileUrl = new URL(pointer.url);
      lastFileUrl.searchParams.set("file", "src/generated/area-07/extremely-large-file-063.ts");
      await page.goto(lastFileUrl.href, { waitUntil: "domcontentloaded" });
      await page.locator("[data-review-ready]").waitFor({ state: "visible" });
      const lastFileScrollElement = page.locator("[data-review-diff-scroll]");
      await page.waitForTimeout(500);
      const lastFileScrollTop = await lastFileScrollElement.evaluate(
        (element) => element.scrollTop,
      );
      await lastFileScrollElement.evaluate((element) => {
        element.scrollTop -= 600;
      });
      await page.waitForTimeout(500);
      const releasedScrollTop = await lastFileScrollElement.evaluate(
        (element) => element.scrollTop,
      );
      expect(lastFileScrollTop - releasedScrollTop).toBeGreaterThan(300);

      await ReviewPerformanceDriver.attachMetrics({ metrics, testInfo });
    } finally {
      await LargeReviewEnvironment.stop({});
    }
  });

  test("keeps a 10,000-line document responsive through code and table comments", async function testLargeDocument({
    page,
  }, testInfo) {
    const LargeReviewEnvironment = new ReviewEnvironment({
      params: {
        cliPath: resolve(process.cwd(), "dist/cli.mjs"),
        fixtureDirectory,
        nodeExecutable: process.execPath,
        projectDirectory: process.cwd(),
      },
      deps: { execFileSync, mkdtemp, rm, stopReview },
    });
    const metrics: PerformanceMetric[] = [];
    try {
      const manifest = JSON.parse(
        await readFile(resolve(fixtureDirectory, "manifest.json"), "utf8"),
      ) as LargeReviewFixtureManifest;
      expect(manifest.document.sectionCount).toBe(280);
      expect(manifest.document.sourceLineCount).toBeGreaterThanOrEqual(10_000);
      const pointer = await LargeReviewEnvironment.startDocument({});
      metrics.push(
        await ReviewPerformanceDriver.open({
          page,
          ready: page.locator("[data-review-ready]"),
          url: pointer.url,
        }),
      );
      await expect(
        page.getByRole("heading", { name: "Extremely large document review" }),
      ).toBeVisible();
      const documentCodeBlocks = page.locator(".document-code diffs-container");
      expect(await documentCodeBlocks.count()).toBeLessThanOrEqual(8);
      const documentTableRows = page.locator("tr[data-document-line]");
      expect(await documentTableRows.count()).toBeLessThanOrEqual(55);
      const deepHeading = page.getByRole("heading", { name: "Performance section 0240" });
      metrics.push(
        await ReviewPerformanceDriver.scroll({
          label: "scroll to deep document section",
          operation: async function scrollToDeepDocumentSection() {
            await deepHeading.scrollIntoViewIfNeeded();
            await expect(deepHeading).toBeInViewport();
          },
        }),
      );
      const commentEditors = page.locator('[data-review-comment="true"] textarea');
      await page.evaluate(() => {
        const article = document.querySelector("article");
        if (!article) {
          throw new Error("The document article is missing.");
        }
        const originalQuerySelectorAll = article.querySelectorAll.bind(article);
        (
          window as Window & {
            __documentAnnotationFullScans?: number;
          }
        ).__documentAnnotationFullScans = 0;
        article.querySelectorAll = function monitorAnnotationQueries(selectors: string) {
          if (selectors.includes("data-document-annotatable")) {
            const state = window as Window & {
              __documentAnnotationFullScans?: number;
            };
            state.__documentAnnotationFullScans = (state.__documentAnnotationFullScans ?? 0) + 1;
          }
          return originalQuerySelectorAll(selectors);
        };
      });
      const deepParagraphBlockId = await deepHeading.evaluate((heading) =>
        heading
          .closest("[data-document-block]")
          ?.nextElementSibling?.getAttribute("data-document-block"),
      );
      expect(deepParagraphBlockId).toBeTruthy();
      const deepParagraph = page.locator(`[data-document-block="${deepParagraphBlockId}"] p`);
      await expect(deepParagraph).toBeVisible();
      let proseCommentLatencyMs = Number.POSITIVE_INFINITY;
      metrics.push(
        await ReviewPerformanceDriver.addComment({
          label: "open deep document prose comment",
          operation: async function openDocumentProseComment() {
            proseCommentLatencyMs = await ReviewPerformanceDriver.selectDocumentText({
              element: deepParagraph,
            });
            await expect(commentEditors).toHaveCount(1);
            await expect(commentEditors.first()).toBeFocused();
          },
        }),
      );
      expect(proseCommentLatencyMs).toBeLessThan(300);
      const annotationFullScans = await page.evaluate(
        () =>
          (
            window as Window & {
              __documentAnnotationFullScans?: number;
            }
          ).__documentAnnotationFullScans ?? 0,
      );
      expect(annotationFullScans).toBe(0);
      await commentEditors.first().press("Escape");
      await expect(commentEditors).toHaveCount(0);

      const deepCodeBlock = deepHeading.locator(
        "xpath=following::*[starts-with(@data-document-block, 'pre:')][1]",
      );
      const documentCodeHost = deepCodeBlock.locator("diffs-container");
      await deepCodeBlock.locator("[data-lazy-document-code]").scrollIntoViewIfNeeded();
      await expect(documentCodeHost).toBeVisible();
      const codeCommentEditor = deepCodeBlock.locator('[data-review-comment="true"] textarea');
      await ReviewPerformanceDriver.scrollLineIntoView({
        host: documentCodeHost,
        lineNumber: 16,
      });
      const codeLineTopBefore = await ReviewPerformanceDriver.lineTop({
        host: documentCodeHost,
        lineNumber: 16,
      });
      metrics.push(
        await ReviewPerformanceDriver.addComment({
          label: "add deep document code comment",
          operation: async function addDocumentCodeComment() {
            await ReviewPerformanceDriver.dragAcrossCodeRow({
              host: documentCodeHost,
              lineNumber: 16,
              page,
            });
            await expect(commentEditors).toHaveCount(1);
          },
        }),
      );
      const codeLineTopAfter = await ReviewPerformanceDriver.lineTop({
        host: documentCodeHost,
        lineNumber: 16,
      });
      expect(Math.abs(codeLineTopAfter - codeLineTopBefore)).toBeLessThanOrEqual(2);
      const codeDraft =
        "Document code comment typing remains responsive inside the shared diff component.";
      metrics.push(
        await ReviewPerformanceDriver.typeComment({
          label: "type document code comment",
          operation: async function typeDocumentCodeComment() {
            await codeCommentEditor.pressSequentially(codeDraft);
          },
        }),
      );
      await codeCommentEditor.press("Enter");

      const deepTableBlock = deepHeading.locator(
        "xpath=following::*[starts-with(@data-document-block, 'table:')][1]",
      );
      await deepTableBlock.locator("[data-lazy-document-table]").scrollIntoViewIfNeeded();
      const deepTableRow = deepTableBlock.locator("tr[data-document-line]").nth(3);
      await expect(deepTableRow).toBeVisible();
      const tableRowTopBefore = (await deepTableRow.boundingBox())?.y;
      expect(tableRowTopBefore).toBeDefined();
      metrics.push(
        await ReviewPerformanceDriver.addComment({
          label: "add deep document table-row comment",
          operation: async function addDocumentTableComment() {
            await ReviewPerformanceDriver.selectTableRow({ row: deepTableRow });
            await expect(commentEditors).toHaveCount(2);
            await expect
              .poll(async function findInlineTableCommentRow() {
                return await deepTableRow.evaluate((row) =>
                  row.nextElementSibling?.getAttribute("data-review-table-comment"),
                );
              })
              .toBe("true");
            await expect(deepTableRow).toHaveAttribute("data-annotated", "true");
          },
        }),
      );
      await expect
        .poll(
          async function measureTableRowShift() {
            const stabilizedTableRowTop = (await deepTableRow.boundingBox())?.y;
            return Math.abs((stabilizedTableRowTop ?? 0) - (tableRowTopBefore ?? 0));
          },
          { timeout: 1_000 },
        )
        .toBeLessThanOrEqual(2);
      await expect(codeCommentEditor).toHaveValue(codeDraft);
      const documentScrollElement = page.locator("[data-review-document-scroll]");
      metrics.push(
        await ReviewPerformanceDriver.scroll({
          label: "keep manual scrolling after opening a document comment",
          operation: async function keepManualDocumentScroll() {
            await ReviewPerformanceDriver.wheelScrollAndHold({
              deltaY: 600,
              page,
              scrollElement: documentScrollElement,
            });
          },
        }),
      );
      const emptyTableCommentEditor = page.locator('[data-review-comment="true"] textarea:focus');
      const followingHeading = page.getByRole("heading", { name: "Performance section 0241" });
      await followingHeading.scrollIntoViewIfNeeded();
      const followingHeadingTopBefore = (await followingHeading.boundingBox())?.y;
      expect(followingHeadingTopBefore).toBeDefined();
      await emptyTableCommentEditor.evaluate((textarea) => textarea.blur());
      await expect(commentEditors).toHaveCount(1);
      await expect
        .poll(
          async function measureEmptyCommentRemovalShift() {
            const followingHeadingTopAfter = (await followingHeading.boundingBox())?.y;
            return Math.abs((followingHeadingTopAfter ?? 0) - (followingHeadingTopBefore ?? 0));
          },
          { timeout: 1_000 },
        )
        .toBeLessThanOrEqual(2);

      const followingTableBlock = followingHeading.locator(
        "xpath=following::*[starts-with(@data-document-block, 'table:')][1]",
      );
      await followingTableBlock.locator("[data-lazy-document-table]").scrollIntoViewIfNeeded();
      const followingTableRow = followingTableBlock.locator("tr[data-document-line]").nth(3);
      await expect(followingTableRow).toBeVisible();
      await ReviewPerformanceDriver.selectTableRow({ row: followingTableRow });
      await expect(commentEditors).toHaveCount(2);
      const tableCommentEditor = page.locator('[data-review-comment="true"] textarea:focus');
      metrics.push(
        await ReviewPerformanceDriver.typeComment({
          label: "type document table-row comment",
          operation: async function typeDocumentTableComment() {
            await tableCommentEditor.pressSequentially(
              "Table row comment stays aligned and responsive in the extremely large document.",
            );
          },
        }),
      );

      await deepHeading.evaluate((heading) => {
        (
          window as Window & {
            __documentHeadingBeforeTheme?: Element;
          }
        ).__documentHeadingBeforeTheme = heading;
      });
      const documentThemeFrameTiming = await ReviewPerformanceDriver.measureFrameTiming({
        page,
        operation: async function switchDocumentThemeWithFrameTiming() {
          metrics.push(
            await ReviewPerformanceDriver.interact({
              label: "switch large document to dark theme",
              operation: async function switchDocumentTheme() {
                await page.getByRole("button", { name: "Use dark theme" }).click();
                await expect(page.locator("html")).toHaveClass(/dark/);
                await expect(codeCommentEditor).toHaveValue(codeDraft);
                const didKeepParsedDocumentTree = await deepHeading.evaluate(
                  (heading) =>
                    heading ===
                    (
                      window as Window & {
                        __documentHeadingBeforeTheme?: Element;
                      }
                    ).__documentHeadingBeforeTheme,
                );
                expect(didKeepParsedDocumentTree).toBe(true);
              },
            }),
          );
        },
      });
      await testInfo.attach("document-theme-frame-timing", {
        body: Buffer.from(`${JSON.stringify(documentThemeFrameTiming, null, 2)}\n`),
        contentType: "application/json",
      });
      const documentThemeFrameTimingMessage = JSON.stringify(documentThemeFrameTiming);
      expect(
        documentThemeFrameTiming.maxFrameMs,
        documentThemeFrameTimingMessage,
      ).toBeLessThanOrEqual(100);
      expect(
        documentThemeFrameTiming.p95FrameMs,
        documentThemeFrameTimingMessage,
      ).toBeLessThanOrEqual(60);
      expect(documentThemeFrameTiming.framesOverBudget, documentThemeFrameTimingMessage).toBe(0);
      await ReviewPerformanceDriver.attachMetrics({ metrics, testInfo });
    } finally {
      await LargeReviewEnvironment.stop({});
    }
  });
});
