import { describe, expect, it, vi } from "vite-plus/test";
import { ToastNotificationsClass } from "./toast-notifications.ts";

describe("ToastNotificationsClass", () => {
  it.each([
    ["preferencesUnavailable", "Preferences unavailable"],
    ["reviewUnavailable", "Review unavailable"],
    ["commentsNotSaved", "Comments not saved"],
    ["copyFailed", "Copy failed"],
    ["cancelFailed", "Cancel failed"],
  ] as const)("shows a minimal message for %s", (method, message) => {
    const showDanger = vi.fn();
    const Notifications = new ToastNotificationsClass({}, { showDanger });

    Notifications[method]();

    expect(showDanger).toHaveBeenCalledWith(message);
  });

  it("includes the preference save error", () => {
    const showDanger = vi.fn();
    const Notifications = new ToastNotificationsClass({}, { showDanger });

    Notifications.preferencesNotSaved({ error: new Error("Failed to fetch") });

    expect(showDanger).toHaveBeenCalledWith("Preferences not saved: Failed to fetch");
  });
});
