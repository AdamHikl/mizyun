import {
  captureHealthExportOwner,
  exportSavedNutrition,
  deleteHealthExport,
} from "@/features/health-exports";
import {
  dailyFoodSummaryResponseSchema,
  foodEntryCreateSchema,
  foodEntryListResponseSchema,
  foodEntryPatchSchema,
  foodEntryResponseSchema,
  type DailyFoodSummary,
  type FoodEntry,
  type FoodEntryCreate,
  type FoodEntryListResponse,
  type FoodEntryPatch,
  type FoodEntryResponse,
} from "@mizyun/contracts";
import type { ApiClient, ApiError } from "@mizyun/api-client";

import { apiClient } from "@/composition/api-client";

import type { LogMealForm, LogMealResult } from "./log-meal-data";
import { createOperationId, parseMealDate } from "./meal-form";
import { getEntryMealGroup, withMealGroup } from "./meal-scale";

export interface FoodDayResult {
  readonly entries: ReadonlyArray<FoodEntry>;
  readonly summary: DailyFoodSummary | null;
  readonly message: string | null;
}

export interface DayGroupSummary {
  readonly entryCount: number;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
}

export interface DayMealCluster {
  readonly kind: "group";
  readonly id: string;
  readonly name: string;
  readonly summary: DayGroupSummary;
  readonly entries: ReadonlyArray<FoodEntry>;
}

export interface DayStandaloneMeal {
  readonly kind: "standalone";
  readonly entry: FoodEntry;
}

export type DayMealItem = DayMealCluster | DayStandaloneMeal;

export interface FoodDayGroup {
  readonly date: string;
  readonly displayDate: string;
  readonly summary: DayGroupSummary;
  readonly entries: ReadonlyArray<FoodEntry>;
  readonly isPartial?: boolean;
}

export interface FoodHistoryResult {
  readonly groups: ReadonlyArray<FoodDayGroup>;
  readonly entries: ReadonlyArray<FoodEntry>;
  readonly message: string | null;
  readonly nextCursor?: string | null;
  readonly cutoffDateIsPartial?: boolean;
}

export type FoodEntryLoadResult =
  | { readonly ok: true; readonly entry: FoodEntry }
  | { readonly ok: false; readonly message: string };

export type FoodMutationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export const isoLocalDate = (now: Date): string => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const entryLocalDate = (entry: FoodEntry): string =>
  isoLocalDate(new Date(entry.consumedAt));

export const formatDisplayDate = (
  dateStr: string,
  today: Date = new Date(),
): string => {
  const todayIso = isoLocalDate(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = isoLocalDate(yesterday);

  const parts = dateStr.split("-").map((p) => Number.parseInt(p, 10));
  const [year, month, day] = parts as [number, number, number];
  const dateObj = new Date(year, month - 1, day, 12, 0, 0);
  const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const isCurrentYear = year === today.getFullYear();

  if (dateStr === todayIso) {
    return `Today · ${weekday}, ${monthDay}`;
  }
  if (dateStr === yesterdayIso) {
    return `Yesterday · ${weekday}, ${monthDay}`;
  }
  if (isCurrentYear) {
    return `${weekday}, ${monthDay}`;
  }
  return `${weekday}, ${monthDay}, ${year}`;
};

export const mergeFoodEntries = (
  existingEntries: ReadonlyArray<FoodEntry>,
  incomingEntries: ReadonlyArray<FoodEntry>,
): ReadonlyArray<FoodEntry> => {
  const map = new Map<string, FoodEntry>();
  for (const entry of existingEntries) {
    map.set(entry.id, entry);
  }
  for (const entry of incomingEntries) {
    map.set(entry.id, entry);
  }
  return Array.from(map.values()).sort((a, b) => {
    const timeDiff =
      new Date(b.consumedAt).getTime() - new Date(a.consumedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.id.localeCompare(a.id);
  });
};

export const groupFoodEntriesByDay = (
  entries: ReadonlyArray<FoodEntry>,
  now: Date = new Date(),
  options?: { readonly cutoffDateIsPartial?: boolean },
): ReadonlyArray<FoodDayGroup> => {
  const groupsMap = new Map<string, FoodEntry[]>();

  for (const entry of entries) {
    const d = entryLocalDate(entry);
    const list = groupsMap.get(d);
    if (list === undefined) {
      groupsMap.set(d, [entry]);
    } else {
      list.push(entry);
    }
  }

  const sortedDates = Array.from(groupsMap.keys()).sort((a, b) =>
    b.localeCompare(a),
  );

  return sortedDates.map((dateStr, index) => {
    const dayEntries = groupsMap.get(dateStr) ?? [];
    dayEntries.sort(
      (a, b) =>
        new Date(b.consumedAt).getTime() - new Date(a.consumedAt).getTime(),
    );

    const summary = summarizeFoodEntries(dayEntries);
    const isOldestDate = index === sortedDates.length - 1;
    const isPartial = Boolean(isOldestDate && options?.cutoffDateIsPartial);

    return {
      date: dateStr,
      displayDate: formatDisplayDate(dateStr, now),
      summary,
      entries: dayEntries,
      isPartial,
    };
  });
};

export const summarizeFoodEntries = (
  entries: ReadonlyArray<FoodEntry>,
): DayGroupSummary => {
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;

  let hasAnyCalories = false;
  let hasAnyProtein = false;
  let hasAnyCarbs = false;
  let hasAnyFat = false;

  for (const entry of entries) {
    if (entry.caloriesKcal !== null) {
      hasAnyCalories = true;
      calories += entry.caloriesKcal;
    }
    if (entry.proteinG !== null) {
      hasAnyProtein = true;
      protein += entry.proteinG;
    }
    if (entry.carbohydrateG !== null) {
      hasAnyCarbs = true;
      carbs += entry.carbohydrateG;
    }
    if (entry.fatG !== null) {
      hasAnyFat = true;
      fat += entry.fatG;
    }
  }

  return {
    entryCount: entries.length,
    caloriesKcal: hasAnyCalories ? Math.round(calories) : null,
    proteinG: hasAnyProtein ? Math.round(protein * 10) / 10 : null,
    carbohydrateG: hasAnyCarbs ? Math.round(carbs * 10) / 10 : null,
    fatG: hasAnyFat ? Math.round(fat * 10) / 10 : null,
  };
};

/**
 * Organizes a day's flat food entries into grouped meals (clusters) and standalone items.
 * Entries belonging to the same mealGroupId are aggregated into a DayMealCluster,
 * with child items preserved and editable.
 */
export const clusterDayEntries = (
  entries: ReadonlyArray<FoodEntry>,
): ReadonlyArray<DayMealItem> => {
  const result: DayMealItem[] = [];
  const groupIndices = new Map<string, number>();

  for (const entry of entries) {
    const group = getEntryMealGroup(entry);
    if (group === null) {
      result.push({ kind: "standalone", entry });
    } else {
      const existingIdx = groupIndices.get(group.id);
      if (existingIdx !== undefined) {
        const cluster = result[existingIdx] as DayMealCluster;
        const updatedEntries = [...cluster.entries, entry];
        result[existingIdx] = {
          kind: "group",
          id: group.id,
          name: cluster.name,
          summary: summarizeFoodEntries(updatedEntries),
          entries: updatedEntries,
        };
      } else {
        const clusterEntries = [entry];
        groupIndices.set(group.id, result.length);
        result.push({
          kind: "group",
          id: group.id,
          name: group.name,
          summary: summarizeFoodEntries(clusterEntries),
          entries: clusterEntries,
        });
      }
    }
  }

  return result;
};

const humanizeApiError = (error: ApiError, action: string): string => {
  switch (error.kind) {
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "network_error":
      return `Network unavailable. ${action} when you're online.`;
    case "http_error":
      if (error.status === 404) return "That meal no longer exists.";
      if (error.status === 422) return "Please double-check the values.";
      return `The server could not ${action.toLowerCase()}. Try again.`;
    case "validation_error":
    case "parse_error":
      return "The server returned an unexpected meal record.";
    case "not_configured":
      return "The API isn't configured yet.";
    case "no_session":
      return "You're signed out. Sign in and try again.";
  }
};

export interface FetchFoodHistoryOptions {
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: string | null;
  readonly search?: string | null;
  readonly limit?: number;
}

export const fetchFoodHistory = async (
  options: FetchFoodHistoryOptions = {},
): Promise<FoodHistoryResult> =>
  fetchFoodHistoryWith(
    apiClient,
    -new Date().getTimezoneOffset(),
    new Date(),
    options,
  );

export const fetchFoodHistoryWith = async (
  client: ApiClient,
  utcOffsetMinutes = 0,
  now: Date = new Date(),
  options: FetchFoodHistoryOptions = {},
): Promise<FoodHistoryResult> => {
  const queryParts: string[] = [
    `limit=${encodeURIComponent(options.limit ?? 200)}`,
  ];
  if (options.from) queryParts.push(`from=${encodeURIComponent(options.from)}`);
  if (options.to) queryParts.push(`to=${encodeURIComponent(options.to)}`);
  if (utcOffsetMinutes !== 0) {
    queryParts.push(`utcOffsetMinutes=${encodeURIComponent(utcOffsetMinutes)}`);
  }
  if (options.cursor) {
    queryParts.push(`cursor=${encodeURIComponent(options.cursor)}`);
  }
  if (options.search && options.search.trim().length > 0) {
    queryParts.push(`search=${encodeURIComponent(options.search.trim())}`);
  }

  const result = await client.request<FoodEntryListResponse>({
    method: "GET",
    path: `/v1/food-entries?${queryParts.join("&")}`,
    schema: foodEntryListResponseSchema,
  });

  if (!result.ok) {
    return {
      groups: [],
      entries: [],
      nextCursor: null,
      cutoffDateIsPartial: false,
      message: humanizeApiError(result.error, "Refresh your meals"),
    };
  }

  const entries = result.value.foodEntries;
  const nextCursor = result.value.nextCursor ?? null;
  const cutoffDateIsPartial = result.value.cutoffDateIsPartial ?? false;
  const groups = groupFoodEntriesByDay(entries, now, {
    cutoffDateIsPartial: nextCursor !== null && cutoffDateIsPartial,
  });
  return {
    groups,
    entries,
    nextCursor,
    cutoffDateIsPartial,
    message: null,
  };
};

/** Refresh one selected historical day, including pages beyond 200 rows. */
export const fetchFoodDateHistory = (
  date: string,
): Promise<FoodHistoryResult> => fetchFoodDateHistoryWith(apiClient, date);

export const fetchFoodDateHistoryWith = async (
  client: ApiClient,
  date: string,
  now: Date = new Date(),
): Promise<FoodHistoryResult> => {
  const failed = (message: string): FoodHistoryResult => ({
    groups: [],
    entries: [],
    nextCursor: null,
    cutoffDateIsPartial: false,
    message,
  });
  if (!parseMealDate(date)) return failed("Choose a valid meal day.");
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  // Query a UTC-day superset then filter exact local midnight bounds. This
  // handles 23/25-hour DST days without assuming one fixed offset all day.
  const from = start.toISOString().slice(0, 10);
  const to = new Date(end.getTime() - 1).toISOString().slice(0, 10);
  let entries: ReadonlyArray<FoodEntry> = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await fetchFoodHistoryWith(client, 0, now, {
      from,
      to,
      cursor,
    });
    if (page.message) return failed(page.message);
    entries = mergeFoodEntries(
      entries,
      page.entries.filter((entry) => {
        const instant = Date.parse(entry.consumedAt);
        return instant >= start.getTime() && instant < end.getTime();
      }),
    );
    cursor = page.nextCursor ?? null;
    if (cursor && seen.has(cursor))
      return failed("Could not refresh that day. Try again.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return {
    groups: groupFoodEntriesByDay(entries, now),
    entries,
    nextCursor: null,
    cutoffDateIsPartial: false,
    message: null,
  };
};

export const fetchFoodDay = async (date: string): Promise<FoodDayResult> =>
  fetchFoodDayWith(apiClient, date, -new Date().getTimezoneOffset());

export const fetchFoodDayWith = async (
  client: ApiClient,
  date: string,
  utcOffsetMinutes = 0,
): Promise<FoodDayResult> => {
  const encodedDate = encodeURIComponent(date);
  const encodedOffset = encodeURIComponent(utcOffsetMinutes);
  const [entriesResult, summaryResult] = await Promise.all([
    client.request<FoodEntryListResponse>({
      method: "GET",
      path: `/v1/food-entries?from=${encodedDate}&to=${encodedDate}&utcOffsetMinutes=${encodedOffset}&limit=200`,
      schema: foodEntryListResponseSchema,
    }),
    client.request<{ summary: DailyFoodSummary }>({
      method: "GET",
      path: `/v1/food-entries/summary?date=${encodedDate}&utcOffsetMinutes=${encodedOffset}`,
      schema: dailyFoodSummaryResponseSchema,
    }),
  ]);

  const firstError = !entriesResult.ok
    ? entriesResult.error
    : !summaryResult.ok
      ? summaryResult.error
      : null;
  return {
    entries: entriesResult.ok ? entriesResult.value.foodEntries : [],
    summary: summaryResult.ok ? summaryResult.value.summary : null,
    message:
      firstError === null
        ? null
        : humanizeApiError(firstError, "Refresh your meals"),
  };
};

export const fetchFoodEntry = async (
  entryId: string,
): Promise<FoodEntryLoadResult> => fetchFoodEntryWith(apiClient, entryId);

export const fetchFoodEntryWith = async (
  client: ApiClient,
  entryId: string,
): Promise<FoodEntryLoadResult> => {
  const result = await client.request<FoodEntryResponse>({
    method: "GET",
    path: `/v1/food-entries/${encodeURIComponent(entryId)}`,
    schema: foodEntryResponseSchema,
  });
  return result.ok
    ? { ok: true, entry: result.value.foodEntry }
    : {
        ok: false,
        message: humanizeApiError(result.error, "Load that meal"),
      };
};

export const patchFromForm = (form: LogMealForm): FoodEntryPatch | null => {
  const parsed = foodEntryPatchSchema.safeParse({
    name: form.name.trim(),
    ...(form.consumedAt !== null ? { consumedAt: form.consumedAt } : {}),
    caloriesKcal: form.caloriesKcal,
    proteinG: form.proteinG,
    carbohydrateG: form.carbohydrateG,
    fatG: form.fatG,
    ...(form.fibreG === undefined ? {} : { fibreG: form.fibreG }),
    ...(form.saturatedFatG === undefined
      ? {}
      : { saturatedFatG: form.saturatedFatG }),
    ...(form.totalSugarsG === undefined
      ? {}
      : { totalSugarsG: form.totalSugarsG }),
    ...(form.sodiumMg === undefined ? {} : { sodiumMg: form.sodiumMg }),
    ...(form.cholesterolMg === undefined
      ? {}
      : { cholesterolMg: form.cholesterolMg }),
    ...(form.details !== undefined ? { details: form.details } : {}),
  });
  return parsed.success ? parsed.data : null;
};

export const formFromEntry = (
  entry: FoodEntry,
  overrideDetails?: Record<string, unknown>,
): LogMealForm => ({
  name: entry.name,
  consumedAt: entry.consumedAt,
  caloriesKcal: entry.caloriesKcal,
  proteinG: entry.proteinG,
  carbohydrateG: entry.carbohydrateG,
  fatG: entry.fatG,
  details: overrideDetails ?? entry.details,
});

export const updateFoodEntry = async (
  entryId: string,
  form: LogMealForm,
): Promise<LogMealResult> => {
  const binding = captureHealthExportOwner();
  return updateFoodEntryWith(apiClient, entryId, form, (entry) =>
    exportSavedNutrition(binding, entry, {
      firstParty: true,
      timeBasis: "observed",
      existingOnly: true,
    }),
  );
};

export const updateFoodEntryWith = async (
  client: ApiClient,
  entryId: string,
  form: LogMealForm,
  afterSave?: (entry: FoodEntryResponse["foodEntry"]) => void,
): Promise<LogMealResult> => {
  const patch = patchFromForm(form);
  if (patch === null) {
    return { ok: false, message: "Please double-check the values." };
  }
  const result = await client.request<FoodEntryResponse>({
    method: "PUT",
    path: `/v1/food-entries/${encodeURIComponent(entryId)}`,
    body: patch,
    schema: foodEntryResponseSchema,
  });
  if (result.ok) {
    try {
      afterSave?.(result.value.foodEntry);
    } catch {
      /* Saved independently. */
    }
  }
  return result.ok
    ? { ok: true, id: result.value.foodEntry.id }
    : {
        ok: false,
        message: humanizeApiError(result.error, "Save that meal"),
      };
};

export const groupFoodEntries = async (
  entryIds: ReadonlyArray<string>,
  groupName: string,
  allEntries: ReadonlyArray<FoodEntry>,
  groupId?: string,
): Promise<FoodMutationResult> =>
  groupFoodEntriesWith(apiClient, entryIds, groupName, allEntries, groupId);

export const groupFoodEntriesWith = async (
  client: ApiClient,
  entryIds: ReadonlyArray<string>,
  groupName: string,
  allEntries: ReadonlyArray<FoodEntry>,
  groupId: string = createOperationId(),
): Promise<FoodMutationResult> => {
  const trimmedName = groupName.trim();
  if (trimmedName.length === 0) {
    return { ok: false, message: "Please enter a meal name." };
  }
  const targetIds = new Set(entryIds);
  const targets = allEntries.filter((e) => targetIds.has(e.id));
  if (targets.length === 0) {
    return { ok: false, message: "No meals selected to group." };
  }

  for (const entry of targets) {
    const updatedDetails = withMealGroup(entry.details, {
      id: groupId,
      name: trimmedName,
    });
    const result = await updateFoodEntryWith(
      client,
      entry.id,
      formFromEntry(entry, updatedDetails),
    );
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
  }
  return { ok: true };
};

export const ungroupFoodEntry = async (
  entry: FoodEntry,
): Promise<FoodMutationResult> => ungroupFoodEntryWith(apiClient, entry);

export const ungroupFoodEntryWith = async (
  client: ApiClient,
  entry: FoodEntry,
): Promise<FoodMutationResult> => {
  const updatedDetails = withMealGroup(entry.details, null);
  const result = await updateFoodEntryWith(
    client,
    entry.id,
    formFromEntry(entry, updatedDetails),
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
};

export const ungroupFoodEntries = async (
  entries: ReadonlyArray<FoodEntry>,
): Promise<FoodMutationResult> => ungroupFoodEntriesWith(apiClient, entries);

export const ungroupFoodEntriesWith = async (
  client: ApiClient,
  entries: ReadonlyArray<FoodEntry>,
): Promise<FoodMutationResult> => {
  for (const entry of entries) {
    const res = await ungroupFoodEntryWith(client, entry);
    if (!res.ok) return res;
  }
  return { ok: true };
};

export const renameFoodGroup = async (
  entries: ReadonlyArray<FoodEntry>,
  newName: string,
): Promise<FoodMutationResult> =>
  renameFoodGroupWith(apiClient, entries, newName);

export const renameFoodGroupWith = async (
  client: ApiClient,
  entries: ReadonlyArray<FoodEntry>,
  newName: string,
): Promise<FoodMutationResult> => {
  const trimmed = newName.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Meal name cannot be blank." };
  }
  for (const entry of entries) {
    const currentGroup = getEntryMealGroup(entry);
    if (currentGroup === null) continue;
    const updatedDetails = withMealGroup(entry.details, {
      id: currentGroup.id,
      name: trimmed,
    });
    const result = await updateFoodEntryWith(
      client,
      entry.id,
      formFromEntry(entry, updatedDetails),
    );
    if (!result.ok) return { ok: false, message: result.message };
  }
  return { ok: true };
};

export const deleteFoodEntry = async (
  entryId: string,
): Promise<FoodMutationResult> => {
  const binding = captureHealthExportOwner();
  const result = await deleteFoodEntryWith(apiClient, entryId);
  if (result.ok) deleteHealthExport(binding, "nutrition", entryId);
  return result;
};

export const deleteFoodEntryWith = async (
  client: ApiClient,
  entryId: string,
): Promise<FoodMutationResult> => {
  const result = await client.request<void>({
    method: "DELETE",
    path: `/v1/food-entries/${encodeURIComponent(entryId)}`,
  });
  return result.ok
    ? { ok: true }
    : {
        ok: false,
        message: humanizeApiError(result.error, "Delete that meal"),
      };
};

export const copyFoodEntry = async (
  entry: FoodEntry,
  includeAdvanced = false,
): Promise<FoodMutationResult> =>
  copyFoodEntryWith(apiClient, entry, () => new Date(), includeAdvanced);

export const copyFoodEntryWith = async (
  client: ApiClient,
  entry: FoodEntry,
  now: () => Date = () => new Date(),
  includeAdvanced = false,
): Promise<FoodMutationResult> => {
  const details = { ...entry.details };
  delete details.recurringMeal;
  const payload: FoodEntryCreate = {
    name: entry.name,
    consumedAt: now().toISOString(),
    caloriesKcal: entry.caloriesKcal,
    proteinG: entry.proteinG,
    carbohydrateG: entry.carbohydrateG,
    fatG: entry.fatG,
    ...(includeAdvanced
      ? {
          fibreG: entry.fibreG,
          saturatedFatG: entry.saturatedFatG,
          totalSugarsG: entry.totalSugarsG,
          sodiumMg: entry.sodiumMg,
          cholesterolMg: entry.cholesterolMg,
        }
      : {}),
    details,
  };
  const parsed = foodEntryCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: "That meal could not be copied." };
  }
  const result = await client.request<FoodEntryResponse>({
    method: "POST",
    path: "/v1/food-entries",
    body: parsed.data,
    schema: foodEntryResponseSchema,
  });
  return result.ok
    ? { ok: true }
    : {
        ok: false,
        message: humanizeApiError(result.error, "Copy that meal"),
      };
};
