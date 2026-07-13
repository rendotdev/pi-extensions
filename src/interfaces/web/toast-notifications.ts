import { toast } from "@heroui/react";
import { DomainClass } from "../../domain/domain-class.ts";

export class ToastNotificationsClass extends DomainClass<
  {},
  { showDanger: (message: string) => unknown }
> {
  public preferencesNotSaved(): void {
    void this.deps.showDanger("Preferences not saved");
  }

  public preferencesUnavailable(): void {
    void this.deps.showDanger("Preferences unavailable");
  }

  public reviewUnavailable(): void {
    void this.deps.showDanger("Review unavailable");
  }

  public commentsNotSaved(): void {
    void this.deps.showDanger("Comments not saved");
  }

  public copyFailed(): void {
    void this.deps.showDanger("Copy failed");
  }

  public cancelFailed(): void {
    void this.deps.showDanger("Cancel failed");
  }
}

export const ToastNotifications = new ToastNotificationsClass({}, { showDanger: toast.danger });
