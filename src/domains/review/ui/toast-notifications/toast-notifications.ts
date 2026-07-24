import { toast } from "@heroui/react";
import { defineRuntime } from "../../../../define.ts";

export class ToastNotifications extends defineRuntime({
  params: {},
  deps: { showDanger: toast.danger, showSuccess: toast.success },
}) {
  public preferencesNotSaved(params: { error: unknown }): void {
    const detail = params.error instanceof Error ? params.error.message : String(params.error);
    void this.deps.showDanger(`Preferences not saved: ${detail}`);
  }

  public preferencesUnavailable(params: {}): void {
    void params;
    void this.deps.showDanger("Preferences unavailable");
  }

  public reviewUnavailable(params: {}): void {
    void params;
    void this.deps.showDanger("Review unavailable");
  }

  public commentsNotSaved(params: {}): void {
    void params;
    void this.deps.showDanger("Comments not saved");
  }

  public commentsCopied(params: {}): void {
    void params;
    void this.deps.showSuccess("Comments copied");
  }

  public commentsKeptInTab(params: {}): void {
    void params;
    void this.deps.showDanger("Comments kept in this tab");
  }

  public reviewNotFinished(params: {}): void {
    void params;
    void this.deps.showDanger("Review saved but not finished");
  }

  public copyFailed(params: {}): void {
    void params;
    void this.deps.showDanger("Copy failed");
  }

  public cancelFailed(params: {}): void {
    void params;
    void this.deps.showDanger("Cancel failed");
  }
}
