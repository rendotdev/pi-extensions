import { defineUIComponent } from "../../../../../../define.ts";
import type { ReactNode } from "react";
import { HomeContent } from "../components/content/content.tsx";
import { HomeFooter, type HomeFooterProps } from "../components/footer/footer.tsx";
import { HomeHeader, type HomeHeaderProps } from "../components/header/header.tsx";

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

function HomeTemplateView(props: HomeTemplateProps) {
  return (
    <div className="h-dvh overflow-hidden bg-transparent text-foreground" data-review-ready="">
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

export const HomeTemplate = defineUIComponent({
  params: {},
  deps: {},
  component(props: HomeTemplateProps) {
    return HomeTemplateView(props);
  },
});
