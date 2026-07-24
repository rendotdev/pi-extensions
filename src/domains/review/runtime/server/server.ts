import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { defineRuntime } from "../../../../define.ts";
import { ReviewGrouping } from "../../service/grouping/grouping.ts";
import { ReviewRetention } from "../../service/retention/retention.ts";
import { ReviewBuilder, ReviewSource } from "../../service/review/review.ts";
import type {
  OpenReviewInput,
  ReviewJson,
  ReviewPayload,
  ReviewPointer,
} from "../../types/review.ts";
import {
  finishReviewImplementation,
  formatReviewForModelImplementation,
  stopReviewsImplementation,
  waitForReviewImplementation,
} from "./server-completion.ts";
import { serveReviewAppImplementation, writeReviewApp } from "./server-host.ts";
import { BuiltCliPath, ReviewIdentifier, WebRoot } from "./server-paths.ts";
import {
  abortCleanupByReviewPath,
  activeReviewServersByPath,
  cleanupReviewServersByPath,
  openInDefaultBrowser,
  registerProcessCleanup,
  ReviewServerLifecycle,
  startReviewServer,
  stopActiveReviewServers,
  stopReviewImplementation,
  stopReviewServerState,
  writeReviewServerState,
  type ReviewServerState,
} from "./server-process.ts";
import { startReviewFinishWatcher } from "./server-watcher.ts";
import type {
  CompletedReview,
  FinishReviewResult,
  OpenReviewOptions,
  WaitForReviewOptions,
} from "./server-types.ts";

type PreparedReview = {
  cwd: string;
  review: ReviewJson;
  pointer: ReviewPointer;
  serverState: ReviewServerState;
};

async function openReviewImplementation(
  input: OpenReviewInput,
  options: OpenReviewOptions,
): Promise<ReviewPointer> {
  const prepared = await prepareReview(input, options);
  try {
    return await activateReview(prepared, options);
  } catch (error) {
    untrackReview(prepared.pointer.reviewPath);
    await stopReviewServerState(prepared.serverState).catch(() => false);
    throw error;
  }
}

async function prepareReview(
  input: OpenReviewInput,
  options: OpenReviewOptions,
): Promise<PreparedReview> {
  const cwd = resolve(options.cwd);
  const sessionId = ReviewIdentifier.sanitizePathSegment({
    value: options.sessionId ?? `cli-${process.pid}`,
  });
  const reviewUUID = ReviewIdentifier.sanitizePathSegment({
    value: options.reviewUUID ?? randomUUID(),
  });
  const reviewId = `${sessionId}-${reviewUUID}`;
  const appDir = resolve(cwd, ".lgtm", reviewId);
  const reviewPath = join(appDir, "review.json");
  const generatedAt = new Date().toISOString();
  const files = (input.files ?? []).map((file, index) => ReviewSource.build({ file, index }));
  const groups = new ReviewGrouping().build({ files, groups: input.groups });
  if (options.replaceActiveReview === true) {
    options.onUpdate?.("Stopping any previous LGTM review server...");
    await stopActiveReviewServers(cwd);
  }
  await mkdir(appDir, { recursive: true });
  const common = {
    ...input,
    sessionId,
    reviewUUID,
    reviewId,
    cwd,
    appDir,
    reviewPath,
    generatedAt,
    files,
  };
  const review = ReviewBuilder.build(common);
  const payload: ReviewPayload = { ...common, groups, checkpoint: input.checkpoint };
  const manifest = new ReviewRetention().createManifest({ reviewId, createdAt: generatedAt });
  await writeReviewApp(appDir, payload, review, manifest);
  options.onUpdate?.("Starting LGTM review server...");
  const server = await startReviewServer(appDir, options.signal, options.detachedServer);
  return {
    cwd,
    review,
    pointer: {
      name: input.name,
      sessionId,
      reviewUUID,
      reviewId,
      appDir,
      url: server.url,
      reviewPath,
    },
    serverState: { ...server, appDir, reviewId, startedAt: new Date().toISOString() },
  };
}

async function activateReview(
  prepared: PreparedReview,
  options: OpenReviewOptions,
): Promise<ReviewPointer> {
  throwIfAborted(options.signal);
  await writeReviewServerState(prepared.serverState);
  await writeFile(
    prepared.pointer.reviewPath,
    `${JSON.stringify({ ...prepared.review, url: prepared.pointer.url, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  if (options.trackAsActiveReview !== false) {
    activeReviewServersByPath.set(prepared.pointer.reviewPath, prepared.serverState);
    if (options.stopOnAbort !== false) {
      trackAbort(prepared.cwd, prepared.pointer.reviewPath, options.signal);
    }
  }
  if (options.cleanupOnExit) {
    cleanupReviewServersByPath.set(prepared.pointer.reviewPath, prepared.serverState);
    registerProcessCleanup();
  }
  if (options.onFinished) {
    startReviewFinishWatcher(prepared.cwd, prepared.pointer, options.onFinished);
  }
  if (options.openBrowser !== false) {
    openInDefaultBrowser(prepared.pointer.url);
  }
  return prepared.pointer;
}

function trackAbort(cwd: string, reviewPath: string, signal?: AbortSignal) {
  if (!signal) {
    return;
  }
  function abort() {
    void stopReviewImplementation(cwd, reviewPath);
  }
  signal.addEventListener("abort", abort, { once: true });
  abortCleanupByReviewPath.set(reviewPath, () => signal.removeEventListener("abort", abort));
  if (signal.aborted) {
    abort();
  }
}

function untrackReview(reviewPath: string) {
  abortCleanupByReviewPath.get(reviewPath)?.();
  abortCleanupByReviewPath.delete(reviewPath);
  activeReviewServersByPath.delete(reviewPath);
  cleanupReviewServersByPath.delete(reviewPath);
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The review was canceled.", "AbortError");
}

export class ReviewServerRuntime extends defineRuntime({
  params: {},
  deps: {
    finishReviewImplementation,
    formatReviewForModelImplementation,
    openReviewImplementation,
    serveReviewAppImplementation,
    stopReviewImplementation,
    stopReviewsImplementation,
    waitForReviewImplementation,
  },
}) {
  public finishReview(cwd: string, reviewPath: string) {
    return this.deps.finishReviewImplementation(cwd, reviewPath);
  }
  public formatReviewForModel(review: ReviewJson, reviewPath: string) {
    return this.deps.formatReviewForModelImplementation(review, reviewPath);
  }
  public openReview(input: OpenReviewInput, options: OpenReviewOptions) {
    return this.deps.openReviewImplementation(input, options);
  }
  public serveReviewApp(appDir: string) {
    return this.deps.serveReviewAppImplementation(appDir);
  }
  public stopReview(cwd: string, reviewPath: string) {
    return this.deps.stopReviewImplementation(cwd, reviewPath);
  }
  public stopReviews(cwd: string) {
    return this.deps.stopReviewsImplementation(cwd);
  }
  public waitForReview(pointer: ReviewPointer, options: WaitForReviewOptions) {
    return this.deps.waitForReviewImplementation(pointer, options);
  }
}

export const ReviewServer = new ReviewServerRuntime();
export const finishReview = ReviewServer.finishReview.bind(ReviewServer);
export const formatReviewForModel = ReviewServer.formatReviewForModel.bind(ReviewServer);
export const openReview = ReviewServer.openReview.bind(ReviewServer);
export const serveReviewApp = ReviewServer.serveReviewApp.bind(ReviewServer);
export const stopReview = ReviewServer.stopReview.bind(ReviewServer);
export const stopReviews = ReviewServer.stopReviews.bind(ReviewServer);
export const waitForReview = ReviewServer.waitForReview.bind(ReviewServer);

export { BuiltCliPath, ReviewIdentifier, ReviewServerLifecycle, WebRoot };
export type { CompletedReview, FinishReviewResult, OpenReviewOptions, WaitForReviewOptions };
