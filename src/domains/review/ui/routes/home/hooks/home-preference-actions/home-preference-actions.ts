import { useEffect, useState } from "react";
import { defineUIHook } from "../../../../../../../define.ts";
import type { DiffStyle } from "../../../../../../settings/ui/index.ts";
import type { HomeReviewData } from "../home-review-data/home-review-data.ts";

export const useHomePreferenceActions = defineUIHook({
  params: {},
  deps: {},
  hook(props: { data: HomeReviewData; showSavingPreferences: () => void }) {
    const [displayedSidebarWidth, setDisplayedSidebarWidth] = useState(
      props.data.preferences.sidebarWidth,
    );
    useEffect(
      function syncSidebarWidth() {
        setDisplayedSidebarWidth(props.data.preferences.sidebarWidth);
      },
      [props.data.preferences.sidebarWidth],
    );
    function savePreferences(patch: Partial<typeof props.data.preferences>) {
      props.showSavingPreferences();
      props.data.mutation.mutate({ ...props.data.preferences, ...patch });
    }
    function toggleAllFiles() {
      const payload = props.data.state?.payload;
      const canToggleFiles = payload?.kind === "diff" && payload.files.length > 0;
      if (!canToggleFiles) {
        return;
      }
      const hasExpandedFiles = props.data.collapsedFileIds.size < payload.files.length;
      const fileExpansion = hasExpandedFiles ? "collapsed" : "expanded";
      props.data.setCollapsedFileIds(
        fileExpansion === "collapsed" ? new Set(payload.files.map((file) => file.id)) : new Set(),
      );
      savePreferences({ fileExpansion, fileExpansionOverrides: {} });
    }
    function updateDiffStyle(diffStyle: DiffStyle) {
      if (diffStyle !== props.data.preferences.diffStyle) {
        savePreferences({ diffStyle });
      }
    }
    function updateLineWrap(lineWrap: boolean) {
      if (lineWrap !== props.data.preferences.lineWrap) {
        savePreferences({ lineWrap });
      }
    }
    function updateSidebarWidth(sidebarWidth: number) {
      if (sidebarWidth !== props.data.preferences.sidebarWidth) {
        savePreferences({ sidebarWidth });
      }
    }
    return {
      displayedSidebarWidth,
      setDisplayedSidebarWidth,
      toggleAllFiles,
      updateDiffStyle,
      updateLineWrap,
      updateSidebarWidth,
    };
  },
});

export type HomePreferenceActions = ReturnType<typeof useHomePreferenceActions>;
