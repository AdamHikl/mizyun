interface MealNotification {
  readonly id: string;
  readonly data: Record<string, unknown>;
}
export class MealNotificationRouter {
  private pending: MealNotification | null = null;
  private handled = new Set<string>();
  constructor(
    private readonly ports: {
      push(route: {
        pathname: "/log-meal" | "/meals";
        params: { source?: string };
      }): void;
      clear(): void;
    },
  ) {}
  receive(notification: MealNotification): void {
    if (
      notification.data.url !== "/log-meal" &&
      notification.data.url !== "/meals"
    )
      return;
    if (!this.handled.has(notification.id)) this.pending = notification;
  }
  flush(owner: string | null, navigationReady: boolean): void {
    const pending = this.pending;
    if (!pending || !owner || !navigationReady) return;
    this.pending = null;
    this.handled.add(pending.id);
    const data = pending.data;
    // Old unscoped first-meal schedules are replaced by account reconciliation.
    if (data.source === "first_meal_reminder" && data.userId !== owner) {
      this.ports.clear();
      return;
    }
    this.ports.push({
      pathname: data.url as "/log-meal" | "/meals",
      params: typeof data.source === "string" ? { source: data.source } : {},
    });
    this.ports.clear();
  }
}
