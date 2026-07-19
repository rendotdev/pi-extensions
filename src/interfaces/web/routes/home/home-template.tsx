import type { ReactNode } from "react";
import { HomeContent } from "./components/home-content.tsx";
import { HomeFooter, type HomeFooterProps } from "./components/home-footer.tsx";
import { HomeHeader, type HomeHeaderProps } from "./components/home-header.tsx";

export type HomeTemplateProps = {
  header: HomeHeaderProps;
  view:
    | {
        content: ReactNode;
        contentMaxWidth: string;
        footer: HomeFooterProps;
        kind: "document";
      }
    | {
        content: ReactNode;
        kind: "diff";
      };
};

export function HomeTemplate(props: HomeTemplateProps) {
  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground" data-review-ready="">
      <HomeHeader {...props.header} />
      {props.view.kind === "document" ? (
        <HomeContent
          kind="document"
          contentMaxWidth={props.view.contentMaxWidth}
          footer={<HomeFooter {...props.view.footer} />}
        >
          {props.view.content}
        </HomeContent>
      ) : (
        props.view.content
      )}
    </div>
  );
}
