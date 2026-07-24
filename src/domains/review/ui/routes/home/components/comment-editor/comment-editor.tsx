import { defineUIComponent } from "../../../../../../../define.ts";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { CloseButton, TextArea } from "@heroui/react";
import { X } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { useHotkey } from "@tanstack/react-hotkeys";
import { CommentDraft } from "../../../../comment-draft/comment-draft.ts";
import { ReviewCommentInteraction } from "../../../../review-comment-interaction/review-comment-interaction.ts";

const iconSize = 14;
const iconStrokeWidth = 1.5;

export type CommentEditorProps = {
  id: string;
  value: string;
  active: boolean;
  onChange: (value: string) => void;
  onFinish: (value: string) => void;
  onDelete: () => void;
};

function finishComment(params: {
  deps: { commentDraft: CommentDraft; reviewCommentInteraction: ReviewCommentInteraction };
  props: CommentEditorProps;
  setIsFocused: (isFocused: boolean) => void;
  value: string;
}) {
  params.setIsFocused(false);
  const finishParams = {
    id: params.props.id,
    value: params.value,
    onDelete: params.props.onDelete,
    onFinish: params.props.onFinish,
  };
  const isEmptyComment = params.value.trim().length === 0;
  if (isEmptyComment) {
    params.deps.reviewCommentInteraction.finishAfterPointerInteraction({
      callback: function finishEmptyComment() {
        params.deps.commentDraft.finish(finishParams);
      },
    });
    return;
  }
  params.deps.commentDraft.finish(finishParams);
}

function useCommentEditorEffects(params: {
  active: boolean;
  id: string;
  reviewCommentInteraction: ReviewCommentInteraction;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  useEffect(() => {
    if (!params.active) {
      return;
    }
    const textarea = params.textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;
  }, [params.active, params.id, params.textareaRef]);
  useEffect(() => {
    if (params.textareaRef.current) {
      params.reviewCommentInteraction.resizeTextarea({
        textarea: params.textareaRef.current,
        allowShrink: true,
      });
    }
  }, [params.id, params.reviewCommentInteraction, params.textareaRef]);
}

function useCommentEditorModel(
  props: CommentEditorProps,
  deps: {
    commentDraft: CommentDraft;
    reviewCommentInteraction: ReviewCommentInteraction;
  },
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const form = useForm({
    defaultValues: {
      comment: deps.commentDraft.value({ id: props.id, fallback: props.value }),
    },
    onSubmit: ({ value }) => finishComment({ deps, props, setIsFocused, value: value.comment }),
  });

  useHotkey("Escape", handleClearComment, {
    enabled: props.active || isFocused,
    ignoreInputs: false,
    target: textareaRef,
  });

  useCommentEditorEffects({
    active: props.active,
    id: props.id,
    reviewCommentInteraction: deps.reviewCommentInteraction,
    textareaRef,
  });

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const shouldFinishComment = event.key === "Enter" && !event.shiftKey;
    if (shouldFinishComment) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  function handleClearComment() {
    setIsFocused(false);
    deps.commentDraft.remove({ id: props.id });
    props.onDelete();
  }

  function handleCommentChange(value: string) {
    deps.commentDraft.update({
      id: props.id,
      value,
      onSync: function synchronizeComment(comment) {
        props.onChange(comment);
        if (textareaRef.current) {
          deps.reviewCommentInteraction.resizeTextarea({
            textarea: textareaRef.current,
            allowShrink: true,
          });
        }
      },
    });
  }

  return {
    form,
    handleClearComment,
    handleCommentChange,
    handleKeyDown,
    setIsFocused,
    textareaRef,
  };
}

function CommentEditorView(
  props: CommentEditorProps,
  deps: {
    commentDraft: CommentDraft;
    reviewCommentInteraction: ReviewCommentInteraction;
  },
) {
  const model = useCommentEditorModel(props, deps);

  return (
    <div
      data-review-comment="true"
      className="flex items-center bg-[var(--review-highlight-background)] px-[var(--review-comment-padding-inline)] py-[var(--review-comment-padding-block)] font-sans"
    >
      <model.form.Field name="comment">
        {(field) => (
          <div className="relative w-full">
            <TextArea
              ref={model.textareaRef}
              aria-label="Review comment"
              className="block min-h-11 w-full overflow-hidden py-[11px] pr-10 font-sans text-sm leading-5"
              placeholder="Add review comment..."
              value={field.state.value}
              variant="secondary"
              onFocus={() => model.setIsFocused(true)}
              onBlur={() => {
                field.handleBlur();
                void model.form.handleSubmit();
              }}
              onChange={(event) => {
                const value = event.currentTarget.value;
                field.handleChange(value);
                model.handleCommentChange(value);
              }}
              onKeyDown={model.handleKeyDown}
              rows={1}
              style={{ resize: "none" }}
            />
            <CloseButton
              aria-label="Delete comment"
              className="absolute right-2 top-2.5 z-10 text-muted hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onPress={model.handleClearComment}
            >
              <X
                size={iconSize}
                strokeWidth={iconStrokeWidth}
                absoluteStrokeWidth
                aria-hidden="true"
              />
            </CloseButton>
          </div>
        )}
      </model.form.Field>
    </div>
  );
}

export const CommentEditor = defineUIComponent({
  params: {},
  deps: {
    commentDraft: new CommentDraft(),
    reviewCommentInteraction: new ReviewCommentInteraction(),
  },
  component(props: CommentEditorProps) {
    return CommentEditorView(props, this.deps);
  },
});
