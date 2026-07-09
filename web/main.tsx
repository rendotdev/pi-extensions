import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import {
  Button,
  Card,
  Chip,
  CloseButton,
  Disclosure,
  DisclosureGroup,
  InputGroup,
  Spinner,
  TextArea,
  Toast,
  toast,
  Typography,
} from "@heroui/react";
import { Check, Copy as CopyIcon, MessageSquarePlus, X } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import {
  MultiFileDiff,
  type DiffLineAnnotation,
  type MultiFileDiffProps,
  type SelectedLineRange,
} from "@pierre/diffs/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type ReviewSourceFile = {
  id: string;
  location: string;
  language: string;
  oldContent: string;
  newContent: string;
  added: number;
  removed: number;
};

type ReviewComment = {
  id: string;
  fileLocation: string;
  selectedRowIds: string[];
  selectedText: string;
  side: "additions" | "deletions";
  selectedRange: SelectedLineRange;
  startLine: number | null;
  endLine: number | null;
  lineNumbers: number[];
  comment: string;
  createdAt: string;
  updatedAt: string;
};

type ReviewFile = {
  location: string;
  added: number;
  removed: number;
  comments: ReviewComment[];
};

type DocumentSource = {
  location?: string;
  markdown: string;
};

type DocumentComment = {
  id: string;
  selectedText: string;
  startBlockId: string;
  endBlockId: string;
  startLine: number;
  endLine: number;
  prefix: string;
  suffix: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

type ReviewStatus = "open" | "approved" | "changes_requested" | "canceled";

type ReviewJson = {
  version: 2;
  kind: "diff" | "document";
  status: ReviewStatus;
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  cwd: string;
  appDir: string;
  url?: string;
  reviewPath: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  files: ReviewFile[];
  document?: DocumentSource;
  documentComments: DocumentComment[];
};

type ReviewPayload = {
  kind: "diff" | "document";
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  cwd: string;
  appDir: string;
  reviewPath: string;
  generatedAt: string;
  files: ReviewSourceFile[];
  document?: DocumentSource;
};

type AppState = {
  payload: ReviewPayload;
  review: ReviewJson;
};

type CommentAnnotationMetadata = {
  commentId: string;
};

function errorDescription(error: unknown, fallback: string) {
  if (!(error instanceof Error) || error.message === "Failed to fetch") return fallback;
  return error.message;
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function")
    return window.crypto.randomUUID();
  return "comment-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

async function loadState(): Promise<AppState> {
  const [payloadResponse, reviewResponse] = await Promise.all([
    fetch("/api/payload"),
    fetch("/api/review"),
  ]);
  if (!payloadResponse.ok) throw new Error("Failed to load payload.");
  if (!reviewResponse.ok) throw new Error("Failed to load review.");
  const payload = (await payloadResponse.json()) as ReviewPayload;
  const review = (await reviewResponse.json()) as ReviewJson;
  return { payload, review };
}

async function saveReview(review: ReviewJson): Promise<ReviewJson> {
  const response = await fetch("/api/review", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(review),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as ReviewJson;
}

function reviewCommentCount(review: ReviewJson) {
  if (review.kind === "document") {
    return review.documentComments.filter((comment) => comment.comment.trim().length > 0).length;
  }
  return review.files.reduce(
    (total, file) =>
      total + file.comments.filter((comment) => comment.comment.trim().length > 0).length,
    0,
  );
}

function reviewFilesWithWrittenComments(review: ReviewJson) {
  return review.files.map((file) => ({
    ...file,
    comments: file.comments.filter((comment) => comment.comment.trim().length > 0),
  }));
}

function meaningfulReviewSignature(review: ReviewJson) {
  if (review.kind === "document") {
    return JSON.stringify(
      review.documentComments
        .filter((comment) => comment.comment.trim().length > 0)
        .map((comment) => ({
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
    reviewFilesWithWrittenComments(review).map((file) => ({
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

function reviewForSave(review: ReviewJson): ReviewJson {
  if (review.kind === "document") {
    return {
      ...review,
      documentComments: review.documentComments.filter(
        (comment) => comment.comment.trim().length > 0,
      ),
    };
  }
  return {
    ...review,
    files: reviewFilesWithWrittenComments(review),
  };
}

function updateReviewFile(
  review: ReviewJson,
  fileLocation: string,
  updater: (file: ReviewFile) => ReviewFile,
): ReviewJson {
  let changed = false;
  const files = review.files.map((file) => {
    if (file.location !== fileLocation) return file;
    const nextFile = updater(file);
    if (nextFile !== file) changed = true;
    return nextFile;
  });

  if (!changed) return review;
  return {
    ...review,
    updatedAt: new Date().toISOString(),
    files,
  };
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [copiedReviewPath, setCopiedReviewPath] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveTimer = useRef<number | null>(null);
  const saveRun = useRef(0);
  const lastSavedSignature = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadState()
      .then((nextState) => {
        if (cancelled) return;
        lastSavedSignature.current = meaningfulReviewSignature(nextState.review);
        setState(nextState);
      })
      .catch((loadError) => {
        if (cancelled) return;
        toast.danger("Unable to load the review", {
          description: errorDescription(
            loadError,
            "Check that the review server is still running.",
          ),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function queueSave(review: ReviewJson) {
    const signature = meaningfulReviewSignature(review);
    if (signature === lastSavedSignature.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setIsSaving(true);
    const run = saveRun.current + 1;
    saveRun.current = run;
    saveTimer.current = window.setTimeout(async () => {
      try {
        await saveReview(reviewForSave(review));
        if (run !== saveRun.current) return;
        lastSavedSignature.current = signature;
        setLastSavedAt(new Date());
      } catch (saveError) {
        if (run !== saveRun.current) return;
        toast.danger("Unable to save your comments", {
          description: errorDescription(
            saveError,
            "Check that the review server is still running.",
          ),
        });
      } finally {
        if (run === saveRun.current) setIsSaving(false);
      }
    }, 250);
  }

  function commitReview(updater: (review: ReviewJson) => ReviewJson) {
    setState((current) => {
      if (!current) return current;
      const nextReview = updater(current.review);
      if (nextReview === current.review) return current;
      queueSave(nextReview);
      return { ...current, review: nextReview };
    });
  }

  function addComment(
    file: ReviewSourceFile,
    selectedRange: SelectedLineRange,
    selectedTextOverride?: string,
  ) {
    const side = selectedRange.endSide || selectedRange.side || "additions";
    const startLine = Math.min(selectedRange.start, selectedRange.end);
    const endLine = Math.max(selectedRange.start, selectedRange.end);
    const lineNumbers = Array.from(
      { length: endLine - startLine + 1 },
      (_, index) => startLine + index,
    );
    const selectedText = selectedTextOverride?.trim()
      ? selectedTextOverride
      : getSelectedText(file, side, startLine, endLine);
    const now = new Date().toISOString();
    const comment: ReviewComment = {
      id: makeId(),
      fileLocation: file.location,
      selectedRowIds: [side + ":" + startLine + "-" + endLine],
      selectedText,
      side,
      selectedRange,
      startLine,
      endLine,
      lineNumbers,
      comment: "",
      createdAt: now,
      updatedAt: now,
    };

    commitReview((review) =>
      updateReviewFile(review, file.location, (reviewFile) => ({
        ...reviewFile,
        comments: [...reviewFile.comments, comment],
      })),
    );
    setActiveCommentId(comment.id);
  }

  function updateComment(fileLocation: string, commentId: string, patch: Partial<ReviewComment>) {
    commitReview((review) =>
      updateReviewFile(review, fileLocation, (reviewFile) => {
        let changed = false;
        const comments = reviewFile.comments.map((comment) => {
          if (comment.id !== commentId) return comment;
          const nextComment = { ...comment, ...patch, updatedAt: new Date().toISOString() };
          const hasChanged =
            JSON.stringify({ ...comment, updatedAt: undefined }) !==
            JSON.stringify({ ...nextComment, updatedAt: undefined });
          if (!hasChanged) return comment;
          changed = true;
          return nextComment;
        });
        return changed ? { ...reviewFile, comments } : reviewFile;
      }),
    );
  }

  function deleteComment(fileLocation: string, commentId: string) {
    commitReview((review) =>
      updateReviewFile(review, fileLocation, (reviewFile) => {
        const comments = reviewFile.comments.filter((comment) => comment.id !== commentId);
        return comments.length === reviewFile.comments.length
          ? reviewFile
          : { ...reviewFile, comments };
      }),
    );
  }

  function addDocumentComment(comment: DocumentComment) {
    commitReview((review) => ({
      ...review,
      updatedAt: new Date().toISOString(),
      documentComments: [...review.documentComments, comment],
    }));
    setActiveCommentId(comment.id);
  }

  function updateDocumentComment(commentId: string, patch: Partial<DocumentComment>) {
    commitReview((review) => {
      let changed = false;
      const documentComments = review.documentComments.map((comment) => {
        if (comment.id !== commentId) return comment;
        const nextComment = { ...comment, ...patch, updatedAt: new Date().toISOString() };
        const hasChanged =
          JSON.stringify({ ...comment, updatedAt: undefined }) !==
          JSON.stringify({ ...nextComment, updatedAt: undefined });
        if (!hasChanged) return comment;
        changed = true;
        return nextComment;
      });
      return changed
        ? { ...review, updatedAt: new Date().toISOString(), documentComments }
        : review;
    });
  }

  function deleteDocumentComment(commentId: string) {
    commitReview((review) => {
      const documentComments = review.documentComments.filter(
        (comment) => comment.id !== commentId,
      );
      return documentComments.length === review.documentComments.length
        ? review
        : { ...review, updatedAt: new Date().toISOString(), documentComments };
    });
  }

  async function copyReviewPath() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.payload.reviewPath);
      setCopiedReviewPath(true);
      window.setTimeout(() => setCopiedReviewPath(false), 1200);
    } catch {
      setCopiedReviewPath(false);
    }
  }

  async function finishReview(decision: "approved" | "changes_requested") {
    if (!state || isFinishing || isSaving) return;
    if (decision === "changes_requested" && reviewCommentCount(state.review) === 0) return;
    setIsFinishing(true);
    try {
      const response = await fetch("/api/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error(await response.text());
      const finishedReview = (await response.json()) as ReviewJson;
      setState((current) => (current ? { ...current, review: finishedReview } : current));
      window.setTimeout(() => {
        window.close();
        const heading = decision === "approved" ? "LGTM" : "Comments sent";
        document.body.innerHTML =
          '<main style="font-family: system-ui, sans-serif; padding: 2rem; color: #111827;"><h1>' +
          heading +
          "</h1><p>You can close this tab.</p></main>";
      }, 250);
    } catch (finishError) {
      setIsFinishing(false);
      toast.danger("Unable to finish the review", {
        description: errorDescription(
          finishError,
          "Check that the review server is still running.",
        ),
      });
    }
  }

  async function cancelReview() {
    if (!state || isFinishing) return;
    setIsFinishing(true);
    try {
      const response = await fetch("/api/cancel", { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      const canceledReview = (await response.json()) as ReviewJson;
      setState((current) => (current ? { ...current, review: canceledReview } : current));
      window.setTimeout(() => {
        window.close();
        document.body.innerHTML =
          '<main style="font-family: system-ui, sans-serif; padding: 2rem; color: #111827;"><h1>Review canceled</h1><p>You can close this tab.</p></main>';
      }, 250);
    } catch (cancelError) {
      setIsFinishing(false);
      toast.danger("Unable to cancel the review", {
        description: errorDescription(
          cancelError,
          "Check that the review server is still running.",
        ),
      });
    }
  }

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-700">
        <Spinner />
        <Typography.Paragraph size="sm" color="muted" className="ml-3">
          Loading review app...
        </Typography.Paragraph>
      </div>
    );
  }

  const { payload, review } = state;
  const commentCount = reviewCommentCount(review);
  const isFinished = review.status !== "open";
  const commentLabel = commentCount + " " + (commentCount === 1 ? "comment" : "comments");
  const decision = commentCount > 0 ? "changes_requested" : "approved";
  const decisionButtonLabel = isFinishing
    ? commentCount > 0
      ? "Sending"
      : "Approving"
    : isSaving
      ? "Saving"
      : commentCount > 0
        ? "Send " + commentLabel
        : "LGTM";
  const savedTime = lastSavedAt
    ? lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const contentMaxWidth = payload.kind === "document" ? "max-w-4xl" : "max-w-7xl";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className={"mx-auto px-4 py-5 " + contentMaxWidth}>
          <div className="flex min-w-0 items-center justify-between gap-4">
            <Typography.Heading
              level={1}
              truncate
              className="min-w-0 text-lg font-semibold leading-6 text-slate-950"
            >
              {payload.name}
            </Typography.Heading>
            <Typography
              type="body-xs"
              color="muted"
              aria-hidden={!isFinished && !savedTime}
              className={"shrink-0 leading-none " + (!isFinished && !savedTime ? "opacity-0" : "")}
            >
              {review.status === "approved"
                ? "Approved"
                : review.status === "changes_requested"
                  ? "Comments sent"
                  : review.status === "canceled"
                    ? "Canceled"
                    : savedTime
                      ? "Saved " + savedTime
                      : "Saved 00:00"}
            </Typography>
          </div>
          <div className="mt-3 flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
            <InputGroup
              fullWidth
              variant="secondary"
              aria-label="Review JSON path"
              className="min-w-0 flex-1 bg-slate-50 shadow-none md:max-w-xl"
            >
              <InputGroup.Input
                readOnly
                value={payload.reviewPath}
                className="font-mono text-xs text-slate-600"
                onFocus={(event) => event.currentTarget.select()}
              />
              <InputGroup.Suffix className="px-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 min-w-0 px-2 font-normal"
                  onClick={copyReviewPath}
                  aria-label="Copy review JSON path"
                >
                  {copiedReviewPath ? (
                    <Check size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
                  ) : (
                    <CopyIcon size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
                  )}
                  <Typography type="body-xs" weight="normal" className="leading-none">
                    {copiedReviewPath ? "Copied" : "Copy"}
                  </Typography>
                </Button>
              </InputGroup.Suffix>
            </InputGroup>
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-3 md:ml-auto md:justify-end">
              <Button
                size="sm"
                variant="outline"
                isDisabled={isFinished || isFinishing}
                onPress={cancelReview}
                aria-label="Cancel this review"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                isPending={isFinishing || isSaving}
                isDisabled={isFinished || isFinishing || isSaving}
                onPress={() => finishReview(decision)}
                aria-label={commentCount > 0 ? "Send review comments" : "Approve this review"}
              >
                {({ isPending }) => (
                  <span className="inline-flex items-center gap-2">
                    {isPending ? <Spinner size="sm" color="current" className="-ms-0.5" /> : null}
                    <span>{decisionButtonLabel}</span>
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className={"mx-auto flex flex-col gap-4 px-4 py-4 pb-[50vh] " + contentMaxWidth}>
        {payload.kind === "document" && payload.document ? (
          <DocumentReviewSurface
            document={payload.document}
            comments={review.documentComments}
            activeCommentId={activeCommentId}
            setActiveCommentId={setActiveCommentId}
            addComment={addDocumentComment}
            updateComment={updateDocumentComment}
            deleteComment={deleteDocumentComment}
          />
        ) : (
          <DisclosureGroup
            allowsMultipleExpanded
            defaultExpandedKeys={payload.files.map((file) => file.id)}
            className="flex flex-col gap-4"
          >
            {payload.files.map((file) => {
              const reviewFile = review.files.find((item) => item.location === file.location) || {
                location: file.location,
                added: file.added,
                removed: file.removed,
                comments: [],
              };
              return (
                <ReviewFileDiff
                  key={file.id}
                  file={file}
                  reviewFile={reviewFile}
                  activeCommentId={activeCommentId}
                  setActiveCommentId={setActiveCommentId}
                  addComment={addComment}
                  updateComment={updateComment}
                  deleteComment={deleteComment}
                />
              );
            })}
          </DisclosureGroup>
        )}
      </div>
    </div>
  );
}

type ReviewFileDiffProps = {
  file: ReviewSourceFile;
  reviewFile: ReviewFile;
  activeCommentId: string | null;
  setActiveCommentId: (id: string | null) => void;
  addComment: (
    file: ReviewSourceFile,
    selectedRange: SelectedLineRange,
    selectedTextOverride?: string,
  ) => void;
  updateComment: (fileLocation: string, commentId: string, patch: Partial<ReviewComment>) => void;
  deleteComment: (fileLocation: string, commentId: string) => void;
};

function DocumentReviewSurface(props: {
  document: DocumentSource;
  comments: DocumentComment[];
  activeCommentId: string | null;
  setActiveCommentId: (id: string | null) => void;
  addComment: (comment: DocumentComment) => void;
  updateComment: (commentId: string, patch: Partial<DocumentComment>) => void;
  deleteComment: (commentId: string) => void;
}) {
  const articleRef = useRef<HTMLElement | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;

  function renderBlock(
    tag: string,
    node: { position?: { start: { line: number }; end: { line: number } } } | undefined,
    content: React.ReactNode,
    listItemProps?: React.LiHTMLAttributes<HTMLLIElement>,
  ) {
    const startLine = node?.position?.start.line ?? 0;
    const endLine = node?.position?.end.line ?? startLine;
    const blockId = tag + ":" + startLine + ":" + endLine;
    const currentProps = latestProps.current;
    const annotations = currentProps.comments.filter((comment) => comment.endBlockId === blockId);
    const annotated = currentProps.comments.some(
      (comment) => comment.startLine <= endLine && comment.endLine >= startLine,
    );
    const blockContent = (
      <>
        <button
          type="button"
          className="document-review-comment-button not-prose"
          aria-label={`Comment on ${tag} block at ${startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`}`}
          title="Comment on this block"
          onClick={() => addBlockComment(blockId, startLine, endLine)}
        >
          <MessageSquarePlus size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {content}
        {annotations.map((comment) => (
          <div key={comment.id} className="not-prose">
            <CommentEditor
              id={comment.id}
              value={comment.comment}
              active={currentProps.activeCommentId === comment.id}
              setActiveCommentId={currentProps.setActiveCommentId}
              onChange={(value) => currentProps.updateComment(comment.id, { comment: value })}
              onFinish={(value) => {
                if (value.trim().length === 0) currentProps.deleteComment(comment.id);
                else currentProps.updateComment(comment.id, { comment: value });
              }}
              onDelete={() => currentProps.deleteComment(comment.id)}
            />
          </div>
        ))}
      </>
    );
    const blockProps = {
      "data-annotated": annotated ? "true" : "false",
      "data-document-block": blockId,
      "data-start-line": startLine,
      "data-end-line": endLine,
    };
    if (listItemProps) {
      return (
        <li
          {...listItemProps}
          {...blockProps}
          className={`document-review-block transition-colors ${listItemProps.className ?? ""}`}
        >
          {blockContent}
        </li>
      );
    }
    return (
      <div {...blockProps} className="document-review-block transition-colors">
        {blockContent}
      </div>
    );
  }

  function addBlockComment(blockId: string, startLine: number, endLine: number) {
    const currentProps = latestProps.current;
    const lines = currentProps.document.markdown.split(/\r?\n/);
    const before = lines.slice(0, Math.max(0, startLine - 1)).join("\n");
    const selectedText = lines
      .slice(Math.max(0, startLine - 1), endLine)
      .join("\n")
      .trim();
    const after = lines.slice(endLine).join("\n");
    const now = new Date().toISOString();
    currentProps.addComment({
      id: makeId(),
      selectedText,
      startBlockId: blockId,
      endBlockId: blockId,
      startLine,
      endLine,
      prefix: before.slice(-40),
      suffix: after.slice(0, 40),
      comment: "",
      createdAt: now,
      updatedAt: now,
    });
  }

  const components = useMemo<Components>(
    () => ({
      h1: ({ node, children, ...elementProps }) =>
        renderBlock("h1", node, <h1 {...elementProps}>{children}</h1>),
      h2: ({ node, children, ...elementProps }) =>
        renderBlock("h2", node, <h2 {...elementProps}>{children}</h2>),
      h3: ({ node, children, ...elementProps }) =>
        renderBlock("h3", node, <h3 {...elementProps}>{children}</h3>),
      h4: ({ node, children, ...elementProps }) =>
        renderBlock("h4", node, <h4 {...elementProps}>{children}</h4>),
      h5: ({ node, children, ...elementProps }) =>
        renderBlock("h5", node, <h5 {...elementProps}>{children}</h5>),
      h6: ({ node, children, ...elementProps }) =>
        renderBlock("h6", node, <h6 {...elementProps}>{children}</h6>),
      p: ({ node, children, ...elementProps }) =>
        renderBlock("p", node, <p {...elementProps}>{children}</p>),
      li: ({ node, children, ...elementProps }) => renderBlock("li", node, children, elementProps),
      pre: ({ node, children, ...elementProps }) =>
        renderBlock("pre", node, <pre {...elementProps}>{children}</pre>),
      blockquote: ({ node, children, ...elementProps }) =>
        renderBlock("blockquote", node, <blockquote {...elementProps}>{children}</blockquote>),
      table: ({ node, children, ...elementProps }) =>
        renderBlock(
          "table",
          node,
          <div className="overflow-x-auto">
            <table {...elementProps}>{children}</table>
          </div>,
        ),
      hr: ({ node, ...elementProps }) => renderBlock("hr", node, <hr {...elementProps} />),
      a: ({ node: _node, children, ...elementProps }) => (
        <a {...elementProps} target="_blank" rel="noreferrer">
          {children}
        </a>
      ),
    }),
    [],
  );

  function handleMouseUp() {
    window.setTimeout(() => {
      const root = articleRef.current;
      const selection = document.getSelection();
      if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const selectedText = selection.toString().trim();
      if (!selectedText) return;
      const range = selection.getRangeAt(0);
      const startElement = getElementFromNode(range.startContainer);
      const endElement = getElementFromNode(range.endContainer);
      if (
        startElement?.closest("[data-review-comment]") ||
        endElement?.closest("[data-review-comment]")
      )
        return;
      const startBlock = startElement?.closest<HTMLElement>("[data-document-block]");
      const endBlock = endElement?.closest<HTMLElement>("[data-document-block]");
      if (!startBlock || !endBlock || !root.contains(startBlock) || !root.contains(endBlock))
        return;

      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(root);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const fullText = root.textContent ?? "";
      const startOffset = beforeRange.toString().length;
      const now = new Date().toISOString();
      const comment: DocumentComment = {
        id: makeId(),
        selectedText,
        startBlockId: startBlock.dataset.documentBlock ?? "",
        endBlockId: endBlock.dataset.documentBlock ?? "",
        startLine: Number.parseInt(startBlock.dataset.startLine ?? "0", 10),
        endLine: Number.parseInt(endBlock.dataset.endLine ?? "0", 10),
        prefix: fullText.slice(Math.max(0, startOffset - 40), startOffset),
        suffix: fullText.slice(
          startOffset + selectedText.length,
          startOffset + selectedText.length + 40,
        ),
        comment: "",
        createdAt: now,
        updatedAt: now,
      };
      props.addComment(comment);
      selection.removeAllRanges();
    }, 0);
  }

  return (
    <div className="bg-white">
      {props.document.location ? (
        <div className="pb-6 font-mono text-xs text-slate-500">{props.document.location}</div>
      ) : null}
      <article
        ref={articleRef}
        onMouseUp={handleMouseUp}
        className="document-review-surface prose prose-slate max-w-none"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {props.document.markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}

const textSelectionCleanupByNode = new WeakMap<HTMLElement, () => void>();

function installTextSelectionCommentHook(
  node: HTMLElement,
  phase: string,
  file: ReviewSourceFile,
  addTextSelectionComment: (range: SelectedLineRange, selectedText: string) => void,
) {
  if (phase === "unmount") {
    textSelectionCleanupByNode.get(node)?.();
    textSelectionCleanupByNode.delete(node);
    return;
  }

  if (textSelectionCleanupByNode.has(node)) return;

  const root = node.shadowRoot ?? node;
  const handleMouseUp = () => {
    window.setTimeout(() => {
      const selection = getSelectionFromRoot(root);
      const selectedText = selection?.toString() ?? "";
      if (
        !selection ||
        selection.isCollapsed ||
        selectedText.trim().length === 0 ||
        selection.rangeCount === 0
      )
        return;

      const range = selection.getRangeAt(0);
      const startElement = getElementFromNode(range.startContainer);
      const endElement = getElementFromNode(range.endContainer);
      if (
        startElement?.closest("[data-review-comment]") ||
        endElement?.closest("[data-review-comment]")
      )
        return;

      const selectedRange = getSelectedLineRangeFromNativeRange(root, range);
      if (!selectedRange) return;

      addTextSelectionComment(selectedRange, selectedText);
      selection.removeAllRanges();
    }, 0);
  };

  root.addEventListener("mouseup", handleMouseUp);
  textSelectionCleanupByNode.set(node, () => root.removeEventListener("mouseup", handleMouseUp));
}

const reviewDiffUnsafeCSS = [
  ':host { --review-radius: 6px; --diffs-font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --diffs-header-font-family: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --diffs-light-bg: #fff; --diffs-light: #000; --diffs-bg-context-override: #fafafa; --diffs-bg-context-gutter-override: #fafafa; --diffs-bg-separator-override: #f5f5f5; --diffs-modified-color: #000; --diffs-bg-hover-override: #0070f3; --diffs-bg-selection-override: #0070f3; --diffs-bg-selection-number-override: #0070f3; --diffs-selection-number-fg: #0070f3; }',
  '[data-diffs-header="default"] { padding-inline: 0 !important; border-radius: var(--review-radius) var(--review-radius) 0 0 !important; }',
  '[data-diffs-header="default"] [data-header-content] { margin-left: 0 !important; }',
  '[data-diffs-header="default"] [data-metadata] { padding-right: 0 !important; }',
  "[data-change-icon] { opacity: 0.72; transform: scale(0.9); transform-origin: center; }",
  "[data-diff-span] { border-radius: var(--review-radius) !important; }",
  "[data-separator-content], [data-expand-button], [data-separator-wrapper] { border-radius: var(--review-radius) !important; }",
].join("\n");

function getSelectionFromRoot(root: ShadowRoot | HTMLElement): Selection | null {
  const shadowSelection =
    root instanceof ShadowRoot
      ? (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.()
      : null;
  if (shadowSelection && !shadowSelection.isCollapsed) return shadowSelection;
  return document.getSelection();
}

function getElementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function getLineSide(element: HTMLElement): "additions" | "deletions" {
  const lineType = element.getAttribute("data-line-type") ?? "";
  return lineType.includes("deletion") ? "deletions" : "additions";
}

function getSelectedLineRangeFromNativeRange(
  root: ShadowRoot | HTMLElement,
  range: Range,
): SelectedLineRange | null {
  const lineElements = Array.from(
    root.querySelectorAll<HTMLElement>("[data-line][data-line-index]"),
  ).filter((element) => {
    try {
      return range.intersectsNode(element);
    } catch {
      return false;
    }
  });

  if (lineElements.length === 0) return null;

  const hasAddition = lineElements.some((element) => getLineSide(element) === "additions");
  const side: "additions" | "deletions" = hasAddition ? "additions" : "deletions";
  const lineNumbers = lineElements
    .filter((element) => getLineSide(element) === side)
    .map((element) => Number.parseInt(element.getAttribute("data-line") ?? "", 10))
    .filter((lineNumber) => Number.isFinite(lineNumber));

  if (lineNumbers.length === 0) return null;
  return {
    start: Math.min(...lineNumbers),
    end: Math.max(...lineNumbers),
    side,
    endSide: side,
  };
}

function ReviewFileDiff(props: ReviewFileDiffProps) {
  const { file, reviewFile } = props;
  const [copied, setCopied] = useState(false);
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null | undefined>();
  const propsRef = useRef(props);
  propsRef.current = props;
  const clearSelectedLines = useCallback(() => {
    setSelectedLines(null);
    window.requestAnimationFrame(() => setSelectedLines(undefined));
  }, []);
  const oldFile = useMemo(
    () => ({ name: file.location, contents: file.oldContent, lang: file.language as never }),
    [file.location, file.oldContent, file.language],
  );
  const newFile = useMemo(
    () => ({ name: file.location, contents: file.newContent, lang: file.language as never }),
    [file.location, file.newContent, file.language],
  );
  const annotations = useMemo<DiffLineAnnotation<CommentAnnotationMetadata>[]>(() => {
    return reviewFile.comments
      .filter((comment) => comment.startLine !== null && comment.endLine !== null)
      .map((comment) => ({
        side: comment.side,
        lineNumber: comment.endLine ?? comment.startLine ?? 0,
        metadata: { commentId: comment.id },
      }));
  }, [reviewFile.comments]);
  const diffOptions = useMemo<
    NonNullable<MultiFileDiffProps<CommentAnnotationMetadata>["options"]>
  >(
    () => ({
      theme: "github-light",
      diffStyle: "unified",
      diffIndicators: "classic",
      hunkSeparators: "metadata",
      lineDiffType: "word",
      unsafeCSS: reviewDiffUnsafeCSS,
      enableLineSelection: true,
      onLineSelectionEnd: (range) => {
        if (range) {
          setSelectedLines(range);
          propsRef.current.addComment(file, range);
        } else {
          clearSelectedLines();
        }
      },
      onPostRender: (node, _instance, phase) => {
        installTextSelectionCommentHook(node, phase, file, (range, selectedText) => {
          setSelectedLines(range);
          propsRef.current.addComment(file, range, selectedText);
        });
      },
    }),
    [clearSelectedLines, file],
  );

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(file.location);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  const writtenCommentCount = reviewFile.comments.filter(
    (comment) => comment.comment.trim().length > 0,
  ).length;

  return (
    <Disclosure
      id={file.id}
      className="overflow-hidden rounded-[var(--vercel-radius)] border border-slate-300 bg-white"
    >
      <Disclosure.Heading>
        <Disclosure.Trigger className="group flex w-full items-center justify-between gap-4 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50">
          <span className="flex min-w-0 items-center gap-3">
            <Disclosure.Indicator className="shrink-0 text-slate-500 transition-transform group-data-[expanded=true]:rotate-90" />
            <span className="min-w-0">
              <Typography
                type="body-sm"
                weight="semibold"
                truncate
                className="block text-slate-950"
              >
                {file.location}
              </Typography>
              <Typography type="body-xs" color="muted" className="mt-1 block leading-none">
                +{file.added} -{file.removed}
              </Typography>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {writtenCommentCount > 0 ? (
              <Chip size="sm" variant="soft" color="accent">
                <Chip.Label>
                  {writtenCommentCount} {writtenCommentCount === 1 ? "comment" : "comments"}
                </Chip.Label>
              </Chip>
            ) : null}
          </span>
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content className="border-t border-slate-200">
        <Card className="border-0 bg-white shadow-none" variant="transparent">
          <Card.Content className="p-0">
            <MultiFileDiff<CommentAnnotationMetadata>
              className="review-diff-surface block"
              oldFile={oldFile}
              newFile={newFile}
              disableWorkerPool
              selectedLines={selectedLines}
              lineAnnotations={annotations}
              options={diffOptions}
              renderHeaderMetadata={() => (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="font-normal"
                    onClick={copyPath}
                    aria-label="Copy file path"
                  >
                    {copied ? (
                      <Check size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
                    ) : (
                      <CopyIcon
                        size={14}
                        strokeWidth={1.5}
                        absoluteStrokeWidth
                        aria-hidden="true"
                      />
                    )}
                    <Typography type="body-sm" weight="normal" className="leading-none">
                      {copied ? "Copied" : "Copy"}
                    </Typography>
                  </Button>
                </div>
              )}
              renderAnnotation={(annotation) => {
                const comment = reviewFile.comments.find(
                  (item) => item.id === annotation.metadata.commentId,
                );
                if (!comment) return null;
                return (
                  <CommentAnnotation
                    key={comment.id}
                    file={file}
                    comment={comment}
                    active={props.activeCommentId === comment.id}
                    clearSelectedLines={clearSelectedLines}
                    setActiveCommentId={props.setActiveCommentId}
                    updateComment={props.updateComment}
                    deleteComment={props.deleteComment}
                  />
                );
              }}
            />
          </Card.Content>
        </Card>
      </Disclosure.Content>
    </Disclosure>
  );
}

function CommentAnnotation(props: {
  file: ReviewSourceFile;
  comment: ReviewComment;
  active: boolean;
  clearSelectedLines: () => void;
  setActiveCommentId: (id: string | null) => void;
  updateComment: (fileLocation: string, commentId: string, patch: Partial<ReviewComment>) => void;
  deleteComment: (fileLocation: string, commentId: string) => void;
}) {
  const comment = props.comment;
  return (
    <CommentEditor
      id={comment.id}
      value={comment.comment}
      active={props.active}
      setActiveCommentId={props.setActiveCommentId}
      onChange={(value) => props.updateComment(props.file.location, comment.id, { comment: value })}
      onFinish={(value) => {
        props.clearSelectedLines();
        if (value.trim().length === 0) props.deleteComment(props.file.location, comment.id);
        else props.updateComment(props.file.location, comment.id, { comment: value });
      }}
      onDelete={() => {
        props.clearSelectedLines();
        props.deleteComment(props.file.location, comment.id);
      }}
    />
  );
}

function CommentEditor(props: {
  id: string;
  value: string;
  active: boolean;
  setActiveCommentId: (id: string | null) => void;
  onChange: (value: string) => void;
  onFinish: (value: string) => void;
  onDelete: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const form = useForm({
    defaultValues: {
      comment: props.value,
    },
  });

  function finishComment(value: string) {
    props.onFinish(value);
    props.setActiveCommentId(null);
  }

  useEffect(() => {
    if (!props.active || !textareaRef.current) return;
    textareaRef.current.focus();
    textareaRef.current.selectionStart = textareaRef.current.value.length;
    textareaRef.current.selectionEnd = textareaRef.current.value.length;
  }, [props.active, props.id]);

  useEffect(() => {
    if (textareaRef.current) resizeTextarea(textareaRef.current);
  }, [props.id]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  function handleClearComment() {
    props.setActiveCommentId(null);
    props.onDelete();
  }

  return (
    <div
      data-review-comment="true"
      className="flex items-center bg-[#0070f3]/10 px-6 py-3 font-sans"
    >
      <form.Field
        name="comment"
        listeners={{
          onChangeDebounceMs: 750,
          onChange: ({ value }) => props.onChange(value),
          onBlur: ({ value }) => finishComment(value),
        }}
      >
        {(field) => (
          <div className="relative w-full">
            <TextArea
              ref={textareaRef}
              aria-label="Review comment"
              className="min-h-11 w-full overflow-hidden pr-10 font-sans text-sm leading-5"
              placeholder="Add review comment..."
              value={field.state.value}
              variant="secondary"
              onFocus={() => props.setActiveCommentId(props.id)}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.currentTarget.value);
                resizeTextarea(event.currentTarget);
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              style={{ resize: "none" }}
            />
            {field.state.value.length > 0 ? (
              <CloseButton
                aria-label="Clear comment"
                className="absolute right-2 top-2 z-10 text-slate-500 hover:text-slate-900"
                onMouseDown={(event) => event.preventDefault()}
                onPress={handleClearComment}
              >
                <X size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
              </CloseButton>
            ) : null}
          </div>
        )}
      </form.Field>
    </div>
  );
}

function getSelectedText(
  file: ReviewSourceFile,
  side: "additions" | "deletions",
  startLine: number,
  endLine: number,
) {
  const source = side === "additions" ? file.newContent : file.oldContent;
  return source
    .split(/\r\n|\r|\n/)
    .slice(startLine - 1, endLine)
    .join("\n");
}

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = Math.max(44, textarea.scrollHeight) + "px";
}

createRoot(document.getElementById("root")!).render(
  <>
    <Toast.Provider placement="bottom end" />
    <App />
  </>,
);
