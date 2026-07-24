import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineRepo } from "../../../../define.ts";
import type {
  DiffReviewFileInput,
  GitReviewSource,
  ReviewCheckpointFile,
} from "../../types/review.ts";
import {
  ReviewSinceLastStore,
  type SinceLastReviewCollection,
} from "../since-last-store/since-last-store.ts";
import { SSHGitRepository } from "../ssh-git/ssh-git.ts";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

async function collectGitReviewFiles(
  cwd: string,
  signal?: AbortSignal,
  options: { allowEmpty?: boolean } = {},
): Promise<DiffReviewFileInput[]> {
  const rootResult = await runGitCommand(["rev-parse", "--show-toplevel"], cwd, signal, 10_000);
  if (rootResult.code !== 0) {
    throw new Error(
      `Unable to open Git review from ${cwd}.\n${rootResult.stderr || rootResult.stdout}`,
    );
  }
  const root = rootResult.stdout.trim();
  const headResult = await runGitCommand(["rev-parse", "--verify", "HEAD"], root, signal, 10_000);
  const hasHead = headResult.code === 0;
  const changedPaths: Array<{ oldPath?: string; newPath?: string }> = [];

  if (hasHead) {
    const diffResult = await runGitCommand(
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
    const trackedResult = await runGitCommand(
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

  const untrackedResult = await runGitCommand(
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
    const isBinaryFile = oldContent.includes("\0") || newContent.includes("\0");
    if (isBinaryFile) {
      continue;
    }
    files.push({
      location: change.newPath ?? change.oldPath ?? "unknown",
      oldContent,
      newContent,
    });
  }

  const hasNoReviewableFiles = files.length === 0 && options.allowEmpty !== true;
  if (hasNoReviewableFiles) {
    throw new Error("No text changes were found to review.");
  }
  return files;
}

async function collectGitReviewFilesSinceLast(
  cwd: string,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<SinceLastReviewCollection> {
  const rootResult = await runGitCommand(["rev-parse", "--show-toplevel"], cwd, signal, 10_000);
  if (rootResult.code !== 0) {
    throw new Error(
      `Unable to open Git review from ${cwd}.\n${rootResult.stderr || rootResult.stdout}`,
    );
  }
  const root = rootResult.stdout.trim();
  const currentFiles = await collectGitReviewFiles(cwd, signal, { allowEmpty: true });
  const collection = await new ReviewSinceLastStore().collect({
    root,
    reviewRoots: [resolve(root, ".lgtm"), resolve(cwd, ".lgtm")],
    currentFiles,
    sessionId,
  });
  if (collection.files.length === 0) {
    throw new Error("No text changes were found since the last LGTM review.");
  }
  return collection;
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
    const isRenameOrCopy = kind === "R" || kind === "C";
    if (isRenameOrCopy) {
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

async function readGitFile(root: string, path: string, signal?: AbortSignal) {
  const result = await runGitCommand(["show", `HEAD:${path}`], root, signal, 30_000);
  return result.code === 0 ? result.stdout : "";
}

async function readWorkingTreeFile(root: string, path: string) {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch {
    return "";
  }
}

function runGitCommand(
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<GitCommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`git timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    function abort() {
      child.kill();
      rejectPromise(new Error("git cancelled."));
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

export type GitReviewCollection = {
  files: DiffReviewFileInput[];
  checkpoint?: ReviewCheckpointFile[];
  source?: GitReviewSource;
};

export class GitReview extends defineRepo({
  params: {},
  deps: {
    collectLocal: collectGitReviewFiles,
    collectLocalSinceLast: collectGitReviewFilesSinceLast,
    collectRemote(params: Parameters<SSHGitRepository["collect"]>[0]) {
      return new SSHGitRepository().collect(params);
    },
  },
}) {
  public async collect(params: {
    cwd: string;
    remote?: string;
    remoteCwd?: string;
    sessionId?: string;
    signal?: AbortSignal;
    sinceLast?: boolean;
  }): Promise<GitReviewCollection> {
    if (params.remote) {
      if (!params.remoteCwd) {
        throw new Error("Remote Git reviews require --remote-cwd <absolute-path>.");
      }
      return await this.deps.collectRemote({
        localCwd: resolve(params.cwd),
        remote: params.remote,
        remoteCwd: params.remoteCwd,
        sessionId: params.sessionId,
        signal: params.signal,
        sinceLast: params.sinceLast,
      });
    }
    if (params.remoteCwd) {
      throw new Error("--remote-cwd requires --remote <destination>.");
    }
    if (params.sinceLast) {
      return await this.deps.collectLocalSinceLast(
        resolve(params.cwd),
        params.signal,
        params.sessionId,
      );
    }
    return { files: await this.deps.collectLocal(resolve(params.cwd), params.signal) };
  }
}
