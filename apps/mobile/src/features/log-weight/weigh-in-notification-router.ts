import { WEIGH_IN_ROUTE, WEIGH_IN_SOURCE } from "./weigh-in-reminders";

interface WeighInNotification {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

/**
 * Opens the log-weight screen for a weigh-in reminder tap, once navigation is
 * ready and only for the account that scheduled it.
 */
export class WeighInNotificationRouter {
  private pending: WeighInNotification | null = null;
  private handled = new Set<string>();
  constructor(
    private readonly ports: { push(route: string): void; clear(): void },
  ) {}
  receive(notification: WeighInNotification): void {
    if (
      notification.data.url !== WEIGH_IN_ROUTE ||
      notification.data.source !== WEIGH_IN_SOURCE
    )
      return;
    if (!this.handled.has(notification.id)) this.pending = notification;
  }
  flush(owner: string | null, navigationReady: boolean): void {
    const pending = this.pending;
    if (!pending || !owner || !navigationReady) return;
    this.pending = null;
    this.handled.add(pending.id);
    if (pending.data.userId !== owner) {
      this.ports.clear();
      return;
    }
    this.ports.push(WEIGH_IN_ROUTE);
    this.ports.clear();
  }
}
