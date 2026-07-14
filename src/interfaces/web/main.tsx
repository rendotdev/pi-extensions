import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import {
  AlertDialog,
  Button,
  ButtonGroup,
  Card,
  Chip,
  CloseButton,
  Disclosure,
  DisclosureGroup,
  InputGroup,
  Spinner,
  TextArea,
  Toast,
  Tooltip,
  Typography,
  useTheme,
} from "@heroui/react";
import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy as CopyIcon,
  MessageSquarePlus,
  Monitor,
  Moon,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { useAsyncDebouncer } from "@tanstack/react-pacer/async-debouncer";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { parseDiffFromFile, type DiffLineAnnotation, type FileDiffMetadata } from "@pierre/diffs";
import { AnimatePresence, motion } from "motion/react";
import {
  FileDiff,
  type FileDiffProps,
  type SelectedLineRange,
  WorkerPoolContextProvider,
} from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DiffStyle, LgtmPreferences } from "../../domain/preferences/preferences.ts";
import { ReviewHandoff } from "../../domain/review/review-handoff.ts";
import { CommentDraft } from "./comment-draft.ts";
import { PreferencesApi } from "./preferences-api.ts";
import { ToastNotifications } from "./toast-notifications.ts";
import { ReviewWindowTitle } from "./window-title.ts";

type ReviewSourceFile = {
  id: string;
  location: string;
  language: string;
  oldContent: string;
  newContent: string;
  added: number;
  removed: number;
};

const parsedFileDiffCache = new WeakMap<ReviewSourceFile, FileDiffMetadata>();
const defaultCollapsedChangedLineThreshold = 500;
const largeDiffWordHighlightThreshold = 2_000;
const snappyTransition = {
  duration: 0.14,
  ease: [0.2, 0, 0, 1] as const,
};
const reviewIconSize = 14;
const reviewIconStrokeWidth = 1.5;

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

async function finishReviewRequest(
  decision: "approved" | "changes_requested",
): Promise<ReviewJson> {
  const response = await fetch("/api/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as ReviewJson;
}

async function cancelReviewRequest(): Promise<ReviewJson> {
  const response = await fetch("/api/cancel", { method: "POST" });
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

function reviewHasCommentEntries(review: ReviewJson) {
  return review.kind === "document"
    ? review.documentComments.length > 0
    : review.files.some((file) => file.comments.length > 0);
}

function clearReviewComments(review: ReviewJson): ReviewJson {
  if (!reviewHasCommentEntries(review)) return review;
  return {
    ...review,
    updatedAt: new Date().toISOString(),
    files: review.files.map((file) =>
      file.comments.length > 0 ? { ...file, comments: [] } : file,
    ),
    documentComments: [],
  };
}

function meaningfulReviewSignature(review: ReviewJson) {
  if (review.kind === "document") {
    return JSON.stringify(
      review.documentComments.map((comment) => ({
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
    review.files.map((file) => ({
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

function getDefaultCollapsedFileIds(state: AppState) {
  if (state.payload.kind !== "diff") return new Set<string>();

  return new Set(
    state.payload.files
      .filter((file) => {
        const reviewFile = state.review.files.find((item) => item.location === file.location);
        return (
          file.added + file.removed >= defaultCollapsedChangedLineThreshold &&
          !reviewFile?.comments.length
        );
      })
      .map((file) => file.id),
  );
}

function App() {
  const { resolvedTheme, setTheme, theme } = useTheme("system");
  const queryClient = useQueryClient();
  const [state, setState] = useState<AppState | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [copiedReviewPath, setCopiedReviewPath] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null);
  const [collapsedFileIds, setCollapsedFileIds] = useState<Set<string>>(() => new Set());
  const reviewHeaderRef = useRef<HTMLElement | null>(null);
  const deleteAllTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lastSavedSignature = useRef<string | null>(null);
  const preferencesQuery = useQuery({
    queryKey: ["preferences"],
    queryFn: () => PreferencesApi.get(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const preferencesMutation = useMutation({
    mutationFn: (preferences: LgtmPreferences) => PreferencesApi.update({ preferences }),
    onMutate: async (preferences) => {
      await queryClient.cancelQueries({ queryKey: ["preferences"] });
      const previousPreferences = queryClient.getQueryData<LgtmPreferences>(["preferences"]);
      queryClient.setQueryData(["preferences"], preferences);
      return { previousPreferences };
    },
    onError: (_error, _preferences, context) => {
      queryClient.setQueryData(
        ["preferences"],
        context?.previousPreferences ?? { diffStyle: "unified" },
      );
      ToastNotifications.preferencesNotSaved();
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(["preferences"], preferences);
    },
  });
  const reviewStateQuery = useQuery({
    queryKey: ["review-state"],
    queryFn: loadState,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const reviewSaveMutation = useMutation({ mutationFn: saveReview });
  const finishReviewMutation = useMutation({ mutationFn: finishReviewRequest });
  const cancelReviewMutation = useMutation({ mutationFn: cancelReviewRequest });
  const diffStyle = preferencesQuery.data?.diffStyle ?? "unified";
  const diffThemeType = resolvedTheme === "dark" ? "dark" : "light";
  const diffTheme = diffThemeType === "dark" ? "github-dark" : "github-light";

  useEffect(() => {
    if (!preferencesQuery.error) return;
    ToastNotifications.preferencesUnavailable();
  }, [preferencesQuery.error]);

  useEffect(() => {
    if (!reviewStateQuery.data) return;
    const nextState = reviewStateQuery.data;
    lastSavedSignature.current = meaningfulReviewSignature(nextState.review);
    document.title = ReviewWindowTitle.format({
      cwd: nextState.payload.cwd,
      name: nextState.payload.name,
    });
    setCollapsedFileIds(getDefaultCollapsedFileIds(nextState));
    setState(nextState);
  }, [reviewStateQuery.data]);

  useEffect(() => {
    if (!reviewStateQuery.error) return;
    ToastNotifications.reviewUnavailable();
  }, [reviewStateQuery.error]);

  const isLoaded = state !== null;
  useLayoutEffect(() => {
    const Header = reviewHeaderRef.current;
    if (!Header) return;
    function updateHeaderHeight() {
      const CurrentHeader = reviewHeaderRef.current;
      if (!CurrentHeader) return;
      document.documentElement.style.setProperty(
        "--review-header-height",
        `${CurrentHeader.getBoundingClientRect().height}px`,
      );
    }
    const Observer = new ResizeObserver(updateHeaderHeight);
    Observer.observe(Header);
    updateHeaderHeight();
    return () => {
      Observer.disconnect();
      document.documentElement.style.removeProperty("--review-header-height");
    };
  }, [isLoaded]);

  const saveDebouncer = useAsyncDebouncer(
    async (review: ReviewJson) => {
      const savedReview = await reviewSaveMutation.mutateAsync(review);
      lastSavedSignature.current = meaningfulReviewSignature(savedReview);
      setLastSavedAt(new Date());
      return savedReview;
    },
    {
      wait: 400,
      onError: () => {
        ToastNotifications.commentsNotSaved();
      },
    },
    (saveState) => ({ isExecuting: saveState.isExecuting }),
  );
  const isSaving = saveDebouncer.state.isExecuting || reviewSaveMutation.isPending;

  const queueSave = useCallback(
    (review: ReviewJson) => {
      if (meaningfulReviewSignature(review) === lastSavedSignature.current) return;
      void saveDebouncer.maybeExecute(review);
    },
    [saveDebouncer],
  );

  const commitReview = useCallback(
    (updater: (review: ReviewJson) => ReviewJson) => {
      setState((current) => {
        if (!current) return current;
        const nextReview = updater(current.review);
        if (nextReview === current.review) return current;
        queueSave(nextReview);
        return { ...current, review: nextReview };
      });
    },
    [queueSave],
  );

  const setFileExpanded = useCallback((fileId: string, isExpanded: boolean) => {
    setCollapsedFileIds((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const addComment = useCallback(
    (file: ReviewSourceFile, selectedRange: SelectedLineRange, selectedTextOverride?: string) => {
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
    },
    [commitReview],
  );

  const updateComment = useCallback(
    (fileLocation: string, commentId: string, patch: Partial<ReviewComment>) => {
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
    },
    [commitReview],
  );

  const deleteComment = useCallback(
    (fileLocation: string, commentId: string) => {
      commitReview((review) =>
        updateReviewFile(review, fileLocation, (reviewFile) => {
          const comments = reviewFile.comments.filter((comment) => comment.id !== commentId);
          return comments.length === reviewFile.comments.length
            ? reviewFile
            : { ...reviewFile, comments };
        }),
      );
    },
    [commitReview],
  );

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

  function clearComments() {
    if (!state || isFinished || isFinishing || isSaving) return;
    setIsDeleteDialogOpen(false);
    setActiveCommentId(null);
    commitReview(clearReviewComments);
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
    setRecoveryStatus(null);
    try {
      await navigator.clipboard.writeText(
        ReviewHandoff.clipboardText({ decision, review: state.review }),
      );
      setCopiedReviewPath(true);
    } catch {
      setIsFinishing(false);
      setCopiedReviewPath(false);
      ToastNotifications.copyFailed();
      return;
    }
    saveDebouncer.cancel();
    try {
      const savedReview = await reviewSaveMutation.mutateAsync(state.review);
      lastSavedSignature.current = meaningfulReviewSignature(savedReview);
    } catch {
      setIsFinishing(false);
      setCopiedReviewPath(false);
      try {
        await navigator.clipboard.writeText(ReviewHandoff.fallbackText({ review: state.review }));
        setRecoveryStatus("Comments copied");
      } catch {
        setRecoveryStatus("Comments kept in this tab");
      }
      return;
    }
    try {
      const finishedReview = await finishReviewMutation.mutateAsync(decision);
      setState((current) => (current ? { ...current, review: finishedReview } : current));
      window.close();
      window.setTimeout(() => {
        window.close();
      }, 50);
    } catch {
      setIsFinishing(false);
      setCopiedReviewPath(false);
      setRecoveryStatus("Review saved but not finished");
    }
  }

  async function cancelReview() {
    if (!state || isFinishing || isSaving) return;
    setIsFinishing(true);
    saveDebouncer.cancel();
    try {
      const canceledReview = await cancelReviewMutation.mutateAsync();
      setState((current) => (current ? { ...current, review: canceledReview } : current));
      window.setTimeout(() => {
        window.close();
        document.body.innerHTML =
          '<main style="font-family: system-ui, sans-serif; padding: 2rem; color: #111827;"><h1>Review canceled</h1><p>You can close this tab.</p></main>';
      }, 250);
    } catch {
      setIsFinishing(false);
      ToastNotifications.cancelFailed();
    }
  }

  const primaryDecision =
    state && reviewCommentCount(state.review) > 0 ? "changes_requested" : "approved";
  const canFinishReview =
    Boolean(state) &&
    state?.review.status === "open" &&
    !isFinishing &&
    !isSaving &&
    !isDeleteDialogOpen;
  useHotkey(
    "Mod+Enter",
    () => {
      void finishReview(primaryDecision);
    },
    { enabled: canFinishReview, ignoreInputs: false },
  );

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center text-foreground">
        <Spinner />
        <Typography.Paragraph size="sm" color="muted" className="ml-3">
          Loading review app...
        </Typography.Paragraph>
      </div>
    );
  }

  const { payload, review } = state;
  const commentCount = reviewCommentCount(review);
  const hasCommentEntries = reviewHasCommentEntries(review);
  const isFinished = review.status !== "open";
  const decision = primaryDecision;
  const decisionButtonLabel = commentCount > 0 ? `Send (${commentCount})` : "Approve";
  const primaryShortcutLabel = formatForDisplay("Mod+Enter");
  const savedTime = lastSavedAt
    ? lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const reviewStatusLabel =
    recoveryStatus ??
    (review.status === "approved"
      ? "Approved"
      : review.status === "changes_requested"
        ? "Comments sent"
        : review.status === "canceled"
          ? "Canceled"
          : savedTime
            ? "Saved " + savedTime
            : null);
  const contentMaxWidth = payload.kind === "document" ? "max-w-4xl" : "max-w-7xl";
  const canToggleFiles = payload.kind === "diff" && payload.files.length > 0;
  const isDeleteAllDisabled = isFinished || isFinishing || isSaving || !hasCommentEntries;
  const hasExpandedFiles =
    canToggleFiles && payload.files.some((file) => !collapsedFileIds.has(file.id));
  const reviewPathParts = payload.reviewPath.split(/[\\/]/).filter(Boolean);
  const reviewFileName = reviewPathParts.at(-1) ?? "review.json";
  const reviewSessionName = reviewPathParts.at(-2) ?? "session";
  const displayedReviewPath =
    reviewSessionName.length > 24
      ? `${reviewSessionName.slice(0, 14)}…${reviewSessionName.slice(-7)}/${reviewFileName}`
      : `${reviewSessionName}/${reviewFileName}`;

  function toggleAllFiles() {
    if (!canToggleFiles) return;
    setCollapsedFileIds(
      hasExpandedFiles ? new Set(payload.files.map((file) => file.id)) : new Set(),
    );
  }

  function handleDeleteDialogOpenChange(isOpen: boolean) {
    setIsDeleteDialogOpen(isOpen && !isDeleteAllDisabled);
    if (!isOpen) window.requestAnimationFrame(() => deleteAllTriggerRef.current?.focus());
  }

  function updateDiffStyle(nextDiffStyle: DiffStyle) {
    if (nextDiffStyle === diffStyle || preferencesMutation.isPending) return;
    preferencesMutation.mutate({ diffStyle: nextDiffStyle });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header
        ref={reviewHeaderRef}
        className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur"
      >
        <div className={"mx-auto px-4 py-5 " + contentMaxWidth}>
          <div className="flex min-w-0 items-center justify-between gap-4">
            <Typography.Heading
              level={1}
              truncate
              className="min-w-0 text-lg font-semibold leading-6 text-foreground"
            >
              {payload.name}
            </Typography.Heading>
            <div className="flex w-32 shrink-0 items-center justify-end gap-2" aria-live="polite">
              <span className="relative h-4 w-4 shrink-0">
                <AnimatePresence initial={false}>
                  {isFinishing || isSaving ? (
                    <motion.span
                      key="loading"
                      className="absolute inset-0 flex items-center justify-center text-muted"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={snappyTransition}
                    >
                      <Spinner
                        size="sm"
                        color="current"
                        aria-label={isFinishing ? "Finishing review" : "Saving review"}
                      />
                    </motion.span>
                  ) : reviewStatusLabel ? (
                    <motion.span
                      key="saved"
                      className="absolute inset-0 flex items-center justify-center text-muted"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={snappyTransition}
                    >
                      <Check
                        size={reviewIconSize}
                        strokeWidth={reviewIconStrokeWidth}
                        absoluteStrokeWidth
                        aria-hidden="true"
                      />
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </span>
              {reviewStatusLabel ? (
                <Typography type="body-xs" color="muted" className="shrink-0 leading-none">
                  {reviewStatusLabel}
                </Typography>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
            <InputGroup
              fullWidth
              variant="secondary"
              aria-label="Review JSON path"
              className="group/review-path min-w-0 flex-1 bg-field-background shadow-none md:max-w-md"
            >
              <InputGroup.Input
                readOnly
                value={displayedReviewPath}
                className="font-mono text-xs text-muted"
                onFocus={(event) => event.currentTarget.select()}
              />
              <InputGroup.Suffix className="px-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 min-w-0 px-2 font-normal opacity-0 transition-opacity duration-[var(--motion-duration)] ease-[var(--motion-ease)] group-focus-within/review-path:opacity-100 group-hover/review-path:opacity-100"
                  onClick={copyReviewPath}
                  aria-label="Copy review JSON path"
                >
                  {copiedReviewPath ? (
                    <Check
                      size={reviewIconSize}
                      strokeWidth={reviewIconStrokeWidth}
                      absoluteStrokeWidth
                      aria-hidden="true"
                    />
                  ) : (
                    <CopyIcon
                      size={reviewIconSize}
                      strokeWidth={reviewIconStrokeWidth}
                      absoluteStrokeWidth
                      aria-hidden="true"
                    />
                  )}
                  <Typography type="body-xs" weight="normal" className="leading-none">
                    {copiedReviewPath ? "Copied" : "Copy"}
                  </Typography>
                </Button>
              </InputGroup.Suffix>
            </InputGroup>
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 md:ml-auto md:justify-end">
              {payload.kind === "diff" ? (
                <ButtonGroup size="sm" aria-label="Diff layout">
                  <Button
                    variant="ghost"
                    className={diffStyle === "unified" ? "bg-default" : undefined}
                    aria-pressed={diffStyle === "unified"}
                    isDisabled={preferencesMutation.isPending}
                    onPress={() => updateDiffStyle("unified")}
                  >
                    Unified
                  </Button>
                  <Button
                    variant="outline"
                    className={diffStyle === "split" ? "bg-default" : undefined}
                    aria-pressed={diffStyle === "split"}
                    isDisabled={preferencesMutation.isPending}
                    onPress={() => updateDiffStyle("split")}
                  >
                    Side by side
                  </Button>
                </ButtonGroup>
              ) : null}
              <ButtonGroup size="sm" aria-label="Color theme">
                <Button
                  variant={theme === "light" ? "secondary" : "outline"}
                  isIconOnly
                  aria-label="Use light theme"
                  aria-pressed={theme === "light"}
                  onPress={() => setTheme("light")}
                >
                  <Sun
                    size={reviewIconSize}
                    strokeWidth={reviewIconStrokeWidth}
                    aria-hidden="true"
                  />
                </Button>
                <Button
                  variant={theme === "dark" ? "secondary" : "outline"}
                  isIconOnly
                  aria-label="Use dark theme"
                  aria-pressed={theme === "dark"}
                  onPress={() => setTheme("dark")}
                >
                  <Moon
                    size={reviewIconSize}
                    strokeWidth={reviewIconStrokeWidth}
                    aria-hidden="true"
                  />
                </Button>
                <Button
                  variant={theme === "system" ? "secondary" : "outline"}
                  isIconOnly
                  aria-label="Use system theme"
                  aria-pressed={theme === "system"}
                  onPress={() => setTheme("system")}
                >
                  <Monitor
                    size={reviewIconSize}
                    strokeWidth={reviewIconStrokeWidth}
                    aria-hidden="true"
                  />
                </Button>
              </ButtonGroup>
              <div
                role="group"
                aria-label="Review content actions"
                className="inline-flex items-center"
              >
                <Tooltip delay={140} closeDelay={140} isDisabled={isDeleteAllDisabled}>
                  <Tooltip.Trigger className="contents">
                    <Button
                      ref={deleteAllTriggerRef}
                      size="sm"
                      variant="outline"
                      isIconOnly
                      isDisabled={isDeleteAllDisabled}
                      aria-label="Delete all review comments"
                      className="!rounded-e-none"
                      onPress={() => setIsDeleteDialogOpen(true)}
                    >
                      <Trash2
                        className="text-[var(--muted)]"
                        size={reviewIconSize}
                        strokeWidth={reviewIconStrokeWidth}
                        absoluteStrokeWidth
                        aria-hidden="true"
                      />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content placement="bottom" showArrow>
                    <Tooltip.Arrow />
                    Delete all comments
                  </Tooltip.Content>
                </Tooltip>
                <Tooltip delay={140} closeDelay={140} isDisabled={!canToggleFiles}>
                  <Tooltip.Trigger className="contents">
                    <Button
                      size="sm"
                      variant="outline"
                      isIconOnly
                      isDisabled={isFinished || isFinishing || !canToggleFiles}
                      onPress={toggleAllFiles}
                      aria-label={hasExpandedFiles ? "Collapse all files" : "Expand all files"}
                      className="-ms-px !rounded-s-none"
                    >
                      {hasExpandedFiles ? (
                        <ChevronsDownUp
                          className="text-[var(--muted)]"
                          size={reviewIconSize}
                          strokeWidth={reviewIconStrokeWidth}
                          absoluteStrokeWidth
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronsUpDown
                          className="text-[var(--muted)]"
                          size={reviewIconSize}
                          strokeWidth={reviewIconStrokeWidth}
                          absoluteStrokeWidth
                          aria-hidden="true"
                        />
                      )}
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content placement="bottom" showArrow>
                    <Tooltip.Arrow />
                    {hasExpandedFiles ? "Collapse all files" : "Expand all files"}
                  </Tooltip.Content>
                </Tooltip>
              </div>
              <ButtonGroup size="sm">
                <Button
                  variant="outline"
                  isDisabled={isFinished || isFinishing || isSaving}
                  onPress={cancelReview}
                  aria-label="Cancel this review"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  isDisabled={isFinished || isFinishing || isSaving}
                  onPress={() => finishReview(decision)}
                  aria-label={commentCount > 0 ? "Send review comments" : "Approve this review"}
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                >
                  <ButtonGroup.Separator />
                  {decisionButtonLabel}
                  <kbd
                    className="ml-1 rounded border border-current/25 px-1 py-0.5 font-mono text-[10px] leading-none text-current/80"
                    aria-hidden="true"
                  >
                    {primaryShortcutLabel}
                  </kbd>
                </Button>
              </ButtonGroup>
            </div>
          </div>
        </div>
      </header>

      <AlertDialog isOpen={isDeleteDialogOpen} onOpenChange={handleDeleteDialogOpenChange}>
        <Button className="hidden" aria-hidden="true" isDisabled />
        <AlertDialog.Backdrop variant="blur">
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>Delete all comments?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                This removes every review comment. The review stays open.
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">
                  Keep comments
                </Button>
                <Button slot="close" variant="danger" onPress={clearComments}>
                  Delete all
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <div className={"mx-auto flex flex-col gap-4 px-4 pt-[5vh] pb-[50vh] " + contentMaxWidth}>
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
          <DiffReviewList
            payload={payload}
            review={review}
            diffStyle={diffStyle}
            diffTheme={diffTheme}
            diffThemeType={diffThemeType}
            collapsedFileIds={collapsedFileIds}
            activeCommentId={activeCommentId}
            setActiveCommentId={setActiveCommentId}
            setFileExpanded={setFileExpanded}
            addComment={addComment}
            updateComment={updateComment}
            deleteComment={deleteComment}
          />
        )}
      </div>
    </div>
  );
}

type ReviewFileDiffProps = {
  file: ReviewSourceFile;
  reviewFile: ReviewFile;
  diffStyle: DiffStyle;
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
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

const ReviewFileRow = React.memo(function ReviewFileRow(
  props: ReviewFileDiffProps & {
    isExpanded: boolean;
    onExpandedChange: (fileId: string, isExpanded: boolean) => void;
  },
) {
  const expandedKeys = useMemo(
    () => (props.isExpanded ? [props.file.id] : []),
    [props.file.id, props.isExpanded],
  );
  return (
    <DisclosureGroup
      allowsMultipleExpanded
      expandedKeys={expandedKeys}
      onExpandedChange={(keys) => props.onExpandedChange(props.file.id, keys.has(props.file.id))}
    >
      <ReviewFileDiff
        file={props.file}
        reviewFile={props.reviewFile}
        diffStyle={props.diffStyle}
        diffTheme={props.diffTheme}
        diffThemeType={props.diffThemeType}
        activeCommentId={props.activeCommentId}
        setActiveCommentId={props.setActiveCommentId}
        addComment={props.addComment}
        updateComment={props.updateComment}
        deleteComment={props.deleteComment}
      />
    </DisclosureGroup>
  );
});

function DiffReviewList(props: {
  payload: ReviewPayload;
  review: ReviewJson;
  diffStyle: DiffStyle;
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
  collapsedFileIds: Set<string>;
  activeCommentId: string | null;
  setActiveCommentId: (id: string | null) => void;
  setFileExpanded: (fileId: string, isExpanded: boolean) => void;
  addComment: ReviewFileDiffProps["addComment"];
  updateComment: ReviewFileDiffProps["updateComment"];
  deleteComment: ReviewFileDiffProps["deleteComment"];
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const getItemKey = useCallback(
    (index: number) => props.payload.files[index]?.id ?? index,
    [props.payload.files],
  );
  const estimateSize = useCallback(
    (index: number) => {
      const file = props.payload.files[index];
      if (!file) return 120;
      if (props.collapsedFileIds.has(file.id)) return 82;
      return Math.max(120, 112 + (file.added + file.removed) * 22);
    },
    [props.collapsedFileIds, props.payload.files],
  );
  const fileVirtualizer = useWindowVirtualizer({
    count: props.payload.files.length,
    estimateSize,
    getItemKey,
    overscan: 1,
    scrollMargin,
    useFlushSync: false,
  });
  fileVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  const handleFileExpandedChange = useCallback(
    (fileId: string, isExpanded: boolean) => {
      function commitExpandedChange() {
        props.setFileExpanded(fileId, isExpanded);
        window.requestAnimationFrame(() => {
          const item = listRef.current?.querySelector<HTMLElement>(
            `[data-review-file-item="${CSS.escape(fileId)}"]`,
          );
          if (item) fileVirtualizer.measureElement(item);
        });
      }

      if (!isExpanded) {
        const item = listRef.current?.querySelector<HTMLElement>(
          `[data-review-file-item="${CSS.escape(fileId)}"]`,
        );
        const heading = item?.querySelector<HTMLElement>("[data-review-file-heading]");
        const stickyTop = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--review-header-height"),
        );
        if (
          item &&
          heading &&
          Number.isFinite(stickyTop) &&
          Math.abs(heading.getBoundingClientRect().top - stickyTop) <= 1
        ) {
          const headingInset = Number.parseFloat(
            getComputedStyle(heading.parentElement ?? heading).borderTopWidth,
          );
          window.scrollTo(
            0,
            item.getBoundingClientRect().top + window.scrollY + headingInset - stickyTop,
          );
          window.requestAnimationFrame(commitExpandedChange);
          return;
        }
      }

      commitExpandedChange();
    },
    [fileVirtualizer, props.setFileExpanded],
  );

  useLayoutEffect(() => {
    setScrollMargin(listRef.current?.offsetTop ?? 0);
  }, []);

  return (
    <div
      ref={listRef}
      data-review-file-list=""
      style={{
        height: fileVirtualizer.getTotalSize(),
        overflowAnchor: "none",
        position: "relative",
      }}
    >
      {fileVirtualizer.getVirtualItems().map((virtualFile) => {
        const file = props.payload.files[virtualFile.index];
        if (!file) return null;
        const reviewFile = props.review.files.find((item) => item.location === file.location) || {
          location: file.location,
          added: file.added,
          removed: file.removed,
          comments: [],
        };
        const fileActiveCommentId = reviewFile.comments.some(
          (comment) => comment.id === props.activeCommentId,
        )
          ? props.activeCommentId
          : null;
        return (
          <div
            key={virtualFile.key}
            ref={fileVirtualizer.measureElement}
            data-index={virtualFile.index}
            data-review-file-item={file.id}
            className="absolute left-0 top-0 w-full pb-4"
            style={{
              top: virtualFile.start - fileVirtualizer.options.scrollMargin,
            }}
          >
            <ReviewFileRow
              file={file}
              reviewFile={reviewFile}
              diffStyle={props.diffStyle}
              diffTheme={props.diffTheme}
              diffThemeType={props.diffThemeType}
              activeCommentId={fileActiveCommentId}
              isExpanded={!props.collapsedFileIds.has(file.id)}
              onExpandedChange={handleFileExpandedChange}
              setActiveCommentId={props.setActiveCommentId}
              addComment={props.addComment}
              updateComment={props.updateComment}
              deleteComment={props.deleteComment}
            />
          </div>
        );
      })}
    </div>
  );
}

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
          data-document-comment-button=""
          className="not-typeset absolute left-[-2.25rem] top-1 z-[1] flex h-7 w-7 items-center justify-center rounded-[var(--vercel-radius)] border border-[var(--border)] bg-white text-[var(--muted)] opacity-0 transition-[border-color,color,opacity] after:absolute after:inset-y-0 after:left-full after:w-2 after:content-[''] duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:border-neutral-400 hover:text-[var(--foreground)] focus-visible:opacity-100"
          aria-label={`Comment on ${tag} block at ${startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`}`}
          title="Comment on this block"
          onClick={() => addBlockComment(blockId, startLine, endLine)}
        >
          <MessageSquarePlus
            size={reviewIconSize}
            strokeWidth={reviewIconStrokeWidth}
            absoluteStrokeWidth
            aria-hidden="true"
          />
        </button>
        {content}
        {annotations.map((comment) => (
          <div key={comment.id} className="not-typeset">
            <CommentEditor
              id={comment.id}
              value={comment.comment}
              active={currentProps.activeCommentId === comment.id}
              setActiveCommentId={currentProps.setActiveCommentId}
              onChange={(value) => currentProps.updateComment(comment.id, { comment: value })}
              onFinish={(value) => currentProps.updateComment(comment.id, { comment: value })}
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
          className={`relative transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] data-[annotated=true]:rounded-[var(--vercel-radius)] data-[annotated=true]:bg-[#0070f3]/10 [&:hover:not(:has([data-document-block]:hover))>[data-document-comment-button]]:opacity-100 ${listItemProps.className ?? ""}`}
        >
          {blockContent}
        </li>
      );
    }
    return (
      <div
        {...blockProps}
        className="relative transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] data-[annotated=true]:rounded-[var(--vercel-radius)] data-[annotated=true]:bg-[#0070f3]/10 [&:hover:not(:has([data-document-block]:hover))>[data-document-comment-button]]:opacity-100"
      >
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
    <div className="bg-surface">
      {props.document.location ? (
        <div className="pb-6 font-mono text-xs text-muted">{props.document.location}</div>
      ) : null}
      <article
        ref={articleRef}
        onMouseUp={handleMouseUp}
        className="typeset typeset-docs max-w-none selection:bg-[#0070f3] selection:text-white"
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
  function handleMouseUp() {
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
  }

  root.addEventListener("mouseup", handleMouseUp);
  textSelectionCleanupByNode.set(node, () => root.removeEventListener("mouseup", handleMouseUp));
}

const reviewDiffUnsafeCSS = [
  ':host { --review-radius: 6px; --diffs-font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --diffs-header-font-family: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --diffs-bg-hover-override: #0070f3; --diffs-bg-selection-override: #0070f3; --diffs-bg-selection-number-override: #0070f3; --diffs-selection-number-fg: #0070f3; }',
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

const ReviewFileDiff = React.memo(function ReviewFileDiff(props: ReviewFileDiffProps) {
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
    () => ({
      name: file.location,
      contents: file.oldContent,
      lang: file.language as never,
      cacheKey: `${file.id}:old`,
    }),
    [file.id, file.location, file.oldContent, file.language],
  );
  const newFile = useMemo(
    () => ({
      name: file.location,
      contents: file.newContent,
      lang: file.language as never,
      cacheKey: `${file.id}:new`,
    }),
    [file.id, file.location, file.newContent, file.language],
  );
  const fileDiff = useMemo(() => {
    const cached = parsedFileDiffCache.get(file);
    if (cached) return cached;
    const parsed = parseDiffFromFile(oldFile, newFile);
    parsedFileDiffCache.set(file, parsed);
    return parsed;
  }, [file, newFile, oldFile]);
  const diffOptions = useMemo<NonNullable<FileDiffProps<CommentAnnotationMetadata>["options"]>>(
    () => ({
      theme: props.diffTheme,
      themeType: props.diffThemeType,
      diffStyle: props.diffStyle,
      diffIndicators: "classic",
      hunkSeparators: "metadata",
      lineDiffType: file.added + file.removed > largeDiffWordHighlightThreshold ? "none" : "word",
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
    [clearSelectedLines, file, props.diffStyle, props.diffTheme, props.diffThemeType],
  );

  const commentsById = useMemo(
    () => new Map(reviewFile.comments.map((comment) => [comment.id, comment])),
    [reviewFile.comments],
  );
  const lineAnnotations = useMemo<DiffLineAnnotation<CommentAnnotationMetadata>[]>(
    () =>
      reviewFile.comments.flatMap((comment) =>
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
    [reviewFile.comments],
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
      className="overflow-clip rounded-[var(--vercel-radius)] border border-border"
    >
      <Disclosure.Heading
        data-review-file-heading={file.id}
        className="sticky top-[var(--review-header-height,0px)] z-[5] bg-surface"
      >
        <Disclosure.Trigger className="group flex w-full items-center justify-between gap-4 bg-surface px-4 py-3 text-left transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:bg-surface-secondary">
          <span className="flex min-w-0 items-center gap-3">
            <Disclosure.Indicator className="shrink-0 text-muted transition-transform duration-[var(--motion-duration)] ease-[var(--motion-ease)] group-data-[expanded=true]:rotate-90" />
            <span className="min-w-0">
              <Typography
                type="body-sm"
                weight="semibold"
                truncate
                className="block text-foreground"
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
      <Disclosure.Content className="border-t border-border !transition-none aria-hidden:border-t-0">
        <Card className="border-0 shadow-none" variant="transparent">
          <Card.Content className="bg-[var(--review-diff-background)] p-4">
            <FileDiff<CommentAnnotationMetadata>
              className="block font-mono [--review-radius:var(--vercel-radius)]"
              fileDiff={fileDiff}
              lineAnnotations={lineAnnotations}
              selectedLines={selectedLines}
              options={diffOptions}
              renderAnnotation={(annotation) => {
                const comment = commentsById.get(annotation.metadata.commentId);
                if (!comment) return null;
                return (
                  <CommentAnnotation
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
              renderHeaderMetadata={() => (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="font-normal"
                    onClick={copyPath}
                    aria-label="Copy file path"
                  >
                    {copied ? (
                      <Check
                        size={reviewIconSize}
                        strokeWidth={reviewIconStrokeWidth}
                        absoluteStrokeWidth
                        aria-hidden="true"
                      />
                    ) : (
                      <CopyIcon
                        size={reviewIconSize}
                        strokeWidth={reviewIconStrokeWidth}
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
            />
          </Card.Content>
        </Card>
      </Disclosure.Content>
    </Disclosure>
  );
});

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
        props.updateComment(props.file.location, comment.id, { comment: value });
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
    CommentDraft.finish(value, { onDelete: props.onDelete, onFinish: props.onFinish });
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
          onChange: ({ value }) => props.onChange(value),
          onBlur: ({ value }) => finishComment(value),
        }}
      >
        {(field) => (
          <div className="relative w-full">
            <TextArea
              ref={textareaRef}
              aria-label="Review comment"
              className="block min-h-11 w-full overflow-hidden pr-10 font-sans text-sm leading-5"
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
            <CloseButton
              aria-label="Delete comment"
              className="absolute right-2 top-2 z-10 text-muted hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onPress={handleClearComment}
            >
              <X
                size={reviewIconSize}
                strokeWidth={reviewIconStrokeWidth}
                absoluteStrokeWidth
                aria-hidden="true"
              />
            </CloseButton>
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

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <>
    <Toast.Provider placement="bottom end" />
    <QueryClientProvider client={queryClient}>
      <WorkerPoolContextProvider
        poolOptions={{
          poolSize: Math.min(4, navigator.hardwareConcurrency || 2),
          workerFactory: () => new DiffsWorker(),
        }}
        highlighterOptions={{
          lineDiffType: "word",
          theme: { light: "github-light", dark: "github-dark" },
        }}
      >
        <App />
      </WorkerPoolContextProvider>
    </QueryClientProvider>
  </>,
);
