import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { defineUIHook } from "../../../../../define.ts";
import { homeRouteDeps } from "./home-route-deps.ts";
import {
  buildReviewGroupItems,
  diffReviewItemKey,
  estimateReviewItemSize,
} from "./diff-review-list-items.ts";
import { useSelectedFileRestoration } from "./hooks/selected-file-restoration/selected-file-restoration.ts";
import { useSidebarResize } from "./hooks/sidebar-resize/sidebar-resize.ts";
import type {
  DiffReviewContentItem,
  DiffReviewListProps,
  DiffReviewSidebarItem,
} from "./diff-review-list-types.ts";

export const useDiffReviewListController = defineUIHook({
  params: {},
  deps: {
    useCallback,
    useDeferredValue,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useVirtualizer,
  },
  hook(props: DiffReviewListProps) {
    const deps = this.deps;
    const listRef = deps.useRef<HTMLDivElement | null>(null);
    const sidebarScrollElementRef = deps.useRef<HTMLDivElement | null>(null);
    const scrollElementRef = deps.useRef<HTMLElement | null>(null);
    const [fileQuery, setFileQuery] = deps.useState("");
    const [scrollMargin, setScrollMargin] = deps.useState(0);
    const [selectedFileLocation, setSelectedFileLocation] = deps.useState(() =>
      homeRouteDeps.reviewFileNavigation.read({ search: window.location.search }),
    );
    const items = useDiffReviewItems({ deps, fileQuery, props });
    const virtualizers = useDiffReviewVirtualizers({
      deps,
      items,
      props,
      refs: { listRef, scrollElementRef, sidebarScrollElementRef },
      scrollMargin,
      setScrollMargin,
    });
    const navigation = useDiffReviewNavigation({
      deps,
      items,
      props,
      reviewVirtualizer: virtualizers.reviewVirtualizer,
      selectedFileLocation,
      setSelectedFileLocation,
    });
    const handleFileExpandedChange = useFileExpansion({
      deps,
      listRef,
      props,
      reviewVirtualizer: virtualizers.reviewVirtualizer,
      scrollElementRef,
    });
    useSelectedFileRestoration({
      files: props.payload.files,
      listRef,
      scrollElementRef,
      scrollMargin,
      scrollToFile: navigation.scrollToFile,
      selectedFileLocation,
    });
    const sidebarResize = useSidebarResize(props);
    return {
      fileQuery,
      handleFileExpandedChange,
      items,
      listRef,
      navigation,
      refs: { scrollElementRef, sidebarScrollElementRef },
      setFileQuery,
      sidebarResize,
      virtualizers,
    };
  },
});

function useDiffReviewItems(params: {
  deps: typeof diffReviewControllerDeps;
  fileQuery: string;
  props: DiffReviewListProps;
}) {
  const query = params.deps.useDeferredValue(params.fileQuery);
  const sidebarFiles = params.deps.useMemo(
    () => homeRouteDeps.fileSearch.search({ files: params.props.payload.files, query }),
    [params.props.payload.files, query],
  );
  const sidebarGroups = params.deps.useMemo(
    () =>
      homeRouteDeps.reviewGroupPresentation.build({
        files: sidebarFiles,
        groups: params.props.payload.groups,
      }),
    [params.props.payload.groups, sidebarFiles],
  );
  const sidebarItems = params.deps.useMemo<DiffReviewSidebarItem[]>(
    () =>
      sidebarGroups.flatMap((group, index) => {
        const files = group.files.map((file) => ({ kind: "file" as const, file }));
        return group.title
          ? [
              {
                kind: "group",
                key: `group-${index}-${group.title}`,
                title: group.title,
                fileCount: group.files.length,
              } as const,
              ...files,
            ]
          : files;
      }),
    [sidebarGroups],
  );
  const reviewGroups = params.deps.useMemo(
    () =>
      homeRouteDeps.reviewGroupPresentation.build({
        files: params.props.payload.files,
        groups: params.props.payload.groups,
      }),
    [params.props.payload.files, params.props.payload.groups],
  );
  const reviewItems = params.deps.useMemo<DiffReviewContentItem[]>(
    () => reviewGroups.flatMap(buildReviewGroupItems),
    [reviewGroups],
  );
  params.deps.useEffect(
    function prepareFileSearchIndex() {
      homeRouteDeps.fileSearch.prepare({ files: params.props.payload.files });
    },
    [params.props.payload.files],
  );
  return { reviewItems, sidebarFiles, sidebarItems };
}

function useDiffReviewVirtualizers(params: {
  deps: typeof diffReviewControllerDeps;
  items: ReturnType<typeof useDiffReviewItems>;
  props: DiffReviewListProps;
  refs: {
    listRef: React.RefObject<HTMLDivElement | null>;
    scrollElementRef: React.RefObject<HTMLElement | null>;
    sidebarScrollElementRef: React.RefObject<HTMLDivElement | null>;
  };
  scrollMargin: number;
  setScrollMargin: (margin: number) => void;
}) {
  const reviewKey = params.deps.useCallback(
    (index: number) => diffReviewItemKey(params.items.reviewItems[index], index),
    [params.items.reviewItems],
  );
  const sidebarKey = params.deps.useCallback(
    (index: number) => diffReviewItemKey(params.items.sidebarItems[index], index),
    [params.items.sidebarItems],
  );
  const estimateReviewSize = params.deps.useCallback(
    (index: number) =>
      estimateReviewItemSize(params.items.reviewItems[index], params.props.collapsedFileIds),
    [params.items.reviewItems, params.props.collapsedFileIds],
  );
  const sidebarVirtualizer = params.deps.useVirtualizer({
    count: params.items.sidebarItems.length,
    estimateSize: (index) => (params.items.sidebarItems[index]?.kind === "group" ? 34 : 38),
    getScrollElement: () => params.refs.sidebarScrollElementRef.current,
    getItemKey: sidebarKey,
    overscan: 10,
    useFlushSync: false,
  });
  const reviewVirtualizer = params.deps.useVirtualizer({
    count: params.items.reviewItems.length,
    estimateSize: estimateReviewSize,
    getScrollElement: () => params.refs.scrollElementRef.current,
    getItemKey: reviewKey,
    overscan: 1,
    scrollMargin: params.scrollMargin,
    useFlushSync: false,
  });
  reviewVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    item.end < (instance.scrollOffset ?? 0);
  useReviewScrollMargin(params);
  params.deps.useEffect(
    function resetSidebarScroll() {
      sidebarVirtualizer.scrollToOffset(0);
    },
    [params.items.sidebarItems, sidebarVirtualizer],
  );
  return { reviewVirtualizer, sidebarVirtualizer };
}

function useReviewScrollMargin(params: Parameters<typeof useDiffReviewVirtualizers>[0]) {
  params.deps.useLayoutEffect(function measureReviewScrollMargin() {
    const list = params.refs.listRef.current;
    const scrollElement = params.refs.scrollElementRef.current;
    const isReviewListMissing = !list || !scrollElement;
    if (isReviewListMissing) {
      return;
    }
    params.setScrollMargin(
      list.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop,
    );
  }, []);
}

function useDiffReviewNavigation(params: {
  deps: typeof diffReviewControllerDeps;
  items: ReturnType<typeof useDiffReviewItems>;
  props: DiffReviewListProps;
  reviewVirtualizer: ReturnType<typeof useVirtualizer<HTMLElement, Element>>;
  selectedFileLocation: string | null;
  setSelectedFileLocation: (location: string | null) => void;
}) {
  const fileIndexById = params.deps.useMemo(
    () =>
      new Map(
        params.items.reviewItems.flatMap((item, index) =>
          item.kind === "file" ? [[item.file.id, index] as const] : [],
        ),
      ),
    [params.items.reviewItems],
  );
  const fileById = params.deps.useMemo(
    () => new Map(params.props.payload.files.map((file) => [file.id, file])),
    [params.props.payload.files],
  );
  const reviewFileByLocation = params.deps.useMemo(
    () => new Map(params.props.review.files.map((file) => [file.location, file])),
    [params.props.review.files],
  );
  const scrollToFile = params.deps.useCallback(
    function scrollToFile(input: { fileId: string; updateUrl: boolean }) {
      const fileIndex = fileIndexById.get(input.fileId);
      const file = fileById.get(input.fileId);
      const isFileMissing = fileIndex === undefined || !file;
      if (isFileMissing) {
        return;
      }
      if (input.updateUrl) {
        updateSelectedFileLocation({ file, input, params });
      }
      params.reviewVirtualizer.scrollToIndex(fileIndex, { align: "start", behavior: "auto" });
    },
    [
      fileById,
      fileIndexById,
      params.props.collapsedFileIds,
      params.props.setFileExpanded,
      params.reviewVirtualizer,
    ],
  );
  params.deps.useEffect(function listenForFileNavigation() {
    function updateSelectedFileFromUrl() {
      params.setSelectedFileLocation(
        homeRouteDeps.reviewFileNavigation.read({ search: window.location.search }),
      );
    }
    window.addEventListener("popstate", updateSelectedFileFromUrl);
    return () => window.removeEventListener("popstate", updateSelectedFileFromUrl);
  }, []);
  return { reviewFileByLocation, scrollToFile, selectedFileLocation: params.selectedFileLocation };
}

function updateSelectedFileLocation(params: {
  file: DiffReviewContentItem & { kind: "file" } extends infer Item
    ? Item extends { file: infer File }
      ? File
      : never
    : never;
  input: { fileId: string; updateUrl: boolean };
  params: Parameters<typeof useDiffReviewNavigation>[0];
}) {
  if (params.params.props.collapsedFileIds.has(params.input.fileId)) {
    params.params.props.setFileExpanded(params.input.fileId, true);
  }
  const currentLocation = homeRouteDeps.reviewFileNavigation.read({
    search: window.location.search,
  });
  params.params.setSelectedFileLocation(params.file.location);
  if (currentLocation !== params.file.location) {
    window.history.pushState(
      {},
      "",
      homeRouteDeps.reviewFileNavigation.createHref({
        href: window.location.href,
        fileLocation: params.file.location,
      }),
    );
  }
}

function useFileExpansion(params: {
  deps: typeof diffReviewControllerDeps;
  listRef: React.RefObject<HTMLDivElement | null>;
  props: DiffReviewListProps;
  reviewVirtualizer: ReturnType<typeof useVirtualizer<HTMLElement, Element>>;
  scrollElementRef: React.RefObject<HTMLElement | null>;
}) {
  return params.deps.useCallback(
    function handleFileExpandedChange(fileId: string, isExpanded: boolean) {
      function commitExpandedChange() {
        params.props.setFileExpanded(fileId, isExpanded);
        window.requestAnimationFrame(function measureExpandedFile() {
          const item = findReviewFileItem(params.listRef.current, fileId);
          if (item) {
            params.reviewVirtualizer.measureElement(item);
          }
        });
      }
      const item = findReviewFileItem(params.listRef.current, fileId);
      const heading = item?.querySelector<HTMLElement>("[data-review-file-heading]");
      const scrollElement = params.scrollElementRef.current;
      const isHeadingPinned =
        !isExpanded &&
        item &&
        heading &&
        scrollElement &&
        Math.abs(heading.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top) <=
          1;
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
      commitExpandedChange();
    },
    [params.props.setFileExpanded, params.reviewVirtualizer],
  );
}

function findReviewFileItem(list: HTMLDivElement | null, fileId: string) {
  return list?.querySelector<HTMLElement>(`[data-review-file-item="${CSS.escape(fileId)}"]`);
}

const diffReviewControllerDeps = {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useVirtualizer,
};
