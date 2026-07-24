import React, { useMemo } from "react";
import { DisclosureGroup, Typography } from "@heroui/react";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import { defineUIComponent } from "../../../../../define.ts";
import type { ReviewFile } from "../../../types/review.ts";
import type { DiffReviewContentItem, DiffReviewListProps } from "./diff-review-list-types.ts";
import { ReviewFileDiff, type ReviewFileDiffProps } from "./review-file-diff.tsx";

type ContentProps = Pick<
  DiffReviewListProps,
  | "activeCommentId"
  | "addComment"
  | "collapsedFileIds"
  | "deleteComment"
  | "diffStyle"
  | "diffTheme"
  | "diffThemeType"
  | "lineWrap"
  | "updateComment"
> & {
  handleFileExpandedChange: (fileId: string, isExpanded: boolean) => void;
  items: DiffReviewContentItem[];
  listRef: React.RefObject<HTMLDivElement | null>;
  reviewFileByLocation: Map<string, ReviewFile>;
  virtualizer: Virtualizer<HTMLElement, Element>;
};

export const DiffReviewContent = defineUIComponent({
  params: {},
  deps: {},
  component(props: ContentProps) {
    return (
      <div
        ref={props.listRef}
        data-review-file-list=""
        style={{
          height: props.virtualizer.getTotalSize(),
          overflowAnchor: "none",
          position: "relative",
        }}
      >
        {props.virtualizer.getVirtualItems().map(function renderReviewItem(virtualItem) {
          return (
            <DiffReviewVirtualItem
              key={virtualItem.key}
              {...props}
              item={props.items[virtualItem.index]}
              virtualItem={virtualItem}
            />
          );
        })}
      </div>
    );
  },
});

const DiffReviewVirtualItem = defineUIComponent({
  params: {},
  deps: {},
  component(
    props: ContentProps & {
      item: DiffReviewContentItem | undefined;
      virtualItem: VirtualItem;
    },
  ) {
    const item = props.item;
    if (!item) {
      return null;
    }
    const itemProps = {
      ref: props.virtualizer.measureElement,
      "data-index": props.virtualItem.index,
      className: "absolute left-0 top-0 w-full pb-4",
      style: { top: props.virtualItem.start - props.virtualizer.options.scrollMargin },
    };
    if (item.kind === "group") {
      return (
        <div {...itemProps}>
          <ReviewGroupHeader item={item} />
        </div>
      );
    }
    const file = item.file;
    const reviewFile = props.reviewFileByLocation.get(file.location) ?? emptyReviewFile(file);
    const fileActiveCommentId = reviewFile.comments.some(
      (comment) => comment.id === props.activeCommentId,
    )
      ? props.activeCommentId
      : null;
    return (
      <div {...itemProps} data-review-file-item={file.id}>
        <ReviewFileRow
          file={file}
          reviewFile={reviewFile}
          diffStyle={props.diffStyle}
          lineWrap={props.lineWrap}
          diffTheme={props.diffTheme}
          diffThemeType={props.diffThemeType}
          activeCommentId={fileActiveCommentId}
          isExpanded={!props.collapsedFileIds.has(file.id)}
          onExpandedChange={props.handleFileExpandedChange}
          addComment={props.addComment}
          updateComment={props.updateComment}
          deleteComment={props.deleteComment}
        />
      </div>
    );
  },
});

const ReviewFileRowComponent = defineUIComponent({
  params: {},
  deps: { useMemo },
  component(
    props: ReviewFileDiffProps & {
      isExpanded: boolean;
      onExpandedChange: (fileId: string, isExpanded: boolean) => void;
    },
  ) {
    const expandedKeys = this.deps.useMemo(
      () => (props.isExpanded ? [props.file.id] : []),
      [props.file.id, props.isExpanded],
    );
    function updateExpandedFiles(keys: Set<React.Key>) {
      props.onExpandedChange(props.file.id, keys.has(props.file.id));
    }
    return (
      <DisclosureGroup
        allowsMultipleExpanded
        expandedKeys={expandedKeys}
        onExpandedChange={updateExpandedFiles}
      >
        <ReviewFileDiff {...props} />
      </DisclosureGroup>
    );
  },
});

const ReviewFileRow = React.memo(ReviewFileRowComponent);

const ReviewGroupHeader = defineUIComponent({
  params: {},
  deps: {},
  component(props: { item: Extract<DiffReviewContentItem, { kind: "group" }> }) {
    return (
      <div
        className="flex items-end justify-between gap-4 px-1 pb-3 pt-1"
        data-review-group-header=""
      >
        <div className="min-w-0">
          <Typography type="h5" weight="semibold" className="truncate">
            {props.item.title}
          </Typography>
          <Typography type="body-xs" color="muted" className="mt-1 block">
            {props.item.fileCount} {props.item.fileCount === 1 ? "file" : "files"}
          </Typography>
        </div>
        <span className="flex shrink-0 gap-2 font-mono text-xs tabular-nums">
          <span className="text-green-600 dark:text-green-400">+{props.item.added}</span>
          <span className="text-red-600 dark:text-red-400">-{props.item.removed}</span>
        </span>
      </div>
    );
  },
});

function emptyReviewFile(
  file: Extract<DiffReviewContentItem, { kind: "file" }>["file"],
): ReviewFile {
  return {
    location: file.location,
    added: file.added,
    removed: file.removed,
    comments: [],
  };
}
