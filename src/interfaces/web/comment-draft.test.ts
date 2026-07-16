import { describe, expect, it, vi } from "vite-plus/test";
import { CommentDraftClass } from "./comment-draft.ts";

describe("CommentDraftClass", () => {
  it.each(["", "   ", "\n\t"])('deletes an empty draft on blur: "%s"', (value) => {
    const onDelete = vi.fn();
    const onFinish = vi.fn();

    new CommentDraftClass({}, {}).finish({ value, onDelete, onFinish });

    expect(onDelete).toHaveBeenCalledOnce();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("finishes a written comment without trimming its content", () => {
    const onDelete = vi.fn();
    const onFinish = vi.fn();

    new CommentDraftClass({}, {}).finish({
      value: "  Keep this comment.  ",
      onDelete,
      onFinish,
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledExactlyOnceWith("  Keep this comment.  ");
  });
});
