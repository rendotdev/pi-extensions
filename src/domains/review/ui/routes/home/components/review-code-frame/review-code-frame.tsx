import { defineUIComponent } from "../../../../../../../define.ts";
import type { ReactNode } from "react";
import { Button, Card, Chip, Disclosure, Typography } from "@heroui/react";
import { Check, Copy as CopyIcon } from "lucide-react";

const iconSize = 14;
const iconStrokeWidth = 1.5;

export type ReviewCodeFrameProps = {
  added?: number;
  children: ReactNode;
  className?: string;
  commentCount?: number;
  copied?: boolean;
  fileName?: string;
  id: string;
  onCopy?: () => void;
  removed?: number;
};

function CodeFrameContent(props: Pick<ReviewCodeFrameProps, "children">) {
  return (
    <Card
      className="border-0 !bg-[var(--review-diff-background)] !p-0 shadow-none"
      variant="transparent"
    >
      <Card.Content className="bg-[var(--review-diff-background)] !p-0">
        {props.children}
      </Card.Content>
    </Card>
  );
}

function CodeFrameCopyButton(props: Pick<ReviewCodeFrameProps, "copied" | "onCopy">) {
  if (!props.onCopy) {
    return null;
  }
  return (
    <div className="absolute inset-y-0 right-3 z-10 flex items-center">
      <Button
        size="sm"
        variant="ghost"
        className="font-normal"
        onClick={props.onCopy}
        aria-label="Copy file path"
      >
        {props.copied ? (
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
        <Typography type="body-sm" weight="normal" className="leading-none">
          {props.copied ? "Copied" : "Copy"}
        </Typography>
      </Button>
    </div>
  );
}

function CodeFrameMetadata(props: ReviewCodeFrameProps) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      {props.added !== undefined && props.removed !== undefined ? (
        <Chip size="sm" variant="soft">
          <Chip.Label className="flex gap-1 font-mono tabular-nums">
            <span className="text-green-600 dark:text-green-400">+{props.added}</span>
            <span className="text-red-600 dark:text-red-400">-{props.removed}</span>
          </Chip.Label>
        </Chip>
      ) : null}
      {props.commentCount ? (
        <Chip size="sm" variant="soft" color="accent">
          <Chip.Label>
            {props.commentCount} {props.commentCount === 1 ? "comment" : "comments"}
          </Chip.Label>
        </Chip>
      ) : null}
    </span>
  );
}

function CodeFrameHeading(props: ReviewCodeFrameProps) {
  return (
    <Disclosure.Heading
      data-review-file-heading={props.id}
      className="sticky top-0 z-[5] bg-surface"
    >
      <Disclosure.Trigger className="group flex w-full min-w-0 items-center justify-between gap-4 bg-surface py-3 pr-24 pl-4 text-left transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:bg-surface-secondary">
        <span className="flex min-w-0 items-center gap-3">
          <Disclosure.Indicator className="shrink-0 text-muted transition-transform duration-[var(--motion-duration)] ease-[var(--motion-ease)] group-data-[expanded=true]:rotate-90" />
          <Typography type="body-sm" weight="semibold" truncate className="block text-foreground">
            {props.fileName}
          </Typography>
        </span>
        <CodeFrameMetadata {...props} />
      </Disclosure.Trigger>
      <CodeFrameCopyButton copied={props.copied} onCopy={props.onCopy} />
    </Disclosure.Heading>
  );
}

function ReviewCodeFrameView(props: ReviewCodeFrameProps) {
  if (!props.fileName) {
    return (
      <div
        className={`overflow-clip rounded-[var(--vercel-radius)] border border-border ${props.className ?? ""}`}
        data-not-typeset=""
      >
        <CodeFrameContent>{props.children}</CodeFrameContent>
      </div>
    );
  }
  return (
    <Disclosure
      id={props.id}
      className={`overflow-clip rounded-[var(--vercel-radius)] border border-border ${props.className ?? ""}`}
      data-not-typeset=""
    >
      <CodeFrameHeading {...props} />
      <Disclosure.Content className="border-t border-border !transition-none aria-hidden:border-t-0">
        <CodeFrameContent>{props.children}</CodeFrameContent>
      </Disclosure.Content>
    </Disclosure>
  );
}

export const ReviewCodeFrame = defineUIComponent({
  params: {},
  deps: {},
  component(props: ReviewCodeFrameProps) {
    return ReviewCodeFrameView(props);
  },
});
