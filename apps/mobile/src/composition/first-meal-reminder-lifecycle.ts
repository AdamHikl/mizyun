export interface FirstMealReminderLifecyclePorts {
  readOwners(): Promise<readonly string[]>;
  writeOwners(owners: readonly string[]): Promise<void>;
  activate(owner: string): void;
  suspend(owner: string): Promise<void>;
  readToday(date: string, owner: string): Promise<boolean | null>;
  reconcile(owner: string, todayLogged: boolean): Promise<unknown>;
  now(): Date;
  sweep?(owner: string | null): Promise<void>;
}
const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Owns account transitions and the restart-safe journal of scheduled owners. */
export class FirstMealReminderLifecycle {
  private owner: string | null = null;
  private revision = 0;
  private ready = false;
  private initialized = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly ports: FirstMealReminderLifecyclePorts) {}

  setOwner(owner: string | null): Promise<void> {
    if (this.initialized && owner === this.owner) return this.refresh();
    this.initialized = true;
    const previous = this.owner;
    this.owner = owner;
    this.ready = false;
    ++this.revision;
    // Retirement must happen synchronously, ahead of any delayed permission/read.
    const cleanup = previous ? this.ports.suspend(previous) : Promise.resolve();
    // Keep the rejection handled immediately while queued work completes.
    const settled = cleanup.then(
      () => null,
      (error) => error,
    );
    return this.enqueue(async () => {
      const error = await settled;
      if (error) throw error;
      await this.prepare();
      await this.readAndReconcile();
    });
  }

  refresh(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.ready) await this.prepare();
      await this.readAndReconcile();
    });
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.queue.catch(() => {}).then(work);
    this.queue = result;
    return result;
  }

  private async prepare(): Promise<void> {
    const revision = this.revision;
    const owner = this.owner;
    await this.ports.sweep?.(owner);
    if (revision !== this.revision) return;
    const owners = await this.ports.readOwners();
    for (const stored of owners) {
      if (stored !== owner) await this.ports.suspend(stored);
    }
    if (revision !== this.revision) return;
    // Persist before activation/scheduling, so signed-out cold starts can clean up.
    await this.ports.writeOwners(owner ? [owner] : []);
    if (revision !== this.revision) return;
    if (owner) this.ports.activate(owner);
    this.ready = true;
  }

  private async readAndReconcile(): Promise<void> {
    const owner = this.owner;
    const revision = this.revision;
    if (!owner || !this.ready) return;
    const now = this.ports.now();
    const day = localDay(now);
    const offset = now.getTimezoneOffset();
    const logged = await this.ports.readToday(day, owner);
    const after = this.ports.now();
    if (
      logged === null ||
      revision !== this.revision ||
      day !== localDay(after) ||
      offset !== after.getTimezoneOffset()
    )
      return;
    await this.ports.reconcile(owner, logged);
  }
}

/** Migrate pre-journal schedules without touching Coach/workout/other reminders. */
export async function sweepUnownedFirstMealNotifications(
  owner: string | null,
  ports: {
    list(): Promise<
      readonly {
        identifier: string;
        content: { data?: Record<string, unknown> };
      }[]
    >;
    cancel(identifier: string): Promise<void>;
  },
): Promise<void> {
  const scheduled = await ports.list();
  const obsolete = scheduled.filter(
    (request) =>
      request.content.data?.source === "first_meal_reminder" &&
      (owner === null || request.content.data.userId !== owner),
  );
  const outcomes = await Promise.allSettled(
    obsolete.map((request) => ports.cancel(request.identifier)),
  );
  if (outcomes.some((result) => result.status === "rejected"))
    throw new Error("First-meal notification migration incomplete");
}
