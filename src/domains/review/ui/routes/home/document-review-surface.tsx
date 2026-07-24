import React, {
  createContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Components } from "react-markdown";
import type { DocumentComment, DocumentSource } from "../../../types/review.ts";
import type { ElementScrollAnchor } from "../../review-comment-interaction/review-comment-interaction.ts";
import { DocumentCommentLayer } from "./document-comment-layer.tsx";
import { DocumentMarkdownTree } from "./document-markdown-tree.tsx";
import { homeRouteDeps } from "./home-route-deps.ts";
import { useScrollAnchorStabilizer } from "./hooks/scroll-anchor-stabilizer/scroll-anchor-stabilizer.ts";

export type DocumentReviewSurfaceProps = {
  document: DocumentSource;
  comments: DocumentComment[];
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
  lineWrap: boolean;
  activeCommentId: string | null;
  addComment: (comment: DocumentComment) => void;
  updateComment: (commentId: string, patch: Partial<DocumentComment>) => void;
  deleteComment: (commentId: string) => void;
};

export type DocumentMarkdownTreeProps = DocumentReviewSurfaceProps & {
  articleRef: React.RefObject<HTMLElement | null>;
  captureScrollAnchor: (element: HTMLElement) => void;
  onMarkdownRendered: () => void;
};

export type DocumentCodePreferences = {
  diffTheme: "github-dark" | "github-light";
  diffThemeType: "dark" | "light";
  lineWrap: boolean;
};

export const DocumentCodePreferencesContext = createContext<DocumentCodePreferences>({
  diffTheme: "github-light",
  diffThemeType: "light",
  lineWrap: false,
});

export const DocumentMarkdownRenderer = React.lazy(async function loadDocumentMarkdownRenderer() {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);

  function LoadedDocumentMarkdownRenderer(props: {
    children: string;
    components: Components;
    onRendered: () => void;
  }) {
    useLayoutEffect(props.onRendered, [props.onRendered]);
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[homeRouteDeps.documentMarkdownNavigation.buildHeadingIdPlugin({})]}
        components={props.components}
      >
        {props.children}
      </ReactMarkdown>
    );
  }

  return { default: LoadedDocumentMarkdownRenderer };
});

function isCodeDocumentComment(comment: DocumentComment) {
  return comment.endBlockId.startsWith("pre:");
}

export const DocumentReviewSurface = React.memo(function DocumentReviewSurface(
  props: DocumentReviewSurfaceProps,
) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [markdownRenderRevision, setMarkdownRenderRevision] = useState(0);
  const codeComments = useMemo(
    () => props.comments.filter(isCodeDocumentComment),
    [props.comments],
  );
  const proseComments = useMemo(
    () => props.comments.filter((comment) => !isCodeDocumentComment(comment)),
    [props.comments],
  );
  const codeActiveCommentId = codeComments.some((comment) => comment.id === props.activeCommentId)
    ? props.activeCommentId
    : null;
  const documentCodePreferences = useMemo<DocumentCodePreferences>(
    () => ({
      diffTheme: props.diffTheme,
      diffThemeType: props.diffThemeType,
      lineWrap: props.lineWrap,
    }),
    [props.diffTheme, props.diffThemeType, props.lineWrap],
  );
  const documentTreeRevision = useMemo(() => ({}), [markdownRenderRevision, props.document]);
  const markMarkdownRendered = useCallback(function markMarkdownRendered() {
    setMarkdownRenderRevision((revision) => revision + 1);
  }, []);
  const { capture: captureDocumentScrollAnchor, stabilize: stabilizeDocumentScrollAnchor } =
    useScrollAnchorStabilizer<ElementScrollAnchor>({
      frameCount: 20,
      restore: function restoreDocumentScrollAnchor(anchor) {
        homeRouteDeps.reviewCommentInteraction.restoreElementScrollAnchor({ anchor });
      },
    });
  const captureScrollAnchor = useCallback(
    function captureScrollAnchor(element: HTMLElement) {
      const scrollElement = element.closest<HTMLElement>("[data-review-document-scroll]");
      if (!scrollElement) {
        return;
      }
      captureDocumentScrollAnchor(
        homeRouteDeps.reviewCommentInteraction.captureElementScrollAnchor({
          element,
          scrollElement,
        }),
      );
    },
    [captureDocumentScrollAnchor],
  );

  useLayoutEffect(
    function preserveSelectedBlockPosition() {
      stabilizeDocumentScrollAnchor();
    },
    [proseComments, stabilizeDocumentScrollAnchor],
  );

  return (
    <div className="bg-transparent">
      <DocumentCodePreferencesContext.Provider value={documentCodePreferences}>
        <DocumentMarkdownTree
          {...props}
          activeCommentId={codeActiveCommentId}
          articleRef={articleRef}
          captureScrollAnchor={captureScrollAnchor}
          comments={codeComments}
          onMarkdownRendered={markMarkdownRendered}
        />
      </DocumentCodePreferencesContext.Provider>
      <DocumentCommentLayer
        activeCommentId={props.activeCommentId}
        articleRef={articleRef}
        comments={proseComments}
        deleteComment={props.deleteComment}
        documentTreeRevision={documentTreeRevision}
        updateComment={props.updateComment}
      />
    </div>
  );
});
