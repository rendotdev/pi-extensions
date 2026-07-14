import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { DomainClass } from "../../domain/domain-class.ts";
import { ReviewSinceLastBuilder } from "../../domain/review/review-since-last.ts";
import type {
  DiffReviewFileInput,
  ReviewCheckpointFile,
  ReviewPayload,
  ReviewStatus,
} from "../../domain/review/review.ts";
import { reviewPayloadSchema, reviewSchema } from "./api/api-schemas.ts";

type ReviewDirectoryEntry = {
  name: string;
  isDirectory: () => boolean;
};

type ReviewSinceLastCollectionParams = {
  root: string;
  reviewRoots: string[];
  currentFiles: DiffReviewFileInput[];
  sessionId?: string;
};

type ReviewSinceLastPlatformDeps = {
  readDirectory: (path: string) => Promise<ReviewDirectoryEntry[]>;
  readTextFile: (path: string) => Promise<string>;
};

type ReviewBaseline = {
  payload: ReviewPayload;
  checkpoint: ReviewCheckpointFile[];
};

type ReviewCandidate = {
  payload: ReviewPayload;
  status: ReviewStatus;
};

export type SinceLastReviewCollection = {
  files: DiffReviewFileInput[];
  checkpoint: ReviewCheckpointFile[];
  baselineReviewId?: string;
};

export class ReviewSinceLastPlatformClass extends DomainClass<{}, ReviewSinceLastPlatformDeps> {
  public async collect(
    params: ReviewSinceLastCollectionParams,
  ): Promise<SinceLastReviewCollection> {
    const baseline = await this.findLatestBaseline(params);
    if (!baseline) {
      return { files: params.currentFiles, checkpoint: this.createCheckpoint(params.currentFiles) };
    }

    const baselineFiles = baseline.checkpoint.map(function createBaselineFile(file) {
      return { location: file.location, oldContent: "", newContent: file.content };
    });
    const currentContents = new Map<string, string>();
    for (const file of baselineFiles) {
      currentContents.set(
        file.location,
        await this.readWorkingTreeFile({ root: params.root, location: file.location }),
      );
    }

    return {
      files: ReviewSinceLastBuilder.build({
        baselineFiles,
        currentFiles: params.currentFiles,
        currentContents,
      }),
      checkpoint: this.createCheckpoint(params.currentFiles),
      baselineReviewId: baseline.payload.reviewId,
    };
  }

  private createCheckpoint(files: Array<{ location: string; newContent: string }>) {
    return files.map(function createCheckpointFile(file) {
      return { location: file.location, content: file.newContent };
    });
  }

  private async findLatestBaseline(
    params: ReviewSinceLastCollectionParams,
  ): Promise<ReviewBaseline | undefined> {
    const candidates: ReviewCandidate[] = [];
    const roots = new Set(params.reviewRoots.map((root) => resolve(root)));

    for (const root of roots) {
      let entries: ReviewDirectoryEntry[];
      try {
        entries = await this.deps.readDirectory(root);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const appDir = resolve(root, entry.name);
        const payload = await this.readPayload(resolve(appDir, "payload.json"));
        if (!payload || !this.isCompatible({ root: params.root, payload })) {
          continue;
        }
        const status = await this.readReviewStatus(
          resolve(appDir, "review.json"),
          payload.reviewId,
        );
        if (status) {
          candidates.push({ payload, status });
        }
      }
    }

    candidates.sort(function sortNewestFirst(left, right) {
      return Date.parse(right.payload.generatedAt) - Date.parse(left.payload.generatedAt);
    });
    const sameSessionIndex = params.sessionId
      ? candidates.findIndex(function findLatestCompletedReviewForSession(candidate) {
          return (
            candidate.payload.sessionId === params.sessionId &&
            (candidate.status === "approved" || candidate.status === "changes_requested")
          );
        })
      : -1;
    const latestIndex =
      sameSessionIndex >= 0
        ? sameSessionIndex
        : candidates.findIndex(function findLatestCompletedReview(candidate) {
            return candidate.status === "approved" || candidate.status === "changes_requested";
          });
    if (latestIndex < 0) {
      return undefined;
    }
    const latest = candidates[latestIndex].payload;
    if (latest.checkpoint) {
      return { payload: latest, checkpoint: latest.checkpoint };
    }

    const latestContents = new Map(
      latest.files.map(function indexLatestFile(file) {
        return [file.location, file.newContent] as const;
      }),
    );
    let matchingEarlierPayload: ReviewPayload | undefined;
    for (const candidate of candidates.slice(latestIndex + 1)) {
      const payload = candidate.payload;
      const checkpoint = payload.checkpoint ?? this.createCheckpoint(payload.files);
      const contentByLocation = new Map(
        checkpoint.map(function indexCheckpointFile(file) {
          return [file.location, file.content] as const;
        }),
      );
      const matches = [...latestContents].every(function matchesLatestContent([location, content]) {
        return contentByLocation.get(location) === content;
      });
      if (matches) {
        matchingEarlierPayload = payload;
        break;
      }
    }
    return {
      payload: latest,
      checkpoint:
        matchingEarlierPayload?.checkpoint ??
        this.createCheckpoint(matchingEarlierPayload?.files ?? latest.files),
    };
  }

  private async readPayload(path: string): Promise<ReviewPayload | undefined> {
    try {
      return reviewPayloadSchema.parse(JSON.parse(await this.deps.readTextFile(path)));
    } catch {
      return undefined;
    }
  }

  private async readReviewStatus(
    path: string,
    expectedReviewId: string,
  ): Promise<ReviewStatus | undefined> {
    try {
      const review = reviewSchema.parse(JSON.parse(await this.deps.readTextFile(path)));
      return review.reviewId === expectedReviewId ? review.status : undefined;
    } catch {
      return undefined;
    }
  }

  private isCompatible(params: { root: string; payload: ReviewPayload }): boolean {
    if (
      params.payload.kind !== "diff" ||
      !Number.isFinite(Date.parse(params.payload.generatedAt))
    ) {
      return false;
    }
    return params.payload.files.every((file) =>
      this.isSafeLocation({ root: params.root, location: file.location }),
    );
  }

  private isSafeLocation(params: { root: string; location: string }): boolean {
    if (!params.location || isAbsolute(params.location)) {
      return false;
    }
    const pathRelativeToRoot = relative(params.root, resolve(params.root, params.location));
    return !pathRelativeToRoot.startsWith("..") && !isAbsolute(pathRelativeToRoot);
  }

  private async readWorkingTreeFile(params: { root: string; location: string }): Promise<string> {
    try {
      return await this.deps.readTextFile(resolve(params.root, params.location));
    } catch {
      return "";
    }
  }
}

export const ReviewSinceLastPlatform = new ReviewSinceLastPlatformClass(
  {},
  {
    readDirectory: async function readDirectory(path) {
      return await readdir(path, { withFileTypes: true });
    },
    readTextFile: async function readTextFile(path) {
      return await readFile(path, "utf8");
    },
  },
);
