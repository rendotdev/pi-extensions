import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FileContents, LineAnnotation } from "@pierre/diffs";
import { File, type FileProps, type SelectedLineRange } from "@pierre/diffs/react";
import type { DocumentComment } from "../../../types/review.ts";
import { CommentEditor } from "./components/comment-editor/comment-editor.tsx";
import { ReviewCodeFrame } from "./components/review-code-frame/review-code-frame.tsx";
import { DocumentCodePreferencesContext } from "./document-review-surface.tsx";
import { homeRouteDeps, type CommentAnnotationMetadata } from "./home-route-deps.ts";
import { useLazyVisibility } from "./hooks/lazy-visibility/lazy-visibility.ts";
import { useReviewLineSelection } from "./hooks/review-line-selection/review-line-selection.ts";

type DocumentCodeBlockProps = {
  activeCommentId: string | null;
  addComment: (comment: DocumentComment) => void;
  blockId: string;
  children: React.ReactNode;
  comments: DocumentComment[];
  deleteComment: (commentId: string) => void;
  fileName?: string;
  sourceStartLine: number;
  updateComment: (commentId: string, patch: Partial<DocumentComment>) => void;
};

function codeElementDetails(children: React.ReactNode) {
  const codeElement = React.Children.toArray(children).find(React.isValidElement);
  const props = codeElement?.props as
    | { children?: React.ReactNode; className?: string }
    | undefined;
  return {
    className: props?.className,
    code: typeof props?.children === "string" ? props.children.replace(/\n$/, "") : "",
  };
}

export function LazyDocumentCodeBlock(props: DocumentCodeBlockProps) {
  const { isVisible, targetRef } = useLazyVisibility({});
  const { code } = codeElementDetails(props.children);
  const lineCount = Math.max(1, code.split(/\r\n|\r|\n/).length);

  return (
    <div
      ref={targetRef}
      data-lazy-document-code={isVisible ? "hydrated" : "pending"}
      style={{ minHeight: lineCount * 20 + 2 }}
    >
      {isVisible ? <DocumentCodeBlock {...props} /> : null}
    </div>
  );
}

function useDocumentCodeCommentState(props: DocumentCodeBlockProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const [comments, setComments] = useState(() =>
    props.comments.filter((comment) => comment.endBlockId === props.blockId),
  );
  const [activeCommentId, setActiveCommentId] = useState<string | null>(() =>
    comments.some((comment) => comment.id === props.activeCommentId) ? props.activeCommentId : null,
  );
  useEffect(() => {
    setComments(props.comments.filter((comment) => comment.endBlockId === props.blockId));
  }, [props.blockId, props.comments]);
  return { activeCommentId, comments, propsRef, setActiveCommentId, setComments };
}

function useAddCodeComment(params: {
  codeLines: string[];
  propsRef: React.RefObject<DocumentCodeBlockProps>;
  setActiveCommentId: React.Dispatch<React.SetStateAction<string | null>>;
  setComments: React.Dispatch<React.SetStateAction<DocumentComment[]>>;
}) {
  return useCallback(
    function addCodeComment(range: SelectedLineRange) {
      const start = Math.min(range.start, range.end);
      const end = Math.max(range.start, range.end);
      const currentProps = params.propsRef.current;
      const now = new Date().toISOString();
      const comment: DocumentComment = {
        id: homeRouteDeps.reviewCommentInteraction.createId({}),
        selectedText: params.codeLines.slice(start - 1, end).join("\n"),
        startBlockId: currentProps.blockId,
        endBlockId: currentProps.blockId,
        startLine: currentProps.sourceStartLine + start - 1,
        endLine: currentProps.sourceStartLine + end - 1,
        prefix: params.codeLines
          .slice(0, start - 1)
          .join("\n")
          .slice(-40),
        suffix: params.codeLines.slice(end).join("\n").slice(0, 40),
        comment: "",
        createdAt: now,
        updatedAt: now,
      };
      params.setComments((current) => [...current, comment]);
      params.setActiveCommentId(comment.id);
      currentProps.addComment(comment);
    },
    [params.codeLines, params.propsRef, params.setActiveCommentId, params.setComments],
  );
}

function useDocumentFileOptions(params: {
  addCodeComment: (range: SelectedLineRange) => void;
  clearSelectedLines: (range?: SelectedLineRange) => void;
  preferences: React.ContextType<typeof DocumentCodePreferencesContext>;
  selectLines: (range: SelectedLineRange) => void;
}) {
  return useMemo<NonNullable<FileProps<CommentAnnotationMetadata>["options"]>>(
    () => ({
      theme: params.preferences.diffTheme,
      themeType: params.preferences.diffThemeType,
      overflow: params.preferences.lineWrap ? "wrap" : "scroll",
      disableFileHeader: true,
      unsafeCSS: homeRouteDeps.reviewDiffPresentation.fileOptions({}).unsafeCSS,
      enableLineSelection: true,
      onLineSelectionEnd: function onLineSelectionEnd(range) {
        if (range) {
          params.selectLines(range);
          params.addCodeComment(range);
        } else {
          params.clearSelectedLines();
        }
      },
      onPostRender: function onPostRender(node, instance, phase) {
        homeRouteDeps.reviewCommentInteraction.installRowSelection({
          node,
          phase,
          renderer: instance,
          previewSelection: params.selectLines,
          commitSelection: function commitRowSelection(range) {
            params.selectLines(range);
            params.addCodeComment(range);
          },
        });
      },
    }),
    [params],
  );
}

function createLineAnnotations(
  comments: DocumentComment[],
  codeLineCount: number,
  sourceStartLine: number,
): LineAnnotation<CommentAnnotationMetadata>[] {
  return comments.flatMap((comment) => {
    const lineNumber = comment.endLine - sourceStartLine + 1;
    const isLineInCodeBlock = lineNumber >= 1 && lineNumber <= codeLineCount;
    return isLineInCodeBlock ? [{ lineNumber, metadata: { commentId: comment.id } }] : [];
  });
}

function DocumentCodeCommentEditor(props: {
  activeCommentId: string | null;
  clearSelectedLines: (range?: SelectedLineRange) => void;
  comment: DocumentComment;
  propsRef: React.RefObject<DocumentCodeBlockProps>;
  setActiveCommentId: React.Dispatch<React.SetStateAction<string | null>>;
  setComments: React.Dispatch<React.SetStateAction<DocumentComment[]>>;
}) {
  const commentRange: SelectedLineRange = {
    start: props.comment.startLine - props.propsRef.current.sourceStartLine + 1,
    end: props.comment.endLine - props.propsRef.current.sourceStartLine + 1,
    side: "additions",
    endSide: "additions",
  };
  function updateComment(value: string) {
    props.setComments((current) =>
      current.map((comment) =>
        comment.id === props.comment.id ? { ...comment, comment: value } : comment,
      ),
    );
    props.propsRef.current.updateComment(props.comment.id, { comment: value });
  }
  function finishComment(value: string) {
    props.clearSelectedLines(commentRange);
    props.setActiveCommentId(null);
    updateComment(value);
  }
  function deleteComment() {
    props.clearSelectedLines(commentRange);
    props.setActiveCommentId(null);
    props.setComments((current) => current.filter((comment) => comment.id !== props.comment.id));
    props.propsRef.current.deleteComment(props.comment.id);
  }
  return (
    <CommentEditor
      id={props.comment.id}
      value={props.comment.comment}
      active={props.activeCommentId === props.comment.id}
      onChange={updateComment}
      onFinish={finishComment}
      onDelete={deleteComment}
    />
  );
}

function DocumentCodeBlock(props: DocumentCodeBlockProps) {
  const preferences = useContext(DocumentCodePreferencesContext);
  const { className, code } = codeElementDetails(props.children);
  const language = homeRouteDeps.documentCodeHighlighter.languageFromClassName({ className });
  const codeLines = useMemo(() => code.split(/\r\n|\r|\n/), [code]);
  const state = useDocumentCodeCommentState(props);
  const { clearSelectedLines, selectedLines, selectLines } = useReviewLineSelection({});
  const addCodeComment = useAddCodeComment({
    codeLines,
    propsRef: state.propsRef,
    setActiveCommentId: state.setActiveCommentId,
    setComments: state.setComments,
  });
  const file = useMemo<FileContents>(
    () => ({
      name: props.fileName ?? `document-code.${language}`,
      contents: code,
      lang: language,
      cacheKey: `document:${props.blockId}:${language}:${code}`,
    }),
    [code, language, props.blockId, props.fileName],
  );
  const commentsById = useMemo(
    () => new Map(state.comments.map((comment) => [comment.id, comment])),
    [state.comments],
  );
  const lineAnnotations = useMemo(
    () => createLineAnnotations(state.comments, codeLines.length, props.sourceStartLine),
    [codeLines.length, props.sourceStartLine, state.comments],
  );
  const fileOptions = useDocumentFileOptions({
    addCodeComment,
    clearSelectedLines,
    preferences,
    selectLines,
  });

  return (
    <ReviewCodeFrame className="document-code" fileName={props.fileName} id={props.blockId}>
      <File<CommentAnnotationMetadata>
        className="block font-mono [--review-radius:var(--vercel-radius)]"
        file={file}
        lineAnnotations={lineAnnotations}
        selectedLines={selectedLines}
        options={fileOptions}
        renderAnnotation={(annotation) => {
          const comment = commentsById.get(annotation.metadata.commentId);
          return comment ? (
            <DocumentCodeCommentEditor
              activeCommentId={state.activeCommentId}
              clearSelectedLines={clearSelectedLines}
              comment={comment}
              propsRef={state.propsRef}
              setActiveCommentId={state.setActiveCommentId}
              setComments={state.setComments}
            />
          ) : null;
        }}
      />
    </ReviewCodeFrame>
  );
}
