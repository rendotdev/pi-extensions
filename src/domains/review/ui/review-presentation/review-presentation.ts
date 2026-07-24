import { defineService } from "../../../../define.ts";
import type { FileExpansion, FileExpansionOverride } from "../../../settings/index.ts";
import type { ReviewFile, ReviewJson } from "../../types/review.ts";
import type { ReviewAppState } from "../review-api/review-api.ts";

export class ReviewPresentation extends defineService({
  params: { defaultCollapsedChangedLineThreshold: 500 },
  deps: {
    now: function now() {
      return new Date();
    },
  },
}) {
  public commentCount(params: { review: ReviewJson }): number {
    if (params.review.kind === "document") {
      return params.review.documentComments.filter(function hasComment(comment) {
        return comment.comment.trim().length > 0;
      }).length;
    }
    return params.review.files.reduce(function countFileComments(total, file) {
      return (
        total +
        file.comments.filter(function hasComment(comment) {
          return comment.comment.trim().length > 0;
        }).length
      );
    }, 0);
  }

  public meaningfulSignature(params: { review: ReviewJson }): string {
    if (params.review.kind === "document") {
      return JSON.stringify(
        params.review.documentComments.map(function documentCommentSignature(comment) {
          return {
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
          };
        }),
      );
    }
    return JSON.stringify(
      params.review.files.map(function fileSignature(file) {
        return {
          location: file.location,
          comments: file.comments.map(function commentSignature(comment) {
            return {
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
            };
          }),
        };
      }),
    );
  }

  public updateFile(params: {
    review: ReviewJson;
    fileLocation: string;
    updater: (file: ReviewFile) => ReviewFile;
  }): ReviewJson {
    let changed = false;
    const files = params.review.files.map(function updateMatchingFile(file) {
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
    return { ...params.review, updatedAt: this.deps.now().toISOString(), files };
  }

  private baseCollapsedFileIds(params: {
    state: ReviewAppState;
    fileExpansion: FileExpansion;
  }): Set<string> {
    if (params.fileExpansion === "expanded") {
      return new Set<string>();
    }
    if (params.fileExpansion === "collapsed") {
      return new Set(
        params.state.payload.files.map(function getFileId(file) {
          return file.id;
        }),
      );
    }
    const reviewFileByLocation = new Map(
      params.state.review.files.map(function indexReviewFile(file) {
        return [file.location, file];
      }),
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
        .map(function getFileId(file) {
          return file.id;
        }),
    );
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
}
