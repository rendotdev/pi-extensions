import { DomainClass } from "../../domain/domain-class.ts";
import type { FileExpansion, FileExpansionOverride } from "../../domain/preferences/preferences.ts";
import type { ReviewFile, ReviewJson } from "../../domain/review/review.ts";
import type { ReviewAppState } from "./review-api.ts";

export class ReviewPresentationClass extends DomainClass<
  { defaultCollapsedChangedLineThreshold: number },
  { now: () => Date }
> {
  public commentCount(params: { review: ReviewJson }): number {
    if (params.review.kind === "document") {
      return params.review.documentComments.filter((comment) => comment.comment.trim().length > 0)
        .length;
    }
    return params.review.files.reduce(
      (total, file) =>
        total + file.comments.filter((comment) => comment.comment.trim().length > 0).length,
      0,
    );
  }

  public meaningfulSignature(params: { review: ReviewJson }): string {
    if (params.review.kind === "document") {
      return JSON.stringify(
        params.review.documentComments.map((comment) => ({
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
        })),
      );
    }
    return JSON.stringify(
      params.review.files.map((file) => ({
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
      })),
    );
  }

  public updateFile(params: {
    review: ReviewJson;
    fileLocation: string;
    updater: (file: ReviewFile) => ReviewFile;
  }): ReviewJson {
    let changed = false;
    const files = params.review.files.map((file) => {
      if (file.location !== params.fileLocation) {
        return file;
      }
      const nextFile = params.updater(file);
      changed ||= nextFile !== file;
      return nextFile;
    });
    if (!changed) {
      return params.review;
    }
    return {
      ...params.review,
      updatedAt: this.deps.now().toISOString(),
      files,
    };
  }

  public initialCollapsedFileIds(params: {
    state: ReviewAppState;
    fileExpansion: FileExpansion;
    fileExpansionOverrides: Record<string, FileExpansionOverride>;
  }): Set<string> {
    if (params.state.payload.kind !== "diff") {
      return new Set<string>();
    }
    const collapsedFileIds = this.baseCollapsedFileIds({
      state: params.state,
      fileExpansion: params.fileExpansion,
    });
    for (const file of params.state.payload.files) {
      const override = params.fileExpansionOverrides[file.location];
      if (override === "collapsed") {
        collapsedFileIds.add(file.id);
      }
      if (override === "expanded") {
        collapsedFileIds.delete(file.id);
      }
    }
    return collapsedFileIds;
  }

  private baseCollapsedFileIds(params: {
    state: ReviewAppState;
    fileExpansion: FileExpansion;
  }): Set<string> {
    if (params.fileExpansion === "expanded") {
      return new Set<string>();
    }
    if (params.fileExpansion === "collapsed") {
      return new Set(params.state.payload.files.map((file) => file.id));
    }
    const reviewFileByLocation = new Map(
      params.state.review.files.map((file) => [file.location, file]),
    );
    return new Set(
      params.state.payload.files
        .filter((file) => {
          const reviewFile = reviewFileByLocation.get(file.location);
          return (
            file.added + file.removed >= this.params.defaultCollapsedChangedLineThreshold &&
            !reviewFile?.comments.length
          );
        })
        .map((file) => file.id),
    );
  }
}

export const ReviewPresentation = new ReviewPresentationClass(
  { defaultCollapsedChangedLineThreshold: 500 },
  { now: () => new Date() },
);
