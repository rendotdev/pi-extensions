import { DomainClass } from "../../domain/domain-class.ts";

type CommentDraftFinishDependencies = {
  onDelete: () => void;
  onFinish: (value: string) => void;
};

export class CommentDraftClass extends DomainClass<{}, {}> {
  public finish(value: string, deps: CommentDraftFinishDependencies) {
    if (value.trim().length === 0) {
      deps.onDelete();
      return;
    }

    deps.onFinish(value);
  }
}

export const CommentDraft = new CommentDraftClass({}, {});
