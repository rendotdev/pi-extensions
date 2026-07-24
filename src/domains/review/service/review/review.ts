import { defineService } from "../../../../define.ts";
import type {
  DiffReviewFileInput,
  ReviewFile,
  ReviewJson,
  ReviewPayload,
  ReviewSourceFile,
} from "../../types/review.ts";
import { formatReview } from "./review-formatter.ts";
import { buildReviewSource } from "./review-source.ts";

export class ReviewSourceService extends defineService({ params: {}, deps: {} }) {
  public build(params: { file: DiffReviewFileInput; index: number }): ReviewSourceFile {
    return buildReviewSource(params);
  }
}

export const ReviewSource = new ReviewSourceService();

export class ReviewBuilderService extends defineService({ params: {}, deps: {} }) {
  public build(
    params: Omit<ReviewPayload, "generatedAt"> & {
      generatedAt: string;
      existingReview?: ReviewJson;
    },
  ): ReviewJson {
    const existingByLocation = new Map<string, ReviewFile>();
    for (const file of params.existingReview?.files ?? []) {
      existingByLocation.set(file.location, file);
    }
    return {
      version: 2,
      kind: params.kind,
      status: "open",
      name: params.name,
      sessionId: params.sessionId,
      reviewUUID: params.reviewUUID,
      reviewId: params.reviewId,
      cwd: params.cwd,
      appDir: params.appDir,
      reviewPath: params.reviewPath,
      createdAt: params.existingReview?.createdAt ?? params.generatedAt,
      updatedAt: params.generatedAt,
      files: params.files.map((file) => ({
        location: file.location,
        added: file.added,
        removed: file.removed,
        comments: existingByLocation.get(file.location)?.comments ?? [],
      })),
      source: params.source,
      document: params.document,
      documentComments: params.existingReview?.documentComments ?? [],
    };
  }
}

export const ReviewBuilder = new ReviewBuilderService();

export class ReviewFormatterService extends defineService({ params: {}, deps: {} }) {
  public format(params: { review: ReviewJson; reviewPath: string }) {
    return formatReview(params);
  }
}

export const ReviewFormatter = new ReviewFormatterService();
