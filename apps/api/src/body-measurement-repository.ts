import type {
  BodyMeasurementRepository,
  StoredBodyMeasurement,
  UserId,
} from "@mizyun/core";

/**
 * In-memory implementation of the `BodyMeasurementRepository` port.
 *
 * Used by `apps/api` until the Supabase adapter lands. Behaviour:
 *   - `create` stores the measurement under the user's tenant
 *     partition.
 *   - `list` filters by tenant, inclusive bounds on `measuredAt`,
 *     newest-first, capped at `limit`.
 *   - `getById` is tenant-blind: it returns the measurement
 *     regardless of who owns it. The route is the owner of the
 *     cross-user access check (it must compare the returned
 *     `userId` to the authenticated principal before returning the
 *     body).
 *   - `delete` returns `true` when a row was removed, `false`
 *     when the id was unknown.
 *
 * The repository deliberately does not enforce RLS — the SQL
 * policies on `public.body_measurements` are the source of truth.
 * Tests that exercise isolation should use the e2e suite against a
 * real Supabase stack, not this in-memory implementation.
 */
export class InMemoryBodyMeasurementRepository implements BodyMeasurementRepository {
  readonly #byUser = new Map<UserId, StoredBodyMeasurement[]>();
  readonly #byId = new Map<string, StoredBodyMeasurement>();

  async create(
    userId: UserId,
    measurement: StoredBodyMeasurement,
  ): Promise<StoredBodyMeasurement> {
    if (measurement.userId !== userId) {
      throw new Error("body measurement create userId mismatch");
    }
    if (this.#byId.has(measurement.id)) {
      throw new Error(`body measurement id collision ${measurement.id}`);
    }
    const list = this.#byUser.get(userId) ?? [];
    this.#byUser.set(userId, [...list, measurement]);
    this.#byId.set(measurement.id, measurement);
    return measurement;
  }

  async list(
    userId: UserId,
    options: {
      readonly from: Date | null;
      readonly to: Date | null;
      readonly limit: number;
    },
  ): Promise<ReadonlyArray<StoredBodyMeasurement>> {
    const list = this.#byUser.get(userId) ?? [];
    const fromMs = options.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const toMs = options.to?.getTime() ?? Number.POSITIVE_INFINITY;
    const filtered = list.filter((entry) => {
      const ms = entry.measuredAt.getTime();
      return ms >= fromMs && ms <= toMs;
    });
    return [...filtered]
      .sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime())
      .slice(0, Math.max(0, options.limit));
  }

  async getById(id: string): Promise<StoredBodyMeasurement | null> {
    return this.#byId.get(id) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.#byId.get(id);
    if (existing === undefined) return false;
    const owner = existing.userId;
    const list = this.#byUser.get(owner) ?? [];
    this.#byUser.set(
      owner,
      list.filter((entry) => entry.id !== id),
    );
    this.#byId.delete(id);
    return true;
  }

  /** Test-only helper that pre-seeds a measurement for a user. */
  __seedForTest(measurement: StoredBodyMeasurement): void {
    const list = this.#byUser.get(measurement.userId) ?? [];
    this.#byUser.set(measurement.userId, [...list, measurement]);
    this.#byId.set(measurement.id, measurement);
  }
}
