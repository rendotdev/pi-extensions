import { defaultPreferences } from "../../../../settings/ui/index.ts";
import { ReviewHandoff } from "../../../service/handoff/handoff.ts";
import { CommentDraft } from "../../comment-draft/comment-draft.ts";
import { DocumentCodeHighlighter } from "../../document-code-highlighter/document-code-highlighter.ts";
import { DocumentMarkdownNavigation } from "../../document-markdown-navigation/document-markdown-navigation.ts";
import { FileSearch } from "../../file-search/file-search.ts";
import { PreferencesApi } from "../../preferences-api/preferences-api.ts";
import { ReviewApi } from "../../review-api/review-api.ts";
import { ReviewClipboardCopy } from "../../review-clipboard-copy/review-clipboard-copy.ts";
import { ReviewCommentInteraction } from "../../review-comment-interaction/review-comment-interaction.ts";
import { ReviewDiffPresentation } from "../../review-diff-presentation/review-diff-presentation.ts";
import { ReviewFileNavigation } from "../../review-file-navigation/review-file-navigation.ts";
import { ReviewGroupPresentation } from "../../review-group-presentation/review-group-presentation.ts";
import { ReviewPresentation } from "../../review-presentation/review-presentation.ts";
import { ToastNotifications } from "../../toast-notifications/toast-notifications.ts";
import { ReviewWindowTitle } from "../../window-title/window-title.ts";

export const homeRouteDeps = {
  lgtmPreferences: { defaults: defaultPreferences },
  reviewHandoff: ReviewHandoff,
  commentDraft: new CommentDraft(),
  documentCodeHighlighter: new DocumentCodeHighlighter(),
  documentMarkdownNavigation: DocumentMarkdownNavigation,
  fileSearch: FileSearch,
  preferencesApi: new PreferencesApi(),
  reviewApi: new ReviewApi(),
  reviewClipboardCopy: new ReviewClipboardCopy(),
  reviewCommentInteraction: new ReviewCommentInteraction(),
  reviewDiffPresentation: new ReviewDiffPresentation(),
  reviewFileNavigation: new ReviewFileNavigation(),
  reviewGroupPresentation: ReviewGroupPresentation,
  reviewPresentation: new ReviewPresentation(),
  toastNotifications: new ToastNotifications(),
  reviewWindowTitle: ReviewWindowTitle,
};

export type CommentAnnotationMetadata = {
  commentId: string;
};
