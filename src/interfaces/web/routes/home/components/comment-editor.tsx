import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CloseButton, TextArea } from "@heroui/react";
import { X } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { useHotkey } from "@tanstack/react-hotkeys";
import { CommentDraft } from "../../../comment-draft.ts";
import { ReviewCommentInteraction } from "../../../review-comment-interaction.ts";

const iconSize = 14;
const iconStrokeWidth = 1.5;

export function CommentEditor(props: {
  id: string;
  value: string;
  active: boolean;
  onChange: (value: string) => void;
  onFinish: (value: string) => void;
  onDelete: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const form = useForm({
    defaultValues: {
      comment: CommentDraft.value({ id: props.id, fallback: props.value }),
    },
    onSubmit: ({ value }) => finishComment(value.comment),
  });

  function finishComment(value: string) {
    setIsFocused(false);
    const isEmptyComment = value.trim().length === 0;
    if (isEmptyComment) {
      ReviewCommentInteraction.finishAfterPointerInteraction({
        callback: function finishEmptyComment() {
          CommentDraft.finish({
            id: props.id,
            value,
            onDelete: props.onDelete,
            onFinish: props.onFinish,
          });
        },
      });
      return;
    }
    CommentDraft.finish({
      id: props.id,
      value,
      onDelete: props.onDelete,
      onFinish: props.onFinish,
    });
  }

  useHotkey("Escape", handleClearComment, {
    enabled: props.active || isFocused,
    ignoreInputs: false,
    target: textareaRef,
  });

  useEffect(() => {
    if (!props.active) {
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;
  }, [props.active, props.id]);

  useEffect(() => {
    if (textareaRef.current) {
      ReviewCommentInteraction.resizeTextarea({
        textarea: textareaRef.current,
        allowShrink: true,
      });
    }
  }, [props.id]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const shouldFinishComment = event.key === "Enter" && !event.shiftKey;
    if (shouldFinishComment) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  function handleClearComment() {
    setIsFocused(false);
    CommentDraft.remove({ id: props.id });
    props.onDelete();
  }

  return (
    <div
      data-review-comment="true"
      className="flex items-center bg-[#0070f3]/10 px-6 py-3 font-sans"
    >
      <form.Field name="comment">
        {(field) => (
          <div className="relative w-full">
            <TextArea
              ref={textareaRef}
              aria-label="Review comment"
              className="block min-h-11 w-full overflow-hidden py-[11px] pr-10 font-sans text-sm leading-5"
              placeholder="Add review comment..."
              value={field.state.value}
              variant="secondary"
              onFocus={() => setIsFocused(true)}
              onBlur={() => {
                field.handleBlur();
                void form.handleSubmit();
              }}
              onChange={(event) => {
                const value = event.currentTarget.value;
                field.handleChange(value);
                CommentDraft.update({
                  id: props.id,
                  value,
                  onSync: function synchronizeComment(comment) {
                    props.onChange(comment);
                    if (textareaRef.current) {
                      ReviewCommentInteraction.resizeTextarea({
                        textarea: textareaRef.current,
                        allowShrink: true,
                      });
                    }
                  },
                });
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              style={{ resize: "none" }}
            />
            <CloseButton
              aria-label="Delete comment"
              className="absolute right-2 top-2.5 z-10 text-muted hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onPress={handleClearComment}
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
      </form.Field>
    </div>
  );
}
