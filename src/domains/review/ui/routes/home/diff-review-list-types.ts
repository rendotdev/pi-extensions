import type { DiffStyle } from "../../../../settings/ui/index.ts";
import type { ReviewJson, ReviewPayload, ReviewSourceFile } from "../../../types/review.ts";
import type { ReviewFileDiffProps } from "./review-file-diff.tsx";

export type DiffReviewListProps = {
  payload: ReviewPayload;
  review: ReviewJson;
  diffStyle: DiffStyle;
  lineWrap: boolean;
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
  theme: string;
  setTheme: (theme: string) => void;
  copiedReviewPath: boolean;
  displayedReviewPath: string;
  onCopyReviewPath: () => void;
  sidebarWidth: number;
  setSidebarWidth: (sidebarWidth: number) => void;
  collapsedFileIds: Set<string>;
  activeCommentId: string | null;
  setFileExpanded: (fileId: string, isExpanded: boolean) => void;
  updateSidebarWidth: (sidebarWidth: number) => void;
  addComment: ReviewFileDiffProps["addComment"];
  updateComment: ReviewFileDiffProps["updateComment"];
  deleteComment: ReviewFileDiffProps["deleteComment"];
};

export type DiffReviewSidebarItem =
  | { kind: "file"; file: ReviewSourceFile }
  | { kind: "group"; key: string; title: string; fileCount: number };

export type DiffReviewContentItem =
  | { kind: "file"; file: ReviewSourceFile }
  | {
      kind: "group";
      key: string;
      title: string;
      fileCount: number;
      added: number;
      removed: number;
    };
