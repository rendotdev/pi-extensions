import { DomainClass } from "../../domain/domain-class.ts";

export class CommentDraftClass extends DomainClass<{}, {}> {
  public finish(params: {
    value: string;
    onDelete: () => void;
    onFinish: (value: string) => void;
  }) {
    if (params.value.trim().length === 0) {
      params.onDelete();
      return;
    }

    params.onFinish(params.value);
  }
}

export const CommentDraft = new CommentDraftClass({}, {});
