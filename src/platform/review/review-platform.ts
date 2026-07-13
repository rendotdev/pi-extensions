import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  reviewBuilder,
  reviewFormatter,
  reviewSourceBuilder,
  type DiffReviewFileInput,
  type OpenReviewInput,
  type ReviewJson,
  type ReviewOutcome,
  type ReviewPayload,
  type ReviewPointer,
} from "../../domain/review/review.ts";
import { lgtmPreferences } from "../../domain/preferences/preferences.ts";
import { LgtmPreferencesPlatformClass } from "../preferences/preferences-platform.ts";

type CommandResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

type ReviewServerInfo = {
  url: string;
  pid: number;
};

type ReviewServerState = ReviewServerInfo & {
  appDir: string;
  reviewId: string;
  startedAt: string;
};

class ReviewIdentifierClass {
  constructor(params: Record<string, never>, deps: Record<string, never>) {
    void params;
    void deps;
  }

  public sanitizePathSegment(params: { value: string }): string {
    return params.value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || randomUUID();
  }
}

class ReviewServerLifecycleClass {
  private readonly deps: {
    activeReviewServersByPath: Map<string, ReviewServerState>;
    readReviewServerPid: (appDir: string) => Promise<number | undefined>;
    readReviewServerState: (appDir: string) => Promise<ReviewServerState | undefined>;
    stopReviewServerState: (state: ReviewServerState, reviewPath?: string) => Promise<boolean>;
  };

  constructor(
    params: Record<string, never>,
    deps: {
      activeReviewServersByPath: Map<string, ReviewServerState>;
      readReviewServerPid: (appDir: string) => Promise<number | undefined>;
      readReviewServerState: (appDir: string) => Promise<ReviewServerState | undefined>;
      stopReviewServerState: (state: ReviewServerState, reviewPath?: string) => Promise<boolean>;
    },
  ) {
    void params;
    this.deps = deps;
  }

  public async stopForReview(params: { review: ReviewJson; reviewPath: string }): Promise<boolean> {
    const appDir = params.review.appDir || resolve(params.reviewPath, "..");
    const knownState =
      this.deps.activeReviewServersByPath.get(params.reviewPath) ??
      (await this.deps.readReviewServerState(appDir));
    const pid = knownState?.pid ?? (await this.deps.readReviewServerPid(appDir));
    if (!pid) return false;
    const state: ReviewServerState = knownState ?? {
      pid,
      url: params.review.url ?? "",
      appDir,
      reviewId: params.review.reviewId,
      startedAt: params.review.updatedAt,
    };
    return await this.deps.stopReviewServerState(state, params.reviewPath);
  }
}

const activeReviewServersByPath = new Map<string, ReviewServerState>();
const cleanupReviewServersByPath = new Map<string, ReviewServerState>();
const abortCleanupByReviewPath = new Map<string, () => void>();
const finishWatchersByReviewPath = new Map<string, ReturnType<typeof setInterval>>();
let processCleanupRegistered = false;

const reviewIdentifier = new ReviewIdentifierClass({}, {});
const reviewServerLifecycle = new ReviewServerLifecycleClass(
  {},
  {
    activeReviewServersByPath,
    readReviewServerPid,
    readReviewServerState,
    stopReviewServerState,
  },
);

export type OpenReviewOptions = {
  cwd: string;
  sessionId?: string;
  signal?: AbortSignal;
  cleanupOnExit?: boolean;
  detachedServer?: boolean;
  openBrowser?: boolean;
  replaceActiveReview?: boolean;
  trackAsActiveReview?: boolean;
  onUpdate?: (message: string) => void;
  onFinished?: (review: ReviewJson, formattedReview: string) => void | Promise<void>;
};

export async function openReview(
  input: OpenReviewInput,
  options: OpenReviewOptions,
): Promise<ReviewPointer> {
  const cwd = resolve(options.cwd);
  const sessionId = reviewIdentifier.sanitizePathSegment({
    value: options.sessionId ?? `cli-${process.pid}`,
  });
  const reviewUUID = randomUUID();
  const reviewId = `${sessionId}-${reviewUUID}`;
  const appDir = resolve(cwd, ".lgtm", reviewId);
  const reviewPath = join(appDir, "review.json");
  const generatedAt = new Date().toISOString();
  const files = (input.files ?? []).map((file, index) =>
    reviewSourceBuilder.build({ file, index }),
  );

  if (options.replaceActiveReview === true) {
    options.onUpdate?.("Stopping any previous LGTM review server...");
    await stopActiveReviewServers(cwd);
  }
  await mkdir(appDir, { recursive: true });

  const review = reviewBuilder.build({
    kind: input.kind,
    name: input.name,
    sessionId: sessionId,
    reviewUUID,
    reviewId,
    cwd,
    appDir,
    reviewPath,
    generatedAt,
    files,
    document: input.document,
  });
  const payload: ReviewPayload = {
    kind: input.kind,
    name: input.name,
    sessionId: sessionId,
    reviewUUID,
    reviewId,
    cwd,
    appDir,
    reviewPath,
    generatedAt,
    files,
    document: input.document,
  };
  await writeReviewApp(appDir, payload, review);

  options.onUpdate?.("Starting LGTM review server...");
  const server = await startReviewServer(appDir, options.signal, options.detachedServer);
  const serverState: ReviewServerState = {
    ...server,
    appDir,
    reviewId,
    startedAt: new Date().toISOString(),
  };
  try {
    throwIfAborted(options.signal);
    await writeReviewServerState(serverState);
    const url = server.url;
    await writeFile(
      reviewPath,
      `${JSON.stringify({ ...review, url, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );

    if (options.trackAsActiveReview !== false) {
      activeReviewServersByPath.set(reviewPath, serverState);
    }
    if (options.signal && options.trackAsActiveReview !== false) {
      const abort = () => void stopReview(cwd, reviewPath);
      options.signal.addEventListener("abort", abort, { once: true });
      abortCleanupByReviewPath.set(reviewPath, () =>
        options.signal?.removeEventListener("abort", abort),
      );
      if (options.signal.aborted) abort();
    }
    if (options.cleanupOnExit) {
      cleanupReviewServersByPath.set(reviewPath, serverState);
      registerProcessCleanup();
    }

    const pointer: ReviewPointer = {
      name: input.name,
      sessionId: sessionId,
      reviewUUID,
      reviewId,
      appDir,
      url,
      reviewPath,
    };
    if (options.onFinished) startReviewFinishWatcher(cwd, pointer, options.onFinished);
    if (options.openBrowser !== false) openInDefaultBrowser(url);
    return pointer;
  } catch (error) {
    if (options.trackAsActiveReview !== false) {
      abortCleanupByReviewPath.get(reviewPath)?.();
      abortCleanupByReviewPath.delete(reviewPath);
      activeReviewServersByPath.delete(reviewPath);
    }
    cleanupReviewServersByPath.delete(reviewPath);
    await stopReviewServerProcess(serverState).catch(() => false);
    throw error;
  }
}

export async function collectGitReviewFiles(
  cwd: string,
  signal?: AbortSignal,
): Promise<DiffReviewFileInput[]> {
  const rootResult = await runCommand("git", ["rev-parse", "--show-toplevel"], cwd, signal, 10_000);
  if (rootResult.code !== 0) {
    throw new Error(
      `Unable to open Git review from ${cwd}.\n${rootResult.stderr || rootResult.stdout}`,
    );
  }
  const root = rootResult.stdout.trim();
  const headResult = await runCommand(
    "git",
    ["rev-parse", "--verify", "HEAD"],
    root,
    signal,
    10_000,
  );
  const hasHead = headResult.code === 0;
  const changedPaths: Array<{ oldPath?: string; newPath?: string }> = [];

  if (hasHead) {
    const diffResult = await runCommand(
      "git",
      ["diff", "--name-status", "-z", "--find-renames", "HEAD", "--"],
      root,
      signal,
      30_000,
    );
    if (diffResult.code !== 0) {
      throw new Error(`git diff failed.\n${diffResult.stderr || diffResult.stdout}`);
    }
    changedPaths.push(...parseGitNameStatus(diffResult.stdout));
  } else {
    const trackedResult = await runCommand(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      root,
      signal,
      30_000,
    );
    if (trackedResult.code !== 0) {
      throw new Error(`git ls-files failed.\n${trackedResult.stderr || trackedResult.stdout}`);
    }
    for (const path of trackedResult.stdout.split("\0").filter(Boolean)) {
      changedPaths.push({ newPath: path });
    }
  }

  const untrackedResult = await runCommand(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    root,
    signal,
    30_000,
  );
  if (untrackedResult.code !== 0) {
    throw new Error(`git ls-files failed.\n${untrackedResult.stderr || untrackedResult.stdout}`);
  }
  for (const path of untrackedResult.stdout.split("\0").filter(Boolean)) {
    changedPaths.push({ newPath: path });
  }

  const deduplicated = new Map<string, { oldPath?: string; newPath?: string }>();
  for (const change of changedPaths) {
    deduplicated.set(change.newPath ?? change.oldPath ?? randomUUID(), change);
  }

  const files: DiffReviewFileInput[] = [];
  for (const change of deduplicated.values()) {
    const oldContent =
      hasHead && change.oldPath ? await readGitFile(root, change.oldPath, signal) : "";
    const newContent = change.newPath ? await readWorkingTreeFile(root, change.newPath) : "";
    if (oldContent.includes("\0") || newContent.includes("\0")) continue;
    files.push({
      location: change.newPath ?? change.oldPath ?? "unknown",
      oldContent,
      newContent,
    });
  }

  if (files.length === 0) {
    throw new Error("No text changes were found to review.");
  }
  return files;
}

function parseGitNameStatus(output: string): Array<{ oldPath?: string; newPath?: string }> {
  const fields = output.split("\0").filter(Boolean);
  const changes: Array<{ oldPath?: string; newPath?: string }> = [];
  for (let index = 0; index < fields.length; index += 1) {
    let status = "";
    let path = "";
    const tab = fields[index].indexOf("\t");
    if (tab >= 0) {
      status = fields[index].slice(0, tab);
      path = fields[index].slice(tab + 1);
    } else {
      status = fields[index];
      path = fields[index + 1] ?? "";
      index += 1;
    }

    const kind = status.charAt(0);
    if (kind === "R" || kind === "C") {
      const newPath = fields[index + 1] ?? "";
      index += 1;
      changes.push({ oldPath: path, newPath });
    } else if (kind === "A") {
      changes.push({ newPath: path });
    } else if (kind === "D") {
      changes.push({ oldPath: path });
    } else {
      changes.push({ oldPath: path, newPath: path });
    }
  }
  return changes.filter((change) => change.oldPath || change.newPath);
}

async function readGitFile(root: string, path: string, signal?: AbortSignal): Promise<string> {
  const result = await runCommand("git", ["show", `HEAD:${path}`], root, signal, 30_000);
  return result.code === 0 ? result.stdout : "";
}

async function readWorkingTreeFile(root: string, path: string): Promise<string> {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch {
    return "";
  }
}

async function readReviewIfExists(reviewPath: string): Promise<ReviewJson | undefined> {
  try {
    return JSON.parse(await readFile(reviewPath, "utf8")) as ReviewJson;
  } catch {
    return undefined;
  }
}

async function writeReviewApp(appDir: string, payload: ReviewPayload, review: ReviewJson) {
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, "payload.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(join(appDir, "review.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8");
}

async function startReviewServer(
  appDir: string,
  signal?: AbortSignal,
  detached = true,
): Promise<ReviewServerInfo> {
  const cliPath = await resolveCliPath();
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", [cliPath, "serve", "--app-dir", appDir], {
      cwd: appDir,
      env: { ...process.env },
      detached,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      cleanup();
      if (child.pid) killReviewServerPid(child.pid, "SIGTERM");
      else child.kill();
      rejectPromise(new Error("Timed out while starting LGTM review server."));
    }, 20_000);

    let stderr = "";
    let settled = false;

    const abort = () => {
      cleanup();
      if (child.pid) killReviewServerPid(child.pid, "SIGTERM");
      else child.kill();
      rejectPromise(new Error("Cancelled while starting LGTM review server."));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
    };

    const finish = async (url: string) => {
      if (settled) return;
      const pid = child.pid;
      if (!pid) {
        settled = true;
        cleanup();
        rejectPromise(new Error("LGTM review server started without a process ID."));
        return;
      }
      settled = true;
      cleanup();
      if (detached) {
        (child.stdout as unknown as { unref?: () => void } | undefined)?.unref?.();
        (child.stderr as unknown as { unref?: () => void } | undefined)?.unref?.();
        child.unref();
      }
      await writeFile(join(appDir, "server.pid"), `${pid}\n`, "utf8");
      resolvePromise({ url, pid });
    };

    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(/LGTM_REVIEW_URL=(\S+)/);
      if (match?.[1]) {
        void finish(match[1]);
      }
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(
        new Error(`LGTM review server exited with code ${code ?? "unknown"}.\n${stderr}`),
      );
    };

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("exit", onExit);
  });
}

async function resolveCliPath() {
  const modulePath = fileURLToPath(import.meta.url);
  if (modulePath.endsWith(`${sep}src${sep}platform${sep}review${sep}review-platform.ts`)) {
    return resolve(modulePath, "..", "..", "..", "interfaces", "cli", "cli.ts");
  }
  return modulePath;
}

export async function serveReviewApp(appDirInput: string): Promise<void> {
  const appDir = resolve(appDirInput);
  const payloadPath = join(appDir, "payload.json");
  const reviewPath = join(appDir, "review.json");
  const payload = await readJsonFile<ReviewPayload>(payloadPath);
  const preferencesPlatform = new LgtmPreferencesPlatformClass({ cwd: payload.cwd });
  const webRoot = await resolveWebRoot();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/api/payload" && request.method === "GET") {
        return await sendJsonFile(response, payloadPath);
      }

      if (url.pathname === "/api/review" && request.method === "GET") {
        return await sendJsonFile(response, reviewPath);
      }

      if (url.pathname === "/api/review" && request.method === "PUT") {
        const review = await readRequestJson<ReviewJson>(request);
        const nextReview = { ...review, updatedAt: new Date().toISOString() };
        await writeJsonFile(reviewPath, nextReview);
        return sendJson(response, 200, nextReview);
      }

      if (url.pathname === "/api/preferences" && request.method === "GET") {
        return sendJson(response, 200, await preferencesPlatform.read());
      }

      if (url.pathname === "/api/preferences" && request.method === "PUT") {
        const body = await readRequestJson<unknown>(request);
        let preferences;
        try {
          preferences = lgtmPreferences.parse({ value: body });
        } catch (error) {
          return sendJson(response, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return sendJson(response, 200, await preferencesPlatform.write({ preferences }));
      }

      if (url.pathname === "/api/finish" && request.method === "POST") {
        const body = await readRequestJson<{ decision?: unknown }>(request);
        if (body.decision !== "approved" && body.decision !== "changes_requested") {
          return sendJson(response, 400, { error: "Invalid review decision." });
        }
        const review = await readJsonFile<ReviewJson>(reviewPath);
        const now = new Date().toISOString();
        const nextReview = {
          ...review,
          status: body.decision,
          updatedAt: now,
          finishedAt: now,
        };
        await writeJsonFile(reviewPath, nextReview);
        sendJson(response, 200, nextReview);
        setTimeout(() => process.exit(0), 300);
        return;
      }

      if (url.pathname === "/api/cancel" && request.method === "POST") {
        const review = await readJsonFile<ReviewJson>(reviewPath);
        const now = new Date().toISOString();
        const nextReview = {
          ...review,
          status: "canceled" as const,
          updatedAt: now,
          finishedAt: now,
          files: review.files.map((file) => ({ ...file, comments: [] })),
          documentComments: [],
        };
        await writeJsonFile(reviewPath, nextReview);
        sendJson(response, 200, nextReview);
        setTimeout(() => process.exit(0), 300);
        return;
      }

      if (url.pathname === "/health" && request.method === "GET") {
        return sendJson(response, 200, { ok: true });
      }

      if (request.method === "GET") {
        return await sendStaticFile(response, webRoot, url.pathname);
      }

      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPromise(new Error("LGTM review server did not receive a TCP port."));
        return;
      }
      console.log(`LGTM_REVIEW_URL=http://localhost:${address.port}/`);
      resolvePromise();
    });
  });
}

async function resolveWebRoot() {
  const modulePath = fileURLToPath(import.meta.url);
  const candidates = [
    process.env.LGTM_WEB_ROOT,
    resolve(modulePath, "..", "..", "..", "interfaces", "web"),
    resolve(modulePath, "..", "..", "dist", "web"),
    resolve(modulePath, "..", "..", "..", "..", "dist", "web"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await stat(join(candidate, "index.html"));
      return candidate;
    } catch {
      // Try the next build location.
    }
  }
  throw new Error("The LGTM frontend build is missing. Run `vp build` first.");
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJsonFile(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readRequestJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 10 * 1024 * 1024) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

async function sendJsonFile(response: ServerResponse, path: string) {
  const body = await readFile(path);
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

async function sendStaticFile(response: ServerResponse, webRoot: string, pathname: string) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(webRoot, relativePath);
  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${sep}`)) {
    return sendJson(response, 404, { error: "Not found." });
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypeForPath(filePath),
      "content-length": body.length,
      "cache-control":
        relativePath === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

function contentTypeForPath(path: string) {
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
  };
  return contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function writeReviewServerState(state: ReviewServerState) {
  await writeFile(join(state.appDir, "server.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readReviewServerState(appDir: string): Promise<ReviewServerState | undefined> {
  try {
    const state = JSON.parse(
      await readFile(join(appDir, "server.json"), "utf8"),
    ) as ReviewServerState;
    if (
      Number.isInteger(state.pid) &&
      typeof state.appDir === "string" &&
      resolve(state.appDir) === resolve(appDir)
    ) {
      return state;
    }
  } catch {
    // No server state.
  }
  return undefined;
}

async function stopActiveReviewServers(cwd: string) {
  const reviewRoot = `${join(resolve(cwd), ".lgtm")}${sep}`;
  const states = [...activeReviewServersByPath.values()].filter((state) =>
    state.appDir.startsWith(reviewRoot),
  );
  const stopped = await Promise.all(states.map((state) => stopReviewServerState(state)));
  return stopped.some(Boolean);
}

function startReviewFinishWatcher(
  cwd: string,
  pointer: ReviewPointer,
  onFinished: NonNullable<OpenReviewOptions["onFinished"]>,
) {
  stopReviewFinishWatcher(pointer.reviewPath);

  const interval = setInterval(async () => {
    let review: ReviewJson;
    try {
      review = JSON.parse(await readFile(pointer.reviewPath, "utf8")) as ReviewJson;
    } catch {
      return;
    }

    if (review.status === "open") return;
    stopReviewFinishWatcher(pointer.reviewPath);
    await reviewServerLifecycle
      .stopForReview({ review, reviewPath: pointer.reviewPath })
      .catch(() => false);
    await onFinished(review, formatReviewForModel(review, pointer.reviewPath));
  }, 1_000);

  (interval as unknown as { unref?: () => void }).unref?.();
  finishWatchersByReviewPath.set(pointer.reviewPath, interval);
}

function stopReviewFinishWatcher(reviewPath: string) {
  const interval = finishWatchersByReviewPath.get(reviewPath);
  if (!interval) return;
  clearInterval(interval);
  finishWatchersByReviewPath.delete(reviewPath);
}

function stopReviewFinishWatchers(cwd: string) {
  const reviewRoot = `${join(resolve(cwd), ".lgtm")}${sep}`;
  for (const reviewPath of finishWatchersByReviewPath.keys()) {
    if (reviewPath.startsWith(reviewRoot)) stopReviewFinishWatcher(reviewPath);
  }
}

async function stopReviewServerState(
  state: ReviewServerState,
  reviewPath = join(state.appDir, "review.json"),
) {
  abortCleanupByReviewPath.get(reviewPath)?.();
  abortCleanupByReviewPath.delete(reviewPath);
  const stopped = await stopReviewServerProcess(state);
  cleanupReviewServersByPath.delete(reviewPath);
  activeReviewServersByPath.delete(reviewPath);
  if (stopped) stopReviewFinishWatcher(reviewPath);
  return stopped;
}

export async function stopReview(cwd: string, reviewPath: string) {
  const review = await readReviewIfExists(reviewPath);
  if (!review) return false;
  stopReviewFinishWatcher(reviewPath);
  return await reviewServerLifecycle.stopForReview({ review, reviewPath });
}

async function readReviewServerPid(appDir: string) {
  try {
    return parseServerPid(await readFile(join(appDir, "server.pid"), "utf8"));
  } catch {
    return undefined;
  }
}

function parseServerPid(value: string) {
  const pid = Number.parseInt(value.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function stopReviewServerProcess(state: ReviewServerState) {
  if (!(await isLikelyReviewServerProcess(state.pid))) return false;
  killReviewServerPid(state.pid, "SIGTERM");
  if (await waitForProcessExit(state.pid, 1_500)) return true;
  killReviewServerPid(state.pid, "SIGKILL");
  return await waitForProcessExit(state.pid, 1_000);
}

async function isLikelyReviewServerProcess(pid: number) {
  if (!isProcessRunning(pid)) return false;
  if (process.platform === "win32") return true;

  try {
    const result = await runCommand(
      "ps",
      ["-p", String(pid), "-o", "command="],
      process.cwd(),
      undefined,
      5_000,
    );
    const command = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return (
      result.code === 0 &&
      command.includes("node") &&
      command.includes("serve") &&
      command.includes("--app-dir")
    );
  } catch {
    return false;
  }
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killReviewServerPid(pid: number, signal: NodeJS.Signals) {
  try {
    if (process.platform === "win32") {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already stopped.
    }
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return !isProcessRunning(pid);
}

function registerProcessCleanup() {
  if (processCleanupRegistered) return;
  processCleanupRegistered = true;
  process.once("exit", () => {
    for (const state of cleanupReviewServersByPath.values()) {
      killReviewServerPid(state.pid, "SIGTERM");
    }
  });
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const abort = () => {
      child.kill();
      rejectPromise(new Error(`${command} cancelled.`));
    };

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      rejectPromise(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolvePromise({ stdout, stderr, code });
    });
  });
}

function openInDefaultBrowser(target: string) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export type FinishReviewResult =
  | { found: false }
  | {
      found: true;
      reviewPath: string;
      review: ReviewJson;
      stoppedServer: boolean;
      formattedReview: string;
    };

export type WaitForReviewOptions = {
  cwd: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  stopServer?: boolean;
};

export type CompletedReview = {
  reviewPath: string;
  review: ReviewJson & { status: ReviewOutcome };
  stoppedServer: boolean;
  formattedReview: string;
};

/**
 * Wait for the browser checkpoint to reach a terminal decision. This is the
 * lifecycle used by synchronous agent protocols such as MCP: the tool call
 * remains pending until the human approves, requests changes, or cancels.
 */
export async function waitForReview(
  pointer: ReviewPointer,
  options: WaitForReviewOptions,
): Promise<CompletedReview> {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 10) {
    throw new Error("pollIntervalMs must be at least 10 milliseconds.");
  }

  try {
    while (true) {
      throwIfAborted(options.signal);
      const review = await readReviewIfExists(pointer.reviewPath);
      if (review && review.status !== "open") {
        stopReviewFinishWatcher(pointer.reviewPath);
        const stoppedServer =
          options.stopServer === false
            ? false
            : await reviewServerLifecycle.stopForReview({ review, reviewPath: pointer.reviewPath });
        return {
          reviewPath: pointer.reviewPath,
          review: review as ReviewJson & { status: ReviewOutcome },
          stoppedServer,
          formattedReview: formatReviewForModel(review, pointer.reviewPath),
        };
      }
      await abortableDelay(pollIntervalMs, options.signal);
    }
  } catch (error) {
    if (options.signal?.aborted && options.stopServer !== false) {
      await stopReview(options.cwd, pointer.reviewPath).catch(() => false);
    }
    throw error;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The review was canceled.", "AbortError");
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(finish, milliseconds);
    const abort = () => {
      cleanup();
      rejectPromise(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("The review was canceled.", "AbortError"),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    function finish() {
      cleanup();
      resolvePromise();
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function finishReview(
  cwd: string,
  reviewPathInput: string,
): Promise<FinishReviewResult> {
  const resolvedCwd = resolve(cwd);
  const reviewPath = resolve(resolvedCwd, reviewPathInput);
  const review = await readReviewIfExists(reviewPath);
  if (!review) return { found: false };
  stopReviewFinishWatcher(reviewPath);
  const stoppedServer = await reviewServerLifecycle.stopForReview({ review, reviewPath });
  return {
    found: true,
    reviewPath,
    review,
    stoppedServer,
    formattedReview: formatReviewForModel(review, reviewPath),
  };
}

export async function stopReviews(cwd: string) {
  const resolvedCwd = resolve(cwd);
  stopReviewFinishWatchers(resolvedCwd);
  return await stopActiveReviewServers(resolvedCwd);
}

export function formatReviewForModel(review: ReviewJson, reviewPath: string): string {
  return reviewFormatter.format({ review, reviewPath });
}
