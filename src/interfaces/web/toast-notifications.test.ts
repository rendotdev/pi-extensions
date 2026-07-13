import { describe, expect, it, vi } from "vite-plus/test";
import { ToastNotificationsClass } from "./toast-notifications.ts";

describe("ToastNotificationsClass", () => {
  it.each([
    ["preferencesNotSaved", "Preferences not saved"],
    ["preferencesUnavailable", "Preferences unavailable"],
    ["reviewUnavailable", "Review unavailable"],
    ["commentsNotSaved", "Comments not saved"],
    ["copyFailed", "Copy failed"],
    ["cancelFailed", "Cancel failed"],
  ] as const)("shows a minimal message for %s", (method, message) => {
    const showDanger = vi.fn();
    const notifications = new ToastNotificationsClass({}, { showDanger });

    notifications[method]();

    expect(showDanger).toHaveBeenCalledWith(message);
  });
});
