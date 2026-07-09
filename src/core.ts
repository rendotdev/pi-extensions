import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import process from "node:process";

export type DiffReviewFileInput = {
  location: string;
  oldContent: string;
  newContent: string;
};

export type ReviewPointer = {
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  appDir: string;
  url: string;
  reviewPath: string;
};

type ReviewSourceFile = {
  id: string;
  location: string;
  language: string;
  oldContent: string;
  newContent: string;
  added: number;
  removed: number;
};

export type DocumentSource = {
  location?: string;
  markdown: string;
};

type DocumentComment = {
  id: string;
  selectedText: string;
  startBlockId: string;
  endBlockId: string;
  startLine: number;
  endLine: number;
  prefix: string;
  suffix: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

type ReviewComment = {
  id: string;
  fileLocation: string;
  selectedRowIds: string[];
  selectedText: string;
  side: "additions" | "deletions";
  selectedRange: {
    start: number;
    end: number;
    side?: "additions" | "deletions";
    endSide?: "additions" | "deletions";
  };
  startLine: number | null;
  endLine: number | null;
  lineNumbers: number[];
  comment: string;
  createdAt: string;
  updatedAt: string;
};

type ReviewFile = {
  location: string;
  added: number;
  removed: number;
  comments: ReviewComment[];
};

export type ReviewStatus = "open" | "approved" | "changes_requested";

export type ReviewJson = {
  version: 2;
  kind: "diff" | "document";
  status: ReviewStatus;
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  sessionUUID?: string;
  cwd: string;
  appDir: string;
  url?: string;
  htmlPath?: string;
  reviewPath: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  files: ReviewFile[];
  document?: DocumentSource;
  documentComments: DocumentComment[];
};

export type ReviewPayload = {
  kind: "diff" | "document";
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  cwd: string;
  appDir: string;
  reviewPath: string;
  generatedAt: string;
  files: ReviewSourceFile[];
  document?: DocumentSource;
};

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

const lastReviewByCwd = new Map<string, ReviewPointer>();
const activeReviewServersByCwd = new Map<string, ReviewServerState>();
const finishWatchersByReviewPath = new Map<string, ReturnType<typeof setInterval>>();
let processCleanupRegistered = false;

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || randomUUID();
}

export type OpenReviewInput = {
  kind: "diff" | "document";
  name: string;
  files?: DiffReviewFileInput[];
  document?: DocumentSource;
};

export type OpenReviewOptions = {
  cwd: string;
  sessionId?: string;
  signal?: AbortSignal;
  cleanupOnExit?: boolean;
  onUpdate?: (message: string) => void;
  onFinished?: (review: ReviewJson, formattedReview: string) => void | Promise<void>;
};

export async function openReview(
  input: OpenReviewInput,
  options: OpenReviewOptions,
): Promise<ReviewPointer> {
  const cwd = resolve(options.cwd);
  const sessionId = sanitizePathSegment(options.sessionId ?? `cli-${process.pid}`);
  const reviewUUID = randomUUID();
  const reviewId = `${sessionId}-${reviewUUID}`;
  const appDir = resolve(cwd, ".lgtm", reviewId);
  const reviewPath = join(appDir, "review.json");
  const generatedAt = new Date().toISOString();
  const files = (input.files ?? []).map((file, index) => buildReviewSourceFile(file, index));

  options.onUpdate?.("Stopping any previous LGTM review server...");
  await stopActiveReviewServer(cwd);
  await mkdir(appDir, { recursive: true });

  const review = buildReviewJson({
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

  options.onUpdate?.("Installing LGTM review app dependencies with Bun...");
  await ensureReviewAppDependencies(appDir, options.signal);

  options.onUpdate?.("Starting LGTM Bun review server...");
  const server = await startReviewServer(appDir, options.signal);
  const url = server.url;
  await writeFile(
    reviewPath,
    `${JSON.stringify({ ...review, url, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );

  const serverState: ReviewServerState = {
    ...server,
    appDir,
    reviewId,
    startedAt: new Date().toISOString(),
  };
  await writeReviewServerState(cwd, serverState);
  activeReviewServersByCwd.set(cwd, serverState);
  if (options.cleanupOnExit) registerProcessCleanup();

  const pointer: ReviewPointer = {
    name: input.name,
    sessionId: sessionId,
    reviewUUID,
    reviewId,
    appDir,
    url,
    reviewPath,
  };
  lastReviewByCwd.set(cwd, pointer);
  if (options.onFinished) startReviewFinishWatcher(cwd, pointer, options.onFinished);
  openInDefaultBrowser(url);
  return pointer;
}

function buildReviewSourceFile(file: DiffReviewFileInput, index: number): ReviewSourceFile {
  const counts = countChangedLines(file.oldContent, file.newContent);
  return {
    id: `file-${index}`,
    location: file.location,
    language: languageFromPath(file.location),
    oldContent: file.oldContent,
    newContent: file.newContent,
    added: counts.added,
    removed: counts.removed,
  };
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

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function countChangedLines(oldText: string, newText: string): { added: number; removed: number } {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const cellCount = (oldLines.length + 1) * (newLines.length + 1);
  if (cellCount > 2_000_000) {
    return { added: newLines.length, removed: oldLines.length };
  }

  const width = newLines.length + 1;
  const matrix = new Uint32Array(cellCount);
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) {
        matrix[i * width + j] = matrix[(i + 1) * width + j + 1] + 1;
      } else {
        matrix[i * width + j] = Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
      }
    }
  }

  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      i += 1;
      j += 1;
    } else if (matrix[(i + 1) * width + j] >= matrix[i * width + j + 1]) {
      removed += 1;
      i += 1;
    } else {
      added += 1;
      j += 1;
    }
  }
  removed += oldLines.length - i;
  added += newLines.length - j;
  return { added, removed };
}

function languageFromPath(location: string): string {
  const ext = extname(location).toLowerCase();
  const map: Record<string, string> = {
    ".astro": "astro",
    ".bash": "bash",
    ".c": "c",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".css": "css",
    ".diff": "diff",
    ".go": "go",
    ".graphql": "graphql",
    ".h": "c",
    ".html": "html",
    ".java": "java",
    ".js": "javascript",
    ".json": "json",
    ".jsx": "jsx",
    ".kt": "kotlin",
    ".lua": "lua",
    ".md": "markdown",
    ".mdx": "mdx",
    ".php": "php",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".scss": "scss",
    ".sh": "bash",
    ".svelte": "svelte",
    ".toml": "toml",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".vue": "vue",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".zsh": "bash",
  };
  return map[ext] ?? "plaintext";
}

async function readReviewIfExists(reviewPath: string): Promise<ReviewJson | undefined> {
  try {
    return JSON.parse(await readFile(reviewPath, "utf8")) as ReviewJson;
  } catch {
    return undefined;
  }
}

function buildReviewJson(input: {
  kind: "diff" | "document";
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  cwd: string;
  appDir: string;
  reviewPath: string;
  generatedAt: string;
  files: ReviewSourceFile[];
  document?: DocumentSource;
  existingReview?: ReviewJson;
}): ReviewJson {
  const existingByLocation = new Map<string, ReviewFile>();
  for (const file of input.existingReview?.files ?? []) {
    existingByLocation.set(file.location, file);
  }

  return {
    version: 2,
    kind: input.kind,
    status: "open",
    name: input.name,
    sessionId: input.sessionId,
    reviewUUID: input.reviewUUID,
    reviewId: input.reviewId,
    cwd: input.cwd,
    appDir: input.appDir,
    reviewPath: input.reviewPath,
    createdAt: input.existingReview?.createdAt ?? input.generatedAt,
    updatedAt: input.generatedAt,
    files: input.files.map((file) => ({
      location: file.location,
      added: file.added,
      removed: file.removed,
      comments: existingByLocation.get(file.location)?.comments ?? [],
    })),
    document: input.document,
    documentComments: input.existingReview?.documentComments ?? [],
  };
}

async function writeReviewApp(appDir: string, payload: ReviewPayload, review: ReviewJson) {
  await mkdir(join(appDir, "src"), { recursive: true });
  await writeFile(
    join(appDir, "package.json"),
    `${JSON.stringify(buildReviewPackageJson(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(appDir, "payload.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(join(appDir, "review.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8");
  await writeFile(join(appDir, "server.ts"), buildReviewServerSource(), "utf8");
  await writeFile(join(appDir, "src", "main.tsx"), buildReviewClientSource(), "utf8");
  await writeFile(join(appDir, "src", "styles.css"), buildReviewStylesSource(), "utf8");
}

function buildReviewPackageJson() {
  return {
    private: true,
    type: "module",
    scripts: {
      dev: "bun server.ts",
    },
    dependencies: {
      "@heroui/react": "^3.2.2",
      "@heroui/styles": "^3.2.2",
      "@pierre/diffs": "^1.2.12",
      "@tailwindcss/cli": "^4.3.2",
      "@tailwindcss/typography": "^0.5.19",
      "@tanstack/react-form": "^1.33.1",
      geist: "^1.7.2",
      "lucide-react": "^1.23.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      "react-markdown": "^10.1.0",
      "remark-gfm": "^4.0.1",
      tailwindcss: "^4.3.2",
    },
    devDependencies: {},
  };
}

async function ensureReviewAppDependencies(appDir: string, signal?: AbortSignal) {
  try {
    await stat(join(appDir, "node_modules", "@heroui", "react"));
    await stat(join(appDir, "node_modules", "@pierre", "diffs"));
    await stat(join(appDir, "node_modules", "@tailwindcss", "cli"));
    await stat(join(appDir, "node_modules", "@tailwindcss", "typography"));
    await stat(join(appDir, "node_modules", "@tanstack", "react-form"));
    await stat(join(appDir, "node_modules", "geist"));
    await stat(join(appDir, "node_modules", "lucide-react"));
    await stat(join(appDir, "node_modules", "react"));
    await stat(join(appDir, "node_modules", "react-markdown"));
    await stat(join(appDir, "node_modules", "remark-gfm"));
    await stat(join(appDir, "node_modules", "tailwindcss"));
    return;
  } catch {
    // Install below.
  }

  const result = await runCommand("bun", ["install", "--silent"], appDir, signal, 120_000);
  if (result.code !== 0) {
    throw new Error(
      `bun install failed with code ${result.code ?? "unknown"}\n${result.stderr || result.stdout}`,
    );
  }
}

function startReviewServer(appDir: string, signal?: AbortSignal): Promise<ReviewServerInfo> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["server.ts"], {
      cwd: appDir,
      env: { ...process.env, PORT: "0" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      cleanup();
      if (child.pid) killReviewServerPid(child.pid, "SIGTERM");
      else child.kill();
      rejectPromise(new Error("Timed out while starting Bun review server."));
    }, 20_000);

    let stderr = "";
    let settled = false;

    const abort = () => {
      cleanup();
      if (child.pid) killReviewServerPid(child.pid, "SIGTERM");
      else child.kill();
      rejectPromise(new Error("Cancelled while starting Bun review server."));
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
        rejectPromise(new Error("Bun review server started without a process ID."));
        return;
      }
      settled = true;
      cleanup();
      (child.stdout as unknown as { unref?: () => void } | undefined)?.unref?.();
      (child.stderr as unknown as { unref?: () => void } | undefined)?.unref?.();
      child.unref();
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
        new Error(`Bun review server exited with code ${code ?? "unknown"}.\n${stderr}`),
      );
    };

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("exit", onExit);
  });
}

function getActiveReviewServerPath(cwd: string) {
  return join(cwd, ".lgtm", "active-server.json");
}

async function writeReviewServerState(cwd: string, state: ReviewServerState) {
  await mkdir(join(cwd, ".lgtm"), { recursive: true });
  await writeFile(getActiveReviewServerPath(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(join(state.appDir, "server.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readReviewServerState(cwd: string): Promise<ReviewServerState | undefined> {
  try {
    const state = JSON.parse(
      await readFile(getActiveReviewServerPath(cwd), "utf8"),
    ) as ReviewServerState;
    if (Number.isInteger(state.pid) && typeof state.appDir === "string") return state;
  } catch {
    // No active server state.
  }
  return undefined;
}

async function stopActiveReviewServer(cwd: string) {
  const state = activeReviewServersByCwd.get(cwd) ?? (await readReviewServerState(cwd));
  let stopped = false;
  if (state) {
    await stopReviewFinishWatcherForAppDir(state.appDir);
    stopped = await stopReviewServerProcess(state);
    activeReviewServersByCwd.delete(cwd);
    await unlink(getActiveReviewServerPath(cwd)).catch(() => undefined);
  }

  const staleStopped = await stopKnownReviewServers(cwd);
  return stopped || staleStopped;
}

async function stopKnownReviewServers(cwd: string) {
  const baseDir = join(cwd, ".lgtm");
  let stopped = false;
  let entries;
  try {
    entries = await readdir(baseDir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const appDir = join(baseDir, entry.name);
    const pid = await readReviewServerPid(appDir);
    if (!pid) continue;
    const review = await readReviewIfExists(join(appDir, "review.json"));
    if (review?.url && !(await isReviewServerUrlForApp(review.url, appDir))) continue;
    if (
      await stopReviewServerProcess({
        pid,
        url: review?.url ?? "",
        appDir,
        reviewId: review?.reviewId ?? entry.name,
        startedAt: review?.updatedAt ?? "",
      })
    ) {
      stopReviewFinishWatcher(review?.reviewPath ?? join(appDir, "review.json"));
      stopped = true;
    }
  }
  return stopped;
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
    await stopReviewServerForReview(cwd, review, pointer.reviewPath).catch(() => false);
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

async function stopReviewFinishWatcherForAppDir(appDir: string) {
  const reviewPath = join(appDir, "review.json");
  const review = await readReviewIfExists(reviewPath);
  stopReviewFinishWatcher(review?.reviewPath ?? reviewPath);
}

function stopAllReviewFinishWatchers() {
  for (const reviewPath of finishWatchersByReviewPath.keys()) {
    stopReviewFinishWatcher(reviewPath);
  }
}

async function stopReviewServerForReview(cwd: string, review: ReviewJson, reviewPath: string) {
  const activeState = activeReviewServersByCwd.get(cwd) ?? (await readReviewServerState(cwd));
  if (
    activeState &&
    (activeState.reviewId === review.reviewId || activeState.appDir === review.appDir)
  ) {
    return await stopActiveReviewServer(cwd);
  }

  const appDir = review.appDir || resolve(reviewPath, "..");
  const pid = await readReviewServerPid(appDir);
  if (!pid) return false;
  const stopped = await stopReviewServerProcess({
    pid,
    url: review.url ?? "",
    appDir,
    reviewId: review.reviewId,
    startedAt: review.updatedAt,
  });
  if (stopped) stopReviewFinishWatcher(review.reviewPath ?? reviewPath);
  return stopped;
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
    return result.code === 0 && command.includes("bun") && command.includes("server.ts");
  } catch {
    return false;
  }
}

async function isReviewServerUrlForApp(url: string, appDir: string) {
  try {
    const response = await fetch(new URL("/api/payload", url), {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { appDir?: unknown };
    return payload.appDir === appDir;
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
    for (const state of activeReviewServersByCwd.values()) {
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

export async function finishReview(cwd: string): Promise<FinishReviewResult> {
  const resolvedCwd = resolve(cwd);
  const reviewPath = await resolveReviewPath(resolvedCwd);
  if (!reviewPath) return { found: false };

  const review = JSON.parse(await readFile(reviewPath, "utf8")) as ReviewJson;
  stopReviewFinishWatcher(reviewPath);
  const stoppedServer = await stopReviewServerForReview(resolvedCwd, review, reviewPath);
  return {
    found: true,
    reviewPath,
    review,
    stoppedServer,
    formattedReview: formatReviewForModel(review, reviewPath),
  };
}

export async function stopReviews(cwd: string) {
  stopAllReviewFinishWatchers();
  return await stopActiveReviewServer(resolve(cwd));
}

async function resolveReviewPath(cwd: string): Promise<string | undefined> {
  const pointer = lastReviewByCwd.get(cwd);
  if (pointer) return pointer.reviewPath;

  return findLatestReviewPath(cwd);
}

async function findLatestReviewPath(cwd: string): Promise<string | undefined> {
  const baseDir = join(cwd, ".lgtm");
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    const candidates: Array<{ path: string; mtimeMs: number }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const reviewPath = join(baseDir, entry.name, "review.json");
      try {
        const info = await stat(reviewPath);
        candidates.push({ path: reviewPath, mtimeMs: info.mtimeMs });
      } catch {
        // Ignore folders without review.json.
      }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.path;
  } catch {
    return undefined;
  }
}

export function formatReviewForModel(review: ReviewJson, reviewPath: string): string {
  const lines: string[] = [];
  lines.push(`# ${review.kind === "document" ? "Document" : "Diff"} review: ${review.name}`);
  lines.push("");
  lines.push(`Review JSON: ${reviewPath}`);
  lines.push(`Session: ${review.sessionId ?? review.sessionUUID ?? "unknown"}`);
  lines.push(`Review ID: ${review.reviewId ?? review.sessionUUID ?? "unknown"}`);
  lines.push(`Review UUID: ${review.reviewUUID ?? "unknown"}`);
  lines.push(`Status: ${review.status ?? "open"}`);
  if (review.finishedAt) lines.push(`Finished: ${review.finishedAt}`);
  if (review.url) lines.push(`Review app URL: ${review.url}`);
  lines.push(`Updated: ${review.updatedAt}`);
  lines.push("");

  if (review.kind === "document") {
    if (review.document?.location) lines.push(`Document: ${review.document.location}`, "");
    const comments = review.documentComments.filter((comment) => comment.comment.trim().length > 0);
    for (const comment of comments) {
      const range =
        comment.startLine === comment.endLine
          ? `Line ${comment.startLine}`
          : `Lines ${comment.startLine}-${comment.endLine}`;
      lines.push(`## ${range}`);
      lines.push("");
      lines.push(`Selected text: ${truncateForReview(comment.selectedText.trim() || "(none)")}`);
      lines.push(`Comment: ${comment.comment.trim()}`);
      lines.push("");
    }
    if (comments.length === 0) lines.push("No written review comments were found.");
    return lines.join("\n");
  }

  let commentCount = 0;
  for (const file of review.files) {
    lines.push(`## ${file.location}`);
    lines.push(`Changes: +${file.added} -${file.removed}`);

    if (file.comments.length === 0) {
      lines.push("");
      lines.push("No comments for this file.");
      lines.push("");
      continue;
    }

    for (const comment of file.comments) {
      if (comment.comment.trim().length === 0) continue;
      commentCount += 1;
      const range = formatLineRange(comment);
      lines.push("");
      lines.push(`- ${range}`);
      lines.push(`  Selected text: ${truncateForReview(comment.selectedText.trim() || "(none)")}`);
      lines.push(`  Comment: ${comment.comment.trim()}`);
    }
    lines.push("");
  }

  if (commentCount === 0) {
    lines.push("No written review comments were found.");
  }

  return lines.join("\n");
}

function formatLineRange(comment: ReviewComment): string {
  const side = comment.side ? `${comment.side}, ` : "";
  if (comment.startLine === null || comment.endLine === null) return `${side}selected lines`;
  if (comment.startLine === comment.endLine) return `${side}line ${comment.startLine}`;
  return `${side}lines ${comment.startLine}-${comment.endLine}`;
}

function truncateForReview(value: string): string {
  if (value.length <= 2000) return value;
  return `${value.slice(0, 2000)}...`;
}

function buildReviewServerSource(): string {
  return String.raw`import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appDir = dirname(fileURLToPath(import.meta.url));
const payloadPath = join(appDir, "payload.json");
const reviewPath = join(appDir, "review.json");
let cachedBuild = null;

async function readJson(path) {
  return JSON.parse(await Bun.file(path).text());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function fontResponse(fontPath) {
  return new Response(Bun.file(fontPath), {
    headers: {
      "content-type": "font/woff2",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

async function writeReview(review) {
  const nextReview = { ...review, updatedAt: new Date().toISOString() };
  await Bun.write(reviewPath, JSON.stringify(nextReview, null, 2) + "\n");
  return nextReview;
}

async function finishReview(decision) {
  if (decision !== "approved" && decision !== "changes_requested") {
    throw new Error("Invalid review decision.");
  }
  const review = await readJson(reviewPath);
  const now = new Date().toISOString();
  const nextReview = await writeReview({ ...review, status: decision, finishedAt: now });
  setTimeout(() => process.exit(0), 300);
  return nextReview;
}

async function buildTailwindCSS() {
  const tailwindBin = join(appDir, "node_modules", ".bin", "tailwindcss");
  const proc = Bun.spawn([tailwindBin, "-i", join(appDir, "src", "styles.css"), "--minify"], {
    cwd: appDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(stderr || stdout || "Tailwind CSS build failed.");
  }
  return stdout;
}

async function buildClientAssets() {
  if (cachedBuild) return cachedBuild;
  const result = await Bun.build({
    entrypoints: [join(appDir, "src", "main.tsx")],
    target: "browser",
  });

  if (!result.success) {
    const logs = result.logs.map((log) => String(log)).join("\n");
    throw new Error(logs || "Bun client build failed.");
  }

  const js = result.outputs.find((output) => output.path.endsWith(".js"));
  cachedBuild = {
    js: js ? await js.text() : "",
    css: await buildTailwindCSS(),
  };
  return cachedBuild;
}

const server = Bun.serve({
  port: Number(process.env.PORT || "0"),
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      const payload = await readJson(payloadPath).catch(() => ({ name: "LGTM review" }));
      const pageTitle = escapeHtml("LGTM • " + (payload.name || "LGTM review"));
      const html = "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n  <title>" + pageTitle + "</title>\n  <link rel=\"stylesheet\" href=\"/client.css\" />\n</head>\n<body>\n  <main id=\"root\"></main>\n  <script type=\"module\" src=\"/client.js\"></script>\n</body>\n</html>";
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/fonts/geist-sans.woff2") {
      return fontResponse(join(appDir, "node_modules", "geist", "dist", "fonts", "geist-sans", "Geist-Variable.woff2"));
    }

    if (url.pathname === "/fonts/geist-mono.woff2") {
      return fontResponse(join(appDir, "node_modules", "geist", "dist", "fonts", "geist-mono", "GeistMono-Variable.woff2"));
    }

    if (url.pathname === "/client.js") {
      try {
        const assets = await buildClientAssets();
        return new Response(assets.js, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      } catch (error) {
        return new Response(String(error instanceof Error ? error.stack || error.message : error), { status: 500 });
      }
    }

    if (url.pathname === "/client.css") {
      try {
        const assets = await buildClientAssets();
        return new Response(assets.css, { headers: { "content-type": "text/css; charset=utf-8" } });
      } catch (error) {
        return new Response(String(error instanceof Error ? error.stack || error.message : error), { status: 500 });
      }
    }

    if (url.pathname === "/api/payload" && request.method === "GET") {
      return Response.json(await readJson(payloadPath));
    }

    if (url.pathname === "/api/review" && request.method === "GET") {
      return Response.json(await readJson(reviewPath));
    }

    if (url.pathname === "/api/review" && request.method === "PUT") {
      const review = await request.json();
      return Response.json(await writeReview(review));
    }

    if (url.pathname === "/api/finish" && request.method === "POST") {
      const body = await request.json();
      return Response.json(await finishReview(body.decision));
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log("LGTM_REVIEW_URL=" + server.url.href);
`;
}

function buildReviewStylesSource(): string {
  return String.raw`@import "tailwindcss";
@import "../node_modules/@heroui/styles/dist/heroui.min.css";
@plugin "@tailwindcss/typography";
@source "./main.tsx";

@font-face {
  font-family: "Geist";
  src: url("/fonts/geist-sans.woff2") format("woff2");
  font-display: swap;
  font-style: normal;
  font-weight: 100 900;
}

@font-face {
  font-family: "Geist Mono";
  src: url("/fonts/geist-mono.woff2") format("woff2");
  font-display: swap;
  font-style: normal;
  font-weight: 100 900;
}

:root {
  color-scheme: light;
  --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --default-font-family: var(--font-sans);
  --default-mono-font-family: var(--font-mono);
  --vercel-radius: 6px;
  --radius: 2px;
  --field-radius: var(--vercel-radius);
  --radius-xs: calc(var(--vercel-radius) / 3);
  --radius-xl: var(--vercel-radius);
  --radius-2xl: var(--vercel-radius);
  --radius-3xl: var(--vercel-radius);
  --radius-4xl: var(--vercel-radius);
  --background: #fff;
  --foreground: #000;
  --surface: #fff;
  --surface-foreground: #000;
  --surface-secondary: #fafafa;
  --surface-secondary-foreground: #000;
  --overlay: #fff;
  --overlay-foreground: #000;
  --muted: #666;
  --border: #e5e5e5;
  --default: #f5f5f5;
  --default-hover: #ebebeb;
  --default-foreground: #171717;
  --accent: #000;
  --accent-hover: #333;
  --accent-foreground: #fff;
  --accent-soft: #f5f5f5;
  --accent-soft-foreground: #000;
  --field-background: #fafafa;
  --field-foreground: #000;
  --input-group-bg: #fafafa;
  --input-group-bg-hover: #f5f5f5;
  --input-group-bg-focus: #fff;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
}

:where(.button, .card, .chip, .close-button, .input-group, .textarea) {
  border-radius: var(--vercel-radius) !important;
}

:where(.input-group__prefix) {
  border-radius: var(--vercel-radius) 0 0 var(--vercel-radius) !important;
}

:where(.input-group__suffix) {
  border-radius: 0 var(--vercel-radius) var(--vercel-radius) 0 !important;
}

.review-diff-surface {
  --review-radius: var(--vercel-radius);
  font-family: var(--font-mono);
}

.document-review-surface ::selection {
  background: #0070f3;
  color: #fff;
}

.document-review-block[data-annotated="true"] {
  background: rgb(0 112 243 / 10%);
}
`;
}

function buildReviewClientSource(): string {
  return String.raw`import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Card, Chip, CloseButton, Disclosure, DisclosureGroup, InputGroup, Spinner, TextArea, Typography } from "@heroui/react";
import { Check, Copy as CopyIcon, X } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { MultiFileDiff, type DiffLineAnnotation, type SelectedLineRange } from "@pierre/diffs/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type ReviewSourceFile = {
  id: string;
  location: string;
  language: string;
  oldContent: string;
  newContent: string;
  added: number;
  removed: number;
};

type ReviewComment = {
  id: string;
  fileLocation: string;
  selectedRowIds: string[];
  selectedText: string;
  side: "additions" | "deletions";
  selectedRange: SelectedLineRange;
  startLine: number | null;
  endLine: number | null;
  lineNumbers: number[];
  comment: string;
  createdAt: string;
  updatedAt: string;
};

type ReviewFile = {
  location: string;
  added: number;
  removed: number;
  comments: ReviewComment[];
};

type DocumentSource = {
  location?: string;
  markdown: string;
};

type DocumentComment = {
  id: string;
  selectedText: string;
  startBlockId: string;
  endBlockId: string;
  startLine: number;
  endLine: number;
  prefix: string;
  suffix: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

type ReviewStatus = "open" | "approved" | "changes_requested";

type ReviewJson = {
  version: 2;
  kind: "diff" | "document";
  status: ReviewStatus;
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  cwd: string;
  appDir: string;
  url?: string;
  reviewPath: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  files: ReviewFile[];
  document?: DocumentSource;
  documentComments: DocumentComment[];
};

type ReviewPayload = {
  kind: "diff" | "document";
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  cwd: string;
  appDir: string;
  reviewPath: string;
  generatedAt: string;
  files: ReviewSourceFile[];
  document?: DocumentSource;
};

type AppState = {
  payload: ReviewPayload;
  review: ReviewJson;
};

type CommentAnnotationMetadata = {
  commentId: string;
};

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return "comment-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

async function loadState(): Promise<AppState> {
  const [payloadResponse, reviewResponse] = await Promise.all([
    fetch("/api/payload"),
    fetch("/api/review"),
  ]);
  if (!payloadResponse.ok) throw new Error("Failed to load payload.");
  if (!reviewResponse.ok) throw new Error("Failed to load review.");
  const payload = await payloadResponse.json() as ReviewPayload;
  const review = await reviewResponse.json() as ReviewJson;
  return { payload, review };
}

async function saveReview(review: ReviewJson): Promise<ReviewJson> {
  const response = await fetch("/api/review", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(review),
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ReviewJson;
}

function reviewCommentCount(review: ReviewJson) {
  if (review.kind === "document") {
    return review.documentComments.filter((comment) => comment.comment.trim().length > 0).length;
  }
  return review.files.reduce((total, file) => total + file.comments.filter((comment) => comment.comment.trim().length > 0).length, 0);
}

function reviewFilesWithWrittenComments(review: ReviewJson) {
  return review.files.map((file) => ({
    ...file,
    comments: file.comments.filter((comment) => comment.comment.trim().length > 0),
  }));
}

function meaningfulReviewSignature(review: ReviewJson) {
  if (review.kind === "document") {
    return JSON.stringify(review.documentComments.filter((comment) => comment.comment.trim().length > 0).map((comment) => ({
      id: comment.id,
      selectedText: comment.selectedText,
      startBlockId: comment.startBlockId,
      endBlockId: comment.endBlockId,
      startLine: comment.startLine,
      endLine: comment.endLine,
      prefix: comment.prefix,
      suffix: comment.suffix,
      comment: comment.comment,
      createdAt: comment.createdAt,
    })));
  }
  return JSON.stringify(reviewFilesWithWrittenComments(review).map((file) => ({
    location: file.location,
    comments: file.comments.map((comment) => ({
      id: comment.id,
      fileLocation: comment.fileLocation,
      selectedRowIds: comment.selectedRowIds,
      selectedText: comment.selectedText,
      side: comment.side,
      selectedRange: comment.selectedRange,
      startLine: comment.startLine,
      endLine: comment.endLine,
      lineNumbers: comment.lineNumbers,
      comment: comment.comment,
      createdAt: comment.createdAt,
    })),
  })));
}

function reviewForSave(review: ReviewJson): ReviewJson {
  if (review.kind === "document") {
    return {
      ...review,
      documentComments: review.documentComments.filter((comment) => comment.comment.trim().length > 0),
    };
  }
  return {
    ...review,
    files: reviewFilesWithWrittenComments(review),
  };
}

function updateReviewFile(review: ReviewJson, fileLocation: string, updater: (file: ReviewFile) => ReviewFile): ReviewJson {
  let changed = false;
  const files = review.files.map((file) => {
    if (file.location !== fileLocation) return file;
    const nextFile = updater(file);
    if (nextFile !== file) changed = true;
    return nextFile;
  });

  if (!changed) return review;
  return {
    ...review,
    updatedAt: new Date().toISOString(),
    files,
  };
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [copiedReviewPath, setCopiedReviewPath] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const saveRun = useRef(0);
  const lastSavedSignature = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadState().then((nextState) => {
      if (cancelled) return;
      lastSavedSignature.current = meaningfulReviewSignature(nextState.review);
      setState(nextState);
    }).catch((loadError) => {
      if (cancelled) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => { cancelled = true; };
  }, []);

  function queueSave(review: ReviewJson) {
    const signature = meaningfulReviewSignature(review);
    if (signature === lastSavedSignature.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setIsSaving(true);
    const run = saveRun.current + 1;
    saveRun.current = run;
    saveTimer.current = window.setTimeout(async () => {
      try {
        await saveReview(reviewForSave(review));
        if (run !== saveRun.current) return;
        lastSavedSignature.current = signature;
        setLastSavedAt(new Date());
        setError(null);
      } catch (saveError) {
        if (run !== saveRun.current) return;
        setError(saveError instanceof Error ? saveError.message : String(saveError));
      } finally {
        if (run === saveRun.current) setIsSaving(false);
      }
    }, 250);
  }

  function commitReview(updater: (review: ReviewJson) => ReviewJson) {
    setState((current) => {
      if (!current) return current;
      const nextReview = updater(current.review);
      if (nextReview === current.review) return current;
      queueSave(nextReview);
      return { ...current, review: nextReview };
    });
  }

  function addComment(file: ReviewSourceFile, selectedRange: SelectedLineRange, selectedTextOverride?: string) {
    const side = selectedRange.endSide || selectedRange.side || "additions";
    const startLine = Math.min(selectedRange.start, selectedRange.end);
    const endLine = Math.max(selectedRange.start, selectedRange.end);
    const lineNumbers = Array.from({ length: endLine - startLine + 1 }, (_, index) => startLine + index);
    const selectedText = selectedTextOverride?.trim() ? selectedTextOverride : getSelectedText(file, side, startLine, endLine);
    const now = new Date().toISOString();
    const comment: ReviewComment = {
      id: makeId(),
      fileLocation: file.location,
      selectedRowIds: [side + ":" + startLine + "-" + endLine],
      selectedText,
      side,
      selectedRange,
      startLine,
      endLine,
      lineNumbers,
      comment: "",
      createdAt: now,
      updatedAt: now,
    };

    commitReview((review) => updateReviewFile(review, file.location, (reviewFile) => ({
      ...reviewFile,
      comments: [...reviewFile.comments, comment],
    })));
    setActiveCommentId(comment.id);
  }

  function updateComment(fileLocation: string, commentId: string, patch: Partial<ReviewComment>) {
    commitReview((review) => updateReviewFile(review, fileLocation, (reviewFile) => {
      let changed = false;
      const comments = reviewFile.comments.map((comment) => {
        if (comment.id !== commentId) return comment;
        const nextComment = { ...comment, ...patch, updatedAt: new Date().toISOString() };
        const hasChanged = JSON.stringify({ ...comment, updatedAt: undefined }) !== JSON.stringify({ ...nextComment, updatedAt: undefined });
        if (!hasChanged) return comment;
        changed = true;
        return nextComment;
      });
      return changed ? { ...reviewFile, comments } : reviewFile;
    }));
  }

  function deleteComment(fileLocation: string, commentId: string) {
    commitReview((review) => updateReviewFile(review, fileLocation, (reviewFile) => {
      const comments = reviewFile.comments.filter((comment) => comment.id !== commentId);
      return comments.length === reviewFile.comments.length ? reviewFile : { ...reviewFile, comments };
    }));
  }

  function addDocumentComment(comment: DocumentComment) {
    commitReview((review) => ({
      ...review,
      updatedAt: new Date().toISOString(),
      documentComments: [...review.documentComments, comment],
    }));
    setActiveCommentId(comment.id);
  }

  function updateDocumentComment(commentId: string, patch: Partial<DocumentComment>) {
    commitReview((review) => {
      let changed = false;
      const documentComments = review.documentComments.map((comment) => {
        if (comment.id !== commentId) return comment;
        const nextComment = { ...comment, ...patch, updatedAt: new Date().toISOString() };
        const hasChanged = JSON.stringify({ ...comment, updatedAt: undefined }) !== JSON.stringify({ ...nextComment, updatedAt: undefined });
        if (!hasChanged) return comment;
        changed = true;
        return nextComment;
      });
      return changed ? { ...review, updatedAt: new Date().toISOString(), documentComments } : review;
    });
  }

  function deleteDocumentComment(commentId: string) {
    commitReview((review) => {
      const documentComments = review.documentComments.filter((comment) => comment.id !== commentId);
      return documentComments.length === review.documentComments.length
        ? review
        : { ...review, updatedAt: new Date().toISOString(), documentComments };
    });
  }

  async function copyReviewPath() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.payload.reviewPath);
      setCopiedReviewPath(true);
      window.setTimeout(() => setCopiedReviewPath(false), 1200);
    } catch {
      setCopiedReviewPath(false);
    }
  }

  async function finishReview(decision: "approved" | "changes_requested") {
    if (!state || isFinishing || isSaving) return;
    if (decision === "changes_requested" && reviewCommentCount(state.review) === 0) return;
    setIsFinishing(true);
    try {
      const response = await fetch("/api/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error(await response.text());
      const finishedReview = await response.json() as ReviewJson;
      setState((current) => current ? { ...current, review: finishedReview } : current);
      window.setTimeout(() => {
        window.close();
        const heading = decision === "approved" ? "LGTM" : "Comments sent";
        document.body.innerHTML = '<main style="font-family: system-ui, sans-serif; padding: 2rem; color: #111827;"><h1>' + heading + '</h1><p>You can close this tab.</p></main>';
      }, 250);
    } catch (finishError) {
      setIsFinishing(false);
      setError(finishError instanceof Error ? finishError.message : String(finishError));
    }
  }

  if (!state) {
    return <div className="flex min-h-screen items-center justify-center text-slate-700">
      <Spinner />
      <Typography.Paragraph size="sm" color="muted" className="ml-3">Loading review app...</Typography.Paragraph>
    </div>;
  }

  const { payload, review } = state;
  const commentCount = reviewCommentCount(review);
  const isFinished = review.status !== "open";
  const commentLabel = commentCount + " " + (commentCount === 1 ? "comment" : "comments");
  const decision = commentCount > 0 ? "changes_requested" : "approved";
  const decisionButtonLabel = isFinishing ? (commentCount > 0 ? "Sending" : "Approving") : isSaving ? "Saving" : commentCount > 0 ? "Send " + commentLabel : "LGTM";
  const savedTime = lastSavedAt ? lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  return <div className="min-h-screen">
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 md:max-w-[50%] md:flex-1">
          <Typography.Heading level={1} truncate className="text-lg font-semibold leading-6 text-slate-950">{payload.name}</Typography.Heading>
          <InputGroup fullWidth variant="secondary" aria-label="Review JSON path" className="mt-3 min-w-0 bg-slate-50 shadow-none">
            <InputGroup.Input
              readOnly
              value={payload.reviewPath}
              className="font-mono text-xs text-slate-600"
              onFocus={(event) => event.currentTarget.select()}
            />
            <InputGroup.Suffix className="px-1">
              <Button size="sm" variant="bordered" className="h-7 min-w-0 px-2 font-normal" onClick={copyReviewPath} title="Copy review JSON path">
                {copiedReviewPath ? <Check size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" /> : <CopyIcon size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />}
                <Typography type="body-xs" elementType="span" weight="normal" className="leading-none">{copiedReviewPath ? "Copied" : "Copy"}</Typography>
              </Button>
            </InputGroup.Suffix>
          </InputGroup>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3 md:shrink-0 md:justify-end">
          <Typography type="body-xs" elementType="span" color="muted" aria-hidden={!isFinished && !savedTime} className={"leading-none " + (!isFinished && !savedTime ? "opacity-0" : "")}>{review.status === "approved" ? "Approved" : review.status === "changes_requested" ? "Comments sent" : savedTime ? "Saved " + savedTime : "Saved 00:00"}</Typography>
          {error ? <Chip size="sm" color="danger" variant="soft" className="max-w-full"><Chip.Label><Typography type="body-xs" elementType="span" truncate className="leading-none">{error}</Typography></Chip.Label></Chip> : null}
          <Button size="sm" variant="primary" isPending={isFinishing || isSaving} isDisabled={isFinished || isFinishing || isSaving} onPress={() => finishReview(decision)} title={commentCount > 0 ? "Send review comments" : "Approve this review"}>
            {({ isPending }) => <span className="inline-flex items-center gap-2">
              {isPending ? <Spinner size="sm" color="current" className="-ms-0.5" /> : null}
              <span>{decisionButtonLabel}</span>
            </span>}
          </Button>
        </div>
      </div>
    </header>

    <div className={"mx-auto flex flex-col gap-4 px-4 py-4 pb-[50vh] " + (payload.kind === "document" ? "max-w-4xl" : "max-w-7xl")}>
      {payload.kind === "document" && payload.document ? <DocumentReviewSurface
        document={payload.document}
        comments={review.documentComments}
        activeCommentId={activeCommentId}
        setActiveCommentId={setActiveCommentId}
        addComment={addDocumentComment}
        updateComment={updateDocumentComment}
        deleteComment={deleteDocumentComment}
      /> : <DisclosureGroup allowsMultipleExpanded defaultExpandedKeys={payload.files.map((file) => file.id)} className="flex flex-col gap-4">
        {payload.files.map((file) => {
          const reviewFile = review.files.find((item) => item.location === file.location) || { location: file.location, added: file.added, removed: file.removed, comments: [] };
          return <ReviewFileDiff
            key={file.id}
            file={file}
            reviewFile={reviewFile}
            activeCommentId={activeCommentId}
            setActiveCommentId={setActiveCommentId}
            addComment={addComment}
            updateComment={updateComment}
            deleteComment={deleteComment}
          />;
        })}
      </DisclosureGroup>}
    </div>
  </div>;
}

type ReviewFileDiffProps = {
  file: ReviewSourceFile;
  reviewFile: ReviewFile;
  activeCommentId: string | null;
  setActiveCommentId: (id: string | null) => void;
  addComment: (file: ReviewSourceFile, selectedRange: SelectedLineRange, selectedTextOverride?: string) => void;
  updateComment: (fileLocation: string, commentId: string, patch: Partial<ReviewComment>) => void;
  deleteComment: (fileLocation: string, commentId: string) => void;
};

function DocumentReviewSurface(props: {
  document: DocumentSource;
  comments: DocumentComment[];
  activeCommentId: string | null;
  setActiveCommentId: (id: string | null) => void;
  addComment: (comment: DocumentComment) => void;
  updateComment: (commentId: string, patch: Partial<DocumentComment>) => void;
  deleteComment: (commentId: string) => void;
}) {
  const articleRef = useRef<HTMLElement | null>(null);

  function renderBlock(tag: string, node: { position?: { start: { line: number }; end: { line: number } } } | undefined, content: React.ReactNode) {
    const startLine = node?.position?.start.line ?? 0;
    const endLine = node?.position?.end.line ?? startLine;
    const blockId = tag + ":" + startLine + ":" + endLine;
    const annotations = props.comments.filter((comment) => comment.endBlockId === blockId);
    const annotated = props.comments.some((comment) => comment.startLine <= endLine && comment.endLine >= startLine);
    return <div
      className="document-review-block transition-colors"
      data-annotated={annotated ? "true" : "false"}
      data-document-block={blockId}
      data-start-line={startLine}
      data-end-line={endLine}
    >
      {content}
      {annotations.map((comment) => <div key={comment.id} className="not-prose">
        <CommentEditor
          id={comment.id}
          value={comment.comment}
          active={props.activeCommentId === comment.id}
          setActiveCommentId={props.setActiveCommentId}
          onChange={(value) => props.updateComment(comment.id, { comment: value })}
          onFinish={(value) => {
            if (value.trim().length === 0) props.deleteComment(comment.id);
            else props.updateComment(comment.id, { comment: value });
          }}
          onDelete={() => props.deleteComment(comment.id)}
        />
      </div>)}
    </div>;
  }

  const components = useMemo<Components>(() => ({
    h1: ({ node, children, ...elementProps }) => renderBlock("h1", node, <h1 {...elementProps}>{children}</h1>),
    h2: ({ node, children, ...elementProps }) => renderBlock("h2", node, <h2 {...elementProps}>{children}</h2>),
    h3: ({ node, children, ...elementProps }) => renderBlock("h3", node, <h3 {...elementProps}>{children}</h3>),
    h4: ({ node, children, ...elementProps }) => renderBlock("h4", node, <h4 {...elementProps}>{children}</h4>),
    h5: ({ node, children, ...elementProps }) => renderBlock("h5", node, <h5 {...elementProps}>{children}</h5>),
    h6: ({ node, children, ...elementProps }) => renderBlock("h6", node, <h6 {...elementProps}>{children}</h6>),
    p: ({ node, children, ...elementProps }) => renderBlock("p", node, <p {...elementProps}>{children}</p>),
    pre: ({ node, children, ...elementProps }) => renderBlock("pre", node, <pre {...elementProps}>{children}</pre>),
    blockquote: ({ node, children, ...elementProps }) => renderBlock("blockquote", node, <blockquote {...elementProps}>{children}</blockquote>),
    table: ({ node, children, ...elementProps }) => renderBlock("table", node, <div className="overflow-x-auto"><table {...elementProps}>{children}</table></div>),
    hr: ({ node, ...elementProps }) => renderBlock("hr", node, <hr {...elementProps} />),
    a: ({ node: _node, children, ...elementProps }) => <a {...elementProps} target="_blank" rel="noreferrer">{children}</a>,
  }), [props.comments, props.activeCommentId]);

  function handleMouseUp() {
    window.setTimeout(() => {
      const root = articleRef.current;
      const selection = document.getSelection();
      if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const selectedText = selection.toString().trim();
      if (!selectedText) return;
      const range = selection.getRangeAt(0);
      const startElement = getElementFromNode(range.startContainer);
      const endElement = getElementFromNode(range.endContainer);
      if (startElement?.closest("[data-review-comment]") || endElement?.closest("[data-review-comment]")) return;
      const startBlock = startElement?.closest<HTMLElement>("[data-document-block]");
      const endBlock = endElement?.closest<HTMLElement>("[data-document-block]");
      if (!startBlock || !endBlock || !root.contains(startBlock) || !root.contains(endBlock)) return;

      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(root);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const fullText = root.textContent ?? "";
      const startOffset = beforeRange.toString().length;
      const now = new Date().toISOString();
      const comment: DocumentComment = {
        id: makeId(),
        selectedText,
        startBlockId: startBlock.dataset.documentBlock ?? "",
        endBlockId: endBlock.dataset.documentBlock ?? "",
        startLine: Number.parseInt(startBlock.dataset.startLine ?? "0", 10),
        endLine: Number.parseInt(endBlock.dataset.endLine ?? "0", 10),
        prefix: fullText.slice(Math.max(0, startOffset - 40), startOffset),
        suffix: fullText.slice(startOffset + selectedText.length, startOffset + selectedText.length + 40),
        comment: "",
        createdAt: now,
        updatedAt: now,
      };
      props.addComment(comment);
      selection.removeAllRanges();
    }, 0);
  }

  return <div className="bg-white">
    {props.document.location ? <div className="pb-6 font-mono text-xs text-slate-500">{props.document.location}</div> : null}
    <article ref={articleRef} onMouseUp={handleMouseUp} className="document-review-surface prose prose-slate max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{props.document.markdown}</ReactMarkdown>
    </article>
  </div>;
}

const textSelectionCleanupByNode = new WeakMap<HTMLElement, () => void>();

function installTextSelectionCommentHook(
  node: HTMLElement,
  phase: string,
  file: ReviewSourceFile,
  addTextSelectionComment: (range: SelectedLineRange, selectedText: string) => void,
) {
  if (phase === "unmount") {
    textSelectionCleanupByNode.get(node)?.();
    textSelectionCleanupByNode.delete(node);
    return;
  }

  if (textSelectionCleanupByNode.has(node)) return;

  const root = node.shadowRoot ?? node;
  const handleMouseUp = () => {
    window.setTimeout(() => {
      const selection = getSelectionFromRoot(root);
      const selectedText = selection?.toString() ?? "";
      if (!selection || selection.isCollapsed || selectedText.trim().length === 0 || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const startElement = getElementFromNode(range.startContainer);
      const endElement = getElementFromNode(range.endContainer);
      if (startElement?.closest("[data-review-comment]") || endElement?.closest("[data-review-comment]")) return;

      const selectedRange = getSelectedLineRangeFromNativeRange(root, range);
      if (!selectedRange) return;

      addTextSelectionComment(selectedRange, selectedText);
      selection.removeAllRanges();
    }, 0);
  };

  root.addEventListener("mouseup", handleMouseUp);
  textSelectionCleanupByNode.set(node, () => root.removeEventListener("mouseup", handleMouseUp));
}

const reviewDiffUnsafeCSS = [
  ':host { --review-radius: 6px; --diffs-font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --diffs-header-font-family: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --diffs-light-bg: #fff; --diffs-light: #000; --diffs-bg-context-override: #fafafa; --diffs-bg-context-gutter-override: #fafafa; --diffs-bg-separator-override: #f5f5f5; --diffs-modified-color: #000; --diffs-bg-hover-override: #0070f3; --diffs-bg-selection-override: #0070f3; --diffs-bg-selection-number-override: #0070f3; --diffs-selection-number-fg: #0070f3; }',
  '[data-diffs-header="default"] { padding-inline: 0 !important; border-radius: var(--review-radius) var(--review-radius) 0 0 !important; }',
  '[data-diffs-header="default"] [data-header-content] { margin-left: 0 !important; }',
  '[data-diffs-header="default"] [data-metadata] { padding-right: 0 !important; }',
  '[data-change-icon] { opacity: 0.72; transform: scale(0.9); transform-origin: center; }',
  '[data-diff-span] { border-radius: var(--review-radius) !important; }',
  '[data-separator-content], [data-expand-button], [data-separator-wrapper] { border-radius: var(--review-radius) !important; }',
].join("\n");

function getSelectionFromRoot(root: ShadowRoot | HTMLElement): Selection | null {
  const shadowSelection = root instanceof ShadowRoot ? root.getSelection?.() : null;
  if (shadowSelection && !shadowSelection.isCollapsed) return shadowSelection;
  return document.getSelection();
}

function getElementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

function getLineSide(element: HTMLElement): "additions" | "deletions" {
  const lineType = element.getAttribute("data-line-type") ?? "";
  return lineType.includes("deletion") ? "deletions" : "additions";
}

function getSelectedLineRangeFromNativeRange(root: ShadowRoot | HTMLElement, range: Range): SelectedLineRange | null {
  const lineElements = Array.from(root.querySelectorAll<HTMLElement>("[data-line][data-line-index]"))
    .filter((element) => {
      try {
        return range.intersectsNode(element);
      } catch {
        return false;
      }
    });

  if (lineElements.length === 0) return null;

  const hasAddition = lineElements.some((element) => getLineSide(element) === "additions");
  const side: "additions" | "deletions" = hasAddition ? "additions" : "deletions";
  const lineNumbers = lineElements
    .filter((element) => getLineSide(element) === side)
    .map((element) => Number.parseInt(element.getAttribute("data-line") ?? "", 10))
    .filter((lineNumber) => Number.isFinite(lineNumber));

  if (lineNumbers.length === 0) return null;
  return {
    start: Math.min(...lineNumbers),
    end: Math.max(...lineNumbers),
    side,
    endSide: side,
  };
}

function ReviewFileDiff(props: ReviewFileDiffProps) {
  const { file, reviewFile } = props;
  const [copied, setCopied] = useState(false);
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
  const oldFile = useMemo(() => ({ name: file.location, contents: file.oldContent, lang: file.language as never }), [file.location, file.oldContent, file.language]);
  const newFile = useMemo(() => ({ name: file.location, contents: file.newContent, lang: file.language as never }), [file.location, file.newContent, file.language]);
  const annotations = useMemo<DiffLineAnnotation<CommentAnnotationMetadata>[]>(() => {
    return reviewFile.comments
      .filter((comment) => comment.startLine !== null && comment.endLine !== null)
      .map((comment) => ({
        side: comment.side,
        lineNumber: comment.endLine ?? comment.startLine ?? 0,
        metadata: { commentId: comment.id },
      }));
  }, [reviewFile.comments]);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(file.location);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  const writtenCommentCount = reviewFile.comments.filter((comment) => comment.comment.trim().length > 0).length;

  return <Disclosure id={file.id} className="overflow-hidden rounded-[var(--vercel-radius)] border border-slate-300 bg-white">
    <Disclosure.Heading>
      <Disclosure.Trigger className="group flex w-full items-center justify-between gap-4 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50">
        <span className="flex min-w-0 items-center gap-3">
          <Disclosure.Indicator className="shrink-0 text-slate-500 transition-transform group-data-[expanded=true]:rotate-90" />
          <span className="min-w-0">
            <Typography type="body-sm" elementType="span" weight="semibold" truncate className="block text-slate-950">{file.location}</Typography>
            <Typography type="body-xs" elementType="span" color="muted" className="mt-1 block leading-none">+{file.added} -{file.removed}</Typography>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {writtenCommentCount > 0 ? <Chip size="sm" variant="soft" color="primary"><Chip.Label>{writtenCommentCount} {writtenCommentCount === 1 ? "comment" : "comments"}</Chip.Label></Chip> : null}
        </span>
      </Disclosure.Trigger>
    </Disclosure.Heading>
    <Disclosure.Content className="border-t border-slate-200">
      <Card className="border-0 bg-white shadow-none" variant="outline">
        <Card.Content className="p-0">
          <MultiFileDiff<CommentAnnotationMetadata>
            className="review-diff-surface block"
        oldFile={oldFile}
        newFile={newFile}
        disableWorkerPool
        selectedLines={selectedLines}
        lineAnnotations={annotations}
        options={{
          theme: "github-light",
          diffStyle: "unified",
          diffIndicators: "classic",
          hunkSeparators: "metadata",
          lineDiffType: "word",
          unsafeCSS: reviewDiffUnsafeCSS,
          enableLineSelection: true,
          controlledSelection: true,
          onLineSelectionChange: setSelectedLines,
          onLineSelectionEnd: (range) => {
            setSelectedLines(range);
            if (range) props.addComment(file, range);
          },
          onPostRender: (node, _instance, phase) => {
            installTextSelectionCommentHook(node, phase, file, (range, selectedText) => {
              setSelectedLines(range);
              props.addComment(file, range, selectedText);
            });
          },
        }}
        renderHeaderMetadata={() => <div className="flex items-center gap-2">
          <Button size="sm" variant="bordered" className="font-normal" onClick={copyPath} title="Copy file path">
            {copied ? <Check size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" /> : <CopyIcon size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />}
            <Typography type="body-sm" elementType="span" weight="normal" className="leading-none">{copied ? "Copied" : "Copy"}</Typography>
          </Button>
        </div>}
        renderAnnotation={(annotation) => {
          const comment = reviewFile.comments.find((item) => item.id === annotation.metadata.commentId);
          if (!comment) return null;
          return <CommentAnnotation
            key={comment.id}
            file={file}
            comment={comment}
            active={props.activeCommentId === comment.id}
            clearSelectedLines={() => setSelectedLines(null)}
            setActiveCommentId={props.setActiveCommentId}
            updateComment={props.updateComment}
            deleteComment={props.deleteComment}
          />;
          }}
        />
        </Card.Content>
      </Card>
    </Disclosure.Content>
  </Disclosure>;
}

function CommentAnnotation(props: {
  file: ReviewSourceFile;
  comment: ReviewComment;
  active: boolean;
  clearSelectedLines: () => void;
  setActiveCommentId: (id: string | null) => void;
  updateComment: (fileLocation: string, commentId: string, patch: Partial<ReviewComment>) => void;
  deleteComment: (fileLocation: string, commentId: string) => void;
}) {
  const comment = props.comment;
  return <CommentEditor
    id={comment.id}
    value={comment.comment}
    active={props.active}
    setActiveCommentId={props.setActiveCommentId}
    onChange={(value) => props.updateComment(props.file.location, comment.id, { comment: value })}
    onFinish={(value) => {
      props.clearSelectedLines();
      if (value.trim().length === 0) props.deleteComment(props.file.location, comment.id);
      else props.updateComment(props.file.location, comment.id, { comment: value });
    }}
    onDelete={() => {
      props.clearSelectedLines();
      props.deleteComment(props.file.location, comment.id);
    }}
  />;
}

function CommentEditor(props: {
  id: string;
  value: string;
  active: boolean;
  setActiveCommentId: (id: string | null) => void;
  onChange: (value: string) => void;
  onFinish: (value: string) => void;
  onDelete: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const form = useForm({
    defaultValues: {
      comment: props.value,
    },
  });

  function finishComment(value: string) {
    props.onFinish(value);
    props.setActiveCommentId(null);
  }

  useEffect(() => {
    if (!props.active || !textareaRef.current) return;
    textareaRef.current.focus();
    textareaRef.current.selectionStart = textareaRef.current.value.length;
    textareaRef.current.selectionEnd = textareaRef.current.value.length;
  }, [props.active, props.id]);

  useEffect(() => {
    if (textareaRef.current) resizeTextarea(textareaRef.current);
  }, [props.id]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  function handleClearComment() {
    props.setActiveCommentId(null);
    props.onDelete();
  }

  return <div data-review-comment="true" className="flex items-center bg-[#0070f3]/10 px-6 py-3 font-sans">
    <form.Field
      name="comment"
      listeners={{
        onChangeDebounceMs: 750,
        onChange: ({ value }) => props.onChange(value),
        onBlur: ({ value }) => finishComment(value),
      }}
    >
      {(field) => <div className="relative w-full">
        <TextArea
          ref={textareaRef}
          aria-label="Review comment"
          className="min-h-11 w-full overflow-hidden pr-10 font-sans text-sm leading-5"
          placeholder="Add review comment..."
          value={field.state.value}
          variant="secondary"
          onFocus={() => props.setActiveCommentId(props.id)}
          onBlur={field.handleBlur}
          onChange={(event) => {
            field.handleChange(event.currentTarget.value);
            resizeTextarea(event.currentTarget);
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          style={{ resize: "none" }}
        />
        {field.state.value.length > 0 ? <CloseButton
          aria-label="Clear comment"
          className="absolute right-2 top-2 z-10 text-slate-500 hover:text-slate-900"
          onMouseDown={(event) => event.preventDefault()}
          onPress={handleClearComment}
        >
          <X size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
        </CloseButton> : null}
      </div>}
    </form.Field>
  </div>;
}

function getSelectedText(file: ReviewSourceFile, side: "additions" | "deletions", startLine: number, endLine: number) {
  const source = side === "additions" ? file.newContent : file.oldContent;
  return source.split(/\r\n|\r|\n/).slice(startLine - 1, endLine).join("\n");
}

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = Math.max(44, textarea.scrollHeight) + "px";
}

createRoot(document.getElementById("root")!).render(<App />);
`;
}
