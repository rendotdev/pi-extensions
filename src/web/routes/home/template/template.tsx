import { build } from "../../../../builder.ts";
import type { ReactNode } from "react";
import { HomeContentComponent } from "../components/content/content.tsx";
import { HomeFooterComponent, type HomeFooterProps } from "../components/footer/footer.tsx";
import { HomeHeaderComponent, type HomeHeaderProps } from "../components/header/header.tsx";

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
      <HomeHeaderComponent {...props.header} />
      {props.view.kind === "document" ? (
        <HomeContentComponent
          kind="document"
          contentMaxWidth={props.view.contentMaxWidth}
          footer={<HomeFooterComponent {...props.view.footer} />}
        >
          {props.view.content}
        </HomeContentComponent>
      ) : (
        props.view.content
      )}
    </div>
  );
}

export const { HomeTemplateComponent, HomeTemplateComponentBuilder } = build().component(
  "HomeTemplateComponent",
  HomeTemplateView,
);
