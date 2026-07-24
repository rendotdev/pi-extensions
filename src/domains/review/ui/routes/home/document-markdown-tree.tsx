import React, { Suspense, useMemo, useRef } from "react";
import type { Components } from "react-markdown";
import type { DocumentComment } from "../../../types/review.ts";
import { LazyDocumentCodeBlock } from "./document-code-block.tsx";
import {
  DocumentMarkdownRenderer,
  type DocumentMarkdownTreeProps,
} from "./document-review-surface.tsx";
import { homeRouteDeps } from "./home-route-deps.ts";
import { useLazyVisibility } from "./hooks/lazy-visibility/lazy-visibility.ts";

type MarkdownNode = { position?: { start: { line: number }; end: { line: number } } } | undefined;

function renderBlock(
  tag: string,
  node: MarkdownNode,
  content: React.ReactNode,
  listItemProps?: React.LiHTMLAttributes<HTMLLIElement>,
  annotateBlock = true,
  blockClassName = "",
) {
  const startLine = node?.position?.start.line ?? 0;
  const endLine = node?.position?.end.line ?? startLine;
  const blockProps = {
    "data-annotated": "false",
    "data-document-annotatable": annotateBlock ? "true" : "false",
    "data-document-block": `${tag}:${startLine}:${endLine}`,
    "data-start-line": startLine,
    "data-end-line": endLine,
  };
  const annotationClassName =
    "relative transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] " +
    "data-[annotated=true]:rounded-[var(--vercel-radius)] " +
    "data-[annotated=true]:bg-[var(--review-highlight-background)] " +
    "data-[annotated=true]:px-[var(--review-document-highlight-padding-inline)]";
  if (listItemProps) {
    return (
      <li
        {...listItemProps}
        {...blockProps}
        className={`${annotationClassName} ${listItemProps.className ?? ""}`}
      >
        {content}
      </li>
    );
  }
  return (
    <div {...blockProps} className={`${annotationClassName} ${blockClassName}`}>
      {content}
    </div>
  );
}

function createBasicMarkdownComponents(): Components {
  return {
    h1: ({ node, children, ...props }) => renderBlock("h1", node, <h1 {...props}>{children}</h1>),
    h2: ({ node, children, ...props }) => renderBlock("h2", node, <h2 {...props}>{children}</h2>),
    h3: ({ node, children, ...props }) => renderBlock("h3", node, <h3 {...props}>{children}</h3>),
    h4: ({ node, children, ...props }) => renderBlock("h4", node, <h4 {...props}>{children}</h4>),
    h5: ({ node, children, ...props }) => renderBlock("h5", node, <h5 {...props}>{children}</h5>),
    h6: ({ node, children, ...props }) => renderBlock("h6", node, <h6 {...props}>{children}</h6>),
    p: ({ node, children, ...props }) => renderBlock("p", node, <p {...props}>{children}</p>),
    li: ({ node, children, ...props }) => renderBlock("li", node, children, props),
    blockquote: ({ node, children, ...props }) =>
      renderBlock("blockquote", node, <blockquote {...props}>{children}</blockquote>),
    hr: ({ node, ...props }) => renderBlock("hr", node, <hr {...props} />),
  };
}

function createCodeMarkdownComponent(
  latestProps: React.RefObject<DocumentMarkdownTreeProps>,
): Components["pre"] {
  return function CodeBlockComponent({ node, children }) {
    const startLine = node?.position?.start.line ?? 0;
    const endLine = node?.position?.end.line ?? startLine;
    const blockId = `pre:${startLine}:${endLine}`;
    return renderBlock(
      "pre",
      node,
      <LazyDocumentCodeBlock
        activeCommentId={latestProps.current.activeCommentId}
        addComment={latestProps.current.addComment}
        blockId={blockId}
        comments={latestProps.current.comments}
        deleteComment={latestProps.current.deleteComment}
        sourceStartLine={startLine + 1}
        updateComment={latestProps.current.updateComment}
      >
        {children}
      </LazyDocumentCodeBlock>,
      undefined,
      false,
    );
  };
}

function createRichMarkdownComponents(
  latestProps: React.RefObject<DocumentMarkdownTreeProps>,
): Components {
  return {
    pre: createCodeMarkdownComponent(latestProps),
    table: ({ node, children, ...props }) => {
      const startLine = node?.position?.start.line ?? 0;
      const endLine = node?.position?.end.line ?? startLine;
      return renderBlock(
        "table",
        node,
        <LazyDocumentTable startLine={startLine} endLine={endLine} tableProps={props}>
          {children}
        </LazyDocumentTable>,
        undefined,
        false,
        "w-fit max-w-full",
      );
    },
    tr: ({ node, children, ...props }) => {
      const startLine = node?.position?.start.line ?? 0;
      return (
        <tr
          {...props}
          data-annotated="false"
          data-document-annotatable="true"
          data-document-line={startLine}
        >
          {children}
        </tr>
      );
    },
    a: ({ node: _node, children, ...props }) => (
      <a
        {...props}
        {...homeRouteDeps.documentMarkdownNavigation.linkAttributes({ href: props.href })}
      >
        {children}
      </a>
    ),
  };
}

function createMarkdownComponents(latestProps: React.RefObject<DocumentMarkdownTreeProps>) {
  return {
    ...createBasicMarkdownComponents(),
    ...createRichMarkdownComponents(latestProps),
  };
}

function addCommentFromCurrentSelection(props: DocumentMarkdownTreeProps) {
  window.setTimeout(function addSelectedTextComment() {
    const root = props.articleRef.current;
    if (!root) {
      return;
    }
    const textSelection = homeRouteDeps.reviewCommentInteraction.currentTextSelection({ root });
    if (!textSelection) {
      return;
    }
    const { selection, range, startElement, endElement } = textSelection;
    const startBlock = startElement?.closest<HTMLElement>("[data-document-block]");
    const endBlock = endElement?.closest<HTMLElement>("[data-document-block]");
    const isSelectionOutsideDocument =
      !startBlock || !endBlock || !root.contains(startBlock) || !root.contains(endBlock);
    if (isSelectionOutsideDocument) {
      return;
    }
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(startBlock);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = document.createRange();
    afterRange.selectNodeContents(endBlock);
    afterRange.setStart(range.endContainer, range.endOffset);
    const selectedDocumentLines =
      startBlock === endBlock
        ? homeRouteDeps.reviewCommentInteraction.selectedDocumentLineRange({
            root: startBlock,
            range,
          })
        : null;
    const now = new Date().toISOString();
    const comment: DocumentComment = {
      id: homeRouteDeps.reviewCommentInteraction.createId({}),
      selectedText: textSelection.selectedText.trim(),
      startBlockId: startBlock.dataset.documentBlock ?? "",
      endBlockId: endBlock.dataset.documentBlock ?? "",
      startLine:
        selectedDocumentLines?.startLine ??
        Number.parseInt(startBlock.dataset.startLine ?? "0", 10),
      endLine:
        selectedDocumentLines?.endLine ?? Number.parseInt(endBlock.dataset.endLine ?? "0", 10),
      prefix: beforeRange.toString().slice(-40),
      suffix: afterRange.toString().slice(0, 40),
      comment: "",
      createdAt: now,
      updatedAt: now,
    };
    props.captureScrollAnchor(startBlock);
    props.addComment(comment);
    selection.removeAllRanges();
  }, 0);
}

export const DocumentMarkdownTree = React.memo(function DocumentMarkdownTree(
  props: DocumentMarkdownTreeProps,
) {
  const latestProps = useRef(props);
  latestProps.current = props;
  const components = useMemo<Components>(() => createMarkdownComponents(latestProps), []);

  function handleMouseUp() {
    addCommentFromCurrentSelection(props);
  }

  return (
    <article
      ref={props.articleRef}
      onMouseUp={handleMouseUp}
      className="typeset typeset-docs max-w-none selection:bg-[#0070f3] selection:text-white"
    >
      <Suspense fallback={null}>
        <DocumentMarkdownRenderer components={components} onRendered={props.onMarkdownRendered}>
          {props.document.markdown}
        </DocumentMarkdownRenderer>
      </Suspense>
    </article>
  );
}, areDocumentMarkdownTreePropsEqual);

function areDocumentMarkdownTreePropsEqual(
  previous: DocumentMarkdownTreeProps,
  next: DocumentMarkdownTreeProps,
) {
  return previous.document === next.document;
}

function LazyDocumentTable(props: {
  children: React.ReactNode;
  endLine: number;
  startLine: number;
  tableProps: React.TableHTMLAttributes<HTMLTableElement>;
}) {
  const { isVisible, targetRef } = useLazyVisibility({});
  const renderedRowCount = Math.max(1, props.endLine - props.startLine);

  return (
    <div
      ref={targetRef}
      className="overflow-x-auto"
      data-lazy-document-table={isVisible ? "hydrated" : "pending"}
      style={{ minHeight: renderedRowCount * 41 }}
    >
      {isVisible ? <table {...props.tableProps}>{props.children}</table> : null}
    </div>
  );
}
