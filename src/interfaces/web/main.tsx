import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import {
  Button,
  ButtonGroup,
  Card,
  Chip,
  CloseButton,
  Disclosure,
  DisclosureGroup,
  InputGroup,
  ScrollShadow,
  Spinner,
  TextArea,
  Toast,
  Tooltip,
  ToggleButton,
  Typography,
  useTheme,
} from "@heroui/react";
import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Copy as CopyIcon,
  FileMinus,
  FilePenLine,
  FilePlus,
  MessageSquarePlus,
  Monitor,
  Moon,
  Rows3,
  Sun,
  WrapText,
  X,
} from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { useAsyncDebouncer } from "@tanstack/react-pacer/async-debouncer";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { LgtmPreferences, type DiffStyle } from "../../domain/preferences/preferences.ts";
import { ReviewHandoff } from "../../domain/review/review-handoff.ts";
import type {
  DocumentComment,
  DocumentSource,
  ReviewComment,
  ReviewFile,
  ReviewJson,
  ReviewPayload,
  ReviewSourceFile,
} from "../../domain/review/review.ts";
import { CommentDraft } from "./comment-draft.ts";
import { PreferencesApi } from "./preferences-api.ts";
import { ReviewApi, type ReviewAppState } from "./review-api.ts";
import { ReviewCommentInteraction } from "./review-comment-interaction.ts";
import { ReviewPresentation } from "./review-presentation.ts";
import { ToastNotifications } from "./toast-notifications.ts";
import { useReviewServerMonitor } from "./use-review-server-monitor.ts";
import { ReviewWindowTitle } from "./window-title.ts";

const parsedFileDiffCache = new WeakMap<ReviewSourceFile, FileDiffMetadata>();
const largeDiffWordHighlightThreshold = 2_000;
const snappyTransition = {
  duration: 0.14,
  ease: [0.2, 0, 0, 1] as const,
};
const reviewIconSize = 14;
const reviewIconStrokeWidth = 1.5;

type CommentAnnotationMetadata = {
  commentId: string;
};

function App() {
  const { resolvedTheme, setTheme, theme } = useTheme("system");
  const queryClient = useQueryClient();
  const [state, setState] = useState<ReviewAppState | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [copiedReviewPath, setCopiedReviewPath] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [showBusyIndicator, setShowBusyIndicator] = useState(false);
  const [busyIndicatorLabel, setBusyIndicatorLabel] = useState("Saving review");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null);
  const [collapsedFileIds, setCollapsedFileIds] = useState<Set<string>>(() => new Set());
  const reviewHeaderRef = useRef<HTMLElement | null>(null);
  const initializedReviewId = useRef<string | null>(null);
  const lastSavedSignature = useRef<string | null>(null);
  const latestReviewRef = useRef<ReviewJson | null>(null);
  latestReviewRef.current = state?.review ?? null;
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
    onError: (error, _preferences, context) => {
      queryClient.setQueryData(
        ["preferences"],
        context?.previousPreferences ?? LgtmPreferences.defaults,
      );
      ToastNotifications.preferencesNotSaved({ error });
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(["preferences"], preferences);
    },
  });
  const reviewStateQuery = useQuery({
    queryKey: ["review-state"],
    queryFn: function loadReviewState() {
      return ReviewApi.load({});
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const reviewSaveMutation = useMutation({
    mutationFn: function saveReview(review: ReviewJson) {
      return ReviewApi.save({ review });
    },
  });
  const finishReviewMutation = useMutation({
    mutationFn: function finishReview(decision: "approved" | "changes_requested") {
      return ReviewApi.finish({ decision });
    },
  });
  const cancelReviewMutation = useMutation({
    mutationFn: function cancelReview() {
      return ReviewApi.cancel({});
    },
  });
  const preferences = preferencesQuery.data ?? LgtmPreferences.defaults;
  const diffStyle = preferences.diffStyle;
  const lineWrap = preferences.lineWrap;
  const fileExpansion = preferences.fileExpansion;
  const fileExpansionOverrides = preferences.fileExpansionOverrides;
  const preferencesReady = preferencesQuery.isFetched;
  const diffThemeType = resolvedTheme === "dark" ? "dark" : "light";
  const diffTheme = diffThemeType === "dark" ? "github-dark" : "github-light";

  useEffect(() => {
    if (!preferencesQuery.error) {
      return;
    }
    ToastNotifications.preferencesUnavailable();
  }, [preferencesQuery.error]);

  useEffect(() => {
    if (!reviewStateQuery.data || !preferencesReady) {
      return;
    }
    const nextState = reviewStateQuery.data;
    if (initializedReviewId.current === nextState.review.reviewId) {
      return;
    }
    initializedReviewId.current = nextState.review.reviewId;
    lastSavedSignature.current = ReviewPresentation.meaningfulSignature({
      review: nextState.review,
    });
    document.title = ReviewWindowTitle.format({
      cwd: nextState.payload.cwd,
      name: nextState.payload.name,
    });
    setCollapsedFileIds(
      ReviewPresentation.initialCollapsedFileIds({
        state: nextState,
        fileExpansion,
        fileExpansionOverrides,
      }),
    );
    setState(nextState);
  }, [fileExpansion, fileExpansionOverrides, preferencesReady, reviewStateQuery.data]);

  useEffect(() => {
    if (!reviewStateQuery.error) {
      return;
    }
    ToastNotifications.reviewUnavailable();
  }, [reviewStateQuery.error]);

  useReviewServerMonitor({
    getCommentCount: function getCommentCount() {
      const review = latestReviewRef.current;
      return review === null ? 0 : ReviewPresentation.commentCount({ review });
    },
  });

  const isLoaded = state !== null;
  useLayoutEffect(() => {
    const Header = reviewHeaderRef.current;
    if (!Header) {
      return;
    }
    function updateHeaderHeight() {
      const CurrentHeader = reviewHeaderRef.current;
      if (!CurrentHeader) {
        return;
      }
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
      lastSavedSignature.current = ReviewPresentation.meaningfulSignature({
        review: savedReview,
      });
      setLastSavedAt(new Date());
      return savedReview;
    },
    {
      wait: 400,
      onError: () => {
        ToastNotifications.commentsNotSaved();
      },
    },
    (saveState) => ({ isExecuting: saveState.isExecuting, isPending: saveState.isPending }),
  );
  const isSaving =
    saveDebouncer.state.isPending ||
    saveDebouncer.state.isExecuting ||
    reviewSaveMutation.isPending;
  const isPreferenceSaving = preferencesMutation.isPending;
  const isBusy = isFinishing || isSaving || isPreferenceSaving;
  const hideBusyIndicatorDebouncer = useDebouncer(
    () => {
      setShowBusyIndicator(false);
    },
    { wait: 650 },
  );

  useEffect(() => {
    if (isBusy) {
      hideBusyIndicatorDebouncer.cancel();
      setBusyIndicatorLabel(
        isFinishing
          ? "Finishing review"
          : isPreferenceSaving && !isSaving
            ? "Saving preferences"
            : "Saving review",
      );
      setShowBusyIndicator(true);
      return;
    }

    if (showBusyIndicator) {
      hideBusyIndicatorDebouncer.maybeExecute();
    }
  }, [
    hideBusyIndicatorDebouncer,
    isBusy,
    isFinishing,
    isPreferenceSaving,
    isSaving,
    showBusyIndicator,
  ]);

  const showSavingPreferences = useCallback(() => {
    hideBusyIndicatorDebouncer.cancel();
    setBusyIndicatorLabel("Saving preferences");
    setShowBusyIndicator(true);
  }, [hideBusyIndicatorDebouncer]);

  const queueSave = useCallback(
    (review: ReviewJson) => {
      if (ReviewPresentation.meaningfulSignature({ review }) === lastSavedSignature.current) {
        return;
      }
      void saveDebouncer.maybeExecute(review);
    },
    [saveDebouncer],
  );

  const commitReview = useCallback(
    (updater: (review: ReviewJson) => ReviewJson) => {
      setState((current) => {
        if (!current) {
          return current;
        }
        const nextReview = updater(current.review);
        if (nextReview === current.review) {
          return current;
        }
        queueSave(nextReview);
        return { ...current, review: nextReview };
      });
    },
    [queueSave],
  );

  const setFileExpanded = useCallback(
    (fileId: string, isExpanded: boolean) => {
      setCollapsedFileIds((current) => {
        const next = new Set(current);
        if (isExpanded) {
          next.delete(fileId);
        } else {
          next.add(fileId);
        }
        return next;
      });

      if (state?.payload.kind !== "diff") {
        return;
      }
      const file = state.payload.files.find((file) => file.id === fileId);
      if (!file) {
        return;
      }
      showSavingPreferences();
      preferencesMutation.mutate({
        ...preferences,
        fileExpansionOverrides: {
          ...preferences.fileExpansionOverrides,
          [file.location]: isExpanded ? "expanded" : "collapsed",
        },
      });
    },
    [preferences, preferencesMutation, showSavingPreferences, state],
  );

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
        : ReviewCommentInteraction.selectedText({ file, side, startLine, endLine });
      const now = new Date().toISOString();
      const comment: ReviewComment = {
        id: ReviewCommentInteraction.createId({}),
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
        ReviewPresentation.updateFile({
          review,
          fileLocation: file.location,
          updater: (reviewFile) => ({
            ...reviewFile,
            comments: [...reviewFile.comments, comment],
          }),
        }),
      );
      setActiveCommentId(comment.id);
    },
    [commitReview],
  );

  const updateComment = useCallback(
    (fileLocation: string, commentId: string, patch: Partial<ReviewComment>) => {
      commitReview((review) =>
        ReviewPresentation.updateFile({
          review,
          fileLocation,
          updater: (reviewFile) => {
            let changed = false;
            const comments = reviewFile.comments.map((comment) => {
              if (comment.id !== commentId) {
                return comment;
              }
              const nextComment = { ...comment, ...patch, updatedAt: new Date().toISOString() };
              const hasChanged =
                JSON.stringify({ ...comment, updatedAt: undefined }) !==
                JSON.stringify({ ...nextComment, updatedAt: undefined });
              if (!hasChanged) {
                return comment;
              }
              changed = true;
              return nextComment;
            });
            return changed ? { ...reviewFile, comments } : reviewFile;
          },
        }),
      );
    },
    [commitReview],
  );

  const deleteComment = useCallback(
    (fileLocation: string, commentId: string) => {
      commitReview((review) =>
        ReviewPresentation.updateFile({
          review,
          fileLocation,
          updater: (reviewFile) => {
            const comments = reviewFile.comments.filter((comment) => comment.id !== commentId);
            return comments.length === reviewFile.comments.length
              ? reviewFile
              : { ...reviewFile, comments };
          },
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
        if (comment.id !== commentId) {
          return comment;
        }
        const nextComment = { ...comment, ...patch, updatedAt: new Date().toISOString() };
        const hasChanged =
          JSON.stringify({ ...comment, updatedAt: undefined }) !==
          JSON.stringify({ ...nextComment, updatedAt: undefined });
        if (!hasChanged) {
          return comment;
        }
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
    if (!state) {
      return;
    }
    try {
      await navigator.clipboard.writeText(state.payload.reviewPath);
      setCopiedReviewPath(true);
      window.setTimeout(() => setCopiedReviewPath(false), 1200);
    } catch {
      setCopiedReviewPath(false);
    }
  }

  async function finishReview(decision: "approved" | "changes_requested") {
    if (!state || isFinishing || isSaving) {
      return;
    }
    if (
      decision === "changes_requested" &&
      ReviewPresentation.commentCount({ review: state.review }) === 0
    ) {
      return;
    }
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
      lastSavedSignature.current = ReviewPresentation.meaningfulSignature({
        review: savedReview,
      });
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
    if (!state || isFinishing || isSaving) {
      return;
    }
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
    state && ReviewPresentation.commentCount({ review: state.review }) > 0
      ? "changes_requested"
      : "approved";
  const canFinishReview =
    Boolean(state) && state?.review.status === "open" && !isFinishing && !isSaving;
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
  const commentCount = ReviewPresentation.commentCount({ review });
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
  const hasExpandedFiles = canToggleFiles && collapsedFileIds.size < payload.files.length;
  const reviewPathParts = payload.reviewPath.split(/[\\/]/).filter(Boolean);
  const reviewFileName = reviewPathParts.at(-1) ?? "review.json";
  const reviewSessionName = reviewPathParts.at(-2) ?? "session";
  const displayedReviewPath =
    reviewSessionName.length > 40
      ? `${reviewSessionName.slice(0, 24)}…${reviewSessionName.slice(-12)}/${reviewFileName}`
      : `${reviewSessionName}/${reviewFileName}`;

  function toggleAllFiles() {
    if (!canToggleFiles) {
      return;
    }
    const nextFileExpansion = hasExpandedFiles ? "collapsed" : "expanded";
    setCollapsedFileIds(
      nextFileExpansion === "collapsed" ? new Set(payload.files.map((file) => file.id)) : new Set(),
    );
    showSavingPreferences();
    preferencesMutation.mutate({
      ...preferences,
      fileExpansion: nextFileExpansion,
      fileExpansionOverrides: {},
    });
  }

  function updateDiffStyle(nextDiffStyle: DiffStyle) {
    if (nextDiffStyle === diffStyle) {
      return;
    }
    showSavingPreferences();
    preferencesMutation.mutate({ ...preferences, diffStyle: nextDiffStyle });
  }

  function updateLineWrap(isSelected: boolean) {
    if (isSelected === lineWrap) {
      return;
    }
    showSavingPreferences();
    preferencesMutation.mutate({ ...preferences, lineWrap: isSelected });
  }

  function updateSidebarWidth(nextSidebarWidth: number) {
    if (nextSidebarWidth === preferences.sidebarWidth) {
      return;
    }
    showSavingPreferences();
    preferencesMutation.mutate({ ...preferences, sidebarWidth: nextSidebarWidth });
  }

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground">
      <header
        ref={reviewHeaderRef}
        className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur"
      >
        <div className="flex min-w-0">
          {payload.kind === "diff" ? (
            <div className="shrink-0" style={{ width: preferences.sidebarWidth }} />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className={"mx-auto px-4 py-4 " + contentMaxWidth}>
              <div className="flex min-w-0 items-center justify-between gap-4">
                <Typography.Heading
                  level={1}
                  truncate
                  className="min-w-0 text-lg font-semibold leading-6 text-foreground"
                >
                  {payload.name}
                </Typography.Heading>
                <InputGroup
                  variant="secondary"
                  aria-label="Review JSON path"
                  className="group/review-path relative w-[36rem] max-w-[60vw] shrink-0 !bg-transparent shadow-none"
                >
                  <InputGroup.Input
                    readOnly
                    dir="rtl"
                    value={displayedReviewPath}
                    className="min-w-0 text-right font-mono text-xs text-muted"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute right-1 top-1/2 h-7 min-w-0 -translate-y-1/2 bg-background px-2 font-normal opacity-0 transition-opacity group-hover/review-path:opacity-100 focus-visible:opacity-100"
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
                </InputGroup>
              </div>
              <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {payload.kind === "diff" ? (
                    <>
                      <ButtonGroup size="sm" variant="outline" aria-label="Diff layout">
                        <Button
                          className={diffStyle === "unified" ? "bg-default" : undefined}
                          aria-pressed={diffStyle === "unified"}
                          onPress={() => updateDiffStyle("unified")}
                        >
                          <Rows3
                            size={reviewIconSize}
                            strokeWidth={reviewIconStrokeWidth}
                            aria-hidden="true"
                          />
                          Unified
                        </Button>
                        <Button
                          className={diffStyle === "split" ? "bg-default" : undefined}
                          aria-pressed={diffStyle === "split"}
                          onPress={() => updateDiffStyle("split")}
                        >
                          <Columns2
                            size={reviewIconSize}
                            strokeWidth={reviewIconStrokeWidth}
                            aria-hidden="true"
                          />
                          Side by side
                        </Button>
                      </ButtonGroup>
                      <ToggleButton
                        size="sm"
                        variant="ghost"
                        isSelected={lineWrap}
                        onChange={updateLineWrap}
                      >
                        <WrapText
                          size={reviewIconSize}
                          strokeWidth={reviewIconStrokeWidth}
                          aria-hidden="true"
                        />
                        Line wrap
                      </ToggleButton>
                    </>
                  ) : null}
                </div>
                <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
                  <div className="flex min-w-0 items-center justify-end gap-2" aria-live="polite">
                    <span className="relative h-4 w-4 shrink-0">
                      <AnimatePresence initial={false}>
                        {showBusyIndicator ? (
                          <motion.span
                            key="loading"
                            className="absolute inset-0 flex items-center justify-center text-accent"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={snappyTransition}
                          >
                            <Spinner size="sm" color="current" aria-label={busyIndicatorLabel} />
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
                  <Tooltip delay={140} closeDelay={140} isDisabled={!canToggleFiles}>
                    <Tooltip.Trigger className="contents">
                      <Button
                        size="sm"
                        variant="outline"
                        isIconOnly
                        isDisabled={isFinished || isFinishing || !canToggleFiles}
                        onPress={toggleAllFiles}
                        aria-label={hasExpandedFiles ? "Collapse all files" : "Expand all files"}
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
          </div>
        </div>
      </header>

      {payload.kind === "document" && payload.document ? (
        <main className="h-[calc(100dvh-var(--review-header-height,0px))] overflow-y-auto">
          <div className={"mx-auto flex flex-col gap-4 px-4 pt-[5vh] pb-[50vh] " + contentMaxWidth}>
            <DocumentReviewSurface
              document={payload.document}
              comments={review.documentComments}
              activeCommentId={activeCommentId}
              setActiveCommentId={setActiveCommentId}
              addComment={addDocumentComment}
              updateComment={updateDocumentComment}
              deleteComment={deleteDocumentComment}
            />
          </div>
        </main>
      ) : (
        <DiffReviewList
          payload={payload}
          review={review}
          diffStyle={diffStyle}
          lineWrap={lineWrap}
          diffTheme={diffTheme}
          diffThemeType={diffThemeType}
          theme={theme}
          setTheme={setTheme}
          sidebarWidth={preferences.sidebarWidth}
          collapsedFileIds={collapsedFileIds}
          activeCommentId={activeCommentId}
          setActiveCommentId={setActiveCommentId}
          setFileExpanded={setFileExpanded}
          updateSidebarWidth={updateSidebarWidth}
          addComment={addComment}
          updateComment={updateComment}
          deleteComment={deleteComment}
        />
      )}
    </div>
  );
}

type ReviewFileDiffProps = {
  file: ReviewSourceFile;
  reviewFile: ReviewFile;
  diffStyle: DiffStyle;
  lineWrap: boolean;
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
        lineWrap={props.lineWrap}
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
  lineWrap: boolean;
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
  theme: string;
  setTheme: (theme: string) => void;
  sidebarWidth: number;
  collapsedFileIds: Set<string>;
  activeCommentId: string | null;
  setActiveCommentId: (id: string | null) => void;
  setFileExpanded: (fileId: string, isExpanded: boolean) => void;
  updateSidebarWidth: (sidebarWidth: number) => void;
  addComment: ReviewFileDiffProps["addComment"];
  updateComment: ReviewFileDiffProps["updateComment"];
  deleteComment: ReviewFileDiffProps["deleteComment"];
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollElementRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeStartRef = useRef<{ clientX: number; width: number } | null>(null);
  const sidebarWidthRef = useRef(props.sidebarWidth);
  const scrollElementRef = useRef<HTMLElement | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(props.sidebarWidth);
  const [scrollMargin, setScrollMargin] = useState(0);
  const getItemKey = useCallback(
    (index: number) => props.payload.files[index]?.id ?? index,
    [props.payload.files],
  );
  const fileIndexById = useMemo(
    () => new Map(props.payload.files.map((file, index) => [file.id, index])),
    [props.payload.files],
  );
  const reviewFileByLocation = useMemo(
    () => new Map(props.review.files.map((file) => [file.location, file])),
    [props.review.files],
  );
  const sidebarVirtualizer = useVirtualizer({
    count: props.payload.files.length,
    estimateSize: () => 38,
    getScrollElement: () => sidebarScrollElementRef.current,
    getItemKey,
    overscan: 10,
    useFlushSync: false,
  });
  const estimateSize = useCallback(
    (index: number) => {
      const file = props.payload.files[index];
      if (!file) {
        return 120;
      }
      if (props.collapsedFileIds.has(file.id)) {
        return 82;
      }
      return Math.max(120, 112 + (file.added + file.removed) * 22);
    },
    [props.collapsedFileIds, props.payload.files],
  );
  const fileVirtualizer = useVirtualizer({
    count: props.payload.files.length,
    estimateSize,
    getScrollElement: () => scrollElementRef.current,
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
          if (item) {
            fileVirtualizer.measureElement(item);
          }
        });
      }

      if (!isExpanded) {
        const item = listRef.current?.querySelector<HTMLElement>(
          `[data-review-file-item="${CSS.escape(fileId)}"]`,
        );
        const heading = item?.querySelector<HTMLElement>("[data-review-file-heading]");
        const scrollElement = scrollElementRef.current;
        if (
          item &&
          heading &&
          scrollElement &&
          Math.abs(
            heading.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top,
          ) <= 1
        ) {
          const headingInset = Number.parseFloat(
            getComputedStyle(heading.parentElement ?? heading).borderTopWidth,
          );
          scrollElement.scrollTo({
            behavior: "auto",
            top:
              item.getBoundingClientRect().top -
              scrollElement.getBoundingClientRect().top +
              scrollElement.scrollTop +
              headingInset,
          });
          window.requestAnimationFrame(commitExpandedChange);
          return;
        }
      }

      commitExpandedChange();
    },
    [fileVirtualizer, props.setFileExpanded],
  );

  useLayoutEffect(() => {
    const list = listRef.current;
    const scrollElement = scrollElementRef.current;
    if (!list || !scrollElement) {
      return;
    }
    setScrollMargin(
      list.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop,
    );
  }, []);

  useEffect(() => {
    sidebarWidthRef.current = props.sidebarWidth;
    setSidebarWidth(props.sidebarWidth);
  }, [props.sidebarWidth]);

  useEffect(() => {
    return () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  function scrollToFile(fileId: string) {
    const fileIndex = fileIndexById.get(fileId);
    if (fileIndex === undefined) {
      return;
    }
    fileVirtualizer.scrollToIndex(fileIndex, { align: "start", behavior: "auto" });
  }

  function resizeSidebar(nextWidth: number) {
    const maximumWidth = Math.min(480, window.innerWidth * 0.5);
    const resizedWidth = Math.round(Math.max(192, Math.min(maximumWidth, nextWidth)));
    sidebarWidthRef.current = resizedWidth;
    setSidebarWidth(resizedWidth);
    return resizedWidth;
  }

  function startSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    sidebarResizeStartRef.current = { clientX: event.clientX, width: sidebarWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function continueSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    const resizeStart = sidebarResizeStartRef.current;
    if (!resizeStart) {
      return;
    }
    resizeSidebar(resizeStart.width + event.clientX - resizeStart.clientX);
  }

  function finishSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    sidebarResizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    props.updateSidebarWidth(sidebarWidthRef.current);
  }

  function resizeSidebarWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const resizedWidth = resizeSidebar(sidebarWidth + (event.key === "ArrowLeft" ? -16 : 16));
    props.updateSidebarWidth(resizedWidth);
  }

  return (
    <div className="flex h-[calc(100dvh-var(--review-header-height,0px))] min-h-0">
      <aside
        className="relative flex h-full shrink-0 flex-col border-r border-border bg-surface"
        style={{ width: sidebarWidth }}
      >
        <div className="border-b border-border px-4 py-3">
          <Typography type="body-sm" weight="semibold">
            Files
          </Typography>
          <Typography type="body-xs" color="muted" className="mt-1 block leading-none">
            {props.payload.files.length} changed
          </Typography>
        </div>
        <ScrollShadow
          ref={sidebarScrollElementRef}
          orientation="vertical"
          size={28}
          className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
          data-review-file-sidebar=""
        >
          <nav
            aria-label="Changed files"
            className="relative"
            style={{ height: sidebarVirtualizer.getTotalSize() }}
          >
            {sidebarVirtualizer.getVirtualItems().map((virtualFile) => {
              const file = props.payload.files[virtualFile.index];
              if (!file) {
                return null;
              }
              const isCollapsed = props.collapsedFileIds.has(file.id);
              const isAdded = file.oldContent.length === 0 && file.newContent.length > 0;
              const isDeleted = file.newContent.length === 0 && file.oldContent.length > 0;
              const fileStatus = isAdded ? "added" : isDeleted ? "deleted" : "modified";
              return (
                <div
                  key={virtualFile.key}
                  ref={sidebarVirtualizer.measureElement}
                  data-index={virtualFile.index}
                  className="absolute left-0 top-0 w-full pb-0.5"
                  style={{ transform: `translateY(${virtualFile.start}px)` }}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className={
                      "h-auto w-full justify-start gap-2 px-2 py-2 text-left font-normal " +
                      (isCollapsed ? "text-muted" : "text-foreground")
                    }
                    data-collapsed={isCollapsed ? "true" : "false"}
                    data-file-status={fileStatus}
                    data-review-file-link={file.id}
                    onPress={() => scrollToFile(file.id)}
                  >
                    {isAdded ? (
                      <FilePlus
                        className="shrink-0 text-green-600 dark:text-green-400"
                        size={reviewIconSize}
                        strokeWidth={reviewIconStrokeWidth}
                        aria-hidden="true"
                      />
                    ) : isDeleted ? (
                      <FileMinus
                        className="shrink-0 text-red-600 dark:text-red-400"
                        size={reviewIconSize}
                        strokeWidth={reviewIconStrokeWidth}
                        aria-hidden="true"
                      />
                    ) : (
                      <FilePenLine
                        className="shrink-0 text-amber-600 dark:text-amber-400"
                        size={reviewIconSize}
                        strokeWidth={reviewIconStrokeWidth}
                        aria-hidden="true"
                      />
                    )}
                    <span className="sr-only">{fileStatus}: </span>
                    <span className="min-w-0 flex-1 truncate">{file.location}</span>
                    <span className="flex shrink-0 gap-1 font-mono text-[10px] tabular-nums">
                      <span className="text-green-600 dark:text-green-400">+{file.added}</span>
                      <span className="text-red-600 dark:text-red-400">-{file.removed}</span>
                    </span>
                  </Button>
                </div>
              );
            })}
          </nav>
        </ScrollShadow>
        <SidebarThemeFooter theme={props.theme} setTheme={props.setTheme} />
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize file sidebar"
          aria-orientation="vertical"
          aria-valuemin={192}
          aria-valuemax={480}
          aria-valuenow={Math.round(sidebarWidth)}
          className="group absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize touch-none focus:outline-none"
          data-review-sidebar-resizer=""
          onKeyDown={resizeSidebarWithKeyboard}
          onPointerDown={startSidebarResize}
          onPointerMove={continueSidebarResize}
          onPointerUp={finishSidebarResize}
          onPointerCancel={finishSidebarResize}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/50 group-focus-visible:bg-accent" />
        </div>
      </aside>
      <main
        ref={scrollElementRef}
        data-review-diff-scroll=""
        className="min-w-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-7xl px-4 pt-[5vh] pb-[50vh]">
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
              if (!file) {
                return null;
              }
              const reviewFile = reviewFileByLocation.get(file.location) || {
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
                    lineWrap={props.lineWrap}
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
        </div>
      </main>
    </div>
  );
}

function SidebarThemeFooter(props: { theme: string; setTheme: (theme: string) => void }) {
  return (
    <footer className="flex shrink-0 justify-end border-t border-border px-3 py-3">
      <ButtonGroup size="sm" aria-label="Color theme">
        <Button
          variant={props.theme === "light" ? "secondary" : "outline"}
          isIconOnly
          aria-label="Use light theme"
          aria-pressed={props.theme === "light"}
          onPress={() => props.setTheme("light")}
        >
          <Sun size={reviewIconSize} strokeWidth={reviewIconStrokeWidth} aria-hidden="true" />
        </Button>
        <Button
          variant={props.theme === "dark" ? "secondary" : "outline"}
          isIconOnly
          aria-label="Use dark theme"
          aria-pressed={props.theme === "dark"}
          onPress={() => props.setTheme("dark")}
        >
          <Moon size={reviewIconSize} strokeWidth={reviewIconStrokeWidth} aria-hidden="true" />
        </Button>
        <Button
          variant={props.theme === "system" ? "secondary" : "outline"}
          isIconOnly
          aria-label="Use system theme"
          aria-pressed={props.theme === "system"}
          onPress={() => props.setTheme("system")}
        >
          <Monitor size={reviewIconSize} strokeWidth={reviewIconStrokeWidth} aria-hidden="true" />
        </Button>
      </ButtonGroup>
    </footer>
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
      id: ReviewCommentInteraction.createId({}),
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
      if (!root) {
        return;
      }
      const textSelection = ReviewCommentInteraction.currentTextSelection({ root });
      if (!textSelection) {
        return;
      }
      const { selection, range, startElement, endElement } = textSelection;
      const selectedText = textSelection.selectedText.trim();
      const startBlock = startElement?.closest<HTMLElement>("[data-document-block]");
      const endBlock = endElement?.closest<HTMLElement>("[data-document-block]");
      if (!startBlock || !endBlock || !root.contains(startBlock) || !root.contains(endBlock)) {
        return;
      }

      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(root);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const fullText = root.textContent ?? "";
      const startOffset = beforeRange.toString().length;
      const now = new Date().toISOString();
      const comment: DocumentComment = {
        id: ReviewCommentInteraction.createId({}),
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

const reviewDiffUnsafeCSS = [
  ':host { --review-radius: 6px; --diffs-font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --diffs-header-font-family: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --diffs-bg-hover-override: #0070f3; --diffs-bg-selection-override: #0070f3; --diffs-bg-selection-number-override: #0070f3; --diffs-selection-number-fg: #0070f3; }',
  '[data-diffs-header="default"] { padding-inline: 0 !important; border-radius: var(--review-radius) var(--review-radius) 0 0 !important; }',
  '[data-diffs-header="default"] [data-header-content] { margin-left: 0 !important; }',
  '[data-diffs-header="default"] [data-metadata] { padding-right: 0 !important; }',
  "[data-change-icon] { opacity: 0.72; transform: scale(0.9); transform-origin: center; }",
  "[data-diff-span] { border-radius: var(--review-radius) !important; }",
  "[data-separator-content], [data-expand-button], [data-separator-wrapper] { border-color: var(--border) !important; border-radius: var(--review-radius) !important; }",
  "[data-separator-wrapper] { background-color: var(--border) !important; }",
].join("\n");

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
    if (cached) {
      return cached;
    }
    const parsed = parseDiffFromFile(oldFile, newFile);
    parsedFileDiffCache.set(file, parsed);
    return parsed;
  }, [file, newFile, oldFile]);
  const diffOptions = useMemo<NonNullable<FileDiffProps<CommentAnnotationMetadata>["options"]>>(
    () => ({
      theme: props.diffTheme,
      themeType: props.diffThemeType,
      diffStyle: props.diffStyle,
      overflow: props.lineWrap ? "wrap" : "scroll",
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
        ReviewCommentInteraction.installTextSelection({
          node,
          phase,
          file,
          addComment: function addTextSelectionComment(range, selectedText) {
            setSelectedLines(range);
            propsRef.current.addComment(file, range, selectedText);
          },
        });
      },
    }),
    [
      clearSelectedLines,
      file,
      props.diffStyle,
      props.diffTheme,
      props.diffThemeType,
      props.lineWrap,
    ],
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
        className="sticky top-0 z-[5] bg-surface"
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
                if (!comment) {
                  return null;
                }
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
    if (!props.active || !textareaRef.current) {
      return;
    }
    textareaRef.current.focus();
    textareaRef.current.selectionStart = textareaRef.current.value.length;
    textareaRef.current.selectionEnd = textareaRef.current.value.length;
  }, [props.active, props.id]);

  useEffect(() => {
    if (textareaRef.current) {
      ReviewCommentInteraction.resizeTextarea({ textarea: textareaRef.current });
    }
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
              className="block min-h-11 w-full overflow-hidden py-[11px] pr-10 font-sans text-sm leading-5"
              placeholder="Add review comment..."
              value={field.state.value}
              variant="secondary"
              onFocus={() => props.setActiveCommentId(props.id)}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.currentTarget.value);
                ReviewCommentInteraction.resizeTextarea({ textarea: event.currentTarget });
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              style={{ resize: "none" }}
            />
            <CloseButton
              aria-label="Delete comment"
              className="absolute right-2 top-2.5 z-10 text-muted hover:text-foreground"
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
