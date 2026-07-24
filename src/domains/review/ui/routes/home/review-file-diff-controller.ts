import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import type { FileDiffProps, SelectedLineRange } from "@pierre/diffs/react";
import { defineUIHook } from "../../../../../define.ts";
import type { ReviewSourceFile } from "../../../types/review.ts";
import type { DiffScrollAnchor } from "../../review-comment-interaction/review-comment-interaction.ts";
import { homeRouteDeps, type CommentAnnotationMetadata } from "./home-route-deps.ts";
import { useReviewLineSelection } from "./hooks/review-line-selection/review-line-selection.ts";
import { useScrollAnchorStabilizer } from "./hooks/scroll-anchor-stabilizer/scroll-anchor-stabilizer.ts";
import type { ReviewFileDiffProps } from "./review-file-diff.tsx";

const parsedFileDiffCache = new WeakMap<ReviewSourceFile, FileDiffMetadata>();
const largeDiffWordHighlightThreshold = 2_000;

export const useReviewFileDiffController = defineUIHook({
  params: {},
  deps: {
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useReviewLineSelection,
    useScrollAnchorStabilizer,
    useState,
  },
  hook(props: ReviewFileDiffProps) {
    const deps = this.deps;
    const [copied, setCopied] = deps.useState(false);
    const selection = deps.useReviewLineSelection({});
    const propsRef = deps.useRef(props);
    propsRef.current = props;
    const stabilizer = deps.useScrollAnchorStabilizer<DiffScrollAnchor>({
      frameCount: 120,
      restore: function restoreDiffScrollAnchor(anchor) {
        homeRouteDeps.reviewCommentInteraction.restoreDiffScrollAnchor({ anchor });
      },
    });
    const captureScrollAnchor = useDiffScrollAnchorCapture({
      capture: stabilizer.capture,
      deps,
      fileId: props.file.id,
    });
    deps.useLayoutEffect(
      function preserveSelectedLinePosition() {
        stabilizer.stabilize();
      },
      [props.reviewFile.comments, stabilizer.stabilize],
    );
    const fileDiff = useParsedFileDiff({ deps, file: props.file });
    const options = useReviewDiffOptions({
      captureScrollAnchor,
      deps,
      props,
      propsRef,
      selection,
    });
    async function copyPath() {
      try {
        await navigator.clipboard.writeText(props.file.location);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch {
        setCopied(false);
      }
    }
    return { copied, copyPath, fileDiff, options, selection };
  },
});

function useDiffScrollAnchorCapture(params: {
  capture: (anchor: DiffScrollAnchor | null) => void;
  deps: typeof reviewFileDiffControllerDeps;
  fileId: string;
}) {
  return params.deps.useCallback(
    function captureScrollAnchor(range: SelectedLineRange) {
      const node = document.querySelector<HTMLElement>(
        `[data-review-file-item="${CSS.escape(params.fileId)}"] diffs-container`,
      );
      if (node) {
        params.capture(
          homeRouteDeps.reviewCommentInteraction.captureDiffScrollAnchor({ node, range }),
        );
      }
    },
    [params.capture, params.fileId],
  );
}

function useParsedFileDiff(params: {
  deps: typeof reviewFileDiffControllerDeps;
  file: ReviewSourceFile;
}) {
  const oldFile = params.deps.useMemo(() => sourceFileVersion(params.file, "old"), [params.file]);
  const newFile = params.deps.useMemo(() => sourceFileVersion(params.file, "new"), [params.file]);
  return params.deps.useMemo(
    function parseFileDiff() {
      const cached = parsedFileDiffCache.get(params.file);
      if (cached) {
        return cached;
      }
      const parsed = parseDiffFromFile(oldFile, newFile);
      parsedFileDiffCache.set(params.file, parsed);
      return parsed;
    },
    [params.file, newFile, oldFile],
  );
}

function sourceFileVersion(file: ReviewSourceFile, side: "new" | "old") {
  return {
    name: file.location,
    contents: side === "old" ? file.oldContent : file.newContent,
    lang: file.language as never,
    cacheKey: `${file.id}:${side}`,
  };
}

function useReviewDiffOptions(params: {
  captureScrollAnchor: (range: SelectedLineRange) => void;
  deps: typeof reviewFileDiffControllerDeps;
  props: ReviewFileDiffProps;
  propsRef: React.RefObject<ReviewFileDiffProps>;
  selection: ReturnType<typeof useReviewLineSelection>;
}) {
  return params.deps.useMemo<NonNullable<FileDiffProps<CommentAnnotationMetadata>["options"]>>(
    function buildDiffOptions() {
      const presentationOptions = homeRouteDeps.reviewDiffPresentation.fileOptions({});
      return {
        ...presentationOptions,
        theme: params.props.diffTheme,
        themeType: params.props.diffThemeType,
        diffStyle: params.props.diffStyle,
        overflow: params.props.lineWrap ? "wrap" : "scroll",
        lineDiffType: diffLineType(params.props.file, presentationOptions.lineDiffType),
        enableLineSelection: true,
        onLineSelectionEnd: function finishLineSelection(range) {
          if (!range) {
            params.selection.clearSelectedLines();
            return;
          }
          params.captureScrollAnchor(range);
          params.selection.selectLines(range);
          params.propsRef.current.addComment(params.props.file, range);
        },
        onPostRender: function installRowSelection(node, instance, phase) {
          homeRouteDeps.reviewCommentInteraction.installRowSelection({
            node,
            phase,
            renderer: instance,
            previewSelection: params.selection.selectLines,
            commitSelection: function commitRowSelection(range) {
              params.captureScrollAnchor(range);
              params.selection.selectLines(range);
              params.propsRef.current.addComment(params.props.file, range);
            },
          });
        },
      };
    },
    [
      params.captureScrollAnchor,
      params.props.diffStyle,
      params.props.diffTheme,
      params.props.diffThemeType,
      params.props.file,
      params.props.lineWrap,
      params.selection.clearSelectedLines,
      params.selection.selectLines,
    ],
  );
}

function diffLineType(
  file: ReviewSourceFile,
  defaultType: NonNullable<FileDiffProps<CommentAnnotationMetadata>["options"]>["lineDiffType"],
) {
  return file.added + file.removed > largeDiffWordHighlightThreshold ? "none" : defaultType;
}

const reviewFileDiffControllerDeps = {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
};
