import { Button, Typography } from "@heroui/react";
import { FileMinus, FilePenLine, FilePlus } from "lucide-react";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import { defineUIComponent } from "../../../../../define.ts";
import { HomeSidebar } from "./components/sidebar/sidebar.tsx";
import type { DiffReviewSidebarItem } from "./diff-review-list-types.ts";

type SidebarProps = {
  collapsedFileIds: Set<string>;
  fileCount: number;
  fileQuery: string;
  itemCount: number;
  items: DiffReviewSidebarItem[];
  onQueryChange: (query: string) => void;
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onResizePointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  scrollToFile: (params: { fileId: string; updateUrl: boolean }) => void;
  selectedFileLocation: string | null;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  width: number;
};

export const DiffReviewSidebar = defineUIComponent({
  params: {},
  deps: {},
  component(props: SidebarProps) {
    return (
      <HomeSidebar
        fileCount={props.fileCount}
        onQueryChange={props.onQueryChange}
        onResizeKeyDown={props.onResizeKeyDown}
        onResizePointerCancel={props.onResizePointerCancel}
        onResizePointerDown={props.onResizePointerDown}
        onResizePointerMove={props.onResizePointerMove}
        onResizePointerUp={props.onResizePointerUp}
        query={props.fileQuery}
        scrollRef={props.scrollRef}
        width={props.width}
      >
        <nav aria-label="Changed files" className="relative min-h-full">
          {props.itemCount === 0 ? (
            <Typography type="body-xs" color="muted" className="block px-2 py-3 text-center">
              No matching files
            </Typography>
          ) : null}
          <div className="relative" style={{ height: props.virtualizer.getTotalSize() }}>
            {props.virtualizer.getVirtualItems().map(function renderSidebarItem(virtualItem) {
              return (
                <DiffReviewSidebarVirtualItem
                  key={virtualItem.key}
                  collapsedFileIds={props.collapsedFileIds}
                  item={props.items[virtualItem.index]}
                  scrollToFile={props.scrollToFile}
                  selectedFileLocation={props.selectedFileLocation}
                  virtualItem={virtualItem}
                  virtualizer={props.virtualizer}
                />
              );
            })}
          </div>
        </nav>
      </HomeSidebar>
    );
  },
});

const DiffReviewSidebarVirtualItem = defineUIComponent({
  params: { iconSize: 14, iconStrokeWidth: 1.5 },
  deps: {},
  component(props: {
    collapsedFileIds: Set<string>;
    item: DiffReviewSidebarItem | undefined;
    scrollToFile: SidebarProps["scrollToFile"];
    selectedFileLocation: string | null;
    virtualItem: VirtualItem;
    virtualizer: Virtualizer<HTMLDivElement, Element>;
  }) {
    const item = props.item;
    if (!item) {
      return null;
    }
    if (item.kind === "group") {
      return (
        <DiffReviewSidebarGroup
          item={item}
          virtualItem={props.virtualItem}
          virtualizer={props.virtualizer}
        />
      );
    }
    const file = item.file;
    const isCollapsed = props.collapsedFileIds.has(file.id);
    const status = getFileStatus(file);
    const isSelected = props.selectedFileLocation === file.location;
    function selectFile() {
      props.scrollToFile({ fileId: file.id, updateUrl: true });
    }
    return (
      <div
        ref={props.virtualizer.measureElement}
        data-index={props.virtualItem.index}
        className="absolute left-0 top-0 w-full pb-0.5"
        style={{ transform: `translateY(${props.virtualItem.start}px)` }}
      >
        <Button
          size="sm"
          variant="ghost"
          className={fileButtonClassName({ isCollapsed, isSelected })}
          aria-current={isSelected ? "location" : undefined}
          data-collapsed={isCollapsed ? "true" : "false"}
          data-file-status={status}
          data-review-file-link={file.id}
          onPress={selectFile}
        >
          <DiffReviewFileStatusIcon status={status} />
          <span className="sr-only">{status}: </span>
          <span className="min-w-0 flex-1 truncate">{file.location}</span>
          <span className="flex shrink-0 gap-1 font-mono text-[10px] tabular-nums">
            <span className="text-green-600 dark:text-green-400">+{file.added}</span>
            <span className="text-red-600 dark:text-red-400">-{file.removed}</span>
          </span>
        </Button>
      </div>
    );
  },
});

const DiffReviewSidebarGroup = defineUIComponent({
  params: {},
  deps: {},
  component(props: {
    item: Extract<DiffReviewSidebarItem, { kind: "group" }>;
    virtualItem: VirtualItem;
    virtualizer: Virtualizer<HTMLDivElement, Element>;
  }) {
    return (
      <div
        ref={props.virtualizer.measureElement}
        data-index={props.virtualItem.index}
        className="absolute left-0 top-0 flex w-full items-center justify-between gap-2 px-2 pb-1 pt-3"
        style={{ transform: `translateY(${props.virtualItem.start}px)` }}
        data-review-sidebar-group=""
      >
        <Typography
          type="body-xs"
          weight="semibold"
          className="min-w-0 truncate uppercase tracking-[0.08em]"
        >
          {props.item.title}
        </Typography>
        <Typography type="body-xs" color="muted" className="shrink-0 tabular-nums">
          {props.item.fileCount}
        </Typography>
      </div>
    );
  },
});

function DiffReviewFileStatusIcon(props: { status: "added" | "deleted" | "modified" }) {
  const iconProps = { size: 14, strokeWidth: 1.5, "aria-hidden": true } as const;
  if (props.status === "added") {
    return <FilePlus className="shrink-0 text-green-600 dark:text-green-400" {...iconProps} />;
  }
  if (props.status === "deleted") {
    return <FileMinus className="shrink-0 text-red-600 dark:text-red-400" {...iconProps} />;
  }
  return <FilePenLine className="shrink-0 text-amber-600 dark:text-amber-400" {...iconProps} />;
}

function getFileStatus(file: Extract<DiffReviewSidebarItem, { kind: "file" }>["file"]) {
  const isAdded = file.oldContent.length === 0 && file.newContent.length > 0;
  const isDeleted = file.newContent.length === 0 && file.oldContent.length > 0;
  return isAdded ? ("added" as const) : isDeleted ? ("deleted" as const) : ("modified" as const);
}

function fileButtonClassName(params: { isCollapsed: boolean; isSelected: boolean }) {
  const stateClassName = params.isSelected
    ? "bg-default text-foreground"
    : params.isCollapsed
      ? "text-muted"
      : "text-foreground";
  return `h-auto w-full justify-start gap-2 px-2 py-2 text-left font-normal ${stateClassName}`;
}
