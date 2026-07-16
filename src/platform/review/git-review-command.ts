import { resolve } from "node:path";
import { DomainClass } from "../../domain/domain-class.ts";
import type {
  DiffReviewFileInput,
  GitReviewSource,
  ReviewCheckpointFile,
} from "../../domain/review/review.ts";
import { collectGitReviewFiles, collectGitReviewFilesSinceLast } from "./review-platform.ts";
import { SSHGitRepositoryReader } from "./ssh-git-review-platform.ts";

export type GitReviewCollection = {
  files: DiffReviewFileInput[];
  checkpoint?: ReviewCheckpointFile[];
  source?: GitReviewSource;
};

export class GitReviewCommandClass extends DomainClass<
  {},
  {
    collectLocal: typeof collectGitReviewFiles;
    collectLocalSinceLast: typeof collectGitReviewFilesSinceLast;
    collectRemote: typeof SSHGitRepositoryReader.collect;
  }
> {
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

export const GitReviewCommand = new GitReviewCommandClass(
  {},
  {
    collectLocal: collectGitReviewFiles,
    collectLocalSinceLast: collectGitReviewFilesSinceLast,
    collectRemote: SSHGitRepositoryReader.collect.bind(SSHGitRepositoryReader),
  },
);
