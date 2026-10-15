import {
  recurringMealLocalDateAt,
  validateRecurringMealSchedule,
} from "./recurring-meal";

export interface RecurringMealSuggestionEntry {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly consumedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly confirmedByUser: boolean;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly deletedAt?: string | null;
}
export interface RecurringMealSuggestionProposal {
  readonly candidateId: string;
  readonly familyKey: string;
  readonly sourceEntryId: string;
  readonly sourceUpdatedAt: string;
  readonly evidence: readonly {
    readonly id: string;
    readonly updatedAt: string;
    readonly localDate: string;
  }[];
  readonly evidenceDigest: string;
  readonly name: string;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly grams: number | null;
  readonly policyVersion: string;
  readonly reasonCode: "three_consecutive_days";
  readonly localTime: string;
  readonly timeZone: string;
  readonly weekdays: readonly number[];
  readonly startLocalDate: string;
  readonly expiresAt: string;
}
export interface RecurringMealSuggestionDecision {
  readonly familyKey: string;
  readonly never?: boolean;
  readonly accepted?: boolean;
  readonly cooldownUntil?: string | null;
  readonly firstShownAt?: string | null;
  readonly expiresAt?: string | null;
}
export interface RecurringMealSuggestionExistingSchedule {
  readonly identityKey: string;
  readonly localTime: string;
  readonly timeZone: string;
  readonly weekdays: readonly number[];
  readonly stopped?: boolean;
}
export interface RecurringMealSuggestionInput {
  readonly userId: string;
  readonly entries: readonly RecurringMealSuggestionEntry[];
  readonly generatedEntryIds: ReadonlySet<string> | readonly string[];
  readonly historyComplete: boolean;
  readonly referenceAt: Date;
  readonly timeZone: string;
  readonly enabled?: boolean;
  readonly policyVersion?: string;
  readonly existingSchedules?: readonly RecurringMealSuggestionExistingSchedule[];
  readonly decisions?: readonly RecurringMealSuggestionDecision[];
}
export const recurringMealSuggestionFamilyKey = (name: string): string =>
  name
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const genericNames = new Set([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "meal",
  "food",
  "brunch",
  "supper",
  "raňajky",
  "obed",
  "večera",
  "desiata",
  "olovrant",
]);
const gramsOf = (entry: RecurringMealSuggestionEntry): number | null =>
  typeof entry.details.grams === "number" ? entry.details.grams : null;
export const recurringMealSuggestionIdentityKey = (
  entry: Pick<
    RecurringMealSuggestionEntry,
    "name" | "caloriesKcal" | "proteinG" | "carbohydrateG" | "fatG" | "details"
  >,
): string =>
  JSON.stringify([
    recurringMealSuggestionFamilyKey(entry.name),
    entry.caloriesKcal,
    entry.proteinG,
    entry.carbohydrateG,
    entry.fatG,
    typeof entry.details.grams === "number" ? entry.details.grams : null,
  ]);
/** Consistency digest only: never use this as an ownership or authorization token. */
export const recurringMealSuggestionDigest = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
};
const addDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
const minuteAt = (at: string, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  return (
    Number(parts.find((p) => p.type === "hour")!.value) * 60 +
    Number(parts.find((p) => p.type === "minute")!.value)
  );
};
// Linear median, matching public.recurring_suggestion_validate. Copies are saved
// when the user taps Copy, so the spread only ranks chains; it never rejects one.
const chainTime = (
  minutes: readonly number[],
): { spread: number; rounded: number } => {
  const sorted = [...minutes].sort((a, b) => a - b);
  return {
    spread: sorted.at(-1)! - sorted[0]!,
    rounded: Math.floor((sorted[1]! + 7) / 15) * 15,
  };
};

/** Pure, bounded observation. Complete history and authoritative generated IDs are required. */
export const detectRecurringMealSuggestion = (
  input: RecurringMealSuggestionInput,
): RecurringMealSuggestionProposal | null => {
  const now = input.referenceAt.getTime();
  if (
    !Number.isFinite(now) ||
    !input.historyComplete ||
    input.enabled === false ||
    !validateRecurringMealSchedule({
      localTime: "12:00",
      timeZone: input.timeZone,
      weekdays: [0],
    })
  )
    return null;
  const today = recurringMealLocalDateAt(input.referenceAt, input.timeZone),
    days = [addDays(today, -2), addDays(today, -1), today];
  const generated = new Set(input.generatedEntryIds);
  const minutes = new Map<string, number>();
  const groups = new Map<string, RecurringMealSuggestionEntry[][]>();
  for (const entry of input.entries) {
    const consumed = Date.parse(entry.consumedAt),
      created = Date.parse(entry.createdAt),
      updated = Date.parse(entry.updatedAt);
    const family = recurringMealSuggestionFamilyKey(entry.name);
    if (
      entry.userId !== input.userId ||
      !entry.confirmedByUser ||
      entry.deletedAt ||
      generated.has(entry.id) ||
      entry.details.recurringMeal != null ||
      !family ||
      genericNames.has(family.toLowerCase()) ||
      family.length > 200 ||
      entry.name.length > 200 ||
      !Number.isFinite(consumed) ||
      consumed > now ||
      !Number.isFinite(created) ||
      created > now ||
      !Number.isFinite(updated) ||
      updated > now
    )
      continue;
    if (
      [
        entry.caloriesKcal,
        entry.proteinG,
        entry.carbohydrateG,
        entry.fatG,
        gramsOf(entry),
      ].some((v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 20_000))
    )
      continue;
    const day = recurringMealLocalDateAt(new Date(consumed), input.timeZone),
      index = days.indexOf(day);
    if (index < 0) continue;
    minutes.set(entry.id, minuteAt(entry.consumedAt, input.timeZone));
    const identity = recurringMealSuggestionIdentityKey(entry),
      buckets = groups.get(identity) ?? [[], [], []];
    buckets[index]!.push(entry);
    groups.set(identity, buckets);
  }
  const decisions = input.decisions ?? [];
  const offerCooldown = decisions.some(
    (d) =>
      d.firstShownAt &&
      now - Date.parse(d.firstShownAt) < 7 * 86400000 &&
      recurringMealLocalDateAt(new Date(d.firstShownAt), input.timeZone) <=
        today,
  );
  const candidates: {
    proposal: RecurringMealSuggestionProposal;
    spread: number;
    freshness: number;
    chainLatest: number;
  }[] = [];
  for (const [identity, buckets] of groups) {
    if (buckets.some((b) => b.length === 0)) continue;
    // Same-minute duplicates cannot improve timing. Retain the freshest eligible
    // save today, and latest consumption on earlier dates, independent of input order.
    const compact = buckets.map((bucket, dayIndex) => {
      const byMinute = new Map<number, RecurringMealSuggestionEntry>();
      for (const entry of bucket) {
        const created = Date.parse(entry.createdAt);
        if (
          dayIndex === 2 &&
          (recurringMealLocalDateAt(new Date(created), input.timeZone) !==
            today ||
            now - created > 86400000)
        )
          continue;
        const minute = minutes.get(entry.id)!;
        const previous = byMinute.get(minute);
        const preferred =
          !previous ||
          (dayIndex === 2 && created > Date.parse(previous.createdAt)) ||
          ((dayIndex !== 2 || created === Date.parse(previous.createdAt)) &&
            (Date.parse(entry.consumedAt) > Date.parse(previous.consumedAt) ||
              (entry.consumedAt === previous.consumedAt &&
                entry.id < previous.id)));
        if (preferred) byMinute.set(minute, entry);
      }
      return [...byMinute.values()].sort(
        (a, b) => minutes.get(a.id)! - minutes.get(b.id)!,
      );
    });
    // Explicit resource ceiling after semantic compaction. Never prune history
    // arbitrarily to produce an apparently complete result.
    if (compact.reduce((count, bucket) => count * bucket.length, 1) > 250_000)
      return null;
    for (const source of compact[2]!) {
      const sourceCreated = Date.parse(source.createdAt),
        familyKey = recurringMealSuggestionFamilyKey(source.name);
      if (
        recurringMealLocalDateAt(new Date(sourceCreated), input.timeZone) !==
          today ||
        now - sourceCreated > 86400000
      )
        continue;
      const decision = decisions.find((d) => d.familyKey === familyKey);
      if (
        decision?.never ||
        decision?.accepted ||
        (decision?.cooldownUntil && Date.parse(decision.cooldownUntil) > now) ||
        (decision?.expiresAt &&
          Date.parse(decision.expiresAt) <= now &&
          now < Date.parse(decision.expiresAt) + 30 * 86400000)
      )
        continue;
      if (offerCooldown && !decision?.firstShownAt) continue;
      for (const a of compact[0]!)
        for (const b of compact[1]!) {
          const chain = [a, b, source],
            timing = chainTime(chain.map((e) => minutes.get(e.id)!));
          // A median rounded up to midnight is ambiguous for a daily schedule.
          if (timing.rounded >= 1440) continue;
          const localTime = `${String(Math.floor(timing.rounded / 60)).padStart(2, "0")}:${String(timing.rounded % 60).padStart(2, "0")}`;
          if (
            (input.existingSchedules ?? []).some(
              (s) =>
                !s.stopped &&
                s.identityKey === identity &&
                s.timeZone === input.timeZone &&
                s.localTime === localTime &&
                s.weekdays.length === 7 &&
                new Set(s.weekdays).size === 7,
            )
          )
            continue;
          const evidence = chain.map((e, i) => ({
            id: e.id,
            updatedAt: e.updatedAt,
            localDate: days[i]!,
          }));
          const evidenceDigest = recurringMealSuggestionDigest(
              JSON.stringify(
                evidence.map((e) => [e.id, e.updatedAt, e.localDate]),
              ),
            ),
            policyVersion = input.policyVersion ?? "mrs-exact-3-v1";
          const candidateId = `mrs1-${recurringMealSuggestionDigest(JSON.stringify([policyVersion, input.timeZone, identity, evidence.map((e) => [e.id, e.updatedAt, e.localDate])]))}`;
          const activeExpiry =
            decision?.expiresAt && Date.parse(decision.expiresAt) > now
              ? decision.expiresAt
              : undefined;
          const expiresAt =
            activeExpiry ??
            new Date(
              (decision?.firstShownAt && activeExpiry
                ? Date.parse(decision.firstShownAt)
                : sourceCreated) +
                7 * 86400000,
            ).toISOString();
          candidates.push({
            spread: timing.spread,
            freshness: sourceCreated,
            chainLatest: chain.reduce(
              (sum, e) => sum + Date.parse(e.consumedAt),
              0,
            ),
            proposal: {
              candidateId,
              familyKey,
              sourceEntryId: source.id,
              sourceUpdatedAt: source.updatedAt,
              evidence,
              evidenceDigest,
              name: source.name,
              caloriesKcal: source.caloriesKcal,
              proteinG: source.proteinG,
              carbohydrateG: source.carbohydrateG,
              fatG: source.fatG,
              grams: gramsOf(source),
              policyVersion,
              reasonCode: "three_consecutive_days",
              localTime,
              timeZone: input.timeZone,
              weekdays: [0, 1, 2, 3, 4, 5, 6],
              startLocalDate: addDays(today, 1),
              expiresAt,
            },
          });
          // Keep only the best result, so the bounded search also has bounded memory.
          candidates.sort(
            (a, b) =>
              a.spread - b.spread ||
              b.freshness - a.freshness ||
              b.chainLatest - a.chainLatest ||
              a.proposal.candidateId.localeCompare(b.proposal.candidateId),
          );
          candidates.splice(1);
        }
    }
  }
  candidates.sort(
    (a, b) =>
      a.spread - b.spread ||
      b.freshness - a.freshness ||
      b.chainLatest - a.chainLatest ||
      a.proposal.candidateId.localeCompare(b.proposal.candidateId),
  );
  return candidates[0]?.proposal ?? null;
};

export class RecurringMealSuggestionRepositoryError extends Error {
  constructor(
    readonly kind: "invalid" | "conflict" | "not_found" | "unavailable",
  ) {
    super(`Recurring meal suggestion ${kind}`);
    this.name = "RecurringMealSuggestionRepositoryError";
  }
}
type SuggestionOwner = import("./index").UserId;
type SuggestionAccess = { readonly accessToken: string };
export interface RecurringMealSuggestionRepository {
  getForUser(
    userId: SuggestionOwner,
    input: { readonly timeZone: string },
    options: SuggestionAccess,
  ): Promise<{
    readonly suggestion: RecurringMealSuggestionProposal | null;
    readonly enabled: boolean;
  }>;
  decide(
    userId: SuggestionOwner,
    input: {
      readonly proposal: RecurringMealSuggestionProposal;
      readonly decision: "shown" | "not_now" | "never";
    },
    options: SuggestionAccess,
  ): Promise<void>;
  accept(
    userId: SuggestionOwner,
    input: {
      readonly operationId: string;
      readonly proposal: RecurringMealSuggestionProposal;
      readonly localTime: string;
      readonly timeZone: string;
      readonly weekdays: readonly number[];
    },
    options: SuggestionAccess,
  ): Promise<{
    readonly recurringMeal: import("./recurring-meal").StoredRecurringMeal;
    readonly created: boolean;
    readonly startLocalDate: string;
  }>;
  getPreferences(
    userId: SuggestionOwner,
    options: SuggestionAccess,
  ): Promise<{ readonly enabled: boolean }>;
  setPreferences(
    userId: SuggestionOwner,
    input: { readonly enabled: boolean },
    options: SuggestionAccess,
  ): Promise<{ readonly enabled: boolean }>;
  resetDecisions(
    userId: SuggestionOwner,
    options: SuggestionAccess,
  ): Promise<void>;
  exportForUser(
    userId: SuggestionOwner,
    options: SuggestionAccess,
  ): Promise<{
    readonly states: readonly Record<string, unknown>[];
    readonly preferences: readonly Record<string, unknown>[];
    readonly receipts: readonly Record<string, unknown>[];
  }>;
  clearForUser(
    userId: SuggestionOwner,
    options: SuggestionAccess,
  ): Promise<void>;
}
