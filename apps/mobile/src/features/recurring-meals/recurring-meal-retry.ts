import * as SecureStore from "expo-secure-store";
import {
  recurringMealCreateSchema,
  type RecurringMealCreate,
} from "@mizyun/contracts";
import { createOperationId } from "@/features/log-meal/public-data";
import { deviceTimeZone, EVERY_DAY } from "./recurring-meal-data";

interface RetryStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}
export interface PendingSchedule {
  payload: RecurringMealCreate;
  attempted: boolean;
}
const keyFor = (userId: string, sourceEntryId: string) =>
  `mizyun.recurring-meal-retry.${userId}.${sourceEntryId}`;
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  const pending = (queues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(action);
  queues.set(key, pending);
  const settled = () => {
    if (queues.get(key) === pending) queues.delete(key);
  };
  void pending.then(settled, settled);
  return pending;
}
function parsePending(raw: string, source: string): PendingSchedule {
  const pending = JSON.parse(raw) as PendingSchedule;
  const parsed = recurringMealCreateSchema.safeParse(pending.payload);
  if (
    !parsed.success ||
    parsed.data.sourceEntryId !== source ||
    typeof pending.attempted !== "boolean"
  )
    throw new Error("Cannot recover pending schedule safely");
  return { payload: parsed.data, attempted: pending.attempted };
}
// No nutrition or meal names are persisted. Preserve UUID and configuration
// across an ambiguous response, including concurrent screen preparations.
export function prepareSchedule(
  userId: string,
  sourceEntryId: string,
  store: RetryStore = SecureStore,
): Promise<PendingSchedule> {
  const key = keyFor(userId, sourceEntryId);
  return serialized(key, async () => {
    const raw = await store.getItemAsync(key);
    if (raw) return parsePending(raw, sourceEntryId);
    const draft: PendingSchedule = {
      payload: {
        id: createOperationId(),
        sourceEntryId,
        localTime: "08:00",
        timeZone: deviceTimeZone(),
        weekdays: [...EVERY_DAY],
      },
      attempted: false,
    };
    await store.setItemAsync(key, JSON.stringify(draft));
    return draft;
  });
}
export function persistScheduleAttempt(
  userId: string,
  payload: RecurringMealCreate,
  store: RetryStore = SecureStore,
): Promise<void> {
  const key = keyFor(userId, payload.sourceEntryId);
  return serialized(key, async () => {
    const raw = await store.getItemAsync(key);
    if (!raw) throw new Error("Schedule preparation expired");
    const existing = parsePending(raw, payload.sourceEntryId);
    const canonical = recurringMealCreateSchema.parse(payload);
    if (
      existing.payload.id !== canonical.id ||
      (existing.attempted &&
        JSON.stringify(existing.payload) !== JSON.stringify(canonical))
    )
      throw new Error("Another unresolved schedule attempt already exists");
    await store.setItemAsync(
      key,
      JSON.stringify({ payload: canonical, attempted: true }),
    );
  });
}
export function clearScheduleAttempt(
  userId: string,
  sourceEntryId: string,
  store: RetryStore = SecureStore,
  expectedId?: string,
): Promise<void> {
  const key = keyFor(userId, sourceEntryId);
  return serialized(key, async () => {
    const raw = await store.getItemAsync(key);
    if (
      raw &&
      expectedId &&
      parsePending(raw, sourceEntryId).payload.id !== expectedId
    )
      throw new Error("Schedule attempt changed");
    await store.deleteItemAsync(key);
  });
}
export function resetRejectedSchedule(
  userId: string,
  payload: RecurringMealCreate,
  store: RetryStore = SecureStore,
): Promise<PendingSchedule> {
  const key = keyFor(userId, payload.sourceEntryId);
  return serialized(key, async () => {
    const raw = await store.getItemAsync(key);
    if (
      raw &&
      parsePending(raw, payload.sourceEntryId).payload.id !== payload.id
    )
      throw new Error("Schedule attempt changed");
    const draft: PendingSchedule = {
      payload: { ...payload, id: createOperationId() },
      attempted: false,
    };
    await store.setItemAsync(key, JSON.stringify(draft));
    return draft;
  });
}
