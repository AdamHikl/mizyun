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
  readonly reasonCode: "three_consecutive_days" | "weekly_pattern";
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
// Rounded median, matching public.recurring_suggestion_validate and
// public.recurring_suggestion_validate_weekly. For an even count this is the
// LOWER median, sorted[floor((n - 1) / 2)] (SQL: minutes[(n + 1) / 2]); for the
// three-day chain it is the middle value. Copies are saved when the user taps
// Copy, so the spread only ranks chains; it never rejects one.
const chainTime = (
  minutes: readonly number[],
): { spread: number; rounded: number } => {
  const sorted = [...minutes].sort((a, b) => a - b);
  return {
    spread: sorted.at(-1)! - sorted[0]!,
    rounded:
      Math.floor((sorted[Math.floor((sorted.length - 1) / 2)]! + 7) / 15) * 15,
  };
};
/** Local days of history detection needs, including today (two of each weekday). */
export const recurringMealSuggestionWindowDays = 14;
const dailyPolicyVersion = "mrs-exact-3-v1";
const weeklyPolicyVersion = "mrs-weekly-2w-v1";
const searchBudget = 250_000;
const formatMinute = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/**
 * Pure, bounded observation. Complete history and authoritative generated IDs are required.
 *
 * Daily (`three_consecutive_days`, mrs-exact-3-v1): the exact identity on today and
 * the two previous local days. Weekly (`weekly_pattern`, mrs-weekly-2w-v1): within
 * the last 14 local days, W is the set of weekdays (0 = Sunday) on which the
 * identity occurs on BOTH occurrences; 2 <= |W| <= 6 and today's weekday must be
 * in W. Priority: a weekly proposal whose every weekday slot is cleanly on or off
 * (none seen exactly once) wins over daily; otherwise daily, else weekly. Either
 * way the source is today's fresh save.
 */
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
  // days[13] is today; days[i] and days[i + 7] share a weekday.
  const today = recurringMealLocalDateAt(input.referenceAt, input.timeZone),
    days = Array.from({ length: recurringMealSuggestionWindowDays }, (_, i) =>
      addDays(today, i - (recurringMealSuggestionWindowDays - 1)),
    ),
    todayIndex = days.length - 1;
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
      buckets = groups.get(identity) ?? days.map(() => []);
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
  const isFreshToday = (entry: RecurringMealSuggestionEntry): boolean => {
    const created = Date.parse(entry.createdAt);
    return (
      recurringMealLocalDateAt(new Date(created), input.timeZone) === today &&
      now - created <= 86400000
    );
  };
  // Same-minute duplicates cannot improve timing. Retain the freshest eligible
  // save today, and latest consumption on earlier dates, independent of input order.
  const compactBucket = (
    bucket: readonly RecurringMealSuggestionEntry[],
    isToday: boolean,
  ): RecurringMealSuggestionEntry[] => {
    const byMinute = new Map<number, RecurringMealSuggestionEntry>();
    for (const entry of bucket) {
      const created = Date.parse(entry.createdAt);
      if (isToday && !isFreshToday(entry)) continue;
      const minute = minutes.get(entry.id)!;
      const previous = byMinute.get(minute);
      const preferred =
        !previous ||
        (isToday && created > Date.parse(previous.createdAt)) ||
        ((!isToday || created === Date.parse(previous.createdAt)) &&
          (Date.parse(entry.consumedAt) > Date.parse(previous.consumedAt) ||
            (entry.consumedAt === previous.consumedAt &&
              entry.id < previous.id)));
      if (preferred) byMinute.set(minute, entry);
    }
    return [...byMinute.values()].sort(
      (a, b) => minutes.get(a.id)! - minutes.get(b.id)!,
    );
  };
  // Returns the family decision when an offer is allowed, or false when suppressed.
  const admissible = (
    familyKey: string,
  ): RecurringMealSuggestionDecision | undefined | false => {
    const decision = decisions.find((d) => d.familyKey === familyKey);
    if (
      decision?.never ||
      decision?.accepted ||
      (decision?.cooldownUntil && Date.parse(decision.cooldownUntil) > now) ||
      (decision?.expiresAt &&
        Date.parse(decision.expiresAt) <= now &&
        now < Date.parse(decision.expiresAt) + 30 * 86400000)
    )
      return false;
    if (offerCooldown && !decision?.firstShownAt) return false;
    return decision;
  };
  type Candidate = {
    proposal: RecurringMealSuggestionProposal;
    breadth: number;
    spread: number;
    freshness: number;
    chainLatest: number;
  };
  // Weekly only: more weekdays first. Daily candidates all have breadth 7.
  const rank = (a: Candidate, b: Candidate) =>
    b.breadth - a.breadth ||
    a.spread - b.spread ||
    b.freshness - a.freshness ||
    b.chainLatest - a.chainLatest ||
    a.proposal.candidateId.localeCompare(b.proposal.candidateId);
  const candidate = (
    policyVersion: string,
    reasonCode: RecurringMealSuggestionProposal["reasonCode"],
    identity: string,
    chain: readonly RecurringMealSuggestionEntry[],
    chainDays: readonly string[],
    decision: RecurringMealSuggestionDecision | undefined,
    timing: { spread: number; rounded: number },
    weekdays: readonly number[],
  ): Candidate => {
    const source = chain.at(-1)!,
      sourceCreated = Date.parse(source.createdAt);
    const evidence = chain.map((e, i) => ({
      id: e.id,
      updatedAt: e.updatedAt,
      localDate: chainDays[i]!,
    }));
    const evidenceDigest = recurringMealSuggestionDigest(
      JSON.stringify(evidence.map((e) => [e.id, e.updatedAt, e.localDate])),
    );
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
    return {
      breadth: weekdays.length,
      spread: timing.spread,
      freshness: sourceCreated,
      chainLatest: chain.reduce((sum, e) => sum + Date.parse(e.consumedAt), 0),
      proposal: {
        candidateId,
        familyKey: recurringMealSuggestionFamilyKey(source.name),
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
        reasonCode,
        localTime: formatMinute(timing.rounded),
        timeZone: input.timeZone,
        weekdays,
        startLocalDate: addDays(today, 1),
        expiresAt,
      },
    };
  };
  // Keep only the best result per kind, so the bounded search also has bounded memory.
  const best: {
    daily: Candidate | null;
    weekly: Candidate | null;
    cleanWeekly: Candidate | null;
  } = { daily: null, weekly: null, cleanWeekly: null };
  const consider = (kind: keyof typeof best, next: Candidate) => {
    const current = best[kind];
    if (!current || rank(next, current) < 0) best[kind] = next;
  };

  // Daily: today and the two previous local days.
  const dailyDays = days.slice(todayIndex - 2);
  for (const [identity, allBuckets] of groups) {
    const buckets = allBuckets.slice(todayIndex - 2);
    if (buckets.some((b) => b.length === 0)) continue;
    const compact = buckets.map((bucket, dayIndex) =>
      compactBucket(bucket, dayIndex === 2),
    );
    // Explicit resource ceiling after semantic compaction. Never prune history
    // arbitrarily to produce an apparently complete result.
    if (
      compact.reduce((count, bucket) => count * bucket.length, 1) > searchBudget
    )
      return null;
    for (const source of compact[2]!) {
      const decision = admissible(
        recurringMealSuggestionFamilyKey(source.name),
      );
      if (decision === false) continue;
      for (const a of compact[0]!)
        for (const b of compact[1]!) {
          const chain = [a, b, source],
            timing = chainTime(chain.map((e) => minutes.get(e.id)!));
          // A median rounded up to midnight is ambiguous for a daily schedule.
          if (timing.rounded >= 1440) continue;
          const localTime = formatMinute(timing.rounded);
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
          consider(
            "daily",
            candidate(
              input.policyVersion ?? dailyPolicyVersion,
              "three_consecutive_days",
              identity,
              chain,
              dailyDays,
              decision,
              timing,
              [0, 1, 2, 3, 4, 5, 6],
            ),
          );
        }
    }
  }

  // Weekly. Each weekday slot is "on" (both occurrences), "off" (neither) or
  // "mixed" (exactly one). A clean rhythm (no mixed slot) beats daily, so a
  // Mon–Fri habit is not offered as every day; otherwise daily keeps priority.
  let weeklyOverBudget = false;
  for (const [identity, buckets] of groups) {
    if (
      buckets[todayIndex]!.length === 0 ||
      buckets[todayIndex - 7]!.length === 0
    )
      continue;
    const compact = buckets.map((bucket, i) =>
      compactBucket(bucket, i === todayIndex),
    );
    // Weekday slots i (first week) and i + 7 (second week) both observed.
    const slots = [0, 1, 2, 3, 4, 5, 6].filter(
      (i) => compact[i]!.length > 0 && compact[i + 7]!.length > 0,
    );
    if (!slots.includes(todayIndex - 7) || slots.length < 2 || slots.length > 6)
      continue;
    const clean = [0, 1, 2, 3, 4, 5, 6].every(
      (i) => compact[i]!.length > 0 === compact[i + 7]!.length > 0,
    );
    const dateIndexes = slots.flatMap((i) => [i, i + 7]).sort((a, b) => a - b);
    const supporting = dateIndexes.filter((i) => i !== todayIndex);
    if (
      compact[todayIndex]!.length *
        supporting.reduce((count, i) => count + compact[i]!.length, 0) >
      searchBudget
    ) {
      weeklyOverBudget = true;
      break;
    }
    const weekdays = slots
      .map((i) => new Date(`${days[i]}T12:00:00Z`).getUTCDay())
      .sort((a, b) => a - b);
    if (
      (input.existingSchedules ?? []).some(
        (s) =>
          !s.stopped &&
          s.identityKey === identity &&
          s.timeZone === input.timeZone &&
          weekdays.every((day) => s.weekdays.includes(day)),
      )
    )
      continue;
    for (const source of compact[todayIndex]!) {
      const decision = admissible(
        recurringMealSuggestionFamilyKey(source.name),
      );
      if (decision === false) continue;
      const sourceMinute = minutes.get(source.id)!;
      // One entry per supporting date: the closest minute to today's save
      // (ties: the later minute). Deterministic regardless of input order.
      const chain = dateIndexes.map((i) => {
        if (i === todayIndex) return source;
        let chosen = compact[i]![0]!;
        for (const e of compact[i]!) {
          const distance = Math.abs(minutes.get(e.id)! - sourceMinute),
            chosenDistance = Math.abs(minutes.get(chosen.id)! - sourceMinute);
          if (distance <= chosenDistance) chosen = e;
        }
        return chosen;
      });
      const timing = chainTime(chain.map((e) => minutes.get(e.id)!));
      if (timing.rounded >= 1440) continue;
      consider(
        clean ? "cleanWeekly" : "weekly",
        candidate(
          weeklyPolicyVersion,
          "weekly_pattern",
          identity,
          chain,
          dateIndexes.map((i) => days[i]!),
          decision,
          timing,
          weekdays,
        ),
      );
    }
  }
  // An over-budget weekly search never invents a weekly result; it keeps the
  // pre-weekly behaviour (the daily proposal, if any) and otherwise fails closed.
  if (weeklyOverBudget) return best.daily?.proposal ?? null;
  return (best.cleanWeekly ?? best.daily ?? best.weekly)?.proposal ?? null;
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
