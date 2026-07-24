import { build } from "../../../../../builder.ts";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import { Input, ScrollShadow, TextField, Typography } from "@heroui/react";

export type HomeSidebarProps = {
  children: ReactNode;
  fileCount: number;
  onQueryChange: (query: string) => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onResizePointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onResizePointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  query: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  width: number;
};

function HomeSidebarView(props: HomeSidebarProps) {
  return (
    <aside
      className="relative row-span-2 row-start-1 flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-transparent"
      style={{ width: props.width }}
    >
      <div
        className="border-b border-border pl-3.5 pr-2 pt-[var(--review-content-top)] pb-3"
        data-review-sidebar-header=""
      >
        <Typography type="body-sm" weight="semibold">
          Files ({props.fileCount})
        </Typography>
        <TextField
          fullWidth
          variant="secondary"
          aria-label="Filter changed files"
          value={props.query}
          onChange={props.onQueryChange}
          className="mt-2"
        >
          <Input
            fullWidth
            type="search"
            placeholder="Search..."
            className="h-8 px-2 py-1 text-xs"
          />
        </TextField>
      </div>
      <ScrollShadow
        ref={props.scrollRef}
        orientation="vertical"
        size={28}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        data-review-file-sidebar=""
      >
        {props.children}
      </ScrollShadow>
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize file sidebar"
        aria-orientation="vertical"
        aria-valuemin={192}
        aria-valuemax={480}
        aria-valuenow={Math.round(props.width)}
        className="group absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize touch-none focus:outline-none"
        data-review-sidebar-resizer=""
        onKeyDown={props.onResizeKeyDown}
        onPointerDown={props.onResizePointerDown}
        onPointerMove={props.onResizePointerMove}
        onPointerUp={props.onResizePointerUp}
        onPointerCancel={props.onResizePointerCancel}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/50 group-focus-visible:bg-accent" />
      </div>
    </aside>
  );
}

export const { HomeSidebarComponent, HomeSidebarComponentBuilder } = build().component(
  "HomeSidebarComponent",
  HomeSidebarView,
);
