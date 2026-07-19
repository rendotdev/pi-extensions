import React, {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, DisclosureGroup, Spinner, Typography, useTheme } from "@heroui/react";
import { FileMinus, FilePenLine, FilePlus } from "lucide-react";
import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { useAsyncDebouncer } from "@tanstack/react-pacer/async-debouncer";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  parseDiffFromFile,
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffMetadata,
  type LineAnnotation,
} from "@pierre/diffs";
import {
  File,
  FileDiff,
  type FileDiffProps,
  type FileProps,
  type SelectedLineRange,
} from "@pierre/diffs/react";
import { createPortal } from "react-dom";
import type { Components } from "react-markdown";
import { LgtmPreferences, type DiffStyle } from "../../../../domain/preferences/preferences.ts";
import { ReviewHandoff } from "../../../../domain/review/review-handoff.ts";
import type {
  DocumentComment,
  DocumentSource,
  ReviewComment,
  ReviewFile,
  ReviewJson,
  ReviewPayload,
  ReviewSourceFile,
} from "../../../../domain/review/review.ts";
import { CommentDraft } from "../../comment-draft.ts";
import { DocumentCodeHighlighter } from "../../document-code-highlighter.ts";
import { DocumentMarkdownNavigation } from "../../document-markdown-navigation.ts";
import { FileSearch } from "../../file-search.ts";
import { PreferencesApi } from "../../preferences-api.ts";
import { ReviewApi, type ReviewAppState } from "../../review-api.ts";
import { ReviewClipboardCopyClass } from "../../review-clipboard-copy.ts";
import {
  ReviewCommentInteraction,
  type DiffScrollAnchor,
  type ElementScrollAnchor,
} from "../../review-comment-interaction.ts";
import { ReviewDiffPresentation } from "../../review-diff-presentation.ts";
import { ReviewFileNavigation } from "../../review-file-navigation.ts";
import { ReviewGroupPresentation } from "../../review-group-presentation.ts";
import { ReviewPresentation } from "../../review-presentation.ts";
import { ToastNotifications } from "../../toast-notifications.ts";
import { useReviewServerMonitor } from "../../use-review-server-monitor.ts";
import { ReviewWindowTitle } from "../../window-title.ts";
import { CommentEditor } from "./components/comment-editor.tsx";
import { HomeContent } from "./components/home-content.tsx";
import { HomeFooter } from "./components/home-footer.tsx";
import { HomeSidebar } from "./components/home-sidebar.tsx";
import { ReviewCodeFrame } from "./components/review-code-frame.tsx";
import { HomeTemplate } from "./home-template.tsx";
import { useLazyVisibility } from "./use-lazy-visibility.ts";
import { useReviewLineSelection } from "./use-review-line-selection.ts";
import { useScrollAnchorStabilizer } from "./use-scroll-anchor-stabilizer.ts";

const parsedFileDiffCache = new WeakMap<ReviewSourceFile, FileDiffMetadata>();
const largeDiffWordHighlightThreshold = 2_000;
const reviewIconSize = 14;
const reviewIconStrokeWidth = 1.5;
const ReviewClipboardCopy = new ReviewClipboardCopyClass(
  {},
  { writeText: navigator.clipboard.writeText.bind(navigator.clipboard) },
);

type CommentAnnotationMetadata = {
  commentId: string;
};

export function HomeRoute() {
  const { resolvedTheme, setTheme, theme } = useTheme("system");
  const queryClient = useQueryClient();
  const [state, setState] = useState<ReviewAppState | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [copiedReviewPath, setCopiedReviewPath] = useState(false);
  const [displayedSidebarWidth, setDisplayedSidebarWidth] = useState(
    LgtmPreferences.defaults.sidebarWidth,
  );
  const [isFinishing, setIsFinishing] = useState(false);
  const [copyingStatus, setCopyingStatus] = useState<string | null>(null);
  const [showBusyIndicator, setShowBusyIndicator] = useState(false);
  const [busyIndicatorLabel, setBusyIndicatorLabel] = useState("Saving review");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [reviewStatusOverride, setReviewStatusOverride] = useState<{
    label: string;
    tone: "success" | "warning";
  } | null>(null);
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
  const diffTheme = ReviewDiffPresentation.resolveTheme({ resolvedTheme });

  useEffect(() => {
    setDisplayedSidebarWidth(preferences.sidebarWidth);
  }, [preferences.sidebarWidth]);

  useEffect(() => {
    if (!preferencesQuery.error) {
      return;
    }
    ToastNotifications.preferencesUnavailable();
  }, [preferencesQuery.error]);

  useEffect(() => {
    const shouldWaitForReview = !reviewStateQuery.data || !preferencesReady;
    if (shouldWaitForReview) {
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

  useEffect(function trackPointerInteractions() {
    ReviewCommentInteraction.installPointerTracking({ node: window, phase: "mount" });
    return function stopTrackingPointerInteractions() {
      ReviewCommentInteraction.installPointerTracking({ node: window, phase: "unmount" });
    };
  }, []);

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
      const signature = ReviewPresentation.meaningfulSignature({ review });
      if (signature === lastSavedSignature.current) {
        return review;
      }
      const savedReview = await reviewSaveMutation.mutateAsync(review);
      lastSavedSignature.current = ReviewPresentation.meaningfulSignature({
        review: savedReview,
      });
      setLastSavedAt(new Date());
      setReviewStatusOverride(null);
      return savedReview;
    },
    {
      wait: 400,
      onError: () => {
        setReviewStatusOverride({ label: "Comments not saved", tone: "warning" });
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
  const isBusyIndicatorVisible = copyingStatus !== null || isBusy || showBusyIndicator;
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

  async function copyReviewHandoff(params: { text: string; status: string }): Promise<boolean> {
    return await ReviewClipboardCopy.copy({
      text: params.text,
      onStart: () => setCopyingStatus(params.status),
      onFinish: () => setCopyingStatus(null),
    });
  }

  async function finishReview(decision: "approved" | "changes_requested") {
    const isReviewBusy = !state || isBusyIndicatorVisible;
    if (isReviewBusy) {
      return;
    }
    const review = CommentDraft.applyToReview({
      review: latestReviewRef.current ?? state.review,
    });
    const hasDraftComments = ReviewPresentation.commentCount({ review }) > 0;
    const resolvedDecision =
      decision === "approved" && hasDraftComments ? "changes_requested" : decision;
    const isEmptyChangeRequest = resolvedDecision === "changes_requested" && !hasDraftComments;
    if (isEmptyChangeRequest) {
      return;
    }
    if (review !== state.review) {
      setState((current) => (current ? { ...current, review } : current));
    }
    setIsFinishing(true);
    setReviewStatusOverride(null);
    const didCopyHandoff = await copyReviewHandoff({
      text: ReviewHandoff.clipboardText({ decision: resolvedDecision, review }),
      status: "Copying review handoff",
    });
    if (!didCopyHandoff) {
      setIsFinishing(false);
      hideBusyIndicatorDebouncer.cancel();
      setShowBusyIndicator(false);
      ToastNotifications.copyFailed();
      return;
    }
    saveDebouncer.cancel();
    try {
      const savedReview = await reviewSaveMutation.mutateAsync(review);
      lastSavedSignature.current = ReviewPresentation.meaningfulSignature({
        review: savedReview,
      });
    } catch {
      const didCopyComments = await copyReviewHandoff({
        text: ReviewHandoff.fallbackText({ review }),
        status: "Copying comments",
      });
      setIsFinishing(false);
      hideBusyIndicatorDebouncer.cancel();
      setShowBusyIndicator(false);
      setReviewStatusOverride(
        didCopyComments
          ? { label: "Comments copied", tone: "success" }
          : { label: "Comments kept in this tab", tone: "warning" },
      );
      if (didCopyComments) {
        ToastNotifications.commentsCopied();
      } else {
        ToastNotifications.commentsKeptInTab();
      }
      return;
    }
    try {
      const finishedReview = await finishReviewMutation.mutateAsync(resolvedDecision);
      setState((current) => (current ? { ...current, review: finishedReview } : current));
      window.close();
      window.setTimeout(() => {
        window.close();
      }, 50);
    } catch {
      setIsFinishing(false);
      hideBusyIndicatorDebouncer.cancel();
      setShowBusyIndicator(false);
      setReviewStatusOverride({ label: "Review saved but not finished", tone: "warning" });
      ToastNotifications.reviewNotFinished();
    }
  }

  async function cancelReview() {
    const isReviewBusy = !state || isBusyIndicatorVisible;
    if (isReviewBusy) {
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
    Boolean(state) && state?.review.status === "open" && !isBusyIndicatorVisible;
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
          Loading lgtm...
        </Typography.Paragraph>
      </div>
    );
  }

  const { payload, review } = state;
  const commentCount = ReviewPresentation.commentCount({ review });
  const isFinished = review.status !== "open";
  const decision = primaryDecision;
  const decisionButtonLabel = commentCount > 0 ? `Send (${commentCount})` : "Approve";
  const currentBusyIndicatorLabel = copyingStatus ?? busyIndicatorLabel;
  const primaryShortcutLabel = formatForDisplay("Mod+Enter");
  const savedTime = lastSavedAt
    ? lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const idleReviewStatus =
    reviewStatusOverride ??
    (review.status === "open" && !savedTime
      ? { label: "Not saved yet", tone: "idle" as const }
      : {
          label:
            review.status === "approved"
              ? "Approved"
              : review.status === "changes_requested"
                ? "Comments sent"
                : review.status === "canceled"
                  ? "Canceled"
                  : savedTime
                    ? "Saved " + savedTime
                    : "Up to date",
          tone: "success" as const,
        });
  const currentReviewStatus = isBusyIndicatorVisible
    ? { label: currentBusyIndicatorLabel, tone: "busy" as const }
    : idleReviewStatus;
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
    <HomeTemplate
      header={{
        actionLabel: commentCount > 0 ? "Send review comments" : "Approve this review",
        canToggleFiles,
        contentMaxWidth,
        decisionButtonLabel,
        diffStyle,
        hasExpandedFiles,
        headerRef: reviewHeaderRef,
        isBusy: isBusyIndicatorVisible,
        isFinished,
        isFinishing,
        kind: payload.kind,
        lineWrap,
        name: payload.name,
        onCancel: cancelReview,
        onDiffStyleChange: updateDiffStyle,
        onFinish: () => finishReview(decision),
        onLineWrapChange: updateLineWrap,
        onToggleAllFiles: toggleAllFiles,
        primaryShortcutLabel,
        sidebarWidth: payload.kind === "diff" ? displayedSidebarWidth : 0,
        status: currentReviewStatus,
      }}
      view={
        payload.kind === "document" && payload.document
          ? {
              kind: "document",
              contentMaxWidth,
              content: (
                <DocumentReviewSurface
                  document={payload.document}
                  comments={review.documentComments}
                  diffTheme={diffTheme.name}
                  diffThemeType={diffTheme.type}
                  lineWrap={lineWrap}
                  activeCommentId={activeCommentId}
                  addComment={addDocumentComment}
                  updateComment={updateDocumentComment}
                  deleteComment={deleteDocumentComment}
                />
              ),
              footer: {
                copiedReviewPath,
                contentMaxWidth,
                displayedReviewPath,
                onCopyReviewPath: copyReviewPath,
                onThemeChange: setTheme,
                theme,
              },
            }
          : {
              kind: "diff",
              content: (
                <DiffReviewList
                  payload={payload}
                  review={review}
                  diffStyle={diffStyle}
                  lineWrap={lineWrap}
                  diffTheme={diffTheme.name}
                  diffThemeType={diffTheme.type}
                  theme={theme}
                  setTheme={setTheme}
                  copiedReviewPath={copiedReviewPath}
                  displayedReviewPath={displayedReviewPath}
                  onCopyReviewPath={copyReviewPath}
                  sidebarWidth={displayedSidebarWidth}
                  setSidebarWidth={setDisplayedSidebarWidth}
                  collapsedFileIds={collapsedFileIds}
                  activeCommentId={activeCommentId}
                  setFileExpanded={setFileExpanded}
                  updateSidebarWidth={updateSidebarWidth}
                  addComment={addComment}
                  updateComment={updateComment}
                  deleteComment={deleteComment}
                />
              ),
            }
      }
    />
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
        addComment={props.addComment}
        updateComment={props.updateComment}
        deleteComment={props.deleteComment}
      />
    </DisclosureGroup>
  );
});

function ReviewGroupHeader(props: {
  added: number;
  fileCount: number;
  removed: number;
  title: string;
}) {
  return (
    <div
      className="flex items-end justify-between gap-4 border-b border-border px-1 pb-3 pt-1"
      data-review-group-header=""
    >
      <div className="min-w-0">
        <Typography type="h5" weight="semibold" className="truncate">
          {props.title}
        </Typography>
        <Typography type="body-xs" color="muted" className="mt-1 block">
          {props.fileCount} {props.fileCount === 1 ? "file" : "files"}
        </Typography>
      </div>
      <span className="flex shrink-0 gap-2 font-mono text-xs tabular-nums">
        <span className="text-green-600 dark:text-green-400">+{props.added}</span>
        <span className="text-red-600 dark:text-red-400">-{props.removed}</span>
      </span>
    </div>
  );
}

function DiffReviewList(props: {
  payload: ReviewPayload;
  review: ReviewJson;
  diffStyle: DiffStyle;
  lineWrap: boolean;
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
  theme: string;
  setTheme: (theme: string) => void;
  copiedReviewPath: boolean;
  displayedReviewPath: string;
  onCopyReviewPath: () => void;
  sidebarWidth: number;
  setSidebarWidth: (sidebarWidth: number) => void;
  collapsedFileIds: Set<string>;
  activeCommentId: string | null;
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
  const [fileQuery, setFileQuery] = useState("");
  const deferredFileQuery = useDeferredValue(fileQuery);
  const [selectedFileLocation, setSelectedFileLocation] = useState(() =>
    ReviewFileNavigation.read({ search: window.location.search }),
  );
  const [scrollMargin, setScrollMargin] = useState(0);
  const sidebarFiles = useMemo(
    () => FileSearch.search({ files: props.payload.files, query: deferredFileQuery }),
    [deferredFileQuery, props.payload.files],
  );
  const sidebarGroups = useMemo(
    () => ReviewGroupPresentation.build({ files: sidebarFiles, groups: props.payload.groups }),
    [props.payload.groups, sidebarFiles],
  );
  const sidebarItems = useMemo(
    () =>
      sidebarGroups.flatMap((group, groupIndex) => {
        const fileItems = group.files.map((file) => ({ kind: "file" as const, file }));
        return group.title
          ? [
              {
                kind: "group" as const,
                key: `group-${groupIndex}-${group.title}`,
                title: group.title,
                fileCount: group.files.length,
              },
              ...fileItems,
            ]
          : fileItems;
      }),
    [sidebarGroups],
  );
  const reviewGroups = useMemo(
    () =>
      ReviewGroupPresentation.build({
        files: props.payload.files,
        groups: props.payload.groups,
      }),
    [props.payload.files, props.payload.groups],
  );
  const reviewItems = useMemo(
    () =>
      reviewGroups.flatMap((group, groupIndex) => {
        const fileItems = group.files.map((file) => ({ kind: "file" as const, file }));
        if (!group.title) {
          return fileItems;
        }
        const totals = group.files.reduce(
          (sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }),
          { added: 0, removed: 0 },
        );
        return [
          {
            kind: "group" as const,
            key: `group-${groupIndex}-${group.title}`,
            title: group.title,
            fileCount: group.files.length,
            ...totals,
          },
          ...fileItems,
        ];
      }),
    [reviewGroups],
  );
  useEffect(
    function prepareFileSearchIndex() {
      FileSearch.prepare({ files: props.payload.files });
    },
    [props.payload.files],
  );
  const getReviewItemKey = useCallback(
    (index: number) => {
      const item = reviewItems[index];
      return item?.kind === "file" ? item.file.id : (item?.key ?? index);
    },
    [reviewItems],
  );
  const getSidebarItemKey = useCallback(
    (index: number) => {
      const item = sidebarItems[index];
      return item?.kind === "file" ? item.file.id : (item?.key ?? index);
    },
    [sidebarItems],
  );
  const fileIndexById = useMemo(
    () =>
      new Map(
        reviewItems.flatMap((item, index) =>
          item.kind === "file" ? ([[item.file.id, index]] as const) : [],
        ),
      ),
    [reviewItems],
  );
  const fileById = useMemo(
    () => new Map(props.payload.files.map((file) => [file.id, file])),
    [props.payload.files],
  );
  const reviewFileByLocation = useMemo(
    () => new Map(props.review.files.map((file) => [file.location, file])),
    [props.review.files],
  );
  const sidebarVirtualizer = useVirtualizer({
    count: sidebarItems.length,
    estimateSize: (index) => (sidebarItems[index]?.kind === "group" ? 34 : 38),
    getScrollElement: () => sidebarScrollElementRef.current,
    getItemKey: getSidebarItemKey,
    overscan: 10,
    useFlushSync: false,
  });
  const estimateSize = useCallback(
    (index: number) => {
      const item = reviewItems[index];
      if (!item) {
        return 120;
      }
      if (item.kind === "group") {
        return 72;
      }
      const file = item.file;
      if (props.collapsedFileIds.has(file.id)) {
        return 82;
      }
      return Math.max(120, 112 + (file.added + file.removed) * 22);
    },
    [props.collapsedFileIds, reviewItems],
  );
  const reviewVirtualizer = useVirtualizer({
    count: reviewItems.length,
    estimateSize,
    getScrollElement: () => scrollElementRef.current,
    getItemKey: getReviewItemKey,
    overscan: 1,
    scrollMargin,
    useFlushSync: false,
  });
  reviewVirtualizer.shouldAdjustScrollPositionOnItemSizeChange =
    function shouldAdjustScrollPositionOnItemSizeChange(item, _delta, instance) {
      return item.end < (instance.scrollOffset ?? 0);
    };

  const scrollToFile = useCallback(
    function scrollToFile(params: { fileId: string; updateUrl: boolean }) {
      const fileIndex = fileIndexById.get(params.fileId);
      const file = fileById.get(params.fileId);
      const isFileMissing = fileIndex === undefined || !file;
      if (isFileMissing) {
        return;
      }
      if (params.updateUrl) {
        const currentLocation = ReviewFileNavigation.read({ search: window.location.search });
        setSelectedFileLocation(file.location);
        if (currentLocation !== file.location) {
          window.history.pushState(
            {},
            "",
            ReviewFileNavigation.createHref({
              href: window.location.href,
              fileLocation: file.location,
            }),
          );
        }
      }
      reviewVirtualizer.scrollToIndex(fileIndex, { align: "start", behavior: "auto" });
    },
    [fileById, fileIndexById, reviewVirtualizer],
  );

  const handleFileExpandedChange = useCallback(
    (fileId: string, isExpanded: boolean) => {
      function commitExpandedChange() {
        props.setFileExpanded(fileId, isExpanded);
        window.requestAnimationFrame(() => {
          const item = listRef.current?.querySelector<HTMLElement>(
            `[data-review-file-item="${CSS.escape(fileId)}"]`,
          );
          if (item) {
            reviewVirtualizer.measureElement(item);
          }
        });
      }

      if (!isExpanded) {
        const item = listRef.current?.querySelector<HTMLElement>(
          `[data-review-file-item="${CSS.escape(fileId)}"]`,
        );
        const heading = item?.querySelector<HTMLElement>("[data-review-file-heading]");
        const scrollElement = scrollElementRef.current;
        const isHeadingPinned =
          item &&
          heading &&
          scrollElement &&
          Math.abs(
            heading.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top,
          ) <= 1;
        if (isHeadingPinned) {
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
    [props.setFileExpanded, reviewVirtualizer],
  );

  useLayoutEffect(() => {
    const list = listRef.current;
    const scrollElement = scrollElementRef.current;
    const isReviewListMissing = !list || !scrollElement;
    if (isReviewListMissing) {
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
  }, [props.sidebarWidth]);

  useEffect(() => {
    function updateSelectedFileFromUrl() {
      setSelectedFileLocation(ReviewFileNavigation.read({ search: window.location.search }));
    }
    window.addEventListener("popstate", updateSelectedFileFromUrl);
    return () => window.removeEventListener("popstate", updateSelectedFileFromUrl);
  }, []);

  useEffect(() => {
    if (!selectedFileLocation) {
      return;
    }
    const file = props.payload.files.find(
      (candidate) => candidate.location === selectedFileLocation,
    );
    if (!file) {
      return;
    }
    const fileId = file.id;
    const list = listRef.current;
    if (!list) {
      return;
    }
    let frame: number | null = null;
    let settleTimer: number | null = null;
    let stopped = false;
    const inputEvents = ["keydown", "pointerdown", "touchstart", "wheel"] as const;
    function stopRestoring() {
      stopped = true;
      Observer.disconnect();
      for (const eventName of inputEvents) {
        scrollElementRef.current?.removeEventListener(eventName, stopRestoring, true);
      }
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
    }
    function restoreSelectedFile() {
      if (stopped) {
        return;
      }
      const scrollElement = scrollElementRef.current;
      const item = listRef.current?.querySelector<HTMLElement>(
        `[data-review-file-item="${CSS.escape(fileId)}"]`,
      );
      const heading = item?.querySelector<HTMLElement>("[data-review-file-heading]");
      const canRestoreFile = heading && scrollElement;
      if (canRestoreFile) {
        const offset =
          heading.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top;
        const maximumScrollTop = Math.max(
          0,
          scrollElement.scrollHeight - scrollElement.clientHeight,
        );
        const targetScrollTop = Math.max(
          0,
          Math.min(maximumScrollTop, scrollElement.scrollTop + offset),
        );
        const isHeadingAligned = Math.abs(offset) <= 1;
        const isScrollBoundaryReached = Math.abs(targetScrollTop - scrollElement.scrollTop) <= 1;
        const shouldSettleRestoration = isHeadingAligned || isScrollBoundaryReached;
        if (shouldSettleRestoration) {
          settleTimer ??= window.setTimeout(stopRestoring, 250);
          return;
        }
        if (settleTimer !== null) {
          window.clearTimeout(settleTimer);
          settleTimer = null;
        }
        scrollElement.scrollTo({ behavior: "auto", top: targetScrollTop });
        frame = window.requestAnimationFrame(restoreSelectedFile);
      } else {
        if (settleTimer !== null) {
          window.clearTimeout(settleTimer);
          settleTimer = null;
        }
        scrollToFile({ fileId, updateUrl: false });
      }
    }
    const Observer = new MutationObserver(restoreSelectedFile);
    Observer.observe(list, {
      attributeFilter: ["style"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    for (const eventName of inputEvents) {
      scrollElementRef.current?.addEventListener(eventName, stopRestoring, {
        capture: true,
        passive: eventName === "touchstart" || eventName === "wheel",
      });
    }
    restoreSelectedFile();
    return stopRestoring;
  }, [props.payload.files, scrollMargin, scrollToFile, selectedFileLocation]);

  useEffect(() => {
    sidebarVirtualizer.scrollToOffset(0);
  }, [fileQuery, sidebarVirtualizer]);

  useEffect(() => {
    return () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  function resizeSidebar(nextWidth: number) {
    const maximumWidth = Math.min(480, window.innerWidth * 0.5);
    const resizedWidth = Math.round(Math.max(192, Math.min(maximumWidth, nextWidth)));
    sidebarWidthRef.current = resizedWidth;
    props.setSidebarWidth(resizedWidth);
    return resizedWidth;
  }

  function startSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    sidebarResizeStartRef.current = { clientX: event.clientX, width: props.sidebarWidth };
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
    const isResizeKey = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (!isResizeKey) {
      return;
    }
    event.preventDefault();
    const resizedWidth = resizeSidebar(props.sidebarWidth + (event.key === "ArrowLeft" ? -16 : 16));
    props.updateSidebarWidth(resizedWidth);
  }

  return (
    <HomeContent
      kind="diff"
      mainRef={scrollElementRef}
      footer={
        <HomeFooter
          className="col-start-2 row-start-2"
          copiedReviewPath={props.copiedReviewPath}
          contentMaxWidth="max-w-7xl"
          displayedReviewPath={props.displayedReviewPath}
          onCopyReviewPath={props.onCopyReviewPath}
          onThemeChange={props.setTheme}
          theme={props.theme}
        />
      }
      sidebar={
        <HomeSidebar
          fileCount={props.payload.files.length}
          onQueryChange={setFileQuery}
          onResizeKeyDown={resizeSidebarWithKeyboard}
          onResizePointerCancel={finishSidebarResize}
          onResizePointerDown={startSidebarResize}
          onResizePointerMove={continueSidebarResize}
          onResizePointerUp={finishSidebarResize}
          query={fileQuery}
          scrollRef={sidebarScrollElementRef}
          width={props.sidebarWidth}
        >
          <nav aria-label="Changed files" className="relative min-h-full">
            {sidebarFiles.length === 0 ? (
              <Typography type="body-xs" color="muted" className="block px-2 py-3 text-center">
                No matching files
              </Typography>
            ) : null}
            <div className="relative" style={{ height: sidebarVirtualizer.getTotalSize() }}>
              {sidebarVirtualizer.getVirtualItems().map((virtualFile) => {
                const item = sidebarItems[virtualFile.index];
                if (!item) {
                  return null;
                }
                if (item.kind === "group") {
                  return (
                    <div
                      key={virtualFile.key}
                      ref={sidebarVirtualizer.measureElement}
                      data-index={virtualFile.index}
                      className="absolute left-0 top-0 flex w-full items-center justify-between gap-2 px-2 pb-1 pt-3"
                      style={{ transform: `translateY(${virtualFile.start}px)` }}
                      data-review-sidebar-group=""
                    >
                      <Typography
                        type="body-xs"
                        weight="semibold"
                        className="min-w-0 truncate uppercase tracking-[0.08em]"
                      >
                        {item.title}
                      </Typography>
                      <Typography type="body-xs" color="muted" className="shrink-0 tabular-nums">
                        {item.fileCount}
                      </Typography>
                    </div>
                  );
                }
                const file = item.file;
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
                        (selectedFileLocation === file.location
                          ? "bg-default text-foreground"
                          : isCollapsed
                            ? "text-muted"
                            : "text-foreground")
                      }
                      aria-current={selectedFileLocation === file.location ? "location" : undefined}
                      data-collapsed={isCollapsed ? "true" : "false"}
                      data-file-status={fileStatus}
                      data-review-file-link={file.id}
                      onPress={() => scrollToFile({ fileId: file.id, updateUrl: true })}
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
            </div>
          </nav>
        </HomeSidebar>
      }
    >
      <div
        ref={listRef}
        data-review-file-list=""
        style={{
          height: reviewVirtualizer.getTotalSize(),
          overflowAnchor: "none",
          position: "relative",
        }}
      >
        {reviewVirtualizer.getVirtualItems().map((virtualFile) => {
          const item = reviewItems[virtualFile.index];
          if (!item) {
            return null;
          }
          if (item.kind === "group") {
            return (
              <div
                key={virtualFile.key}
                ref={reviewVirtualizer.measureElement}
                data-index={virtualFile.index}
                className="absolute left-0 top-0 w-full pb-4"
                style={{
                  top: virtualFile.start - reviewVirtualizer.options.scrollMargin,
                }}
              >
                <ReviewGroupHeader
                  added={item.added}
                  fileCount={item.fileCount}
                  removed={item.removed}
                  title={item.title}
                />
              </div>
            );
          }
          const file = item.file;
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
              ref={reviewVirtualizer.measureElement}
              data-index={virtualFile.index}
              data-review-file-item={file.id}
              className="absolute left-0 top-0 w-full pb-4"
              style={{
                top: virtualFile.start - reviewVirtualizer.options.scrollMargin,
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
                addComment={props.addComment}
                updateComment={props.updateComment}
                deleteComment={props.deleteComment}
              />
            </div>
          );
        })}
      </div>
    </HomeContent>
  );
}

type DocumentReviewSurfaceProps = {
  document: DocumentSource;
  comments: DocumentComment[];
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
  lineWrap: boolean;
  activeCommentId: string | null;
  addComment: (comment: DocumentComment) => void;
  updateComment: (commentId: string, patch: Partial<DocumentComment>) => void;
  deleteComment: (commentId: string) => void;
};

type DocumentMarkdownTreeProps = DocumentReviewSurfaceProps & {
  articleRef: React.RefObject<HTMLElement | null>;
  captureScrollAnchor: (element: HTMLElement) => void;
  onMarkdownRendered: () => void;
};

type DocumentCodePreferences = {
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
  lineWrap: boolean;
};

const DocumentCodePreferencesContext = createContext<DocumentCodePreferences>({
  diffTheme: "github-light",
  diffThemeType: "light",
  lineWrap: false,
});

const DocumentMarkdownRenderer = React.lazy(async function loadDocumentMarkdownRenderer() {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);

  function LoadedDocumentMarkdownRenderer(props: {
    children: string;
    components: Components;
    onRendered: () => void;
  }) {
    useLayoutEffect(props.onRendered, [props.onRendered]);
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[DocumentMarkdownNavigation.buildHeadingIdPlugin({})]}
        components={props.components}
      >
        {props.children}
      </ReactMarkdown>
    );
  }

  return { default: LoadedDocumentMarkdownRenderer };
});

function isCodeDocumentComment(comment: DocumentComment) {
  return comment.endBlockId.startsWith("pre:");
}

const DocumentReviewSurface = React.memo(function DocumentReviewSurface(
  props: DocumentReviewSurfaceProps,
) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [markdownRenderRevision, setMarkdownRenderRevision] = useState(0);
  const codeComments = useMemo(
    () => props.comments.filter(isCodeDocumentComment),
    [props.comments],
  );
  const proseComments = useMemo(
    () => props.comments.filter((comment) => !isCodeDocumentComment(comment)),
    [props.comments],
  );
  const codeActiveCommentId = codeComments.some((comment) => comment.id === props.activeCommentId)
    ? props.activeCommentId
    : null;
  const documentCodePreferences = useMemo<DocumentCodePreferences>(
    () => ({
      diffTheme: props.diffTheme,
      diffThemeType: props.diffThemeType,
      lineWrap: props.lineWrap,
    }),
    [props.diffTheme, props.diffThemeType, props.lineWrap],
  );
  const documentTreeRevision = useMemo(() => ({}), [markdownRenderRevision, props.document]);
  const markMarkdownRendered = useCallback(function markMarkdownRendered() {
    setMarkdownRenderRevision((revision) => revision + 1);
  }, []);
  const { capture: captureDocumentScrollAnchor, stabilize: stabilizeDocumentScrollAnchor } =
    useScrollAnchorStabilizer<ElementScrollAnchor>({
      frameCount: 20,
      restore: function restoreDocumentScrollAnchor(anchor) {
        ReviewCommentInteraction.restoreElementScrollAnchor({ anchor });
      },
    });
  const captureScrollAnchor = useCallback(
    function captureScrollAnchor(element: HTMLElement) {
      const scrollElement = element.closest<HTMLElement>("[data-review-document-scroll]");
      if (!scrollElement) {
        return;
      }
      captureDocumentScrollAnchor(
        ReviewCommentInteraction.captureElementScrollAnchor({ element, scrollElement }),
      );
    },
    [captureDocumentScrollAnchor],
  );

  useLayoutEffect(
    function preserveSelectedBlockPosition() {
      stabilizeDocumentScrollAnchor();
    },
    [proseComments, stabilizeDocumentScrollAnchor],
  );

  return (
    <div className="bg-background">
      <DocumentCodePreferencesContext.Provider value={documentCodePreferences}>
        <DocumentMarkdownTree
          {...props}
          activeCommentId={codeActiveCommentId}
          articleRef={articleRef}
          captureScrollAnchor={captureScrollAnchor}
          comments={codeComments}
          onMarkdownRendered={markMarkdownRendered}
        />
      </DocumentCodePreferencesContext.Provider>
      <DocumentCommentLayer
        activeCommentId={props.activeCommentId}
        articleRef={articleRef}
        comments={proseComments}
        deleteComment={props.deleteComment}
        documentTreeRevision={documentTreeRevision}
        updateComment={props.updateComment}
      />
    </div>
  );
});

const DocumentMarkdownTree = React.memo(function DocumentMarkdownTree(
  props: DocumentMarkdownTreeProps,
) {
  const latestProps = useRef(props);
  latestProps.current = props;

  function renderBlock(
    tag: string,
    node: { position?: { start: { line: number }; end: { line: number } } } | undefined,
    content: React.ReactNode,
    listItemProps?: React.LiHTMLAttributes<HTMLLIElement>,
    annotateBlock = true,
    blockClassName = "",
  ) {
    const startLine = node?.position?.start.line ?? 0;
    const endLine = node?.position?.end.line ?? startLine;
    const blockId = tag + ":" + startLine + ":" + endLine;
    const blockContent = content;
    const blockProps = {
      "data-annotated": "false",
      "data-document-annotatable": annotateBlock ? "true" : "false",
      "data-document-block": blockId,
      "data-start-line": startLine,
      "data-end-line": endLine,
    };
    if (listItemProps) {
      return (
        <li
          {...listItemProps}
          {...blockProps}
          className={`relative transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] data-[annotated=true]:rounded-[var(--vercel-radius)] data-[annotated=true]:bg-[#0070f3]/10 ${listItemProps.className ?? ""}`}
        >
          {blockContent}
        </li>
      );
    }
    return (
      <div
        {...blockProps}
        className={`relative transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] data-[annotated=true]:rounded-[var(--vercel-radius)] data-[annotated=true]:bg-[#0070f3]/10 ${blockClassName}`}
      >
        {blockContent}
      </div>
    );
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
      pre: ({ node, children }) => {
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
      },
      blockquote: ({ node, children, ...elementProps }) =>
        renderBlock("blockquote", node, <blockquote {...elementProps}>{children}</blockquote>),
      table: ({ node, children, ...elementProps }) => {
        const startLine = node?.position?.start.line ?? 0;
        const endLine = node?.position?.end.line ?? startLine;
        return renderBlock(
          "table",
          node,
          <LazyDocumentTable startLine={startLine} endLine={endLine} tableProps={elementProps}>
            {children}
          </LazyDocumentTable>,
          undefined,
          false,
          "w-fit max-w-full",
        );
      },
      tr: ({ node, children, ...elementProps }) => {
        const startLine = node?.position?.start.line ?? 0;
        return (
          <tr
            {...elementProps}
            data-annotated="false"
            data-document-annotatable="true"
            data-document-line={startLine}
          >
            {children}
          </tr>
        );
      },
      hr: ({ node, ...elementProps }) => renderBlock("hr", node, <hr {...elementProps} />),
      a: ({ node: _node, children, ...elementProps }) => {
        const linkAttributes = DocumentMarkdownNavigation.linkAttributes({
          href: elementProps.href,
        });
        return (
          <a {...elementProps} {...linkAttributes}>
            {children}
          </a>
        );
      },
    }),
    [],
  );

  function handleMouseUp() {
    window.setTimeout(() => {
      const root = props.articleRef.current;
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
          ? ReviewCommentInteraction.selectedDocumentLineRange({ root: startBlock, range })
          : null;
      const blockStartLine = Number.parseInt(startBlock.dataset.startLine ?? "0", 10);
      const blockEndLine = Number.parseInt(endBlock.dataset.endLine ?? "0", 10);
      const now = new Date().toISOString();
      const comment: DocumentComment = {
        id: ReviewCommentInteraction.createId({}),
        selectedText,
        startBlockId: startBlock.dataset.documentBlock ?? "",
        endBlockId: endBlock.dataset.documentBlock ?? "",
        startLine: selectedDocumentLines?.startLine ?? blockStartLine,
        endLine: selectedDocumentLines?.endLine ?? blockEndLine,
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

function DocumentCommentLayer(props: {
  activeCommentId: string | null;
  articleRef: React.RefObject<HTMLElement | null>;
  comments: DocumentComment[];
  deleteComment: (commentId: string) => void;
  documentTreeRevision: object;
  updateComment: (commentId: string, patch: Partial<DocumentComment>) => void;
}) {
  const annotatedElementsRef = useRef<Set<HTMLElement>>(new Set());
  const annotationIndexRef = useRef<{
    documentTreeRevision: object;
    elementsByLine: Map<number, HTMLElement[]>;
  } | null>(null);
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
        const elementsByLine = new Map<number, HTMLElement[]>();
        const candidates = article.querySelectorAll<HTMLElement>(
          '[data-document-annotatable="true"]',
        );
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
        annotationIndexRef.current = {
          documentTreeRevision: props.documentTreeRevision,
          elementsByLine,
        };
      }
      const nextAnnotatedElements = new Set<HTMLElement>();
      const elementsByLine = annotationIndexRef.current?.elementsByLine;
      for (const comment of props.comments) {
        for (let lineNumber = comment.startLine; lineNumber <= comment.endLine; lineNumber += 1) {
          let lineElements = elementsByLine?.get(lineNumber) ?? [];
          if (lineElements.length === 0) {
            lineElements = Array.from(
              article.querySelectorAll<HTMLElement>(`[data-document-line="${lineNumber}"]`),
            );
            if (lineElements.length > 0) {
              elementsByLine?.set(lineNumber, lineElements);
            }
          }
          for (const element of lineElements) {
            nextAnnotatedElements.add(element);
          }
        }
      }
      for (const element of annotatedElementsRef.current) {
        if (!nextAnnotatedElements.has(element)) {
          element.dataset.annotated = "false";
        }
      }
      for (const element of nextAnnotatedElements) {
        if (!annotatedElementsRef.current.has(element)) {
          element.dataset.annotated = "true";
        }
      }
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
    <div className="not-typeset">
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
  const { isVisible, targetRef } = useLazyVisibility();
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

function LazyDocumentCodeBlock(props: DocumentCodeBlockProps) {
  const { isVisible, targetRef } = useLazyVisibility();
  const codeElement = React.Children.toArray(props.children).find(React.isValidElement);
  const codeElementProps = codeElement?.props as { children?: React.ReactNode } | undefined;
  const code = typeof codeElementProps?.children === "string" ? codeElementProps.children : "";
  const lineCount = Math.max(1, code.replace(/\n$/, "").split(/\r\n|\r|\n/).length);

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

function DocumentCodeBlock(props: DocumentCodeBlockProps) {
  const preferences = useContext(DocumentCodePreferencesContext);
  const codeElement = React.Children.toArray(props.children).find(React.isValidElement);
  const codeElementProps = codeElement?.props as
    | { children?: React.ReactNode; className?: string }
    | undefined;
  const className = codeElementProps?.className;
  const code =
    typeof codeElementProps?.children === "string"
      ? codeElementProps.children.replace(/\n$/, "")
      : "";
  const language = DocumentCodeHighlighter.languageFromClassName({ className });
  const { clearSelectedLines, selectedLines, selectLines } = useReviewLineSelection();
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
  const file = useMemo<FileContents>(
    () => ({
      name: props.fileName ?? `document-code.${language}`,
      contents: code,
      lang: language,
      cacheKey: `document:${props.blockId}:${language}:${code}`,
    }),
    [code, language, props.blockId, props.fileName],
  );
  const codeLines = useMemo(() => code.split(/\r\n|\r|\n/), [code]);
  const commentsById = useMemo(
    () => new Map(comments.map((comment) => [comment.id, comment])),
    [comments],
  );
  const lineAnnotations = useMemo<LineAnnotation<CommentAnnotationMetadata>[]>(
    () =>
      comments.flatMap((comment) => {
        const lineNumber = comment.endLine - props.sourceStartLine + 1;
        const isLineInCodeBlock = lineNumber >= 1 && lineNumber <= codeLines.length;
        return isLineInCodeBlock ? [{ lineNumber, metadata: { commentId: comment.id } }] : [];
      }),
    [codeLines.length, comments, props.sourceStartLine],
  );

  const addCodeComment = useCallback(
    function addCodeComment(range: SelectedLineRange) {
      const start = Math.min(range.start, range.end);
      const end = Math.max(range.start, range.end);
      const selectedText = codeLines.slice(start - 1, end).join("\n");
      const beforeSelection = codeLines.slice(0, start - 1).join("\n");
      const afterSelection = codeLines.slice(end).join("\n");
      const now = new Date().toISOString();
      const comment: DocumentComment = {
        id: ReviewCommentInteraction.createId({}),
        selectedText,
        startBlockId: propsRef.current.blockId,
        endBlockId: propsRef.current.blockId,
        startLine: propsRef.current.sourceStartLine + start - 1,
        endLine: propsRef.current.sourceStartLine + end - 1,
        prefix: beforeSelection.slice(-40),
        suffix: afterSelection.slice(0, 40),
        comment: "",
        createdAt: now,
        updatedAt: now,
      };
      setComments((current) => [...current, comment]);
      setActiveCommentId(comment.id);
      propsRef.current.addComment(comment);
    },
    [codeLines],
  );
  const fileOptions = useMemo<NonNullable<FileProps<CommentAnnotationMetadata>["options"]>>(
    () => ({
      theme: preferences.diffTheme,
      themeType: preferences.diffThemeType,
      overflow: preferences.lineWrap ? "wrap" : "scroll",
      disableFileHeader: true,
      unsafeCSS: ReviewDiffPresentation.fileOptions().unsafeCSS,
      enableLineSelection: true,
      onLineSelectionEnd: function onLineSelectionEnd(range) {
        if (range) {
          selectLines(range);
          addCodeComment(range);
        } else {
          clearSelectedLines();
        }
      },
      onPostRender: function onPostRender(node, instance, phase) {
        ReviewCommentInteraction.installRowSelection({
          node,
          phase,
          renderer: instance,
          previewSelection: selectLines,
          commitSelection: function commitRowSelection(range) {
            selectLines(range);
            addCodeComment(range);
          },
        });
      },
    }),
    [
      addCodeComment,
      clearSelectedLines,
      preferences.diffTheme,
      preferences.diffThemeType,
      preferences.lineWrap,
      selectLines,
    ],
  );

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
          if (!comment) {
            return null;
          }
          const commentRange: SelectedLineRange = {
            start: comment.startLine - props.sourceStartLine + 1,
            end: comment.endLine - props.sourceStartLine + 1,
            side: "additions",
            endSide: "additions",
          };
          return (
            <CommentEditor
              id={comment.id}
              value={comment.comment}
              active={activeCommentId === comment.id}
              onChange={(value) => {
                setComments((current) =>
                  current.map((currentComment) =>
                    currentComment.id === comment.id
                      ? { ...currentComment, comment: value }
                      : currentComment,
                  ),
                );
                propsRef.current.updateComment(comment.id, { comment: value });
              }}
              onFinish={(value) => {
                clearSelectedLines(commentRange);
                setActiveCommentId(null);
                setComments((current) =>
                  current.map((currentComment) =>
                    currentComment.id === comment.id
                      ? { ...currentComment, comment: value }
                      : currentComment,
                  ),
                );
                propsRef.current.updateComment(comment.id, { comment: value });
              }}
              onDelete={() => {
                clearSelectedLines(commentRange);
                setActiveCommentId(null);
                setComments((current) =>
                  current.filter((currentComment) => currentComment.id !== comment.id),
                );
                propsRef.current.deleteComment(comment.id);
              }}
            />
          );
        }}
      />
    </ReviewCodeFrame>
  );
}

const ReviewFileDiff = React.memo(function ReviewFileDiff(props: ReviewFileDiffProps) {
  const { file, reviewFile } = props;
  const [copied, setCopied] = useState(false);
  const { clearSelectedLines, selectedLines, selectLines } = useReviewLineSelection();
  const propsRef = useRef(props);
  propsRef.current = props;
  const { capture: captureDiffScrollAnchor, stabilize: stabilizeDiffScrollAnchor } =
    useScrollAnchorStabilizer<DiffScrollAnchor>({
      frameCount: 120,
      restore: function restoreDiffScrollAnchor(anchor) {
        ReviewCommentInteraction.restoreDiffScrollAnchor({ anchor });
      },
    });
  const captureScrollAnchor = useCallback(
    function captureScrollAnchor(range: SelectedLineRange) {
      const node = document.querySelector<HTMLElement>(
        `[data-review-file-item="${CSS.escape(file.id)}"] diffs-container`,
      );
      if (!node) {
        return;
      }
      captureDiffScrollAnchor(ReviewCommentInteraction.captureDiffScrollAnchor({ node, range }));
    },
    [captureDiffScrollAnchor, file.id],
  );
  useLayoutEffect(
    function preserveSelectedLinePosition() {
      stabilizeDiffScrollAnchor();
    },
    [reviewFile.comments, stabilizeDiffScrollAnchor],
  );
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
  const diffOptions = useMemo<
    NonNullable<FileDiffProps<CommentAnnotationMetadata>["options"]>
  >(() => {
    const presentationOptions = ReviewDiffPresentation.fileOptions();
    return {
      ...presentationOptions,
      theme: props.diffTheme,
      themeType: props.diffThemeType,
      diffStyle: props.diffStyle,
      overflow: props.lineWrap ? "wrap" : "scroll",
      lineDiffType:
        file.added + file.removed > largeDiffWordHighlightThreshold
          ? "none"
          : presentationOptions.lineDiffType,
      enableLineSelection: true,
      onLineSelectionEnd: (range) => {
        if (range) {
          captureScrollAnchor(range);
          selectLines(range);
          propsRef.current.addComment(file, range);
        } else {
          clearSelectedLines();
        }
      },
      onPostRender: (node, instance, phase) => {
        ReviewCommentInteraction.installRowSelection({
          node,
          phase,
          renderer: instance,
          previewSelection: selectLines,
          commitSelection: function commitRowSelection(range) {
            captureScrollAnchor(range);
            selectLines(range);
            propsRef.current.addComment(file, range);
          },
        });
      },
    };
  }, [
    captureScrollAnchor,
    clearSelectedLines,
    file,
    props.diffStyle,
    props.diffTheme,
    props.diffThemeType,
    props.lineWrap,
    selectLines,
  ]);

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
    <ReviewCodeFrame
      added={file.added}
      commentCount={writtenCommentCount}
      copied={copied}
      fileName={file.location}
      id={file.id}
      onCopy={copyPath}
      removed={file.removed}
    >
      <ReviewFileDiffBody
        activeCommentId={props.activeCommentId}
        clearSelectedLines={clearSelectedLines}
        deleteComment={props.deleteComment}
        fileDiff={fileDiff}
        file={file}
        options={diffOptions}
        reviewFile={reviewFile}
        selectedLines={selectedLines}
        updateComment={props.updateComment}
      />
    </ReviewCodeFrame>
  );
});

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
