import { defineUIComponent } from "../../../../../../../define.ts";
import type { RefObject } from "react";
import { Button, ButtonGroup, Spinner, ToggleButton, Tooltip, Typography } from "@heroui/react";
import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Rows3,
  TriangleAlert,
  WrapText,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { DiffStyle } from "../../../../../../settings/index.ts";

const iconSize = 14;
const iconStrokeWidth = 1.5;
const transition = {
  duration: 0.14,
  ease: [0.2, 0, 0, 1] as const,
};

export type HomeHeaderProps = {
  actionLabel: string;
  canToggleFiles: boolean;
  contentMaxWidth: string;
  decisionButtonLabel: string;
  diffStyle: DiffStyle;
  hasExpandedFiles: boolean;
  headerRef: RefObject<HTMLElement | null>;
  isBusy: boolean;
  isFinished: boolean;
  isFinishing: boolean;
  kind: "diff" | "document";
  lineWrap: boolean;
  name: string;
  onCancel: () => void;
  onDiffStyleChange: (diffStyle: DiffStyle) => void;
  onFinish: () => void;
  onLineWrapChange: (lineWrap: boolean) => void;
  onToggleAllFiles: () => void;
  primaryShortcutLabel: string;
  status: {
    label: string;
    tone: "busy" | "idle" | "success" | "warning";
  };
};

function DiffLayoutControls(props: HomeHeaderProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
      <ButtonGroup size="sm" variant="outline" aria-label="Diff layout">
        <Button
          className={props.diffStyle === "unified" ? "bg-default" : undefined}
          aria-pressed={props.diffStyle === "unified"}
          onPress={() => props.onDiffStyleChange("unified")}
        >
          <Rows3 size={iconSize} strokeWidth={iconStrokeWidth} aria-hidden="true" />
          Unified
        </Button>
        <Button
          className={props.diffStyle === "split" ? "bg-default" : undefined}
          aria-pressed={props.diffStyle === "split"}
          onPress={() => props.onDiffStyleChange("split")}
        >
          <Columns2 size={iconSize} strokeWidth={iconStrokeWidth} aria-hidden="true" />
          Side by side
        </Button>
      </ButtonGroup>
      <ToggleButton size="sm" isSelected={props.lineWrap} onChange={props.onLineWrapChange}>
        <WrapText size={iconSize} strokeWidth={iconStrokeWidth} aria-hidden="true" />
        Line wrap
      </ToggleButton>
      <FileExpansionControl {...props} />
    </div>
  );
}

function FileExpansionControl(props: HomeHeaderProps) {
  const label = props.hasExpandedFiles ? "Collapse all files" : "Expand all files";
  const iconProps = {
    className: "text-[var(--muted)]",
    size: iconSize,
    strokeWidth: iconStrokeWidth,
    absoluteStrokeWidth: true,
    "aria-hidden": true as const,
  };
  return (
    <Tooltip delay={140} closeDelay={140} isDisabled={!props.canToggleFiles}>
      <Tooltip.Trigger>
        <Button
          size="sm"
          variant="outline"
          isIconOnly
          isDisabled={props.isFinished || props.isFinishing || !props.canToggleFiles}
          onPress={props.onToggleAllFiles}
          aria-label={label}
        >
          {props.hasExpandedFiles ? (
            <ChevronsDownUp {...iconProps} />
          ) : (
            <ChevronsUpDown {...iconProps} />
          )}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="bottom" showArrow>
        <Tooltip.Arrow />
        {label}
      </Tooltip.Content>
    </Tooltip>
  );
}

function ReviewDecisionControls(props: HomeHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2">
      <HomeStatusIndicator label={props.status.label} tone={props.status.tone} />
      <ButtonGroup size="sm">
        <Button
          variant="outline"
          isDisabled={props.isFinished || props.isBusy}
          onPress={props.onCancel}
          aria-label="Cancel this review"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          isDisabled={props.isFinished || props.isBusy}
          onPress={props.onFinish}
          aria-label={props.actionLabel}
          aria-keyshortcuts="Meta+Enter Control+Enter"
        >
          <ButtonGroup.Separator />
          {props.decisionButtonLabel}
          <kbd
            className="ml-1 rounded border border-current/25 px-1 py-0.5 font-mono text-[10px] leading-none text-current/80"
            aria-hidden="true"
          >
            {props.primaryShortcutLabel}
          </kbd>
        </Button>
      </ButtonGroup>
    </div>
  );
}

function HomeHeaderView(props: HomeHeaderProps) {
  const layoutClassName =
    props.kind === "diff"
      ? "h-[6.25rem] w-full grid-rows-[2rem_2rem] gap-2 px-3.5"
      : `h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 ${props.contentMaxWidth}`;
  const actionsClassName =
    props.kind === "diff"
      ? "flex min-w-0 items-center justify-between gap-3"
      : "flex shrink-0 items-center justify-end";
  return (
    <header
      ref={props.headerRef}
      className="sticky top-0 z-10 border-b border-border bg-transparent"
    >
      <div className="flex min-w-0">
        <div className="min-w-0 flex-1">
          <div className={`mx-auto grid content-center ${layoutClassName}`}>
            <div className="min-w-0" data-review-header-row="title">
              <Typography.Heading
                level={1}
                truncate
                className="min-w-0 flex-1 text-lg font-semibold leading-6 text-foreground"
              >
                {props.name}
              </Typography.Heading>
            </div>
            <div className={actionsClassName} data-review-header-row="actions">
              {props.kind === "diff" ? <DiffLayoutControls {...props} /> : null}
              <ReviewDecisionControls {...props} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function statusIcon(tone: HomeHeaderProps["status"]["tone"]) {
  if (tone === "busy") {
    return <Spinner size="sm" color="current" aria-hidden="true" />;
  }
  if (tone === "warning") {
    return (
      <TriangleAlert
        size={iconSize}
        strokeWidth={iconStrokeWidth}
        absoluteStrokeWidth
        aria-hidden="true"
      />
    );
  }
  if (tone === "idle") {
    return <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />;
  }
  return (
    <Check size={iconSize} strokeWidth={iconStrokeWidth} absoluteStrokeWidth aria-hidden="true" />
  );
}

function HomeStatusIndicator(props: HomeHeaderProps["status"]) {
  return (
    <Tooltip delay={140} closeDelay={140}>
      <Tooltip.Trigger>
        <span
          role="status"
          aria-label={props.label}
          className="relative flex h-4 w-4 shrink-0 cursor-help items-center justify-center outline-none"
          data-review-status-indicator={props.tone}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={props.tone}
              className="absolute inset-0 flex items-center justify-center text-muted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
            >
              {statusIcon(props.tone)}
            </motion.span>
          </AnimatePresence>
          <span className="sr-only">{props.label}</span>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content placement="bottom" showArrow>
        <Tooltip.Arrow />
        {props.label}
      </Tooltip.Content>
    </Tooltip>
  );
}

export const HomeHeader = defineUIComponent({
  params: {},
  deps: {},
  component(props: HomeHeaderProps) {
    return HomeHeaderView(props);
  },
});
