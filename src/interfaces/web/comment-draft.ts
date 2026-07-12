type CommentDraftFinishDependencies = {
  onDelete: () => void;
  onFinish: (value: string) => void;
};

export class CommentDraftClass {
  public finish(value: string, deps: CommentDraftFinishDependencies) {
    if (value.trim().length === 0) {
      deps.onDelete();
      return;
    }

    deps.onFinish(value);
  }
}

export const CommentDraft = new CommentDraftClass();
