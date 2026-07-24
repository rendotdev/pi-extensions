import { defineUIComponent } from "../../../../../define.ts";
import { HomeContent } from "./components/content/content.tsx";
import { HomeFooter } from "./components/footer/footer.tsx";
import { DiffReviewContent } from "./diff-review-content.tsx";
import { useDiffReviewListController } from "./diff-review-list-controller.ts";
import type { DiffReviewListProps } from "./diff-review-list-types.ts";
import { DiffReviewSidebar } from "./diff-review-sidebar.tsx";

export const DiffReviewList = defineUIComponent({
  params: {},
  deps: { useDiffReviewListController },
  component(props: DiffReviewListProps) {
    const controller = this.deps.useDiffReviewListController(props);
    return (
      <HomeContent
        kind="diff"
        mainRef={controller.refs.scrollElementRef}
        footer={
          <HomeFooter
            className="col-start-2 row-start-2"
            copiedReviewPath={props.copiedReviewPath}
            contentMaxWidth="max-w-7xl"
            displayedReviewPath={props.displayedReviewPath}
            onCopyReviewPath={props.onCopyReviewPath}
            onThemeChange={props.setTheme}
            theme={props.theme}
          />
        }
        sidebar={
          <DiffReviewSidebar
            collapsedFileIds={props.collapsedFileIds}
            fileCount={props.payload.files.length}
            fileQuery={controller.fileQuery}
            itemCount={controller.items.sidebarFiles.length}
            items={controller.items.sidebarItems}
            onQueryChange={controller.setFileQuery}
            onResizeKeyDown={controller.sidebarResize.resizeWithKeyboard}
            onResizePointerCancel={controller.sidebarResize.finish}
            onResizePointerDown={controller.sidebarResize.start}
            onResizePointerMove={controller.sidebarResize.continueResize}
            onResizePointerUp={controller.sidebarResize.finish}
            scrollRef={controller.refs.sidebarScrollElementRef}
            scrollToFile={controller.navigation.scrollToFile}
            selectedFileLocation={controller.navigation.selectedFileLocation}
            virtualizer={controller.virtualizers.sidebarVirtualizer}
            width={props.sidebarWidth}
          />
        }
      >
        <DiffReviewContent
          activeCommentId={props.activeCommentId}
          addComment={props.addComment}
          collapsedFileIds={props.collapsedFileIds}
          deleteComment={props.deleteComment}
          diffStyle={props.diffStyle}
          diffTheme={props.diffTheme}
          diffThemeType={props.diffThemeType}
          handleFileExpandedChange={controller.handleFileExpandedChange}
          items={controller.items.reviewItems}
          lineWrap={props.lineWrap}
          listRef={controller.listRef}
          reviewFileByLocation={controller.navigation.reviewFileByLocation}
          updateComment={props.updateComment}
          virtualizer={controller.virtualizers.reviewVirtualizer}
        />
      </HomeContent>
    );
  },
});
