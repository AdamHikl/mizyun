import type { StringStorage } from "@mizyun/adapter-supabase-mobile";
import { createDefaultOfflineCacheStorage } from "./offline-cache-storage";

export type PersonalReadRecord = {
  readonly path: string;
  readonly value: unknown;
  readonly savedAt: number;
  /**
   * Kept across a write whose outcome is unknown: display-only, never fresh,
   * so the next read always revalidates it.
   */
  readonly stale?: true;
};

/** Display snapshots only; callers must validate values with their response schema. */
export interface PersonalReadStorage {
  /** Capture before scheduling work; a later purge retires that scheduled work. */
  generation?(userId: string): number;
  load(userId: string): Promise<ReadonlyArray<PersonalReadRecord>>;
  /**
   * Like load, but rejects when the device store cannot be read, so a
   * rewrite before a write never mistakes a read failure for "nothing saved".
   * Malformed or expired data still loads as no records.
   */
  loadStrict?(userId: string): Promise<ReadonlyArray<PersonalReadRecord>>;
  save(
    userId: string,
    records: ReadonlyArray<PersonalReadRecord>,
  ): Promise<void>;
  /**
   * Replaces the saved records before a write. Unlike save, failures reject,
   * so a write never proceeds while a record it changes is still saved as
   * fresh.
   */
  replace?(
    userId: string,
    records: ReadonlyArray<PersonalReadRecord>,
  ): Promise<void>;
  /** Cleanup failures reject so account cleanup cannot report false success. */
  purge(userId: string): Promise<void>;
}

export const PERSONAL_READ_MAX_AGE_MS = 48 * 60 * 60_000;
export const PERSONAL_READ_MAX_RECORDS = 512;
export const PERSONAL_READ_MAX_BYTES = 1_000_000;

const queryKeys: Readonly<Record<string, ReadonlyArray<string>>> = {
  "/v1/profile": [],
  "/v1/goals/active": [],
  "/v1/energy/summary": ["utcOffsetMinutes"],
  "/v1/exercises": ["limit", "cursor"],
  "/v1/body-measurements": ["limit", "cursor", "from", "to"],
  "/v1/food-entries": [
    "limit",
    "cursor",
    "from",
    "to",
    "utcOffsetMinutes",
    "search",
  ],
  "/v1/food-entries/summary": ["date", "from", "to", "utcOffsetMinutes"],
  "/v1/workouts": ["limit", "cursor", "from", "to", "kind"],
  "/v1/runs": ["limit", "cursor", "from", "to", "include"],
  "/v1/coach/conversations": ["limit", "cursor"],
};

/** Reject URL/traversal forms and unknown query controls before touching disk. */
export function isPersonalDisplayPath(path: string): boolean {
  if (path.length > 4096 || /[\s\\#\u0000-\u001f\u007f]/.test(path))
    return false;
  const [pathname, query, extra] = path.split("?");
  if (!pathname || extra !== undefined) return false;
  let allowed = Object.prototype.hasOwnProperty.call(queryKeys, pathname)
    ? queryKeys[pathname]
    : undefined;
  if (
    /^\/v1\/runs\/[A-Za-z0-9_-]+$/.test(pathname) ||
    /^\/v1\/workouts\/[A-Za-z0-9_-]+\/sets$/.test(pathname) ||
    /^\/v1\/coach\/conversations\/[A-Za-z0-9_-]+$/.test(pathname)
  )
    allowed = [];
  if (!allowed) return false;
  if (query === undefined) return true;
  if (!query) return false;
  const seen = new Set<string>();
  try {
    return query.split("&").every((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return false;
      const key = part.slice(0, separator);
      const value = decodeURIComponent(
        part.slice(separator + 1).replace(/\+/g, " "),
      );
      if (
        !allowed.includes(key) ||
        seen.has(key) ||
        /[\u0000-\u001f\u007f]/.test(value)
      )
        return false;
      seen.add(key);
      return true;
    });
  } catch {
    return false;
  }
}

export const personalReadCacheKey = (userId: string): string =>
  `mizyun.offline-cache.personal-reads.${userId}`;

const validOwner = (userId: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(userId);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const utf8Bytes = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
};
const validRecord = (
  value: unknown,
  now: number,
): value is PersonalReadRecord =>
  object(value) &&
  (Object.keys(value).length === 3 ||
    (Object.keys(value).length === 4 && value.stale === true)) &&
  Object.prototype.hasOwnProperty.call(value, "value") &&
  typeof value.path === "string" &&
  isPersonalDisplayPath(value.path) &&
  typeof value.savedAt === "number" &&
  Number.isSafeInteger(value.savedAt) &&
  value.savedAt >= 0 &&
  value.savedAt <= now &&
  now - value.savedAt <= PERSONAL_READ_MAX_AGE_MS;

type Lane = { generation: number; tail: Promise<unknown> };
// Shared across factories: cleanup and the cache adapter can use distinct wrappers.
const lanes = new Map<string, Lane>();
// Retain the cleanup revision after the operation lane drains. A delayed timer
// must still see its captured generation retired after purge has completed.
const generations = new Map<string, number>();
const laneFor = (userId: string): Lane => {
  let lane = lanes.get(userId);
  if (!lane) {
    lane = {
      generation: generations.get(userId) ?? 0,
      tail: Promise.resolve(),
    };
    lanes.set(userId, lane);
  }
  return lane;
};
function enqueue<T>(
  userId: string,
  lane: Lane,
  operation: () => Promise<T>,
): Promise<T> {
  const current = lane.tail.catch(() => undefined).then(operation);
  lane.tail = current;
  void current
    .finally(() => {
      if (lane.tail === current && lanes.get(userId) === lane)
        lanes.delete(userId);
    })
    .catch(() => undefined);
  return current;
}

/** Shares the write fence with all adapter instances, including account cleanup. */
export function purgePersonalReads(
  userId: string,
  store: StringStorage = createDefaultOfflineCacheStorage(),
): Promise<void> {
  if (!validOwner(userId))
    return Promise.reject(new Error("Invalid personal cache owner"));
  const lane = laneFor(userId);
  lane.generation++;
  generations.set(userId, lane.generation);
  return enqueue(userId, lane, () =>
    store.removeItem(personalReadCacheKey(userId)),
  );
}

function serialize(
  userId: string,
  records: ReadonlyArray<PersonalReadRecord>,
  now: number,
): string {
  const candidates = new Map<string, PersonalReadRecord>();
  for (const record of records) {
    if (!validRecord(record, now)) continue;
    const previous = candidates.get(record.path);
    if (!previous || record.savedAt >= previous.savedAt)
      candidates.set(record.path, record);
  }
  const envelope = {
    version: 1,
    ownerId: userId,
    records: [] as PersonalReadRecord[],
  };
  let remaining = PERSONAL_READ_MAX_BYTES - utf8Bytes(JSON.stringify(envelope));
  for (const record of [...candidates.values()].sort(
    (a, b) => b.savedAt - a.savedAt,
  )) {
    if (envelope.records.length >= PERSONAL_READ_MAX_RECORDS) break;
    try {
      const json = JSON.stringify(record);
      // Reject values which JSON silently drops, and detach from subsequent mutation.
      const detached: unknown = JSON.parse(json);
      if (!validRecord(detached, now)) continue;
      const bytes = utf8Bytes(json) + (envelope.records.length ? 1 : 0);
      if (bytes > remaining) continue;
      envelope.records.push(detached);
      remaining -= bytes;
    } catch {
      // A non-JSON response cannot become a usable display snapshot.
    }
  }
  return JSON.stringify(envelope);
}

/** Reads/writes are best effort; deletion is an explicit, awaitable cleanup gate. */
export function createPersonalReadStorage(
  store: StringStorage = createDefaultOfflineCacheStorage(),
  now: () => number = Date.now,
): PersonalReadStorage {
  // Rejects only when the store itself fails; bad data loads as no records.
  const read = (userId: string): Promise<ReadonlyArray<PersonalReadRecord>> => {
    if (!validOwner(userId)) return Promise.resolve([]);
    const lane = laneFor(userId);
    const generation = lane.generation;
    return enqueue(userId, lane, async () => {
      if (generation !== lane.generation) return [];
      const json = await store.getItem(personalReadCacheKey(userId));
      try {
        if (
          generation !== lane.generation ||
          !json ||
          utf8Bytes(json) > PERSONAL_READ_MAX_BYTES
        )
          return [];
        const envelope: unknown = JSON.parse(json);
        if (
          !object(envelope) ||
          Object.keys(envelope).length !== 3 ||
          envelope.version !== 1 ||
          envelope.ownerId !== userId ||
          !Array.isArray(envelope.records) ||
          envelope.records.length > PERSONAL_READ_MAX_RECORDS
        )
          return [];
        const time = now();
        if (!Number.isSafeInteger(time) || time < 0) return [];
        return envelope.records.filter((record): record is PersonalReadRecord =>
          validRecord(record, time),
        );
      } catch {
        return [];
      }
    });
  };
  return {
    generation(userId) {
      return generations.get(userId) ?? 0;
    },
    load(userId) {
      return read(userId).catch(() => []);
    },
    loadStrict(userId) {
      return read(userId);
    },
    save(userId, records) {
      if (!validOwner(userId)) return Promise.resolve();
      const lane = laneFor(userId);
      const generation = lane.generation;
      let json: string;
      try {
        const time = now();
        if (!Number.isSafeInteger(time) || time < 0) return Promise.resolve();
        json = serialize(userId, records, time);
      } catch {
        return Promise.resolve();
      }
      return enqueue(userId, lane, async () => {
        if (generation !== lane.generation) return;
        try {
          await store.setItem(personalReadCacheKey(userId), json);
        } catch {
          // Cache persistence must not turn a successful live read into a failure.
        }
      });
    },
    replace(userId, records) {
      if (!validOwner(userId))
        return Promise.reject(new Error("Invalid personal cache owner"));
      const lane = laneFor(userId);
      const generation = lane.generation;
      let json: string;
      try {
        const time = now();
        if (!Number.isSafeInteger(time) || time < 0)
          throw new Error("Invalid clock");
        json = serialize(userId, records, time);
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(userId, lane, async () => {
        // Cleanup since then already removed every record.
        if (generation !== lane.generation) return;
        await store.setItem(personalReadCacheKey(userId), json);
      });
    },
    purge(userId) {
      return purgePersonalReads(userId, store);
    },
  };
}
