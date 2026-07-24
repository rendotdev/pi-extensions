import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { defineRuntime } from "../../../../define.ts";
import type { ReviewJson } from "../../types/review.ts";
import { BuiltCliPath } from "./server-paths.ts";
import { stopReviewFinishWatcher } from "./server-watcher.ts";

type CommandResult = { stdout: string; stderr: string; code: number | null };
export type ReviewServerInfo = { url: string; pid: number };
export type ReviewServerState = ReviewServerInfo & {
  appDir: string;
  reviewId: string;
  startedAt: string;
};

export const activeReviewServersByPath = new Map<string, ReviewServerState>();
export const cleanupReviewServersByPath = new Map<string, ReviewServerState>();
export const abortCleanupByReviewPath = new Map<string, () => void>();
let processCleanupRegistered = false;

export class ReviewServerLifecycle extends defineRuntime({
  params: {},
  deps: {
    activeReviewServersByPath,
    readReviewServerPid,
    readReviewServerState,
    stopReviewServerState,
  },
}) {
  public async stopForReview(params: { review: ReviewJson; reviewPath: string }): Promise<boolean> {
    const appDir = params.review.appDir || resolve(params.reviewPath, "..");
    const knownState =
      this.deps.activeReviewServersByPath.get(params.reviewPath) ??
      (await this.deps.readReviewServerState(appDir));
    const pid = knownState?.pid ?? (await this.deps.readReviewServerPid(appDir));
    if (!pid) {
      return false;
    }
    return await this.deps.stopReviewServerState(
      knownState ?? {
        pid,
        url: params.review.url ?? "",
        appDir,
        reviewId: params.review.reviewId,
        startedAt: params.review.updatedAt,
      },
      params.reviewPath,
    );
  }
}

export async function startReviewServer(
  appDir: string,
  signal?: AbortSignal,
  detached = true,
): Promise<ReviewServerInfo> {
  const cliPath = await new BuiltCliPath().resolve({});
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", [cliPath, "serve", "--app-dir", appDir], {
      cwd: resolve(appDir, "..", ".."),
      env: { ...process.env },
      detached,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      cleanup();
      stopChild(child);
      rejectPromise(new Error("Timed out while starting LGTM review server."));
    }, 20_000);

    let stderr = "";
    let settled = false;

    function abort() {
      cleanup();
      stopChild(child);
      rejectPromise(new Error("Cancelled while starting LGTM review server."));
    }

    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
    }

    async function finish(url: string) {
      if (settled) {
        return;
      }
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
        detachChild(child);
      }
      await writeFile(join(appDir, "server.pid"), `${pid}\n`, "utf8");
      resolvePromise({ url, pid });
    }

    function onStdout(chunk: Buffer) {
      const text = chunk.toString("utf8");
      const match = text.match(/LGTM_REVIEW_URL=(\S+)/);
      if (match?.[1]) {
        void finish(match[1]);
      }
    }

    function onStderr(chunk: Buffer) {
      stderr += chunk.toString("utf8");
    }

    function onExit(code: number | null) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(
        new Error(`LGTM review server exited with code ${code ?? "unknown"}.\n${stderr}`),
      );
    }

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("exit", onExit);
  });
}

function stopChild(child: ReturnType<typeof spawn>) {
  if (child.pid) {
    killReviewServerPid(child.pid, "SIGTERM");
  } else {
    child.kill();
  }
}

function detachChild(child: ReturnType<typeof spawn>) {
  (child.stdout as unknown as { unref?: () => void } | undefined)?.unref?.();
  (child.stderr as unknown as { unref?: () => void } | undefined)?.unref?.();
  child.unref();
}

export async function writeReviewServerState(state: ReviewServerState) {
  await writeFile(join(state.appDir, "server.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function ensureReviewServerForReview(
  review: ReviewJson,
  reviewPath: string,
): Promise<{ review: ReviewJson; restartedServer: boolean }> {
  const appDir = review.appDir || resolve(reviewPath, "..");
  const knownState =
    activeReviewServersByPath.get(reviewPath) ?? (await readReviewServerState(appDir));
  const isHealthy = knownState ? await isReviewServerHealthy(knownState) : false;
  if (knownState) {
    if (isHealthy) {
      activeReviewServersByPath.set(reviewPath, knownState);
      return { review, restartedServer: false };
    }
    await stopReviewServerState(knownState, reviewPath).catch(() => false);
  }
  const server = await startReviewServer(appDir);
  const state: ReviewServerState = {
    ...server,
    appDir,
    reviewId: review.reviewId,
    startedAt: new Date().toISOString(),
  };
  await writeReviewServerState(state);
  activeReviewServersByPath.set(reviewPath, state);
  const resumedReview = { ...review, url: server.url, updatedAt: new Date().toISOString() };
  await writeFile(reviewPath, `${JSON.stringify(resumedReview, null, 2)}\n`, "utf8");
  return { review: resumedReview, restartedServer: true };
}

async function isReviewServerHealthy(state: ReviewServerState) {
  if (!(await isLikelyReviewServerProcess(state.pid))) {
    return false;
  }
  try {
    const response = await fetch(new URL("/health", state.url), {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function readReviewServerState(appDir: string): Promise<ReviewServerState | undefined> {
  try {
    const state = JSON.parse(
      await readFile(join(appDir, "server.json"), "utf8"),
    ) as ReviewServerState;
    const isValidState =
      Number.isInteger(state.pid) &&
      typeof state.appDir === "string" &&
      resolve(state.appDir) === resolve(appDir);
    if (isValidState) {
      return state;
    }
  } catch {
    // No server state.
  }
  return undefined;
}

export async function stopReviewServerForAppDir(appDir: string) {
  const state = await readReviewServerState(appDir);
  if (state) {
    return await stopReviewServerProcess(state);
  }
  const pid = await readReviewServerPid(appDir);
  if (!pid) {
    return false;
  }
  return await stopReviewServerProcess({
    pid,
    url: "",
    appDir,
    reviewId: resolve(appDir).split(sep).at(-1) ?? "unknown",
    startedAt: new Date(0).toISOString(),
  });
}

export async function stopActiveReviewServers(cwd: string) {
  const reviewRoot = `${join(resolve(cwd), ".lgtm")}${sep}`;
  const states = [...activeReviewServersByPath.values()].filter((state) =>
    state.appDir.startsWith(reviewRoot),
  );
  const stopped = await Promise.all(states.map((state) => stopReviewServerState(state)));
  return stopped.some(Boolean);
}

export async function stopReviewServerState(
  state: ReviewServerState,
  reviewPath = join(state.appDir, "review.json"),
) {
  abortCleanupByReviewPath.get(reviewPath)?.();
  abortCleanupByReviewPath.delete(reviewPath);
  const stopped = await stopReviewServerProcess(state);
  cleanupReviewServersByPath.delete(reviewPath);
  activeReviewServersByPath.delete(reviewPath);
  if (stopped) {
    stopReviewFinishWatcher(reviewPath);
  }
  return stopped;
}

export async function stopReviewImplementation(cwd: string, reviewPath: string) {
  const review = await readReviewIfExists(reviewPath);
  if (!review) {
    return false;
  }
  stopReviewFinishWatcher(reviewPath);
  return await new ReviewServerLifecycle().stopForReview({ review, reviewPath });
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
  if (!(await isLikelyReviewServerProcess(state.pid))) {
    return false;
  }
  killReviewServerPid(state.pid, "SIGTERM");
  if (await waitForProcessExit(state.pid, 1_500)) {
    return true;
  }
  killReviewServerPid(state.pid, "SIGKILL");
  return await waitForProcessExit(state.pid, 1_000);
}

async function isLikelyReviewServerProcess(pid: number) {
  if (!isProcessRunning(pid)) {
    return false;
  }
  if (process.platform === "win32") {
    return true;
  }

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
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return !isProcessRunning(pid);
}

export function registerProcessCleanup() {
  if (processCleanupRegistered) {
    return;
  }
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

    function abort() {
      child.kill();
      rejectPromise(new Error(`${command} cancelled.`));
    }

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

export async function readReviewIfExists(reviewPath: string): Promise<ReviewJson | undefined> {
  try {
    return JSON.parse(await readFile(reviewPath, "utf8")) as ReviewJson;
  } catch {
    return undefined;
  }
}

export function openInDefaultBrowser(target: string) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}
