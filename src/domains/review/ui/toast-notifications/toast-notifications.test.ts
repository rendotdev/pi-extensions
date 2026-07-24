import { describe, expect, it, vi } from "vite-plus/test";
import { ToastNotifications } from "./toast-notifications.ts";

describe("ToastNotifications", () => {
  it.each([
    ["preferencesUnavailable", "Preferences unavailable"],
    ["reviewUnavailable", "Review unavailable"],
    ["commentsNotSaved", "Comments not saved"],
    ["copyFailed", "Copy failed"],
    ["cancelFailed", "Cancel failed"],
  ] as const)("shows a minimal message for %s", (method, message) => {
    const showDanger = vi.fn();
    const Notifications = new ToastNotifications({
      params: {},
      deps: { showDanger, showSuccess: vi.fn() },
    });

    Notifications[method]({});

    expect(showDanger).toHaveBeenCalledWith(message);
  });

  it("includes the preference save error", () => {
    const showDanger = vi.fn();
    const Notifications = new ToastNotifications({
      params: {},
      deps: { showDanger, showSuccess: vi.fn() },
    });

    Notifications.preferencesNotSaved({ error: new Error("Failed to fetch") });

    expect(showDanger).toHaveBeenCalledWith("Preferences not saved: Failed to fetch");
  });

  it("shows recovery outcomes without placing text in the review header", () => {
    const showDanger = vi.fn();
    const showSuccess = vi.fn();
    const Notifications = new ToastNotifications({
      params: {},
      deps: { showDanger, showSuccess },
    });

    Notifications.commentsCopied({});
    Notifications.commentsKeptInTab({});
    Notifications.reviewNotFinished({});

    expect(showSuccess).toHaveBeenCalledWith("Comments copied");
    expect(showDanger).toHaveBeenNthCalledWith(1, "Comments kept in this tab");
    expect(showDanger).toHaveBeenNthCalledWith(2, "Review saved but not finished");
  });
});
