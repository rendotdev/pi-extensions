import { useState } from "react";
import { Spinner, Typography, useTheme } from "@heroui/react";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import type { ReviewPayload } from "../../../types/review.ts";
import { DiffReviewList } from "./diff-review-list.tsx";
import { DocumentReviewSurface } from "./document-review-surface.tsx";
import { homeRouteDeps } from "./home-route-deps.ts";
import { useHomePreferenceActions } from "./hooks/home-preference-actions/home-preference-actions.ts";
import { useHomeReviewActions } from "./hooks/home-review-actions/home-review-actions.ts";
import { useHomeReviewComments } from "./hooks/home-review-comments/home-review-comments.ts";
import { useHomeReviewData } from "./hooks/home-review-data/home-review-data.ts";
import { useHomeReviewSave } from "./hooks/home-review-save/home-review-save.ts";
import { HomeTemplate, type HomeTemplateProps } from "./template/template.tsx";

function displayReviewPath(reviewPath: string) {
  const parts = reviewPath.split(/[\\/]/).filter(Boolean);
  const fileName = parts.at(-1) ?? "review.json";
  const sessionName = parts.at(-2) ?? "session";
  return sessionName.length > 40
    ? `${sessionName.slice(0, 24)}…${sessionName.slice(-12)}/${fileName}`
    : `${sessionName}/${fileName}`;
}

function reviewStatus(params: {
  busyLabel: string;
  isBusy: boolean;
  lastSavedAt: Date | null;
  override: { label: string; tone: "success" | "warning" } | null;
  status: "open" | "approved" | "changes_requested" | "canceled";
}) {
  if (params.isBusy) {
    return { label: params.busyLabel, tone: "busy" as const };
  }
  if (params.override) {
    return params.override;
  }
  const savedTime = params.lastSavedAt?.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const isUnsavedOpenReview = params.status === "open" && !savedTime;
  if (isUnsavedOpenReview) {
    return { label: "Not saved yet", tone: "idle" as const };
  }
  const labels = {
    approved: "Approved",
    changes_requested: "Comments sent",
    canceled: "Canceled",
    open: savedTime ? "Saved " + savedTime : "Up to date",
  };
  return { label: labels[params.status], tone: "success" as const };
}

type LoadedProps = ReturnType<typeof useHomeRouteController>;

function createDocumentView(props: LoadedProps, payload: ReviewPayload) {
  return {
    kind: "document" as const,
    contentMaxWidth: "max-w-4xl",
    content: payload.document ? (
      <DocumentReviewSurface
        document={payload.document}
        comments={props.data.state!.review.documentComments}
        diffTheme={props.diffTheme.name}
        diffThemeType={props.diffTheme.type}
        lineWrap={props.data.preferences.lineWrap}
        activeCommentId={props.activeCommentId}
        addComment={props.comments.addDocumentComment}
        updateComment={props.comments.updateDocumentComment}
        deleteComment={props.comments.deleteDocumentComment}
      />
    ) : null,
    footer: {
      copiedReviewPath: props.actions.copiedReviewPath,
      contentMaxWidth: "max-w-4xl",
      displayedReviewPath: props.displayedReviewPath,
      onCopyReviewPath: props.actions.copyReviewPath,
      onThemeChange: props.setTheme,
      theme: props.theme,
    },
  } satisfies HomeTemplateProps["view"];
}

function createDiffView(props: LoadedProps, payload: ReviewPayload) {
  const review = props.data.state!.review;
  return {
    kind: "diff" as const,
    content: (
      <DiffReviewList
        payload={payload}
        review={review}
        diffStyle={props.data.preferences.diffStyle}
        lineWrap={props.data.preferences.lineWrap}
        diffTheme={props.diffTheme.name}
        diffThemeType={props.diffTheme.type}
        theme={props.theme}
        setTheme={props.setTheme}
        copiedReviewPath={props.actions.copiedReviewPath}
        displayedReviewPath={props.displayedReviewPath}
        onCopyReviewPath={props.actions.copyReviewPath}
        sidebarWidth={props.preferences.displayedSidebarWidth}
        setSidebarWidth={props.preferences.setDisplayedSidebarWidth}
        collapsedFileIds={props.data.collapsedFileIds}
        activeCommentId={props.activeCommentId}
        setFileExpanded={props.comments.setFileExpanded}
        updateSidebarWidth={props.preferences.updateSidebarWidth}
        addComment={props.comments.addComment}
        updateComment={props.comments.updateComment}
        deleteComment={props.comments.deleteComment}
      />
    ),
  } satisfies HomeTemplateProps["view"];
}

function LoadedHomeRoute(props: LoadedProps) {
  const state = props.data.state!;
  const { payload, review } = state;
  const commentCount = homeRouteDeps.reviewPresentation.commentCount({ review });
  const canToggleFiles = payload.kind === "diff" && payload.files.length > 0;
  const hasExpandedFiles =
    canToggleFiles && props.data.collapsedFileIds.size < payload.files.length;
  const status = reviewStatus({
    busyLabel: props.actions.copyingStatus ?? props.save.busyIndicatorLabel,
    isBusy: props.isBusyIndicatorVisible,
    lastSavedAt: props.save.lastSavedAt,
    override: props.save.reviewStatusOverride,
    status: review.status,
  });
  return (
    <HomeTemplate
      header={{
        actionLabel: commentCount > 0 ? "Send review comments" : "Approve this review",
        canToggleFiles,
        contentMaxWidth: payload.kind === "document" ? "max-w-4xl" : "max-w-7xl",
        decisionButtonLabel: commentCount > 0 ? `Send (${commentCount})` : "Approve",
        diffStyle: props.data.preferences.diffStyle,
        hasExpandedFiles,
        headerRef: props.data.headerRef,
        isBusy: props.isBusyIndicatorVisible,
        isFinished: review.status !== "open",
        isFinishing: props.isFinishing,
        kind: payload.kind,
        lineWrap: props.data.preferences.lineWrap,
        name: payload.name,
        onCancel: props.actions.cancel,
        onDiffStyleChange: props.preferences.updateDiffStyle,
        onFinish: () => props.actions.finish(props.actions.primaryDecision),
        onLineWrapChange: props.preferences.updateLineWrap,
        onToggleAllFiles: props.preferences.toggleAllFiles,
        primaryShortcutLabel: formatForDisplay("Mod+Enter"),
        status,
      }}
      view={
        payload.kind === "document"
          ? createDocumentView(props, payload)
          : createDiffView(props, payload)
      }
    />
  );
}

function useHomeRouteController() {
  const { resolvedTheme, setTheme, theme } = useTheme("system");
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const data = useHomeReviewData({});
  const save = useHomeReviewSave({ data, isFinishing });
  const isBusyIndicatorVisible = save.isBusy || save.showBusyIndicator;
  const actions = useHomeReviewActions({
    data,
    isBusy: isBusyIndicatorVisible,
    isFinishing,
    save,
    setIsFinishing,
  });
  const comments = useHomeReviewComments({
    activeCommentId,
    data,
    queueSave: save.queueSave,
    setActiveCommentId,
    showSavingPreferences: save.showSavingPreferences,
  });
  const preferences = useHomePreferenceActions({
    data,
    showSavingPreferences: save.showSavingPreferences,
  });
  const diffTheme = homeRouteDeps.reviewDiffPresentation.resolveTheme({ resolvedTheme });
  return {
    actions,
    activeCommentId,
    comments,
    data,
    diffTheme,
    displayedReviewPath: data.state ? displayReviewPath(data.state.payload.reviewPath) : "",
    isBusyIndicatorVisible: isBusyIndicatorVisible || actions.copyingStatus !== null,
    isFinishing,
    preferences,
    save,
    setTheme,
    theme,
  };
}

export function HomeRouteView() {
  const props = useHomeRouteController();
  if (!props.data.state) {
    return (
      <div className="flex min-h-screen items-center justify-center text-foreground">
        <Spinner />
        <Typography.Paragraph size="sm" color="muted" className="ml-3">
          Loading lgtm...
        </Typography.Paragraph>
      </div>
    );
  }
  return <LoadedHomeRoute {...props} />;
}
