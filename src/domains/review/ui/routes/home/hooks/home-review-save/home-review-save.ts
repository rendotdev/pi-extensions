import { useCallback, useEffect, useState } from "react";
import { useAsyncDebouncer } from "@tanstack/react-pacer/async-debouncer";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { defineUIHook } from "../../../../../../../define.ts";
import type { ReviewJson } from "../../../../../types/review.ts";
import { homeRouteDeps } from "../../home-route-deps.ts";
import type { HomeReviewData } from "../home-review-data/home-review-data.ts";

function useBusyIndicator(params: {
  isFinishing: boolean;
  isPreferenceSaving: boolean;
  isSaving: boolean;
}) {
  const [showBusyIndicator, setShowBusyIndicator] = useState(false);
  const [busyIndicatorLabel, setBusyIndicatorLabel] = useState("Saving review");
  const hideBusyIndicatorDebouncer = useDebouncer(() => setShowBusyIndicator(false), {
    wait: 650,
  });
  const isBusy = params.isFinishing || params.isSaving || params.isPreferenceSaving;
  useEffect(
    function updateBusyIndicator() {
      if (isBusy) {
        hideBusyIndicatorDebouncer.cancel();
        setBusyIndicatorLabel(
          params.isFinishing
            ? "Finishing review"
            : params.isPreferenceSaving && !params.isSaving
              ? "Saving preferences"
              : "Saving review",
        );
        setShowBusyIndicator(true);
        return;
      }
      if (showBusyIndicator) {
        hideBusyIndicatorDebouncer.maybeExecute();
      }
    },
    [hideBusyIndicatorDebouncer, isBusy, params, showBusyIndicator],
  );
  const showSavingPreferences = useCallback(() => {
    hideBusyIndicatorDebouncer.cancel();
    setBusyIndicatorLabel("Saving preferences");
    setShowBusyIndicator(true);
  }, [hideBusyIndicatorDebouncer]);
  return {
    busyIndicatorLabel,
    hideBusyIndicatorDebouncer,
    isBusy,
    setShowBusyIndicator,
    showBusyIndicator,
    showSavingPreferences,
  };
}

export const useHomeReviewSave = defineUIHook({
  params: {},
  deps: homeRouteDeps,
  hook(props: { data: HomeReviewData; isFinishing: boolean }) {
    const deps = this.deps;
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [reviewStatusOverride, setReviewStatusOverride] = useState<{
      label: string;
      tone: "success" | "warning";
    } | null>(null);
    const saveDebouncer = useAsyncDebouncer(
      async (review: ReviewJson) => {
        const signature = deps.reviewPresentation.meaningfulSignature({ review });
        if (signature === props.data.lastSavedSignature.current) {
          return review;
        }
        const savedReview = await props.data.saveMutation.mutateAsync(review);
        props.data.lastSavedSignature.current = deps.reviewPresentation.meaningfulSignature({
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
          deps.toastNotifications.commentsNotSaved({});
        },
      },
      (state) => ({ isExecuting: state.isExecuting, isPending: state.isPending }),
    );
    const isSaving =
      saveDebouncer.state.isPending ||
      saveDebouncer.state.isExecuting ||
      props.data.saveMutation.isPending;
    const busy = useBusyIndicator({
      isFinishing: props.isFinishing,
      isPreferenceSaving: props.data.mutation.isPending,
      isSaving,
    });
    const queueSave = useCallback(
      (review: ReviewJson) => void saveDebouncer.maybeExecute(review),
      [saveDebouncer],
    );
    return {
      ...busy,
      isSaving,
      lastSavedAt,
      queueSave,
      reviewStatusOverride,
      saveDebouncer,
      setReviewStatusOverride,
    };
  },
});

export type HomeReviewSave = ReturnType<typeof useHomeReviewSave>;
