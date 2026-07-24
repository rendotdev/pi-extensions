import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { defineUIHook } from "../../../../../../../define.ts";
import type { LgtmPreferences } from "../../../../../../settings/ui/index.ts";
import type { ReviewJson } from "../../../../../types/review.ts";
import type { ReviewAppState } from "../../../../review-api/review-api.ts";
import { useReviewServerMonitor } from "../../../../review-server-monitor/review-server-monitor.ts";
import { homeRouteDeps } from "../../home-route-deps.ts";

type Deps = typeof homeRouteDeps;

function usePreferences(deps: Deps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["preferences"],
    queryFn: () => deps.preferencesApi.get({}),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const mutation = useMutation({
    mutationFn: (preferences: LgtmPreferences) => deps.preferencesApi.update({ preferences }),
    onMutate: async (preferences: LgtmPreferences) => {
      await queryClient.cancelQueries({ queryKey: ["preferences"] });
      const previousPreferences = queryClient.getQueryData<LgtmPreferences>(["preferences"]);
      queryClient.setQueryData(["preferences"], preferences);
      return { previousPreferences };
    },
    onError: (error, _preferences, context) => {
      queryClient.setQueryData(
        ["preferences"],
        context?.previousPreferences ?? deps.lgtmPreferences.defaults,
      );
      deps.toastNotifications.preferencesNotSaved({ error });
    },
    onSuccess: (preferences) => queryClient.setQueryData(["preferences"], preferences),
  });
  useEffect(
    function reportPreferencesError() {
      if (query.error) {
        deps.toastNotifications.preferencesUnavailable({});
      }
    },
    [deps, query.error],
  );
  return { mutation, preferences: query.data ?? deps.lgtmPreferences.defaults, query };
}

function useReviewQueries(deps: Deps) {
  const stateQuery = useQuery({
    queryKey: ["review-state"],
    queryFn: () => deps.reviewApi.load({}),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const saveMutation = useMutation({
    mutationFn: (review: ReviewJson) => deps.reviewApi.save({ review }),
  });
  const finishMutation = useMutation({
    mutationFn: (decision: "approved" | "changes_requested") => deps.reviewApi.finish({ decision }),
  });
  const cancelMutation = useMutation({ mutationFn: () => deps.reviewApi.cancel({}) });
  useEffect(
    function reportReviewError() {
      if (stateQuery.error) {
        deps.toastNotifications.reviewUnavailable({});
      }
    },
    [deps, stateQuery.error],
  );
  return { cancelMutation, finishMutation, saveMutation, stateQuery };
}

function useInitializedReview(
  deps: Deps,
  preferences: LgtmPreferences,
  preferencesReady: boolean,
  reviewState: ReviewAppState | undefined,
) {
  const [state, setState] = useState<ReviewAppState | null>(null);
  const [collapsedFileIds, setCollapsedFileIds] = useState<Set<string>>(() => new Set());
  const initializedReviewId = useRef<string | null>(null);
  const lastSavedSignature = useRef<string | null>(null);
  useEffect(
    function initializeReview() {
      const shouldWaitForReview = !reviewState || !preferencesReady;
      if (shouldWaitForReview) {
        return;
      }
      if (initializedReviewId.current === reviewState.review.reviewId) {
        return;
      }
      initializedReviewId.current = reviewState.review.reviewId;
      lastSavedSignature.current = deps.reviewPresentation.meaningfulSignature({
        review: reviewState.review,
      });
      document.title = deps.reviewWindowTitle.format({
        cwd: reviewState.payload.cwd,
        name: reviewState.payload.name,
      });
      setCollapsedFileIds(
        deps.reviewPresentation.initialCollapsedFileIds({
          state: reviewState,
          fileExpansion: preferences.fileExpansion,
          fileExpansionOverrides: preferences.fileExpansionOverrides,
        }),
      );
      setState(reviewState);
    },
    [deps, preferences, preferencesReady, reviewState],
  );
  return { collapsedFileIds, lastSavedSignature, setCollapsedFileIds, setState, state };
}

function useHeaderHeight(headerRef: RefObject<HTMLElement | null>, isLoaded: boolean) {
  useLayoutEffect(
    function trackHeaderHeight() {
      const header = headerRef.current;
      if (!header) {
        return;
      }
      function updateHeaderHeight() {
        const currentHeader = headerRef.current;
        if (!currentHeader) {
          return;
        }
        document.documentElement.style.setProperty(
          "--review-header-height",
          `${currentHeader.getBoundingClientRect().height}px`,
        );
      }
      const observer = new ResizeObserver(updateHeaderHeight);
      observer.observe(header);
      updateHeaderHeight();
      return () => {
        observer.disconnect();
        document.documentElement.style.removeProperty("--review-header-height");
      };
    },
    [headerRef, isLoaded],
  );
}

export const useHomeReviewData = defineUIHook({
  params: {},
  deps: homeRouteDeps,
  hook(_props: {}) {
    const deps = this.deps as Deps;
    const preferencesState = usePreferences(deps);
    const queries = useReviewQueries(deps);
    const reviewState = useInitializedReview(
      deps,
      preferencesState.preferences,
      preferencesState.query.isFetched,
      queries.stateQuery.data,
    );
    const headerRef = useRef<HTMLElement | null>(null);
    const latestReviewRef = useRef<ReviewJson | null>(null);
    latestReviewRef.current = reviewState.state?.review ?? null;
    useHeaderHeight(headerRef, reviewState.state !== null);
    useReviewServerMonitor({
      getCommentCount: () =>
        latestReviewRef.current
          ? deps.reviewPresentation.commentCount({ review: latestReviewRef.current })
          : 0,
    });
    useEffect(function trackPointers() {
      deps.reviewCommentInteraction.installPointerTracking({ node: window, phase: "mount" });
      return () =>
        deps.reviewCommentInteraction.installPointerTracking({ node: window, phase: "unmount" });
    }, []);
    return { ...preferencesState, ...queries, ...reviewState, headerRef, latestReviewRef };
  },
});

export type HomeReviewData = ReturnType<typeof useHomeReviewData>;
