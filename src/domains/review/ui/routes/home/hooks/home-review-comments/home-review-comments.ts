import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { SelectedLineRange } from "@pierre/diffs/react";
import { defineUIHook } from "../../../../../../../define.ts";
import type {
  DocumentComment,
  ReviewComment,
  ReviewJson,
  ReviewSourceFile,
} from "../../../../../types/review.ts";
import { homeRouteDeps } from "../../home-route-deps.ts";
import type { HomeReviewData } from "../home-review-data/home-review-data.ts";

type CommitReview = (updater: (review: ReviewJson) => ReviewJson) => void;
type Deps = typeof homeRouteDeps;

function patchComment(comment: ReviewComment, patch: Partial<ReviewComment>) {
  const next = { ...comment, ...patch, updatedAt: new Date().toISOString() };
  const before = JSON.stringify({ ...comment, updatedAt: undefined });
  const after = JSON.stringify({ ...next, updatedAt: undefined });
  return before === after ? comment : next;
}

function patchDocumentComment(comment: DocumentComment, patch: Partial<DocumentComment>) {
  const next = { ...comment, ...patch, updatedAt: new Date().toISOString() };
  const before = JSON.stringify({ ...comment, updatedAt: undefined });
  const after = JSON.stringify({ ...next, updatedAt: undefined });
  return before === after ? comment : next;
}

function createComment(
  deps: Deps,
  file: ReviewSourceFile,
  selectedRange: SelectedLineRange,
  selectedTextOverride?: string,
): ReviewComment {
  const side = selectedRange.endSide || selectedRange.side || "additions";
  const startLine = Math.min(selectedRange.start, selectedRange.end);
  const endLine = Math.max(selectedRange.start, selectedRange.end);
  const now = new Date().toISOString();
  return {
    id: deps.reviewCommentInteraction.createId({}),
    fileLocation: file.location,
    selectedRowIds: [side + ":" + startLine + "-" + endLine],
    selectedText: selectedTextOverride?.trim()
      ? selectedTextOverride
      : deps.reviewCommentInteraction.selectedText({ file, side, startLine, endLine }),
    side,
    selectedRange,
    startLine,
    endLine,
    lineNumbers: Array.from({ length: endLine - startLine + 1 }, (_, index) => startLine + index),
    comment: "",
    createdAt: now,
    updatedAt: now,
  };
}

function useFileComments(deps: Deps, commitReview: CommitReview, setActive: (id: string) => void) {
  const addComment = useCallback(
    (file: ReviewSourceFile, range: SelectedLineRange, text?: string) => {
      const comment = createComment(deps, file, range, text);
      commitReview((review) =>
        deps.reviewPresentation.updateFile({
          review,
          fileLocation: file.location,
          updater: (reviewFile) => ({
            ...reviewFile,
            comments: [...reviewFile.comments, comment],
          }),
        }),
      );
      setActive(comment.id);
    },
    [commitReview, deps, setActive],
  );
  const updateComment = useCallback(
    (fileLocation: string, commentId: string, patch: Partial<ReviewComment>) =>
      commitReview((review) =>
        deps.reviewPresentation.updateFile({
          review,
          fileLocation,
          updater: (file) => {
            const comments = file.comments.map((comment) =>
              comment.id === commentId ? patchComment(comment, patch) : comment,
            );
            return comments.some((comment, index) => comment !== file.comments[index])
              ? { ...file, comments }
              : file;
          },
        }),
      ),
    [commitReview, deps],
  );
  const deleteComment = useCallback(
    (fileLocation: string, commentId: string) =>
      commitReview((review) =>
        deps.reviewPresentation.updateFile({
          review,
          fileLocation,
          updater: (file) => {
            const comments = file.comments.filter((comment) => comment.id !== commentId);
            return comments.length === file.comments.length ? file : { ...file, comments };
          },
        }),
      ),
    [commitReview, deps],
  );
  return { addComment, deleteComment, updateComment };
}

function useDocumentComments(
  commitReview: CommitReview,
  setActive: Dispatch<SetStateAction<string | null>>,
) {
  function addDocumentComment(comment: DocumentComment) {
    commitReview((review) => ({
      ...review,
      updatedAt: new Date().toISOString(),
      documentComments: [...review.documentComments, comment],
    }));
    setActive(comment.id);
  }
  function updateDocumentComment(commentId: string, patch: Partial<DocumentComment>) {
    commitReview((review) => {
      const comments = review.documentComments.map((comment) =>
        comment.id === commentId ? patchDocumentComment(comment, patch) : comment,
      );
      return comments.some((comment, index) => comment !== review.documentComments[index])
        ? { ...review, updatedAt: new Date().toISOString(), documentComments: comments }
        : review;
    });
  }
  function deleteDocumentComment(commentId: string) {
    commitReview((review) => {
      const comments = review.documentComments.filter((comment) => comment.id !== commentId);
      return comments.length === review.documentComments.length
        ? review
        : { ...review, updatedAt: new Date().toISOString(), documentComments: comments };
    });
  }
  return { addDocumentComment, deleteDocumentComment, updateDocumentComment };
}

export const useHomeReviewComments = defineUIHook({
  params: {},
  deps: homeRouteDeps,
  hook(props: {
    activeCommentId: string | null;
    data: HomeReviewData;
    queueSave: (review: ReviewJson) => void;
    setActiveCommentId: Dispatch<SetStateAction<string | null>>;
    showSavingPreferences: () => void;
  }) {
    const deps = this.deps as Deps;
    const commitReview = useCallback<CommitReview>(
      (updater) =>
        props.data.setState((current) => {
          if (!current) {
            return current;
          }
          const review = updater(current.review);
          if (review === current.review) {
            return current;
          }
          props.queueSave(review);
          return { ...current, review };
        }),
      [props.data, props.queueSave],
    );
    const setFileExpanded = useCallback(
      (fileId: string, isExpanded: boolean) => {
        props.data.setCollapsedFileIds((current) => {
          const next = new Set(current);
          if (isExpanded) {
            next.delete(fileId);
          } else {
            next.add(fileId);
          }
          return next;
        });
        const file =
          props.data.state?.payload.kind === "diff"
            ? props.data.state.payload.files.find((candidate) => candidate.id === fileId)
            : undefined;
        if (!file) {
          return;
        }
        props.showSavingPreferences();
        props.data.mutation.mutate({
          ...props.data.preferences,
          fileExpansionOverrides: {
            ...props.data.preferences.fileExpansionOverrides,
            [file.location]: isExpanded ? "expanded" : "collapsed",
          },
        });
      },
      [props],
    );
    return {
      ...useFileComments(deps, commitReview, props.setActiveCommentId),
      ...useDocumentComments(commitReview, props.setActiveCommentId),
      commitReview,
      setFileExpanded,
    };
  },
});

export type HomeReviewComments = ReturnType<typeof useHomeReviewComments>;
