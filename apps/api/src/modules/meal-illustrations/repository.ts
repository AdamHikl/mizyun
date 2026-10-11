import type {
  MealIllustrationClaim,
  MealIllustrationImage,
  MealIllustrationRepository,
  StoredMealIllustration,
  UserId,
} from "@mizyun/core";

/** Fake only; production admission is serialized by the SQL feature RPC. */
export class InMemoryMealIllustrationRepository implements MealIllustrationRepository {
  readonly userUsage = new Map<string, number>();
  readonly environmentUsage = new Map<string, number>();
  readonly records = new Map<string, StoredMealIllustration>();
  readonly deletedUsers = new Set<UserId>();
  constructor(private readonly now: () => Date = () => new Date()) {}
  async claim(
    userId: UserId,
    key: string,
    _consentVersion?: string,
    sourceEntryId: string = crypto.randomUUID(),
  ): Promise<MealIllustrationClaim> {
    if (this.deletedUsers.has(userId)) return { kind: "limited" };
    const now = this.now();
    for (const [k, record] of this.records)
      if (
        record.state === "generating" &&
        Date.parse(record.leaseUntil) <= now.getTime()
      )
        this.records.set(k, { ...record, state: "unknown" });
    const mapKey = `${userId}:${key}`;
    const existing = this.records.get(mapKey);
    if (existing) return { kind: "existing", record: existing };
    const rows = [...this.records.values()];
    const day = now.toISOString().slice(0, 10),
      month = day.slice(0, 7);
    const own = rows.filter((r) => r.userId === userId);
    if (
      (this.userUsage.get(`${userId}:${day}`) ?? 0) >= 5 ||
      [...this.userUsage.entries()]
        .filter(([d]) => d.startsWith(`${userId}:${month}`))
        .reduce((sum, [, count]) => sum + count, 0) >= 30 ||
      (this.environmentUsage.get(day) ?? 0) >= 50 ||
      [...this.environmentUsage.entries()]
        .filter(([d]) => d.startsWith(month))
        .reduce((total, [, count]) => total + count, 0) >= 500 ||
      rows.filter((r) => r.state === "generating").length >= 2 ||
      own.some((r) => r.state === "generating")
    )
      return { kind: "limited" };
    const record: StoredMealIllustration = {
      id: crypto.randomUUID(),
      userId,
      sourceEntryId,
      key,
      state: "generating",
      createdAt: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 120_000).toISOString(),
      image: null,
    };
    this.userUsage.set(
      `${userId}:${day}`,
      (this.userUsage.get(`${userId}:${day}`) ?? 0) + 1,
    );
    this.environmentUsage.set(day, (this.environmentUsage.get(day) ?? 0) + 1);
    this.records.set(mapKey, record);
    return { kind: "claimed", record };
  }
  async complete(
    userId: UserId,
    id: string,
    image: MealIllustrationImage,
  ): Promise<void> {
    for (const [key, row] of this.records)
      if (
        row.id === id &&
        row.userId === userId &&
        row.state === "generating" &&
        Date.parse(row.leaseUntil) > this.now().getTime()
      )
        this.records.set(key, { ...row, state: "ready", image });
  }
  async fail(userId: UserId, id: string): Promise<void> {
    for (const [key, row] of this.records)
      if (row.id === id && row.userId === userId && row.state === "generating")
        this.records.set(key, { ...row, state: "failed", image: null });
  }
  async exportForUser(
    userId: UserId,
  ): Promise<readonly StoredMealIllustration[]> {
    return [...this.records.values()].filter((r) => r.userId === userId);
  }
  async exportUsageForUser(userId: UserId) {
    return [...this.userUsage.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([key, attempts]) => ({
        userId,
        day: key.slice(userId.length + 1),
        attempts,
      }));
  }
  async deleteForUser(userId: UserId): Promise<void> {
    this.deletedUsers.add(userId);
    for (const k of this.userUsage.keys())
      if (k.startsWith(`${userId}:`)) this.userUsage.delete(k);
    for (const [k, r] of this.records)
      if (r.userId === userId) this.records.delete(k);
  }
  async invalidateForEntry(
    userId: UserId,
    sourceEntryId: string,
  ): Promise<void> {
    for (const [key, row] of this.records)
      if (row.userId === userId && row.sourceEntryId === sourceEntryId)
        this.records.delete(key);
  }
}
