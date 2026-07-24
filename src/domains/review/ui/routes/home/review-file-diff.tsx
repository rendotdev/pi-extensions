import React, { useMemo } from "react";
import { type DiffLineAnnotation, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, type FileDiffProps, type SelectedLineRange } from "@pierre/diffs/react";
import { defineUIComponent } from "../../../../../define.ts";
import type { ReviewComment, ReviewFile, ReviewSourceFile } from "../../../types/review.ts";
import { CommentEditor } from "./components/comment-editor/comment-editor.tsx";
import { ReviewCodeFrame } from "./components/review-code-frame/review-code-frame.tsx";
import type { CommentAnnotationMetadata } from "./home-route-deps.ts";
import { useReviewFileDiffController } from "./review-file-diff-controller.ts";

export type ReviewFileDiffProps = {
  file: ReviewSourceFile;
  reviewFile: ReviewFile;
  diffStyle: "split" | "unified";
  lineWrap: boolean;
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
  activeCommentId: string | null;
  addComment: (
    file: ReviewSourceFile,
    selectedRange: SelectedLineRange,
    selectedTextOverride?: string,
  ) => void;
  updateComment: (fileLocation: string, commentId: string, patch: Partial<ReviewComment>) => void;
  deleteComment: (fileLocation: string, commentId: string) => void;
};

const ReviewFileDiffComponent = defineUIComponent({
  params: {},
  deps: { useReviewFileDiffController },
  component(props: ReviewFileDiffProps) {
    const { file, reviewFile } = props;
    const controller = this.deps.useReviewFileDiffController(props);
    const writtenCommentCount = reviewFile.comments.filter(
      (comment) => comment.comment.trim().length > 0,
    ).length;

    return (
      <ReviewCodeFrame
        added={file.added}
        commentCount={writtenCommentCount}
        copied={controller.copied}
        fileName={file.location}
        id={file.id}
        onCopy={controller.copyPath}
        removed={file.removed}
      >
        <ReviewFileDiffBody
          activeCommentId={props.activeCommentId}
          clearSelectedLines={controller.selection.clearSelectedLines}
          deleteComment={props.deleteComment}
          fileDiff={controller.fileDiff}
          file={file}
          options={controller.options}
          reviewFile={reviewFile}
          selectedLines={controller.selection.selectedLines}
          updateComment={props.updateComment}
        />
      </ReviewCodeFrame>
    );
  },
});

export const ReviewFileDiff = React.memo(ReviewFileDiffComponent);

const ReviewFileDiffBody = React.memo(
  function ReviewFileDiffBody(props: {
    activeCommentId: string | null;
    clearSelectedLines: (expectedRange?: SelectedLineRange) => void;
    deleteComment: ReviewFileDiffProps["deleteComment"];
    file: ReviewSourceFile;
    fileDiff: FileDiffMetadata;
    options: NonNullable<FileDiffProps<CommentAnnotationMetadata>["options"]>;
    reviewFile: ReviewFile;
    selectedLines: SelectedLineRange | null | undefined;
    updateComment: ReviewFileDiffProps["updateComment"];
  }) {
    const commentsById = useMemo(
      () => new Map(props.reviewFile.comments.map((comment) => [comment.id, comment])),
      [props.reviewFile.comments],
    );
    const lineAnnotations = useMemo<DiffLineAnnotation<CommentAnnotationMetadata>[]>(
      () =>
        props.reviewFile.comments.flatMap((comment) =>
          comment.endLine === null
            ? []
            : [
                {
                  side: comment.side,
                  lineNumber: comment.endLine,
                  metadata: { commentId: comment.id },
                },
              ],
        ),
      [props.reviewFile.comments],
    );

    return (
      <FileDiff<CommentAnnotationMetadata>
        className="block font-mono [--review-radius:var(--vercel-radius)]"
        fileDiff={props.fileDiff}
        lineAnnotations={lineAnnotations}
        selectedLines={props.selectedLines}
        options={props.options}
        renderAnnotation={(annotation) => {
          const comment = commentsById.get(annotation.metadata.commentId);
          if (!comment) {
            return null;
          }
          return (
            <CommentAnnotation
              file={props.file}
              comment={comment}
              active={props.activeCommentId === comment.id}
              clearSelectedLines={props.clearSelectedLines}
              updateComment={props.updateComment}
              deleteComment={props.deleteComment}
            />
          );
        }}
      />
    );
  },
  function areReviewFileDiffBodyPropsEqual(previous, next) {
    const haveSameCommentPlacement =
      previous.reviewFile.comments.length === next.reviewFile.comments.length &&
      previous.reviewFile.comments.every((comment, index) => {
        const nextComment = next.reviewFile.comments[index];
        return (
          nextComment !== undefined &&
          comment.id === nextComment.id &&
          comment.side === nextComment.side &&
          comment.startLine === nextComment.startLine &&
          comment.endLine === nextComment.endLine
        );
      });
    return (
      haveSameCommentPlacement &&
      previous.activeCommentId === next.activeCommentId &&
      previous.clearSelectedLines === next.clearSelectedLines &&
      previous.deleteComment === next.deleteComment &&
      previous.file === next.file &&
      previous.fileDiff === next.fileDiff &&
      previous.options === next.options &&
      previous.selectedLines === next.selectedLines &&
      previous.updateComment === next.updateComment
    );
  },
);

function CommentAnnotation(props: {
  file: ReviewSourceFile;
  comment: ReviewComment;
  active: boolean;
  clearSelectedLines: (expectedRange?: SelectedLineRange) => void;
  updateComment: (fileLocation: string, commentId: string, patch: Partial<ReviewComment>) => void;
  deleteComment: (fileLocation: string, commentId: string) => void;
}) {
  const comment = props.comment;
  return (
    <CommentEditor
      id={comment.id}
      value={comment.comment}
      active={props.active}
      onChange={(value) => props.updateComment(props.file.location, comment.id, { comment: value })}
      onFinish={(value) => {
        props.clearSelectedLines(comment.selectedRange);
        props.updateComment(props.file.location, comment.id, { comment: value });
      }}
      onDelete={() => {
        props.clearSelectedLines(comment.selectedRange);
        props.deleteComment(props.file.location, comment.id);
      }}
    />
  );
}
