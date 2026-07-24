import { isAbsolute, resolve } from "node:path";
import type { DiffReviewFileInput } from "../../types/review.ts";
import type { SSHCommand } from "./ssh-command.ts";
import type { SSHControlConnectionManager } from "./ssh-control-connection.ts";
import type { SSHProcess } from "./ssh-process.ts";
import type { SSHControlConnection } from "./ssh-types.ts";

export type SSHGitDependencies = {
  commandEncoder: Pick<SSHCommand, "executable" | "hasHead" | "worktreeFile">;
  connection: Pick<SSHControlConnectionManager, "close" | "execute" | "open">;
  randomUUID: () => string;
  processRunner: Pick<SSHProcess, "run">;
};

type ChangedPath = { oldPath?: string; newPath?: string };

export async function describeSSHEndpoint(params: {
  deps: SSHGitDependencies;
  destination: string;
  signal?: AbortSignal;
}) {
  const result = await params.deps.processRunner.run({
    args: ["-G", "--", params.destination],
    signal: params.signal,
  });
  if (result.code !== 0) {
    throw new Error(
      `Unable to resolve SSH destination ${params.destination}.${result.stderr ? `\n${result.stderr.trim()}` : ""}`,
    );
  }
  const settings = new Map<string, string>();
  for (const line of result.stdout.toString("utf8").split("\n")) {
    const separator = line.indexOf(" ");
    if (separator > 0) {
      settings.set(line.slice(0, separator), line.slice(separator + 1).trim());
    }
  }
  const hostname = settings.get("hostname");
  const user = settings.get("user");
  const port = settings.get("port") ?? "22";
  const isEndpointIncomplete = !hostname || !user;
  if (isEndpointIncomplete) {
    throw new Error(`ssh -G did not resolve a hostname and user for ${params.destination}.`);
  }
  return { hostname: hostname.includes(":") ? `[${hostname}]` : hostname, user, port };
}

export async function readRemoteGitRoot(params: {
  deps: SSHGitDependencies;
  connection: SSHControlConnection;
  remoteCwd: string;
  signal?: AbortSignal;
}) {
  const root = (
    await runExecutable({
      ...params,
      executable: "git",
      args: ["-C", params.remoteCwd, "rev-parse", "--show-toplevel"],
    })
  )
    .toString("utf8")
    .trim();
  if (!isAbsolute(root)) {
    throw new Error(`Remote Git root is not absolute: ${root || "(empty)"}.`);
  }
  return root;
}

export async function collectRemoteGitFiles(params: {
  deps: SSHGitDependencies;
  fileConcurrency: number;
  maximumFileBytes: number;
  connection: SSHControlConnection;
  root: string;
  signal?: AbortSignal;
}): Promise<DiffReviewFileInput[]> {
  const collected = await collectChangedPaths(params);
  const pending = deduplicateChanges(collected.changes);
  const files: DiffReviewFileInput[] = [];
  for (let index = 0; index < pending.length; index += params.fileConcurrency) {
    const batch = await Promise.all(
      pending
        .slice(index, index + params.fileConcurrency)
        .map((change) => readChangedFile({ ...params, change, hasHead: collected.hasHead })),
    );
    files.push(...batch.filter((file): file is DiffReviewFileInput => Boolean(file)));
  }
  return files;
}

async function collectChangedPaths(params: {
  deps: SSHGitDependencies;
  connection: SSHControlConnection;
  root: string;
  signal?: AbortSignal;
}) {
  const hasHead =
    (
      await runCommand({
        ...params,
        command: params.deps.commandEncoder.hasHead({
          marker: nextMarker(params.deps),
          root: params.root,
        }),
      })
    )
      .toString("utf8")
      .trim() === "true";
  const changes = hasHead
    ? parseNameStatus({
        output: (
          await runExecutable({
            ...params,
            executable: "git",
            args: [
              "-C",
              params.root,
              "diff",
              "--name-status",
              "-z",
              "--find-renames",
              "HEAD",
              "--",
            ],
          })
        ).toString("utf8"),
      })
    : pathsAsAdditions(
        await runExecutable({
          ...params,
          executable: "git",
          args: ["-C", params.root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        }),
      );
  const untracked = await runExecutable({
    ...params,
    executable: "git",
    args: ["-C", params.root, "ls-files", "--others", "--exclude-standard", "-z"],
  });
  changes.push(...pathsAsAdditions(untracked));
  return { changes, hasHead };
}

async function readChangedFile(params: {
  deps: SSHGitDependencies;
  maximumFileBytes: number;
  connection: SSHControlConnection;
  root: string;
  signal?: AbortSignal;
  change: ChangedPath;
  hasHead: boolean;
}): Promise<DiffReviewFileInput | undefined> {
  const [oldContent, newContent] = await Promise.all([
    params.hasHead && params.change.oldPath
      ? readHeadFile({ ...params, location: params.change.oldPath })
      : Promise.resolve(Buffer.alloc(0)),
    params.change.newPath
      ? readRemoteWorktreeFile({ ...params, location: params.change.newPath })
      : Promise.resolve(Buffer.alloc(0)),
  ]);
  const isBinaryFile = oldContent.includes(0) || newContent.includes(0);
  if (isBinaryFile) {
    return undefined;
  }
  return {
    location: params.change.newPath ?? params.change.oldPath ?? "unknown",
    oldContent: oldContent.toString("utf8"),
    newContent: newContent.toString("utf8"),
  };
}

async function readHeadFile(params: {
  deps: SSHGitDependencies;
  maximumFileBytes: number;
  connection: SSHControlConnection;
  root: string;
  location: string;
  signal?: AbortSignal;
}) {
  try {
    return await runExecutable({
      ...params,
      executable: "git",
      args: ["-C", params.root, "show", `HEAD:${params.location}`],
      maximumOutputBytes: params.maximumFileBytes,
    });
  } catch {
    return Buffer.alloc(0);
  }
}

export async function readRemoteWorktreeFile(params: {
  deps: SSHGitDependencies;
  maximumFileBytes: number;
  connection: SSHControlConnection;
  root: string;
  location: string;
  signal?: AbortSignal;
  allowMissing?: boolean;
}) {
  assertSafeLocation(params);
  const marker = nextMarker(params.deps);
  try {
    return await runCommand({
      ...params,
      command: params.deps.commandEncoder.worktreeFile({
        marker,
        path: resolve(params.root, params.location),
      }),
      marker,
      maximumOutputBytes: params.maximumFileBytes,
    });
  } catch (error) {
    if (params.allowMissing) {
      return Buffer.alloc(0);
    }
    throw error;
  }
}

async function runExecutable(params: {
  deps: SSHGitDependencies;
  connection: SSHControlConnection;
  executable: string;
  args: string[];
  signal?: AbortSignal;
  maximumOutputBytes?: number;
}) {
  const marker = nextMarker(params.deps);
  return await runCommand({
    ...params,
    command: params.deps.commandEncoder.executable({
      marker,
      executable: params.executable,
      args: params.args,
    }),
    marker,
  });
}

async function runCommand(params: {
  deps: SSHGitDependencies;
  connection: SSHControlConnection;
  command: string;
  marker?: string;
  signal?: AbortSignal;
  maximumOutputBytes?: number;
}) {
  const marker = params.marker ?? markerFromCommand(params.command);
  return await params.deps.connection.execute({ ...params, marker });
}

function parseNameStatus(params: { output: string }): ChangedPath[] {
  const fields = params.output.split("\0").filter(Boolean);
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index];
    const path = fields[index + 1] ?? "";
    index += 1;
    const kind = status.charAt(0);
    const isRenameOrCopy = kind === "R" || kind === "C";
    if (isRenameOrCopy) {
      changes.push({ oldPath: path, newPath: fields[index + 1] ?? "" });
      index += 1;
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

function pathsAsAdditions(output: Buffer): ChangedPath[] {
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((newPath) => ({ newPath }));
}

function deduplicateChanges(changes: ChangedPath[]): ChangedPath[] {
  const deduplicated = new Map<string, ChangedPath>();
  for (const change of changes) {
    const key = change.newPath ?? change.oldPath;
    if (key) {
      deduplicated.set(key, change);
    }
  }
  return [...deduplicated.values()];
}

function assertSafeLocation(params: { root: string; location: string }) {
  const isUnsafeLocation =
    !params.location || isAbsolute(params.location) || params.location.includes("\0");
  if (isUnsafeLocation) {
    throw new Error(`Unsafe remote Git path: ${params.location || "(empty)"}.`);
  }
  const path = resolve(params.root, params.location);
  const escapesRepository = path !== params.root && !path.startsWith(`${params.root}/`);
  if (escapesRepository) {
    throw new Error(`Remote Git path escapes the repository: ${params.location}.`);
  }
}

function markerFromCommand(command: string) {
  const match = command.match(/LGTM_FRAME_[a-zA-Z0-9-]+/);
  if (!match) {
    throw new Error("SSH command is missing its frame marker.");
  }
  return match[0];
}

function nextMarker(deps: SSHGitDependencies) {
  return `LGTM_FRAME_${deps.randomUUID()}`;
}
