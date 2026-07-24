import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { defineRepo } from "../../../../define.ts";
import { ReviewSinceLast } from "../since-last/since-last.ts";
import type {
  DiffReviewFileInput,
  ReviewCheckpointFile,
  ReviewPayload,
  ReviewStatus,
} from "../../types/review.ts";
import { reviewPayloadSchema, reviewSchema } from "../../types/schemas/schemas.ts";

type ReviewDirectoryEntry = {
  name: string;
  isDirectory: () => boolean;
};

type ReviewSinceLastCollectionParams = {
  root: string;
  reviewRoots: string[];
  currentFiles: DiffReviewFileInput[];
  sessionId?: string;
  sourceKey?: string;
  readCurrentContent?: (location: string) => Promise<string>;
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

export class ReviewSinceLastStore extends defineRepo({
  params: {},
  deps: {
    readDirectory: async function readDirectory(path: string): Promise<ReviewDirectoryEntry[]> {
      return await readdir(path, { withFileTypes: true });
    },
    readTextFile: async function readTextFile(path: string): Promise<string> {
      return await readFile(path, "utf8");
    },
  },
}) {
  // oxlint-disable-next-line lgtm/max-function-lines -- Baseline recovery stays atomic while its storage split is designed.
  public async collect(
    params: ReviewSinceLastCollectionParams,
  ): Promise<SinceLastReviewCollection> {
    const deps = this.deps;
    const baseline = await findLatestBaseline(params);
    if (!baseline) {
      return { files: params.currentFiles, checkpoint: createCheckpoint(params.currentFiles) };
    }

    const baselineFiles = baseline.checkpoint.map(function createBaselineFile(file) {
      return { location: file.location, oldContent: "", newContent: file.content };
    });
    const currentContents = new Map<string, string>();
    for (const file of baselineFiles) {
      currentContents.set(
        file.location,
        params.readCurrentContent
          ? await params.readCurrentContent(file.location)
          : await readWorkingTreeFile({ root: params.root, location: file.location }),
      );
    }

    return {
      files: ReviewSinceLast.build({
        baselineFiles,
        currentFiles: params.currentFiles,
        currentContents,
      }),
      checkpoint: createCheckpoint(params.currentFiles),
      baselineReviewId: baseline.payload.reviewId,
    };

    function createCheckpoint(files: Array<{ location: string; newContent: string }>) {
      return files.map(function createCheckpointFile(file) {
        return { location: file.location, content: file.newContent };
      });
    }

    // oxlint-disable-next-line lgtm/max-function-lines -- Candidate ranking and legacy checkpoint recovery share one ordered pass.
    async function findLatestBaseline(
      params: ReviewSinceLastCollectionParams,
    ): Promise<ReviewBaseline | undefined> {
      const candidates: ReviewCandidate[] = [];
      const roots = new Set(params.reviewRoots.map((root) => resolve(root)));

      for (const root of roots) {
        let entries: ReviewDirectoryEntry[];
        try {
          entries = await deps.readDirectory(root);
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }
          const appDir = resolve(root, entry.name);
          const payload = await readPayload(resolve(appDir, "payload.json"));
          const isIncompatiblePayload =
            !payload || !isCompatible({ root: params.root, payload, sourceKey: params.sourceKey });
          if (isIncompatiblePayload) {
            continue;
          }
          const status = await readReviewStatus(resolve(appDir, "review.json"), payload.reviewId);
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
        const checkpoint = payload.checkpoint ?? createCheckpoint(payload.files);
        const contentByLocation = new Map(
          checkpoint.map(function indexCheckpointFile(file) {
            return [file.location, file.content] as const;
          }),
        );
        const matches = [...latestContents].every(function matchesLatestContent([
          location,
          content,
        ]) {
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
          createCheckpoint(matchingEarlierPayload?.files ?? latest.files),
      };
    }

    async function readPayload(path: string): Promise<ReviewPayload | undefined> {
      try {
        return reviewPayloadSchema.parse(JSON.parse(await deps.readTextFile(path)));
      } catch {
        return undefined;
      }
    }

    async function readReviewStatus(
      path: string,
      expectedReviewId: string,
    ): Promise<ReviewStatus | undefined> {
      try {
        const review = reviewSchema.parse(JSON.parse(await deps.readTextFile(path)));
        return review.reviewId === expectedReviewId ? review.status : undefined;
      } catch {
        return undefined;
      }
    }

    function isCompatible(params: {
      root: string;
      payload: ReviewPayload;
      sourceKey?: string;
    }): boolean {
      const isInvalidPayload =
        params.payload.kind !== "diff" || !Number.isFinite(Date.parse(params.payload.generatedAt));
      if (isInvalidPayload) {
        return false;
      }
      if (params.payload.source?.key !== params.sourceKey) {
        return false;
      }
      return params.payload.files.every((file) =>
        isSafeLocation({ root: params.root, location: file.location }),
      );
    }

    function isSafeLocation(params: { root: string; location: string }): boolean {
      const isUnsafeLocation = !params.location || isAbsolute(params.location);
      if (isUnsafeLocation) {
        return false;
      }
      const pathRelativeToRoot = relative(params.root, resolve(params.root, params.location));
      return !pathRelativeToRoot.startsWith("..") && !isAbsolute(pathRelativeToRoot);
    }

    async function readWorkingTreeFile(params: {
      root: string;
      location: string;
    }): Promise<string> {
      try {
        return await deps.readTextFile(resolve(params.root, params.location));
      } catch {
        return "";
      }
    }
  }
}
