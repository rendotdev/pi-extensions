import { useState, type Dispatch, type SetStateAction } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { defineUIHook } from "../../../../../../../define.ts";
import type { ReviewJson } from "../../../../../types/review.ts";
import { homeRouteDeps } from "../../home-route-deps.ts";
import type { HomeReviewData } from "../home-review-data/home-review-data.ts";
import type { HomeReviewSave } from "../home-review-save/home-review-save.ts";

type Decision = "approved" | "changes_requested";
type Deps = typeof homeRouteDeps;

async function copyHandoff(
  deps: Deps,
  setCopyingStatus: Dispatch<SetStateAction<string | null>>,
  params: { text: string; status: string },
) {
  return await deps.reviewClipboardCopy.copy({
    text: params.text,
    onStart: () => setCopyingStatus(params.status),
    onFinish: () => setCopyingStatus(null),
  });
}

function stopFinishing(save: HomeReviewSave, setIsFinishing: (value: boolean) => void) {
  setIsFinishing(false);
  save.hideBusyIndicatorDebouncer.cancel();
  save.setShowBusyIndicator(false);
}

async function saveBeforeFinish(params: {
  data: HomeReviewData;
  deps: Deps;
  review: ReviewJson;
  save: HomeReviewSave;
  setCopyingStatus: Dispatch<SetStateAction<string | null>>;
  setIsFinishing: (value: boolean) => void;
}) {
  params.save.saveDebouncer.cancel();
  try {
    const savedReview = await params.data.saveMutation.mutateAsync(params.review);
    params.data.lastSavedSignature.current = params.deps.reviewPresentation.meaningfulSignature({
      review: savedReview,
    });
    return true;
  } catch {
    const didCopy = await copyHandoff(params.deps, params.setCopyingStatus, {
      text: params.deps.reviewHandoff.fallbackText({ review: params.review }),
      status: "Copying comments",
    });
    stopFinishing(params.save, params.setIsFinishing);
    params.save.setReviewStatusOverride(
      didCopy
        ? { label: "Comments copied", tone: "success" }
        : { label: "Comments kept in this tab", tone: "warning" },
    );
    if (didCopy) {
      params.deps.toastNotifications.commentsCopied({});
    } else {
      params.deps.toastNotifications.commentsKeptInTab({});
    }
    return false;
  }
}

async function finishReview(params: {
  data: HomeReviewData;
  decision: Decision;
  deps: Deps;
  isBusy: boolean;
  save: HomeReviewSave;
  setCopyingStatus: Dispatch<SetStateAction<string | null>>;
  setIsFinishing: (value: boolean) => void;
}) {
  const state = params.data.state;
  if (!state) {
    return;
  }
  if (params.isBusy) {
    return;
  }
  const review = params.deps.commentDraft.applyToReview({
    review: params.data.latestReviewRef.current ?? state.review,
  });
  const hasComments = params.deps.reviewPresentation.commentCount({ review }) > 0;
  const decision =
    params.decision === "approved" && hasComments ? "changes_requested" : params.decision;
  const isEmptyChangeRequest = decision === "changes_requested" && !hasComments;
  if (isEmptyChangeRequest) {
    return;
  }
  if (review !== state.review) {
    params.data.setState((current) => (current ? { ...current, review } : current));
  }
  params.setIsFinishing(true);
  params.save.setReviewStatusOverride(null);
  const didCopy = await copyHandoff(params.deps, params.setCopyingStatus, {
    text: params.deps.reviewHandoff.clipboardText({ decision, review }),
    status: "Copying review handoff",
  });
  if (!didCopy) {
    stopFinishing(params.save, params.setIsFinishing);
    params.deps.toastNotifications.copyFailed({});
    return;
  }
  if (!(await saveBeforeFinish({ ...params, review }))) {
    return;
  }
  try {
    const finished = await params.data.finishMutation.mutateAsync(decision);
    params.data.setState((current) => (current ? { ...current, review: finished } : current));
    window.close();
    window.setTimeout(() => window.close(), 50);
  } catch {
    stopFinishing(params.save, params.setIsFinishing);
    params.save.setReviewStatusOverride({
      label: "Review saved but not finished",
      tone: "warning",
    });
    params.deps.toastNotifications.reviewNotFinished({});
  }
}

async function cancelReview(params: {
  data: HomeReviewData;
  deps: Deps;
  isBusy: boolean;
  save: HomeReviewSave;
  setIsFinishing: (value: boolean) => void;
}) {
  if (!params.data.state) {
    return;
  }
  if (params.isBusy) {
    return;
  }
  params.setIsFinishing(true);
  params.save.saveDebouncer.cancel();
  try {
    const canceled = await params.data.cancelMutation.mutateAsync();
    params.data.setState((current) => (current ? { ...current, review: canceled } : current));
    window.setTimeout(() => {
      window.close();
      document.body.innerHTML =
        '<main style="font-family: system-ui, sans-serif; padding: 2rem; color: #111827;"><h1>Review canceled</h1><p>You can close this tab.</p></main>';
    }, 250);
  } catch {
    params.setIsFinishing(false);
    params.deps.toastNotifications.cancelFailed({});
  }
}

export const useHomeReviewActions = defineUIHook({
  params: {},
  deps: homeRouteDeps,
  hook(props: {
    data: HomeReviewData;
    isBusy: boolean;
    isFinishing: boolean;
    save: HomeReviewSave;
    setIsFinishing: (value: boolean) => void;
  }) {
    const deps = this.deps as Deps;
    const [copiedReviewPath, setCopiedReviewPath] = useState(false);
    const [copyingStatus, setCopyingStatus] = useState<string | null>(null);
    const primaryDecision: Decision =
      props.data.state &&
      deps.reviewPresentation.commentCount({ review: props.data.state.review }) > 0
        ? "changes_requested"
        : "approved";
    function finish(decision: Decision) {
      return finishReview({ ...props, decision, deps, setCopyingStatus });
    }
    function cancel() {
      return cancelReview({ ...props, deps });
    }
    async function copyReviewPath() {
      if (!props.data.state) {
        return;
      }
      try {
        await navigator.clipboard.writeText(props.data.state.payload.reviewPath);
        setCopiedReviewPath(true);
        window.setTimeout(() => setCopiedReviewPath(false), 1200);
      } catch {
        setCopiedReviewPath(false);
      }
    }
    const canFinish =
      Boolean(props.data.state) && props.data.state?.review.status === "open" && !props.isBusy;
    useHotkey("Mod+Enter", () => void finish(primaryDecision), {
      enabled: canFinish,
      ignoreInputs: false,
    });
    return { cancel, copiedReviewPath, copyingStatus, copyReviewPath, finish, primaryDecision };
  },
});

export type HomeReviewActions = ReturnType<typeof useHomeReviewActions>;
