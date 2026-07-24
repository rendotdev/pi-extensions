import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { defineRepo } from "../../../../define.ts";
import type { DiffReviewFileInput, GitReviewSource } from "../../types/review.ts";
import { ReviewSinceLastStore } from "../since-last-store/since-last-store.ts";
import { SSHCommand } from "./ssh-command.ts";
import { SSHControlConnectionManager } from "./ssh-control-connection.ts";
import {
  collectRemoteGitFiles,
  describeSSHEndpoint,
  readRemoteGitRoot,
  readRemoteWorktreeFile,
} from "./ssh-git-operations.ts";
import { SSHProcess } from "./ssh-process.ts";

export type RemoteGitReviewCollection = {
  files: DiffReviewFileInput[];
  checkpoint?: Array<{ location: string; content: string }>;
  source: GitReviewSource;
};

export class SSHGitRepository extends defineRepo({
  params: { fileConcurrency: 6, maximumFileBytes: 50 * 1024 * 1024 },
  deps: {
    commandEncoder: new SSHCommand(),
    connection: new SSHControlConnectionManager(),
    randomUUID: function createRandomUUID(): string {
      return randomUUID();
    },
    processRunner: new SSHProcess(),
  },
}) {
  public async collect(params: {
    localCwd: string;
    remote: string;
    remoteCwd: string;
    sessionId?: string;
    signal?: AbortSignal;
    sinceLast?: boolean;
  }): Promise<RemoteGitReviewCollection> {
    if (!isAbsolute(params.remoteCwd)) {
      throw new Error("--remote-cwd and remote worktree paths must be absolute.");
    }
    const endpoint = await describeSSHEndpoint({
      deps: this.deps,
      destination: params.remote,
      signal: params.signal,
    });
    const connection = await this.deps.connection.open({
      destination: params.remote,
      signal: params.signal,
    });
    try {
      const root = await readRemoteGitRoot({
        deps: this.deps,
        connection,
        remoteCwd: params.remoteCwd,
        signal: params.signal,
      });
      const source: GitReviewSource = {
        kind: "git",
        transport: "ssh",
        key: `ssh://${endpoint.user}@${endpoint.hostname}:${endpoint.port}${root}`,
        label: `${params.remote}:${root}`,
      };
      const files = await collectRemoteGitFiles({
        deps: this.deps,
        fileConcurrency: this.params.fileConcurrency,
        maximumFileBytes: this.params.maximumFileBytes,
        connection,
        root,
        signal: params.signal,
      });
      return params.sinceLast
        ? await this.collectSinceLast({ ...params, connection, files, root, source })
        : this.requireFiles({ files, message: "No text changes were found to review.", source });
    } finally {
      await this.deps.connection.close({ connection });
    }
  }

  private async collectSinceLast(params: {
    localCwd: string;
    sessionId?: string;
    signal?: AbortSignal;
    connection: Awaited<ReturnType<SSHControlConnectionManager["open"]>>;
    files: DiffReviewFileInput[];
    root: string;
    source: GitReviewSource;
  }): Promise<RemoteGitReviewCollection> {
    const collection = await new ReviewSinceLastStore().collect({
      root: params.root,
      reviewRoots: [resolve(params.localCwd, ".lgtm")],
      currentFiles: params.files,
      sessionId: params.sessionId,
      sourceKey: params.source.key,
      readCurrentContent: async (location) =>
        (
          await readRemoteWorktreeFile({
            deps: this.deps,
            maximumFileBytes: this.params.maximumFileBytes,
            connection: params.connection,
            root: params.root,
            location,
            signal: params.signal,
            allowMissing: true,
          })
        ).toString("utf8"),
    });
    if (collection.files.length === 0) {
      throw new Error("No text changes were found since the last lgtm review.");
    }
    return { files: collection.files, checkpoint: collection.checkpoint, source: params.source };
  }

  private requireFiles(params: {
    files: DiffReviewFileInput[];
    message: string;
    source: GitReviewSource;
  }): RemoteGitReviewCollection {
    if (params.files.length === 0) {
      throw new Error(params.message);
    }
    return { files: params.files, source: params.source };
  }
}
