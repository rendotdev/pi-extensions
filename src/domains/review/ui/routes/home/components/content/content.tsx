import { defineUIComponent } from "../../../../../../../define.ts";
import type { ReactNode, RefObject } from "react";

export type HomeContentProps =
  | {
      children: ReactNode;
      contentMaxWidth: string;
      footer: ReactNode;
      kind: "document";
    }
  | {
      children: ReactNode;
      footer: ReactNode;
      kind: "diff";
      mainRef: RefObject<HTMLElement | null>;
      sidebar: ReactNode;
    };

function HomeContentView(props: HomeContentProps) {
  if (props.kind === "document") {
    return (
      <div className="flex h-[calc(100dvh-var(--review-header-height,0px))] flex-col">
        <main data-review-document-scroll="" className="min-h-0 flex-1 overflow-y-auto">
          <div
            className={
              "mx-auto flex flex-col gap-4 px-4 pt-[var(--review-content-top)] pb-[50vh] " +
              props.contentMaxWidth
            }
            data-review-content-frame=""
          >
            {props.children}
          </div>
        </main>
        {props.footer}
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100dvh-var(--review-header-height,0px))] min-h-0 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
      {props.sidebar}
      <main
        ref={props.mainRef}
        data-review-diff-scroll=""
        className="col-start-2 row-start-1 min-w-0 flex-1 overflow-y-auto"
      >
        <div
          className="mx-auto max-w-7xl px-4 pt-[var(--review-content-top)] pb-[50vh]"
          data-review-content-frame=""
        >
          {props.children}
        </div>
      </main>
      {props.footer}
    </div>
  );
}

export const HomeContent = defineUIComponent({
  params: {},
  deps: {},
  component(props: HomeContentProps) {
    return HomeContentView(props);
  },
});
