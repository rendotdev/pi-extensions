import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DocumentComment } from "../../../types/review.ts";
import { CommentEditor } from "./components/comment-editor/comment-editor.tsx";

type AnnotationIndex = {
  documentTreeRevision: object;
  elementsByLine: Map<number, HTMLElement[]>;
};

function buildAnnotationIndex(article: HTMLElement, documentTreeRevision: object): AnnotationIndex {
  const elementsByLine = new Map<number, HTMLElement[]>();
  const candidates = article.querySelectorAll<HTMLElement>('[data-document-annotatable="true"]');
  for (const candidate of candidates) {
    const startLine = Number.parseInt(
      candidate.dataset.documentLine ?? candidate.dataset.startLine ?? "0",
      10,
    );
    const endLine = Number.parseInt(
      candidate.dataset.documentLine ?? candidate.dataset.endLine ?? String(startLine),
      10,
    );
    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      const lineElements = elementsByLine.get(lineNumber) ?? [];
      lineElements.push(candidate);
      elementsByLine.set(lineNumber, lineElements);
    }
  }
  return { documentTreeRevision, elementsByLine };
}

function elementsForLine(
  article: HTMLElement,
  annotationIndex: AnnotationIndex,
  lineNumber: number,
) {
  const indexedElements = annotationIndex.elementsByLine.get(lineNumber) ?? [];
  if (indexedElements.length > 0) {
    return indexedElements;
  }
  const elements = Array.from(
    article.querySelectorAll<HTMLElement>(`[data-document-line="${lineNumber}"]`),
  );
  if (elements.length > 0) {
    annotationIndex.elementsByLine.set(lineNumber, elements);
  }
  return elements;
}

function collectAnnotatedElements(
  article: HTMLElement,
  annotationIndex: AnnotationIndex,
  comments: DocumentComment[],
) {
  const annotatedElements = new Set<HTMLElement>();
  for (const comment of comments) {
    for (let lineNumber = comment.startLine; lineNumber <= comment.endLine; lineNumber += 1) {
      for (const element of elementsForLine(article, annotationIndex, lineNumber)) {
        annotatedElements.add(element);
      }
    }
  }
  return annotatedElements;
}

function synchronizeAnnotatedElements(
  previousElements: Set<HTMLElement>,
  nextElements: Set<HTMLElement>,
) {
  for (const element of previousElements) {
    if (!nextElements.has(element)) {
      element.dataset.annotated = "false";
    }
  }
  for (const element of nextElements) {
    if (!previousElements.has(element)) {
      element.dataset.annotated = "true";
    }
  }
}

export function DocumentCommentLayer(props: {
  activeCommentId: string | null;
  articleRef: React.RefObject<HTMLElement | null>;
  comments: DocumentComment[];
  deleteComment: (commentId: string) => void;
  documentTreeRevision: object;
  updateComment: (commentId: string, patch: Partial<DocumentComment>) => void;
}) {
  const annotatedElementsRef = useRef<Set<HTMLElement>>(new Set());
  const annotationIndexRef = useRef<AnnotationIndex | null>(null);
  const annotationSignature = props.comments
    .map((comment) => `${comment.id}:${comment.startLine}:${comment.endLine}`)
    .join("|");

  useLayoutEffect(
    function updateDocumentAnnotations() {
      const article = props.articleRef.current;
      if (!article) {
        return;
      }
      const shouldBuildAnnotationIndex =
        annotationIndexRef.current?.documentTreeRevision !== props.documentTreeRevision;
      if (shouldBuildAnnotationIndex) {
        annotationIndexRef.current = buildAnnotationIndex(article, props.documentTreeRevision);
      }
      const annotationIndex = annotationIndexRef.current;
      if (!annotationIndex) {
        return;
      }
      const nextAnnotatedElements = collectAnnotatedElements(
        article,
        annotationIndex,
        props.comments,
      );
      synchronizeAnnotatedElements(annotatedElementsRef.current, nextAnnotatedElements);
      annotatedElementsRef.current = nextAnnotatedElements;
    },
    [annotationSignature, props.articleRef, props.documentTreeRevision],
  );

  return props.comments.map((comment) => (
    <DocumentCommentPortal
      key={comment.id}
      active={props.activeCommentId === comment.id}
      articleRef={props.articleRef}
      comment={comment}
      deleteComment={props.deleteComment}
      documentTreeRevision={props.documentTreeRevision}
      updateComment={props.updateComment}
    />
  ));
}

function DocumentCommentPortal(props: {
  active: boolean;
  articleRef: React.RefObject<HTMLElement | null>;
  comment: DocumentComment;
  deleteComment: (commentId: string) => void;
  documentTreeRevision: object;
  updateComment: (commentId: string, patch: Partial<DocumentComment>) => void;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(
    function findCommentTarget() {
      const blockTarget = props.articleRef.current?.querySelector<HTMLElement>(
        `[data-document-block="${CSS.escape(props.comment.endBlockId)}"]`,
      );
      const selectedTableRow = blockTarget?.querySelector<HTMLTableRowElement>(
        `[data-document-line="${props.comment.endLine}"]`,
      );
      if (!selectedTableRow) {
        setTarget(blockTarget ?? null);
        return;
      }
      const commentRow = document.createElement("tr");
      commentRow.dataset.reviewTableComment = "true";
      commentRow.dataset.reviewTableCommentLine = String(props.comment.endLine);
      const commentCell = document.createElement("td");
      commentCell.colSpan = Math.max(1, selectedTableRow.cells.length);
      commentCell.style.padding = "0";
      commentRow.append(commentCell);
      let insertionPoint = selectedTableRow;
      while (
        insertionPoint.nextElementSibling instanceof HTMLTableRowElement &&
        insertionPoint.nextElementSibling.dataset.reviewTableCommentLine ===
          String(props.comment.endLine)
      ) {
        insertionPoint = insertionPoint.nextElementSibling;
      }
      insertionPoint.after(commentRow);
      setTarget(commentCell);
      return function removeCommentRow() {
        commentRow.remove();
      };
    },
    [props.articleRef, props.comment.endBlockId, props.comment.endLine, props.documentTreeRevision],
  );

  if (!target) {
    return null;
  }
  return createPortal(
    <div className="not-typeset -mx-[var(--review-document-highlight-padding-inline)]">
      <CommentEditor
        id={props.comment.id}
        value={props.comment.comment}
        active={props.active}
        onChange={(value) => props.updateComment(props.comment.id, { comment: value })}
        onFinish={(value) => props.updateComment(props.comment.id, { comment: value })}
        onDelete={() => props.deleteComment(props.comment.id)}
      />
    </div>,
    target,
  );
}
