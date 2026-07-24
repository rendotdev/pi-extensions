import { defineService } from "../../../../define.ts";
import type { ReviewJson } from "../../types/review.ts";

export class CommentDraft extends defineService({
  params: { syncWaitMs: 250 },
  deps: {
    clearTimeout: function clearScheduledTimeout(handle: number) {
      globalThis.clearTimeout(handle);
    },
    now: function now() {
      return new Date();
    },
    setTimeout: function scheduleTimeout(callback: () => void, milliseconds: number): number {
      return globalThis.setTimeout(callback, milliseconds) as unknown as number;
    },
  },
}) {
  private readonly values = new Map<string, string>();
  private readonly syncTimers = new Map<string, number>();

  private clearScheduledSync(params: { id: string }): void {
    const handle = this.syncTimers.get(params.id);
    if (handle === undefined) {
      return;
    }
    this.deps.clearTimeout(handle);
    this.syncTimers.delete(params.id);
  }

  public value(params: { fallback: string; id: string }): string {
    return this.values.get(params.id) ?? params.fallback;
  }

  public update(params: { id: string; onSync: (value: string) => void; value: string }): void {
    this.values.set(params.id, params.value);
    this.clearScheduledSync({ id: params.id });
    const handle = this.deps.setTimeout(() => {
      this.syncTimers.delete(params.id);
      const draft = this.values.get(params.id);
      if (draft !== undefined) {
        params.onSync(draft);
      }
    }, this.params.syncWaitMs);
    this.syncTimers.set(params.id, handle);
  }

  public remove(params: { id: string }): void {
    this.clearScheduledSync(params);
    this.values.delete(params.id);
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

  public applyToReview(params: { review: ReviewJson }): ReviewJson {
    let changed = false;
    const updatedAt = this.deps.now().toISOString();
    const files = params.review.files.map((file) => {
      return {
        ...file,
        comments: file.comments.map((comment) => {
          const draft = this.values.get(comment.id);
          const shouldApplyDraft = draft !== undefined && draft !== comment.comment;
          if (!shouldApplyDraft) {
            return comment;
          }
          changed = true;
          return { ...comment, comment: draft, updatedAt };
        }),
      };
    });
    const documentComments = params.review.documentComments.map((comment) => {
      const draft = this.values.get(comment.id);
      const shouldApplyDraft = draft !== undefined && draft !== comment.comment;
      if (!shouldApplyDraft) {
        return comment;
      }
      changed = true;
      return { ...comment, comment: draft, updatedAt };
    });
    if (!changed) {
      return params.review;
    }
    return { ...params.review, updatedAt, files, documentComments };
  }
}
