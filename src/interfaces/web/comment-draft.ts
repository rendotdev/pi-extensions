import { DomainClass } from "../../domain/domain-class.ts";
import type { ReviewJson } from "../../domain/review/review.ts";

export class CommentDraftClass extends DomainClass<
  { syncWaitMs: number },
  {
    clearTimeout: (handle: number) => void;
    now: () => Date;
    setTimeout: (callback: () => void, milliseconds: number) => number;
  }
> {
  private readonly values = new Map<string, string>();
  private readonly syncTimers = new Map<string, number>();

  public value(params: { fallback: string; id: string }): string {
    return this.values.get(params.id) ?? params.fallback;
  }

  public update(params: { id: string; onSync: (value: string) => void; value: string }): void {
    this.values.set(params.id, params.value);
    this.clearScheduledSync({ id: params.id });
    const handle = this.deps.setTimeout(() => {
      this.syncTimers.delete(params.id);
      const value = this.values.get(params.id);
      if (value !== undefined) {
        params.onSync(value);
      }
    }, this.params.syncWaitMs);
    this.syncTimers.set(params.id, handle);
  }

  public finish(params: {
    id: string;
    value: string;
    onDelete: () => void;
    onFinish: (value: string) => void;
  }): void {
    this.remove({ id: params.id });
    if (params.value.trim().length === 0) {
      params.onDelete();
      return;
    }
    params.onFinish(params.value);
  }

  public remove(params: { id: string }): void {
    this.clearScheduledSync(params);
    this.values.delete(params.id);
  }

  public applyToReview(params: { review: ReviewJson }): ReviewJson {
    let changed = false;
    const updatedAt = this.deps.now().toISOString();
    const files = params.review.files.map((file) => ({
      ...file,
      comments: file.comments.map((comment) => {
        const value = this.values.get(comment.id);
        const shouldApplyDraft = value !== undefined && value !== comment.comment;
        if (!shouldApplyDraft) {
          return comment;
        }
        changed = true;
        return { ...comment, comment: value, updatedAt };
      }),
    }));
    const documentComments = params.review.documentComments.map((comment) => {
      const value = this.values.get(comment.id);
      const shouldApplyDraft = value !== undefined && value !== comment.comment;
      if (!shouldApplyDraft) {
        return comment;
      }
      changed = true;
      return { ...comment, comment: value, updatedAt };
    });
    if (!changed) {
      return params.review;
    }
    return { ...params.review, updatedAt, files, documentComments };
  }

  private clearScheduledSync(params: { id: string }): void {
    const handle = this.syncTimers.get(params.id);
    if (handle === undefined) {
      return;
    }
    this.deps.clearTimeout(handle);
    this.syncTimers.delete(params.id);
  }
}

export const CommentDraft = new CommentDraftClass(
  { syncWaitMs: 250 },
  {
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    now: () => new Date(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
  },
);
