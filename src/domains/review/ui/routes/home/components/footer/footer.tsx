import { defineUIComponent } from "../../../../../../../define.ts";
import { Button, ButtonGroup, InputGroup, Typography } from "@heroui/react";
import { Check, Copy as CopyIcon, Monitor, Moon, Sun } from "lucide-react";

const iconSize = 14;
const iconStrokeWidth = 1.5;

export type HomeFooterProps = {
  className?: string;
  copiedReviewPath: boolean;
  contentMaxWidth: string;
  displayedReviewPath: string;
  onCopyReviewPath: () => void;
  theme: string;
  onThemeChange: (theme: string) => void;
};

function HomeFooterView(props: HomeFooterProps) {
  return (
    <footer className={`${props.className ?? ""} shrink-0 border-t border-border bg-background`}>
      <div className="min-w-0 flex-1">
        <div
          className={`mx-auto flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3 ${props.contentMaxWidth}`}
          data-review-footer-frame=""
        >
          <ReviewPathControl {...props} />
          <ThemeControl {...props} />
        </div>
      </div>
    </footer>
  );
}

function ReviewPathControl(props: HomeFooterProps) {
  const inputWidth = Math.max(20, props.displayedReviewPath.length + 12);
  return (
    <InputGroup
      variant="secondary"
      aria-label="Review JSON path"
      className="group/review-path relative min-w-0 w-fit !bg-transparent shadow-none"
      style={{ maxWidth: "min(36rem, calc(100% - 7.5rem))" }}
    >
      <InputGroup.Input
        readOnly
        value={props.displayedReviewPath}
        className="min-w-0 max-w-full text-left font-mono text-xs text-muted"
        style={{ width: `${inputWidth}ch` }}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        size="sm"
        variant="ghost"
        className="absolute right-1 top-1/2 h-7 min-w-0 -translate-y-1/2 bg-background px-2 font-normal opacity-0 transition-opacity group-hover/review-path:opacity-100 focus-visible:opacity-100"
        onClick={props.onCopyReviewPath}
        aria-label="Copy review JSON path"
      >
        {props.copiedReviewPath ? (
          <Check
            size={iconSize}
            strokeWidth={iconStrokeWidth}
            absoluteStrokeWidth
            aria-hidden="true"
          />
        ) : (
          <CopyIcon
            size={iconSize}
            strokeWidth={iconStrokeWidth}
            absoluteStrokeWidth
            aria-hidden="true"
          />
        )}
        <Typography type="body-xs" weight="normal" className="leading-none">
          {props.copiedReviewPath ? "Copied" : "Copy"}
        </Typography>
      </Button>
    </InputGroup>
  );
}

function ThemeControl(props: HomeFooterProps) {
  return (
    <ButtonGroup size="sm" aria-label="Color theme">
      <Button
        variant={props.theme === "light" ? "secondary" : "outline"}
        isIconOnly
        aria-label="Use light theme"
        aria-pressed={props.theme === "light"}
        onPress={() => props.onThemeChange("light")}
      >
        <Sun size={iconSize} strokeWidth={iconStrokeWidth} aria-hidden="true" />
      </Button>
      <Button
        variant={props.theme === "dark" ? "secondary" : "outline"}
        isIconOnly
        aria-label="Use dark theme"
        aria-pressed={props.theme === "dark"}
        onPress={() => props.onThemeChange("dark")}
      >
        <Moon size={iconSize} strokeWidth={iconStrokeWidth} aria-hidden="true" />
      </Button>
      <Button
        variant={props.theme === "system" ? "secondary" : "outline"}
        isIconOnly
        aria-label="Use system theme"
        aria-pressed={props.theme === "system"}
        onPress={() => props.onThemeChange("system")}
      >
        <Monitor size={iconSize} strokeWidth={iconStrokeWidth} aria-hidden="true" />
      </Button>
    </ButtonGroup>
  );
}

export const HomeFooter = defineUIComponent({
  params: {},
  deps: {},
  component(props: HomeFooterProps) {
    return HomeFooterView(props);
  },
});
