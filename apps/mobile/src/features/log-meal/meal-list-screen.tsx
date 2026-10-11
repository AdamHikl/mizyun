import {
  removeMealPhotoRetry,
  mealPhotoRetentionEnabled,
} from "./meal-photo-retention";
import { MealVisual } from "./meal-visual";
import { useMealVisualCapability } from "./meal-visual-capability";
import {
  ActivityIndicator,
  AppState,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  router,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DailyFoodSummary, FoodEntry } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TabHeader, useTabHeaderLayout } from "@/components/tab-header";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { analyticsClient } from "@/composition/analytics-client";
import { isAutomaticallyLogged } from "@/features/recurring-meals/public-data";
import { getSessionReadVersion } from "@/composition/api-client";
import { subscribeSessionReadUpdates } from "@/composition/personal-read-events";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { getIsoLocalDate } from "./food-day-completion";
import { reconcileEveningReminders } from "./evening-catch-up-reminders";
import { reconcileFirstMealReminders } from "./first-meal-reminders";
import {
  fetchCurrentWeekSummaries,
  useAdvancedNutritionCapability,
} from "./advanced-nutrition";
import {
  ADVANCED_DISPLAY_FIELDS,
  advancedNutrientLines,
  weeklyAdvancedNutrientLines,
} from "./advanced-nutrition-data";

import { filterFoodDayGroups } from "./meal-history-filter";
import {
  clusterDayEntries,
  copyFoodEntry,
  deleteFoodEntry,
  fetchFoodHistory,
  fetchFoodDateHistory,
  formFromEntry,
  groupFoodEntries,
  groupFoodEntriesByDay,
  mergeFoodEntries,
  renameFoodGroup,
  ungroupFoodEntries,
  ungroupFoodEntry,
  updateFoodEntry,
  type DayGroupSummary,
  type DayMealCluster,
  type FoodDayGroup,
} from "./meal-lifecycle-data";
import {
  extractGramsFromName,
  getEntryGrams,
  scaleNutritionFromKnownPortion,
  scaledAdvancedPatchForExisting,
  updateGramsInName,
  withMealGrams,
} from "./meal-scale";
import {
  completeInitialMealSearch,
  failMealSearchLoadMore,
  shouldShowNoMealSearchMatches,
  type MealSearchState,
} from "./meal-history-search-state";

interface MealListState {
  readonly groups: ReadonlyArray<FoodDayGroup>;
  readonly entries: ReadonlyArray<FoodEntry>;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly nextCursor: string | null;
  readonly cutoffDateIsPartial: boolean;
  readonly message: string | null;
}

const INITIAL_STATE: MealListState = {
  groups: [],
  entries: [],
  loading: true,
  loadingMore: false,
  nextCursor: null,
  cutoffDateIsPartial: false,
  message: null,
};

const MEAL_GROUP_PRESETS = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;

const formatGroupNutrition = (summary: DayGroupSummary): string => {
  const values = [
    summary.caloriesKcal === null ? null : `${summary.caloriesKcal} kcal`,
    summary.proteinG === null ? null : `${summary.proteinG}P`,
    summary.carbohydrateG === null ? null : `${summary.carbohydrateG}C`,
    summary.fatG === null ? null : `${summary.fatG}F`,
  ].filter((value): value is string => value !== null);
  return values.length === 0 ? "No nutrition totals" : values.join(" · ");
};

const formatMealTime = (instant: string): string =>
  new Date(instant).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const getEntryCalculationText = (entry: FoodEntry): string | null => {
  if (!entry.details || typeof entry.details !== "object") return null;
  const d = entry.details as Record<string, unknown>;
  if (
    typeof d.calculationText === "string" &&
    d.calculationText.trim().length > 0
  ) {
    return d.calculationText.trim();
  }
  if (
    typeof d.aiCalculation === "string" &&
    d.aiCalculation.trim().length > 0
  ) {
    return d.aiCalculation.trim();
  }
  if (d.aiDraft && typeof d.aiDraft === "object") {
    const aiDraft = d.aiDraft as Record<string, unknown>;
    if (
      typeof aiDraft.calculation === "string" &&
      aiDraft.calculation.trim().length > 0
    ) {
      return aiDraft.calculation.trim();
    }
  }
  return null;
};

interface PortionModalState {
  readonly entry: FoodEntry;
  readonly grams: string;
  readonly baseGrams: number | null;
}

export function MealListScreen() {
  const { headerHeight, onHeaderLayout } = useTabHeaderLayout();
  const theme = useTheme();
  const { session } = useAuth();
  const mealVisualCapability = useMealVisualCapability(
    session?.user.id ?? null,
    session?.accessToken,
  );
  const advancedCapability = useAdvancedNutritionCapability(
    session?.user.id ?? null,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [visibleAdvancedFields, setVisibleAdvancedFields] = useState<string[]>(
    ADVANCED_DISPLAY_FIELDS.map(({ key }) => key),
  );
  const [weeklySummaries, setWeeklySummaries] =
    useState<ReadonlyArray<DailyFoodSummary> | null>(null);
  const userId = session?.user?.id ?? null;
  const ownerKey = `${userId ?? ""}:${session?.accessToken ?? ""}`;
  const currentOwner = useRef(ownerKey);
  currentOwner.current = ownerKey;
  const requestVersion = useRef(0);
  const loaded = useRef(false);
  const paginationPending = useRef(false);
  const historyReadPending = useRef(false);
  const addMealDate = useRef<string | null>(null);
  const lastLoad = useRef<{ version: string; completedAt: number } | null>(
    null,
  );
  useEffect(() => setWeeklySummaries(null), [userId]);
  const params = useLocalSearchParams<{ source?: string }>();
  const [state, setState] = useState<MealListState>(INITIAL_STATE);
  const [dismissEveningBanner, setDismissEveningBanner] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchAttempt, setSearchAttempt] = useState(0);
  const searchSessionIdRef = useRef(0);
  const searchPaginationPending = useRef<number | null>(null);

  // Grouping selection state
  const [groupingDate, setGroupingDate] = useState<string | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set(),
  );
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupModalName, setGroupModalName] = useState("Breakfast");

  // Rename group state
  const [renameTarget, setRenameTarget] = useState<DayMealCluster | null>(null);
  const [renameNewName, setRenameNewName] = useState("");

  // Portion adjusting modal state
  const [portionTarget, setPortionTarget] = useState<PortionModalState | null>(
    null,
  );

  const [serverSearch, setServerSearch] = useState<MealSearchState | null>(
    null,
  );

  useEffect(() => {
    requestVersion.current += 1;
    loaded.current = false;
    paginationPending.current = false;
    historyReadPending.current = false;
    lastLoad.current = null;
    addMealDate.current = null;
    setState(INITIAL_STATE);
    setServerSearch(null);
    setSearchQuery("");
    setBusyEntryId(null);
    setSelectedEntryIds(new Set());
    setGroupingDate(null);
    setShowGroupModal(false);
    setGroupModalName("Breakfast");
    setRenameNewName("");
    setPortionTarget(null);
    setRenameTarget(null);
  }, [ownerKey]);

  const load = useCallback(
    async (preserveOlder = false): Promise<void> => {
      const version = ++requestVersion.current;
      historyReadPending.current = true;
      const requestOwner = ownerKey;
      const readVersion = getSessionReadVersion();
      setState((current) => ({
        ...current,
        loading: !loaded.current,
        message: null,
      }));
      const targetDate = addMealDate.current;
      const [result, addedDay] = await Promise.all([
        fetchFoodHistory(),
        targetDate ? fetchFoodDateHistory(targetDate) : Promise.resolve(null),
      ]);
      if (
        version !== requestVersion.current ||
        requestOwner !== currentOwner.current
      )
        return;
      historyReadPending.current = false;
      if (result.message !== null) {
        setState((current) => ({
          ...current,
          loading: false,
          message: result.message,
        }));
        return;
      }
      if (addedDay?.message) {
        setState((current) => ({
          ...current,
          loading: false,
          message: addedDay.message,
        }));
        return;
      }
      if (targetDate && addMealDate.current === targetDate)
        addMealDate.current = null;
      loaded.current = true;
      lastLoad.current = { version: readVersion, completedAt: Date.now() };
      if (userId && result.entries && result.savedAt === undefined) {
        const today = getIsoLocalDate();
        const todayEntries = result.entries.filter((e) =>
          e.consumedAt.startsWith(today),
        );
        const hasMealAfter6Pm = todayEntries.some(
          (e) => new Date(e.consumedAt).getHours() >= 18,
        );
        if (hasMealAfter6Pm) {
          void reconcileEveningReminders(userId, { hasMealAfter6Pm: true });
        }
      }
      setState((current) => {
        if (addedDay && result.entries.length === 0) {
          const entries = mergeFoodEntries(current.entries, addedDay.entries);
          return {
            ...current,
            entries,
            groups: groupFoodEntriesByDay(entries, new Date(), {
              cutoffDateIsPartial: current.cutoffDateIsPartial,
            }),
            loading: false,
            loadingMore: false,
            message: null,
          };
        }
        if (
          !preserveOlder ||
          current.entries.length === 0 ||
          result.entries.length === 0
        ) {
          return {
            groups: result.groups,
            entries: result.entries,
            loading: false,
            loadingMore: false,
            nextCursor: result.nextCursor ?? null,
            cutoffDateIsPartial: result.cutoffDateIsPartial ?? false,
            message: result.message,
          };
        }
        const oldestIncoming = result.entries.reduce((oldest, entry) => {
          const time = new Date(entry.consumedAt).getTime();
          const oldestTime = new Date(oldest.consumedAt).getTime();
          return time < oldestTime ||
            (time === oldestTime && entry.id.localeCompare(oldest.id) < 0)
            ? entry
            : oldest;
        });
        const oldestTime = new Date(oldestIncoming.consumedAt).getTime();
        const older = current.entries.filter((entry) => {
          const time = new Date(entry.consumedAt).getTime();
          return (
            time < oldestTime ||
            (time === oldestTime &&
              entry.id.localeCompare(oldestIncoming.id) < 0)
          );
        });
        const entries = mergeFoodEntries(
          mergeFoodEntries(older, result.entries),
          addedDay?.entries ?? [],
        );
        const retainedOlderPages = older.length > 0;
        const nextCursor = retainedOlderPages
          ? current.nextCursor
          : (result.nextCursor ?? null);
        const cutoffDateIsPartial = retainedOlderPages
          ? current.cutoffDateIsPartial
          : (result.cutoffDateIsPartial ?? false);
        return {
          groups: groupFoodEntriesByDay(entries, new Date(), {
            cutoffDateIsPartial,
          }),
          entries,
          loading: false,
          loadingMore: false,
          nextCursor,
          cutoffDateIsPartial,
          message: result.message,
        };
      });
    },
    [userId, ownerKey],
  );

  const refreshAfterMutation = useCallback(async (): Promise<void> => {
    // Retire every old result before refreshing the unchanged search query.
    ++searchSessionIdRef.current;
    searchPaginationPending.current = null;
    setServerSearch(null);
    setSearchAttempt((value) => value + 1);
    await load();
  }, [load]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (
      state.loadingMore ||
      paginationPending.current ||
      historyReadPending.current ||
      !state.nextCursor
    )
      return;
    paginationPending.current = true;
    setState((current) => ({ ...current, loadingMore: true }));
    const requestOwner = ownerKey;
    const readRevision = requestVersion.current;
    const result = await fetchFoodHistory({ cursor: state.nextCursor }).finally(
      () => {
        if (requestOwner === currentOwner.current)
          paginationPending.current = false;
      },
    );
    if (
      requestOwner !== currentOwner.current ||
      readRevision !== requestVersion.current
    )
      return;
    if (result.message !== null) {
      setState((current) => ({
        ...current,
        loadingMore: false,
        message: result.message,
      }));
      return;
    }
    setState((current) => {
      const mergedEntries = mergeFoodEntries(current.entries, result.entries);
      const nextCursor = result.nextCursor ?? null;
      const cutoffDateIsPartial = result.cutoffDateIsPartial ?? false;
      const groups = groupFoodEntriesByDay(mergedEntries, new Date(), {
        cutoffDateIsPartial: nextCursor !== null && cutoffDateIsPartial,
      });
      return {
        ...current,
        groups,
        entries: mergedEntries,
        nextCursor,
        cutoffDateIsPartial,
        loadingMore: false,
      };
    });
  }, [state.loadingMore, state.nextCursor, ownerKey]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    const sessionId = ++searchSessionIdRef.current;
    searchPaginationPending.current = null;
    if (trimmed.length === 0) {
      setServerSearch(null);
      return;
    }

    let active = true;
    const requestOwner = ownerKey;
    setServerSearch((current) => ({
      loading: true,
      loadingMore: false,
      groups: current?.query === trimmed ? current.groups : [],
      entries: current?.query === trimmed ? current.entries : [],
      nextCursor: null,
      query: trimmed,
      sessionId,
      error: null,
    }));

    const timer = setTimeout(async () => {
      const result = await fetchFoodHistory({ search: trimmed });
      if (!active || requestOwner !== currentOwner.current) return;
      setServerSearch((current) =>
        completeInitialMealSearch(current, trimmed, sessionId, result),
      );
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchAttempt, searchQuery, ownerKey]);

  const loadMoreSearch = useCallback(async (): Promise<void> => {
    if (
      !serverSearch ||
      serverSearch.loading ||
      serverSearch.loadingMore ||
      searchPaginationPending.current !== null ||
      serverSearch.sessionId !== searchSessionIdRef.current ||
      ownerKey !== currentOwner.current ||
      !serverSearch.nextCursor
    ) {
      return;
    }
    const currentCursor = serverSearch.nextCursor;
    const currentQuery = serverSearch.query;
    const currentSessionId = serverSearch.sessionId;
    searchPaginationPending.current = currentSessionId;
    setServerSearch((current) =>
      current &&
      current.query === currentQuery &&
      current.sessionId === currentSessionId
        ? { ...current, loadingMore: true, error: null }
        : current,
    );
    const requestOwner = ownerKey;
    const result = await fetchFoodHistory({
      search: currentQuery,
      cursor: currentCursor,
    }).finally(() => {
      if (searchPaginationPending.current === currentSessionId) {
        searchPaginationPending.current = null;
      }
    });
    if (requestOwner !== currentOwner.current) return;
    if (result.message !== null) {
      setServerSearch((current) =>
        failMealSearchLoadMore(
          current,
          currentQuery,
          currentSessionId,
          result.message!,
        ),
      );
      return;
    }
    setServerSearch((current) => {
      if (
        !current ||
        current.query !== currentQuery ||
        current.sessionId !== currentSessionId
      ) {
        return current;
      }
      const mergedEntries = mergeFoodEntries(current.entries, result.entries);
      const nextCursor = result.nextCursor ?? null;
      const groups = groupFoodEntriesByDay(mergedEntries, new Date(), {
        cutoffDateIsPartial:
          nextCursor !== null && (result.cutoffDateIsPartial ?? false),
      });
      return {
        ...current,
        groups,
        entries: mergedEntries,
        nextCursor,
        loadingMore: false,
        error: null,
      };
    });
  }, [serverSearch, ownerKey]);

  useFocusEffect(
    useCallback(() => {
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "nutrition_history" },
      });
      const previous = lastLoad.current;
      if (
        addMealDate.current !== null ||
        !previous ||
        previous.version !== getSessionReadVersion() ||
        Date.now() - previous.completedAt >= 60 * 1000
      ) {
        void load(addMealDate.current !== null);
        if (addMealDate.current !== null)
          setSearchAttempt((value) => value + 1);
      }
      void advancedCapability.refresh();
      let foreground =
        AppState.currentState !== "background" &&
        AppState.currentState !== "inactive";
      const timer = setInterval(() => {
        if (
          foreground &&
          !paginationPending.current &&
          !historyReadPending.current
        )
          void load(true);
      }, 60_000);
      const subscription = AppState.addEventListener("change", (state) => {
        foreground = state === "active";
        if (state === "active") {
          void load();
          void advancedCapability.refresh();
        }
      });
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeSessionReadUpdates((path) => {
        if (!path.startsWith("/v1/food-entries")) return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          if (!paginationPending.current) void load(true);
        }, 50);
      });
      return () => {
        clearInterval(timer);
        clearTimeout(refreshTimer);
        unsubscribe();
        subscription.remove();
      };
    }, [load, advancedCapability.refresh]),
  );

  useEffect(() => {
    if (!advancedCapability.enabled) {
      setWeeklySummaries(null);
      return;
    }
    let active = true;
    const requestOwner = ownerKey;
    void fetchCurrentWeekSummaries()
      .then((summaries) => {
        if (active && requestOwner === currentOwner.current)
          setWeeklySummaries(summaries);
      })
      .catch(() => {
        if (active && requestOwner === currentOwner.current)
          setWeeklySummaries(null);
      });
    return () => {
      active = false;
    };
  }, [advancedCapability.enabled, state.entries, userId, ownerKey]);

  const copy = useCallback(
    async (entry: FoodEntry): Promise<void> => {
      const requestOwner = ownerKey;
      if (!userId || requestOwner !== currentOwner.current) return;
      setBusyEntryId(entry.id);
      setState((current) => ({ ...current, message: null }));
      const includeAdvanced = await advancedCapability.refresh();
      if (requestOwner !== currentOwner.current) return;
      const result = await copyFoodEntry(entry, includeAdvanced, {
        expectedUserId: userId,
      });
      if (requestOwner !== currentOwner.current) return;
      setBusyEntryId(null);
      if (!result.ok) {
        setState((current) => ({ ...current, message: result.message }));
        return;
      }
      await reconcileFirstMealReminders(userId, { todayLogged: true }).catch(
        () => {},
      );
      if (requestOwner !== currentOwner.current) return;
      await refreshAfterMutation();
    },
    [refreshAfterMutation, advancedCapability, ownerKey, userId],
  );

  const remove = useCallback(
    async (entryId: string): Promise<void> => {
      setBusyEntryId(entryId);
      setState((current) => ({ ...current, message: null }));
      const owner = session?.user.id;
      const result = await deleteFoodEntry(entryId);
      setBusyEntryId(null);
      if (!result.ok) {
        setState((current) => ({ ...current, message: result.message }));
        return;
      }
      if (owner && mealPhotoRetentionEnabled())
        await removeMealPhotoRetry(owner, entryId);
      await refreshAfterMutation();
    },
    [refreshAfterMutation, session?.user.id],
  );

  const confirmDelete = useCallback(
    (entry: FoodEntry): void => {
      Alert.alert("Delete meal?", `This permanently removes “${entry.name}”.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void remove(entry.id);
          },
        },
      ]);
    },
    [remove],
  );

  const localFilteredGroups = useMemo(
    () => filterFoodDayGroups(state.groups, searchQuery),
    [searchQuery, state.groups],
  );
  const hasSearchQuery = searchQuery.trim().length > 0;
  const displayGroups = hasSearchQuery
    ? serverSearch !== null &&
      !serverSearch.loading &&
      serverSearch.error?.phase !== "initial"
      ? serverSearch.groups
      : localFilteredGroups
    : state.groups;
  const visibleMealCount = useMemo(
    () =>
      displayGroups.reduce((count, group) => count + group.entries.length, 0),
    [displayGroups],
  );
  const totalDaysTracked = displayGroups.length;
  const historySummary = hasSearchQuery
    ? serverSearch?.error?.phase === "initial" &&
      localFilteredGroups.length === 0
      ? "Search unavailable"
      : serverSearch?.loading && localFilteredGroups.length === 0
        ? "Searching meal history…"
        : `${visibleMealCount} ${visibleMealCount === 1 ? "meal" : "meals"} · ${totalDaysTracked} ${totalDaysTracked === 1 ? "day" : "days"}`
    : `${totalDaysTracked} ${totalDaysTracked === 1 ? "day" : "days"}`;

  // Grouping handlers
  const startGrouping = useCallback((dateStr: string) => {
    setGroupingDate(dateStr);
    setSelectedEntryIds(new Set());
  }, []);

  const cancelGrouping = useCallback(() => {
    setGroupingDate(null);
    setSelectedEntryIds(new Set());
  }, []);

  const toggleSelectEntry = useCallback((entryId: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  const handleCreateGroup = useCallback(async () => {
    if (groupingDate === null || selectedEntryIds.size === 0) return;
    const groupEntries =
      displayGroups.find((g) => g.date === groupingDate)?.entries ?? [];
    setShowGroupModal(false);
    setState((current) => ({ ...current, loading: true }));
    const result = await groupFoodEntries(
      Array.from(selectedEntryIds),
      groupModalName,
      groupEntries,
    );
    cancelGrouping();
    if (!result.ok) {
      setState((current) => ({
        ...current,
        loading: false,
        message: result.message,
      }));
      return;
    }
    await refreshAfterMutation();
  }, [
    cancelGrouping,
    displayGroups,
    groupModalName,
    groupingDate,
    refreshAfterMutation,
    selectedEntryIds,
  ]);

  const handleUngroupItem = useCallback(
    async (entry: FoodEntry) => {
      setBusyEntryId(entry.id);
      const res = await ungroupFoodEntry(entry);
      setBusyEntryId(null);
      if (!res.ok) {
        setState((current) => ({ ...current, message: res.message }));
        return;
      }
      await refreshAfterMutation();
    },
    [refreshAfterMutation],
  );

  const handleUngroupAll = useCallback(
    async (cluster: DayMealCluster) => {
      Alert.alert(
        "Ungroup meal?",
        `This will turn all ${cluster.entries.length} items in “${cluster.name}” back into individual meals.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Ungroup",
            onPress: async () => {
              setState((current) => ({ ...current, loading: true }));
              const res = await ungroupFoodEntries(cluster.entries);
              if (!res.ok) {
                setState((current) => ({
                  ...current,
                  loading: false,
                  message: res.message,
                }));
                return;
              }
              await refreshAfterMutation();
            },
          },
        ],
      );
    },
    [refreshAfterMutation],
  );

  const handleRenameGroup = useCallback(async () => {
    if (renameTarget === null) return;
    const target = renameTarget;
    setRenameTarget(null);
    setState((current) => ({ ...current, loading: true }));
    const res = await renameFoodGroup(target.entries, renameNewName);
    if (!res.ok) {
      setState((current) => ({
        ...current,
        loading: false,
        message: res.message,
      }));
      return;
    }
    await refreshAfterMutation();
  }, [refreshAfterMutation, renameNewName, renameTarget]);

  // Portion adjustment handlers
  const openPortionAdjuster = useCallback((entry: FoodEntry) => {
    const detected = getEntryGrams(entry);
    const base = detected !== null && detected > 0 ? detected : null;
    setPortionTarget({
      entry,
      grams: base === null ? "" : String(base),
      baseGrams: base,
    });
  }, []);

  const handleApplyPortion = useCallback(
    async (grams: string) => {
      if (portionTarget === null) return;
      const { entry, baseGrams } = portionTarget;
      const parsedGrams = Number(grams.trim().replace(",", "."));
      if (!Number.isFinite(parsedGrams) || parsedGrams <= 0) {
        Alert.alert("Invalid weight", "Please enter a valid weight in grams.");
        return;
      }

      const scaled = scaleNutritionFromKnownPortion(
        {
          caloriesKcal: entry.caloriesKcal,
          proteinG: entry.proteinG,
          carbohydrateG: entry.carbohydrateG,
          fatG: entry.fatG,
          fibreG: entry.fibreG,
          saturatedFatG: entry.saturatedFatG,
          totalSugarsG: entry.totalSugarsG,
          sodiumMg: entry.sodiumMg,
          cholesterolMg: entry.cholesterolMg,
          grams: baseGrams,
        },
        parsedGrams,
      );

      const updatedName =
        extractGramsFromName(entry.name) !== null
          ? updateGramsInName(entry.name, parsedGrams)
          : entry.name;

      const patch = {
        ...formFromEntry(entry),
        name: updatedName,
        caloriesKcal: scaled.caloriesKcal,
        proteinG: scaled.proteinG,
        carbohydrateG: scaled.carbohydrateG,
        fatG: scaled.fatG,
        ...scaledAdvancedPatchForExisting(entry, scaled),
        details: withMealGrams(entry.details, parsedGrams),
      };

      setPortionTarget(null);
      setBusyEntryId(entry.id);
      const res = await updateFoodEntry(entry.id, patch);
      setBusyEntryId(null);
      if (!res.ok) {
        setState((current) => ({ ...current, message: res.message }));
        return;
      }
      await refreshAfterMutation();
    },
    [refreshAfterMutation, portionTarget],
  );

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Meals" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <TabHeader onLayout={onHeaderLayout} />
        <ScrollView
          style={{ marginTop: -headerHeight }}
          contentContainerStyle={[
            styles.content,
            { paddingTop: headerHeight + Spacing.four },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {/* Top Header */}
          <View style={styles.header}>
            <ThemedText type="subtitle">Meals</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Manage daily nutrition, logged foods, and history.
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recurring meals"
            onPress={() => router.push("/recurring-meals" as Href)}
            style={styles.inlineButton}
          >
            <ThemedText type="smallBold">Recurring meals</ThemedText>
          </Pressable>

          {/* Primary Action Card: Log a Meal */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log a meal"
            onPress={() => router.push("/log-meal" as Href)}
            style={({ pressed }) => [
              styles.logMealHeroCard,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.logMealIconContainer}>
              <ThemedText style={styles.logMealIcon}>🥗</ThemedText>
            </View>
            <View style={styles.logMealBody}>
              <ThemedText type="smallBold">Log a Meal</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Scan photo with AI or manual ingredient entry
              </ThemedText>
            </View>
            <View style={styles.logMealBadge}>
              <ThemedText type="smallBold" style={styles.logMealBadgeText}>
                ＋ Log
              </ThemedText>
            </View>
          </Pressable>

          {advancedCapability.enabled ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show or hide more nutrient totals"
              onPress={() => setShowAdvanced((value) => !value)}
              style={styles.inlineButton}
            >
              <ThemedText type="smallBold">
                {showAdvanced ? "Hide" : "Show"} more nutrients
              </ThemedText>
            </Pressable>
          ) : null}

          {advancedCapability.enabled && showAdvanced ? (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">
                This week · more nutrients
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Completeness covers nutrient values in logged meals. It does not
                mean every food eaten was logged.
              </ThemedText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  marginVertical: 8,
                }}
              >
                {ADVANCED_DISPLAY_FIELDS.map(({ key, label }) => (
                  <Pressable
                    key={key}
                    accessibilityRole="checkbox"
                    accessibilityState={{
                      checked: visibleAdvancedFields.includes(key),
                    }}
                    accessibilityLabel={`Show ${label}`}
                    onPress={() =>
                      setVisibleAdvancedFields((current) =>
                        current.includes(key)
                          ? current.filter((item) => item !== key)
                          : [...current, key],
                      )
                    }
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 8,
                      padding: 8,
                    }}
                  >
                    <ThemedText type="small">
                      {visibleAdvancedFields.includes(key) ? "✓ " : ""}
                      {label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              {weeklySummaries === null ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Weekly nutrient summary unavailable.
                </ThemedText>
              ) : (
                weeklyAdvancedNutrientLines(
                  weeklySummaries,
                  visibleAdvancedFields,
                ).map((line) => (
                  <ThemedText
                    key={line}
                    type="small"
                    themeColor="textSecondary"
                  >
                    {line}
                  </ThemedText>
                ))
              )}
            </ThemedView>
          ) : null}

          {state.message !== null ? (
            <ThemedView type="backgroundElement" style={styles.messageCard}>
              <ThemedText type="small" accessibilityRole="alert">
                {state.message}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading logged meals"
                onPress={() => void load()}
                style={styles.inlineButton}
              >
                <ThemedText type="smallBold">Retry</ThemedText>
              </Pressable>
            </ThemedView>
          ) : null}

          {/* History Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                HISTORY BY DAY
              </ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                accessibilityLiveRegion="polite"
              >
                {historySummary}
              </ThemedText>
            </View>

            <View
              style={[
                styles.searchRow,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <ThemedText
                accessible={false}
                importantForAccessibility="no"
                style={styles.searchIcon}
              >
                🔍
              </ThemedText>
              <TextInput
                accessibilityLabel="Search meal history"
                accessibilityHint="Filters meals by name and saved details"
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search meals…"
                placeholderTextColor={theme.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="search"
                returnKeyType="search"
              />
              {searchQuery.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear meal search"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => setSearchQuery("")}
                  style={({ pressed }) => [
                    styles.clearSearchButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    ✕
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>

            {state.loading && state.groups.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Loading logged meals…
              </ThemedText>
            ) : null}

            {hasSearchQuery && serverSearch?.error ? (
              <ThemedView
                type="backgroundElement"
                style={styles.messageCard}
                accessibilityRole="alert"
              >
                <ThemedText type="small">
                  {serverSearch.error.message}
                </ThemedText>
                {serverSearch.error.phase === "initial" &&
                localFilteredGroups.length > 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Showing matches from meals already loaded on this device.
                  </ThemedText>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    serverSearch.error.phase === "load-more"
                      ? "Retry loading more matching meals"
                      : "Retry searching meal history"
                  }
                  onPress={() => {
                    if (serverSearch.error?.phase === "load-more") {
                      void loadMoreSearch();
                    } else {
                      setSearchAttempt((attempt) => attempt + 1);
                    }
                  }}
                  style={styles.inlineButton}
                >
                  <ThemedText type="smallBold">Retry</ThemedText>
                </Pressable>
              </ThemedView>
            ) : null}

            {hasSearchQuery &&
            shouldShowNoMealSearchMatches(
              serverSearch,
              displayGroups.length,
            ) ? (
              <ThemedView
                type="backgroundElement"
                style={styles.emptyCard}
                accessibilityRole="alert"
              >
                <ThemedText type="smallBold">
                  No meals match “{searchQuery}”
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.emptyStateDesc}
                >
                  Check spelling or clear the search to view all logged meals.
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearchQuery("")}
                  style={styles.emptyAddButton}
                >
                  <ThemedText
                    type="smallBold"
                    style={styles.emptyAddButtonText}
                  >
                    Clear search
                  </ThemedText>
                </Pressable>
              </ThemedView>
            ) : null}

            {!hasSearchQuery &&
            !state.loading &&
            state.groups.length === 0 &&
            state.message === null ? (
              <ThemedView
                type="backgroundElement"
                style={styles.emptyCard}
                accessibilityRole="alert"
              >
                <ThemedText type="smallBold">Nothing logged yet</ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.emptyStateDesc}
                >
                  Meals you log manually or scan with AI will appear here
                  grouped by day with detailed calorie and macro breakdowns.
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Log your first meal"
                  onPress={() => router.push("/log-meal" as Href)}
                  style={styles.emptyAddButton}
                >
                  <ThemedText
                    type="smallBold"
                    style={styles.emptyAddButtonText}
                  >
                    ＋ Log your first meal
                  </ThemedText>
                </Pressable>
              </ThemedView>
            ) : null}

            {params.source === "evening_catch_up_reminder" &&
            !dismissEveningBanner ? (
              <ThemedView
                type="backgroundElement"
                style={[
                  styles.eveningCatchUpBanner,
                  {
                    borderColor: "rgba(16, 185, 129, 0.3)",
                    backgroundColor:
                      theme.background === "#F8FAF9"
                        ? "rgba(16, 185, 129, 0.08)"
                        : "rgba(16, 185, 129, 0.12)",
                  },
                ]}
              >
                <View style={styles.eveningBannerHeader}>
                  <ThemedText style={styles.eveningBannerIcon}>🌙</ThemedText>
                  <View style={styles.eveningBannerContent}>
                    <ThemedText type="smallBold" style={{ color: "#10B981" }}>
                      Evening Food-Log Catch-Up
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Anything else to add from today? Add missed meals below.
                    </ThemedText>
                    <ThemedText
                      type="small"
                      style={styles.eveningSupportiveNote}
                    >
                      Missed a meal or day? Consistency is built over time, not
                      perfection.
                    </ThemedText>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss evening reminder banner"
                    onPress={() => setDismissEveningBanner(true)}
                    style={styles.eveningBannerDismiss}
                  >
                    <ThemedText type="small" themeColor="textSecondary">
                      ✕
                    </ThemedText>
                  </Pressable>
                </View>
              </ThemedView>
            ) : null}

            <View style={styles.groupList}>
              {displayGroups.map((group) => {
                const isGroupingThisDay = groupingDate === group.date;
                const clusters = clusterDayEntries(group.entries);

                return (
                  <ThemedView
                    key={group.date}
                    type="backgroundElement"
                    style={styles.dayGroupCard}
                  >
                    {/* Day identity and totals stay separate from actions. */}
                    <View style={styles.dayHeader}>
                      <View style={styles.dayTitleRow}>
                        <ThemedText
                          type="smallBold"
                          accessibilityRole="header"
                          style={styles.dayTitle}
                        >
                          {group.displayDate}
                        </ThemedText>
                        <View style={styles.dayMetadata}>
                          <ThemedText type="small" themeColor="textSecondary">
                            {group.summary.entryCount}{" "}
                            {group.summary.entryCount === 1 ? "meal" : "meals"}
                          </ThemedText>
                          {group.isPartial ? (
                            <View style={styles.partialBadge}>
                              <ThemedText
                                type="smallBold"
                                style={styles.partialBadgeText}
                              >
                                Partial
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      {isGroupingThisDay ? (
                        <View style={styles.groupingToolbar}>
                          <ThemedText
                            type="smallBold"
                            themeColor="textSecondary"
                            style={styles.groupingCountText}
                          >
                            {selectedEntryIds.size} selected
                          </ThemedText>
                          <View style={styles.groupingToolbarActions}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Confirm grouping selected meals"
                              disabled={selectedEntryIds.size < 2}
                              onPress={() => setShowGroupModal(true)}
                              style={[
                                styles.groupConfirmBtn,
                                selectedEntryIds.size < 2 && styles.disabledBtn,
                              ]}
                            >
                              <ThemedText
                                type="smallBold"
                                style={styles.groupConfirmBtnText}
                              >
                                Group as…
                              </ThemedText>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Cancel grouping meals"
                              onPress={cancelGrouping}
                              style={styles.groupCancelBtn}
                            >
                              <ThemedText
                                type="small"
                                themeColor="textSecondary"
                              >
                                Cancel
                              </ThemedText>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.dayNutrition}>
                          {hasSearchQuery || group.isPartial ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              {hasSearchQuery
                                ? group.isPartial
                                  ? "Partial matching-meal totals"
                                  : "Matching-meal totals"
                                : "Partial totals"}
                            </ThemedText>
                          ) : null}
                          {(
                            [
                              [group.summary.caloriesKcal, "kcal"],
                              [group.summary.proteinG, "g protein"],
                              [group.summary.carbohydrateG, "g carbs"],
                              [group.summary.fatG, "g fat"],
                            ] as const
                          ).map(([value, unit], index) =>
                            value === null ? null : (
                              <ThemedText
                                key={unit}
                                type={index === 0 ? "smallBold" : "small"}
                                themeColor={
                                  index === 0 ? "text" : "textSecondary"
                                }
                                style={[
                                  styles.dayNutrient,
                                  index === 0 && styles.dayCalories,
                                ]}
                              >
                                {value}
                                {unit === "kcal" ? " " : ""}
                                {unit}
                              </ThemedText>
                            ),
                          )}
                          {group.summary.caloriesKcal === null &&
                          group.summary.proteinG === null &&
                          group.summary.carbohydrateG === null &&
                          group.summary.fatG === null ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              No nutrition totals
                            </ThemedText>
                          ) : null}
                        </View>
                      )}

                      <View style={styles.dayActions}>
                        <Pressable
                          testID={`add-meal-${group.date}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Add meal on ${group.displayDate}`}
                          accessibilityHint="Opens a new meal entry for this day"
                          onPress={() => {
                            addMealDate.current = group.date;
                            router.push({
                              pathname: "/log-meal",
                              params: { date: group.date },
                            });
                          }}
                          style={({ pressed }) => [
                            styles.dayAddButton,
                            { backgroundColor: theme.backgroundSelected },
                            pressed && { opacity: 0.6 },
                          ]}
                        >
                          <ThemedText type="smallBold">＋ Add meal</ThemedText>
                        </Pressable>
                        {!isGroupingThisDay && group.entries.length >= 2 ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Group meals on ${group.displayDate}`}
                            accessibilityHint="Select at least two entries to combine into a meal group"
                            onPress={() => startGrouping(group.date)}
                            style={({ pressed }) => [
                              styles.groupActionTrigger,
                              pressed && { opacity: 0.6 },
                            ]}
                          >
                            <ThemedText type="small" themeColor="textSecondary">
                              Group meals
                            </ThemedText>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>

                    {advancedCapability.enabled && showAdvanced
                      ? advancedNutrientLines(
                          group.entries,
                          visibleAdvancedFields,
                        ).map((line) => (
                          <ThemedText
                            key={line}
                            type="small"
                            themeColor="textSecondary"
                          >
                            {group.isPartial ? "Partial loaded history · " : ""}
                            {line}
                          </ThemedText>
                        ))
                      : null}

                    {/* Day Entries List (clusters & standalone meals) */}
                    <View style={styles.dayEntries}>
                      {clusters.map((clusterItem, index) => {
                        if (clusterItem.kind === "group") {
                          return (
                            <View
                              key={`cluster-${clusterItem.id}-${index}`}
                              style={styles.clusterContainer}
                            >
                              {/* Bigger Meal Header */}
                              <View style={styles.clusterHeader}>
                                <View style={styles.clusterHeaderLeft}>
                                  <ThemedText style={styles.clusterIcon}>
                                    🍽️
                                  </ThemedText>
                                  <ThemedText
                                    type="smallBold"
                                    style={styles.clusterTitle}
                                  >
                                    {clusterItem.name}
                                  </ThemedText>
                                  <View style={styles.clusterCountBadge}>
                                    <ThemedText
                                      type="small"
                                      themeColor="textSecondary"
                                    >
                                      {clusterItem.entries.length} items
                                    </ThemedText>
                                  </View>
                                </View>

                                <View style={styles.clusterHeaderActions}>
                                  <EntryAction
                                    label="Rename"
                                    groupAction
                                    disabled={busyEntryId !== null}
                                    onPress={() => {
                                      setRenameTarget(clusterItem);
                                      setRenameNewName(clusterItem.name);
                                    }}
                                  />
                                  <EntryAction
                                    label="Ungroup all"
                                    groupAction
                                    disabled={busyEntryId !== null}
                                    onPress={() =>
                                      void handleUngroupAll(clusterItem)
                                    }
                                  />
                                </View>
                              </View>

                              <ThemedText
                                type="small"
                                themeColor="textSecondary"
                                style={styles.clusterTotalsText}
                              >
                                {formatGroupNutrition(clusterItem.summary)}
                              </ThemedText>

                              {/* Child items in this bigger meal */}
                              <View style={styles.clusterChildrenList}>
                                {clusterItem.entries.map((child) => (
                                  <MealEntryRow
                                    key={child.id}
                                    entry={child}
                                    mealVisualsEnabled={
                                      mealVisualCapability.enabled
                                    }
                                    showAdvanced={
                                      advancedCapability.enabled && showAdvanced
                                    }
                                    visibleAdvancedFields={
                                      visibleAdvancedFields
                                    }
                                    isGrouping={isGroupingThisDay}
                                    isSelected={selectedEntryIds.has(child.id)}
                                    onToggleSelect={() =>
                                      toggleSelectEntry(child.id)
                                    }
                                    busy={busyEntryId === child.id}
                                    onEdit={() =>
                                      router.push(
                                        `/edit-meal?id=${encodeURIComponent(child.id)}` as Href,
                                      )
                                    }
                                    onRepeat={() =>
                                      router.push(
                                        `/recurring-meals?sourceEntryId=${encodeURIComponent(child.id)}` as Href,
                                      )
                                    }
                                    onResize={() => openPortionAdjuster(child)}
                                    onUngroup={() =>
                                      void handleUngroupItem(child)
                                    }
                                    onDelete={() => confirmDelete(child)}
                                    inGroup
                                  />
                                ))}
                              </View>
                            </View>
                          );
                        }

                        // Standalone Meal Entry
                        return (
                          <MealEntryRow
                            key={clusterItem.entry.id}
                            entry={clusterItem.entry}
                            mealVisualsEnabled={mealVisualCapability.enabled}
                            showAdvanced={
                              advancedCapability.enabled && showAdvanced
                            }
                            visibleAdvancedFields={visibleAdvancedFields}
                            isGrouping={isGroupingThisDay}
                            isSelected={selectedEntryIds.has(
                              clusterItem.entry.id,
                            )}
                            onToggleSelect={() =>
                              toggleSelectEntry(clusterItem.entry.id)
                            }
                            busy={busyEntryId === clusterItem.entry.id}
                            onEdit={() =>
                              router.push(
                                `/edit-meal?id=${encodeURIComponent(clusterItem.entry.id)}` as Href,
                              )
                            }
                            onRepeat={() =>
                              router.push(
                                `/recurring-meals?sourceEntryId=${encodeURIComponent(clusterItem.entry.id)}` as Href,
                              )
                            }
                            onResize={() =>
                              openPortionAdjuster(clusterItem.entry)
                            }
                            onCopy={() => void copy(clusterItem.entry)}
                            onDelete={() => confirmDelete(clusterItem.entry)}
                            inGroup={false}
                          />
                        );
                      })}
                    </View>
                  </ThemedView>
                );
              })}
            </View>

            {/* Pagination / History Continuation Footer */}
            {hasSearchQuery ? (
              <View style={styles.paginationFooter}>
                {serverSearch?.loadingMore ? (
                  <View style={styles.loadingMoreRow}>
                    <ActivityIndicator size="small" color="#10B981" />
                    <ThemedText type="small" themeColor="textSecondary">
                      Loading more matching meals…
                    </ThemedText>
                  </View>
                ) : serverSearch?.nextCursor &&
                  serverSearch.error?.phase !== "load-more" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Load more matching meals"
                    onPress={() => void loadMoreSearch()}
                    style={styles.loadMoreButton}
                  >
                    <ThemedText
                      type="smallBold"
                      style={styles.loadMoreButtonText}
                    >
                      Load more matching meals
                    </ThemedText>
                  </Pressable>
                ) : serverSearch &&
                  !serverSearch.loading &&
                  !serverSearch.nextCursor &&
                  serverSearch.error === null &&
                  serverSearch.entries.length > 0 ? (
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.historyEndNotice}
                  >
                    All matching meals loaded ({serverSearch.entries.length}{" "}
                    total)
                  </ThemedText>
                ) : null}
              </View>
            ) : (
              <View style={styles.paginationFooter}>
                {state.loadingMore ? (
                  <View style={styles.loadingMoreRow}>
                    <ActivityIndicator size="small" color="#10B981" />
                    <ThemedText type="small" themeColor="textSecondary">
                      Loading older meals…
                    </ThemedText>
                  </View>
                ) : state.nextCursor ? (
                  <>
                    {state.cutoffDateIsPartial ? (
                      <ThemedText
                        type="small"
                        style={styles.partialCutoffNotice}
                      >
                        Cutoff day is split across pages. Load older meals to
                        complete totals.
                      </ThemedText>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Load older meals"
                      onPress={() => void loadMore()}
                      style={styles.loadMoreButton}
                    >
                      <ThemedText
                        type="smallBold"
                        style={styles.loadMoreButtonText}
                      >
                        Load older meals
                      </ThemedText>
                    </Pressable>
                  </>
                ) : !state.loading && state.entries.length > 0 ? (
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.historyEndNotice}
                  >
                    All meals loaded ({state.entries.length} total)
                  </ThemedText>
                ) : null}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Group Meals Modal */}
      <Modal
        visible={showGroupModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowGroupModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText type="subtitle">Group Meals</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Combine {selectedEntryIds.size} items into a bigger meal while
              keeping each one editable.
            </ThemedText>

            <View style={styles.modalPresetsRow}>
              {MEAL_GROUP_PRESETS.map((preset) => (
                <Pressable
                  key={preset}
                  onPress={() => setGroupModalName(preset)}
                  style={[
                    styles.presetChip,
                    groupModalName === preset && styles.presetChipActive,
                  ]}
                >
                  <ThemedText
                    type="smallBold"
                    style={
                      groupModalName === preset
                        ? styles.presetChipTextActive
                        : styles.presetChipText
                    }
                  >
                    {preset}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <TextInput
              accessibilityLabel="Meal group name input"
              value={groupModalName}
              onChangeText={setGroupModalName}
              placeholder="e.g. Post-workout meal"
              placeholderTextColor="#8A8D91"
              style={[styles.modalInput, { color: theme.text }]}
            />

            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setShowGroupModal(false)}
                style={styles.modalCancelButton}
              >
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Cancel
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={() => void handleCreateGroup()}
                style={styles.modalConfirmButton}
              >
                <ThemedText type="smallBold" style={styles.modalConfirmText}>
                  Create Group
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename Group Modal */}
      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText type="subtitle">Rename Meal Group</ThemedText>
            <TextInput
              accessibilityLabel="New meal group name"
              value={renameNewName}
              onChangeText={setRenameNewName}
              placeholder="e.g. Lunch"
              placeholderTextColor="#8A8D91"
              style={[styles.modalInput, { color: theme.text, marginTop: 12 }]}
              autoFocus
            />
            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setRenameTarget(null)}
                style={styles.modalCancelButton}
              >
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Cancel
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => void handleRenameGroup()}
                style={styles.modalConfirmButton}
              >
                <ThemedText type="smallBold" style={styles.modalConfirmText}>
                  Save
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Adjust Portion / Grams Modal */}
      {portionTarget !== null ? (
        <AdjustPortionModal
          portionTarget={portionTarget}
          onClose={() => setPortionTarget(null)}
          onSave={(grams) => void handleApplyPortion(grams)}
          theme={theme}
        />
      ) : null}
    </ThemedView>
  );
}

function MealEntryRow(props: {
  readonly entry: FoodEntry;
  readonly mealVisualsEnabled: boolean;
  readonly showAdvanced: boolean;
  readonly visibleAdvancedFields: ReadonlyArray<string>;
  readonly isGrouping: boolean;
  readonly isSelected: boolean;
  readonly onToggleSelect: () => void;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onRepeat: () => void;
  readonly onResize: () => void;
  readonly onCopy?: () => void;
  readonly onUngroup?: () => void;
  readonly onDelete: () => void;
  readonly inGroup: boolean;
}) {
  const {
    entry,
    mealVisualsEnabled,
    showAdvanced,
    visibleAdvancedFields,
    isGrouping,
    isSelected,
    onToggleSelect,
    busy,
    onEdit,
    onResize,
    onRepeat,
    onCopy,
    onUngroup,
    onDelete,
    inGroup,
  } = props;
  const grams = getEntryGrams(entry);
  const calcText = getEntryCalculationText(entry);

  return (
    <View
      style={[
        styles.entryCard,
        inGroup && styles.childEntryCard,
        isGrouping && isSelected && styles.selectedEntryCard,
      ]}
    >
      <View style={styles.entryHeader}>
        {isGrouping ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            onPress={onToggleSelect}
            style={styles.checkboxContainer}
          >
            <View
              style={[styles.checkbox, isSelected && styles.checkboxChecked]}
            >
              {isSelected ? (
                <ThemedText style={styles.checkboxCheckText}>✓</ThemedText>
              ) : null}
            </View>
          </Pressable>
        ) : null}

        <ThemedText type="smallBold" style={styles.entryName}>
          {entry.name}
        </ThemedText>

        <View style={styles.entryHeaderMeta}>
          {grams !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Adjust ${entry.name} weight`}
              onPress={onResize}
              style={styles.gramsBadge}
            >
              <ThemedText type="smallBold" style={styles.gramsBadgeText}>
                ⚖️ {grams}g
              </ThemedText>
            </Pressable>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {formatMealTime(entry.consumedAt)}
          </ThemedText>
        </View>
      </View>

      {isAutomaticallyLogged(entry.details) ? (
        <ThemedText type="small" themeColor="textSecondary">
          Automatically logged · review if your meal changed
        </ThemedText>
      ) : null}
      <MealVisual
        entryId={entry.id}
        name={entry.name}
        enabled={mealVisualsEnabled}
        hasPhoto={Boolean(entry.photoAssetId)}
        editable
      />
      {/* Semantic Macro Badges */}
      <View style={styles.macroBadgesRow}>
        {entry.caloriesKcal !== null ? (
          <View style={styles.calorieBadge}>
            <ThemedText type="smallBold" style={styles.calorieBadgeText}>
              {entry.caloriesKcal} kcal
            </ThemedText>
          </View>
        ) : null}
        {entry.proteinG !== null ? (
          <View style={styles.proteinBadge}>
            <ThemedText type="small" style={styles.proteinBadgeText}>
              {entry.proteinG}g P
            </ThemedText>
          </View>
        ) : null}
        {entry.carbohydrateG !== null ? (
          <View style={styles.carbsBadge}>
            <ThemedText type="small" style={styles.carbsBadgeText}>
              {entry.carbohydrateG}g C
            </ThemedText>
          </View>
        ) : null}
        {entry.fatG !== null ? (
          <View style={styles.fatBadge}>
            <ThemedText type="small" style={styles.fatBadgeText}>
              {entry.fatG}g F
            </ThemedText>
          </View>
        ) : null}
        {calcText !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View AI calculation in edit"
            onPress={onEdit}
            style={styles.aiCalcBadge}
          >
            <ThemedText type="smallBold" style={styles.aiCalcBadgeText}>
              ✨ AI Calc
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {showAdvanced
        ? advancedNutrientLines([entry], visibleAdvancedFields).map((line) => (
            <ThemedText key={line} type="small" themeColor="textSecondary">
              {line}
            </ThemedText>
          ))
        : null}

      {/* Entry Actions */}
      <View style={styles.entryActions}>
        <EntryAction label="Edit" disabled={busy} onPress={onEdit} />
        <EntryAction label="Repeat" disabled={busy} onPress={onRepeat} />
        <EntryAction label="Resize" disabled={busy} onPress={onResize} />
        {inGroup && onUngroup !== undefined ? (
          <EntryAction label="Ungroup" disabled={busy} onPress={onUngroup} />
        ) : null}
        {!inGroup && onCopy !== undefined ? (
          <EntryAction
            label={busy ? "Working…" : "Copy to Today"}
            disabled={busy}
            onPress={onCopy}
          />
        ) : null}
        <EntryAction
          label="Delete"
          disabled={busy}
          destructive
          onPress={onDelete}
        />
      </View>
    </View>
  );
}

function AdjustPortionModal(props: {
  readonly portionTarget: PortionModalState;
  readonly onClose: () => void;
  readonly onSave: (grams: string) => void;
  readonly theme: { backgroundElement: string; text: string };
}) {
  const { portionTarget, onClose, onSave, theme } = props;
  const [currentGrams, setCurrentGrams] = useState(portionTarget.grams);
  const parsedGrams = Number(currentGrams.trim().replace(",", "."));

  const scaled = useMemo(() => {
    if (!Number.isFinite(parsedGrams) || parsedGrams <= 0) {
      return {
        caloriesKcal: portionTarget.entry.caloriesKcal,
        proteinG: portionTarget.entry.proteinG,
        carbohydrateG: portionTarget.entry.carbohydrateG,
        fatG: portionTarget.entry.fatG,
        fibreG: portionTarget.entry.fibreG,
        saturatedFatG: portionTarget.entry.saturatedFatG,
        totalSugarsG: portionTarget.entry.totalSugarsG,
        sodiumMg: portionTarget.entry.sodiumMg,
        cholesterolMg: portionTarget.entry.cholesterolMg,
      };
    }
    return scaleNutritionFromKnownPortion(
      {
        caloriesKcal: portionTarget.entry.caloriesKcal,
        proteinG: portionTarget.entry.proteinG,
        carbohydrateG: portionTarget.entry.carbohydrateG,
        fatG: portionTarget.entry.fatG,
        fibreG: portionTarget.entry.fibreG,
        saturatedFatG: portionTarget.entry.saturatedFatG,
        totalSugarsG: portionTarget.entry.totalSugarsG,
        sodiumMg: portionTarget.entry.sodiumMg,
        cholesterolMg: portionTarget.entry.cholesterolMg,
        grams: portionTarget.baseGrams,
      },
      parsedGrams,
    );
  }, [parsedGrams, portionTarget]);

  const adjustDelta = (delta: number) => {
    if (!Number.isFinite(parsedGrams) || parsedGrams <= 0) return;
    const base = parsedGrams;
    const next = Math.max(5, Math.round(base + delta));
    setCurrentGrams(String(next));
  };

  const multiply = (factor: number) => {
    const base =
      portionTarget.baseGrams ??
      (Number.isFinite(parsedGrams) && parsedGrams > 0 ? parsedGrams : null);
    if (base === null) return;
    const next = Math.max(5, Math.round(base * factor));
    setCurrentGrams(String(next));
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalKeyboardAvoidingView}
      >
        <ScrollView
          contentContainerStyle={styles.modalScrollableContent}
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText type="subtitle">Adjust Portion (Grams)</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {portionTarget.entry.name}
            </ThemedText>
            {portionTarget.baseGrams === null ? (
              <ThemedText type="small" themeColor="textSecondary">
                Enter the current total weight to set this meal's portion. Its
                nutrition totals will stay unchanged.
              </ThemedText>
            ) : null}

            <View style={styles.gramsInputRow}>
              <TextInput
                accessibilityLabel="Adjust portion weight in grams"
                keyboardType="numeric"
                style={[styles.modalInput, { flex: 1, color: theme.text }]}
                value={currentGrams}
                onChangeText={setCurrentGrams}
                autoFocus
              />
              <ThemedText type="smallBold" style={styles.gramsUnit}>
                grams
              </ThemedText>
            </View>

            {/* Stepper buttons */}
            <View style={styles.chipsRow}>
              <ChipButton label="-50g" onPress={() => adjustDelta(-50)} />
              <ChipButton label="-10g" onPress={() => adjustDelta(-10)} />
              <ChipButton label="+10g" onPress={() => adjustDelta(10)} />
              <ChipButton label="+50g" onPress={() => adjustDelta(50)} />
              <ChipButton label="0.5x" onPress={() => multiply(0.5)} />
              <ChipButton label="1.5x" onPress={() => multiply(1.5)} />
              <ChipButton label="2x" onPress={() => multiply(2)} />
            </View>

            {/* Dynamic live nutrition preview */}
            <View style={styles.previewBox}>
              <ThemedText type="smallBold" style={styles.previewTitle}>
                Recalculated values:
              </ThemedText>
              <View style={styles.macroBadgesRow}>
                {scaled.caloriesKcal !== null ? (
                  <View style={styles.calorieBadge}>
                    <ThemedText
                      type="smallBold"
                      style={styles.calorieBadgeText}
                    >
                      {scaled.caloriesKcal} kcal
                    </ThemedText>
                  </View>
                ) : null}
                {scaled.proteinG !== null ? (
                  <View style={styles.proteinBadge}>
                    <ThemedText type="small" style={styles.proteinBadgeText}>
                      {scaled.proteinG}g P
                    </ThemedText>
                  </View>
                ) : null}
                {scaled.carbohydrateG !== null ? (
                  <View style={styles.carbsBadge}>
                    <ThemedText type="small" style={styles.carbsBadgeText}>
                      {scaled.carbohydrateG}g C
                    </ThemedText>
                  </View>
                ) : null}
                {scaled.fatG !== null ? (
                  <View style={styles.fatBadge}>
                    <ThemedText type="small" style={styles.fatBadgeText}>
                      {scaled.fatG}g F
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.modalActionsRow}>
              <Pressable onPress={onClose} style={styles.modalCancelButton}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Cancel
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => onSave(currentGrams)}
                style={styles.modalConfirmButton}
              >
                <ThemedText type="smallBold" style={styles.modalConfirmText}>
                  Apply & Save
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ChipButton(props: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [styles.chipButton, pressed && styles.pressed]}
    >
      <ThemedText type="smallBold" style={styles.chipButtonText}>
        {props.label}
      </ThemedText>
    </Pressable>
  );
}

function EntryAction(props: {
  readonly label: string;
  readonly disabled: boolean;
  readonly destructive?: boolean;
  readonly groupAction?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} meal`}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.entryAction,
        props.groupAction === true && styles.entryGroupAction,
        props.destructive === true && styles.entryActionDestructive,
        (pressed || props.disabled) && styles.pressed,
      ]}
    >
      <ThemedText
        type="small"
        style={[
          styles.entryActionLabel,
          props.destructive === true ? styles.destructiveText : undefined,
        ]}
      >
        {props.label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  header: { gap: Spacing.one },
  logMealHeroCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  logMealIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  logMealIcon: {
    fontSize: 20,
  },
  logMealBody: {
    flex: 1,
    gap: 2,
  },
  logMealBadge: {
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
    paddingVertical: 7,
    borderRadius: 10,
  },
  logMealBadgeText: {
    color: "#ffffff",
    fontSize: 12,
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    color: "#64748B",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  searchRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchIcon: {
    fontSize: 16,
  },
  searchInput: {
    minHeight: 46,
    flex: 1,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  clearSearchButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  messageCard: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  inlineButton: {
    minHeight: 36,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  emptyCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
  },
  emptyStateDesc: {
    lineHeight: 19,
  },
  emptyAddButton: {
    backgroundColor: "#10B981",
    paddingVertical: 9,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    alignSelf: "flex-start",
    marginTop: Spacing.one,
  },
  emptyAddButtonText: {
    color: "#ffffff",
  },
  groupList: { gap: Spacing.four },
  dayGroupCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
  },
  dayHeader: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148, 163, 184, 0.12)",
  },
  dayTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  dayTitle: {
    fontSize: 16,
    lineHeight: 22,
    flexGrow: 1,
    flexBasis: 180,
    maxWidth: "100%",
  },
  dayMetadata: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  dayNutrition: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: Spacing.three,
    rowGap: Spacing.one,
  },
  dayNutrient: {
    fontSize: 13,
    maxWidth: "100%",
  },
  dayCalories: {
    width: "100%",
  },
  dayActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  dayAddButton: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 12,
    justifyContent: "center",
    maxWidth: "100%",
  },
  eveningCatchUpBanner: {
    borderRadius: 16,
    borderWidth: 1,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  eveningBannerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  eveningBannerIcon: {
    fontSize: 20,
    marginTop: 2,
  },
  eveningBannerContent: {
    flex: 1,
    gap: 2,
  },
  eveningSupportiveNote: {
    fontStyle: "italic",
    color: "#64748B",
    fontSize: 12,
    marginTop: 2,
  },
  eveningBannerDismiss: {
    padding: Spacing.half,
  },
  partialBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  partialBadgeText: {
    fontSize: 11,
    color: "#D97706",
    fontWeight: "700",
  },
  groupActionTrigger: {
    minHeight: 48,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    justifyContent: "center",
    maxWidth: "100%",
  },
  groupingToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: Spacing.two,
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: 10,
    marginTop: 2,
  },
  groupingCountText: {
    fontSize: 12,
  },
  groupingToolbarActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  groupConfirmBtn: {
    minHeight: 48,
    justifyContent: "center",
    backgroundColor: "#047857",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  groupConfirmBtnText: {
    color: "#ffffff",
    fontSize: 12,
  },
  groupCancelBtn: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  disabledBtn: {
    opacity: 0.4,
  },
  paginationFooter: {
    paddingVertical: Spacing.four,
    alignItems: "center",
    gap: Spacing.two,
  },
  loadingMoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  partialCutoffNotice: {
    textAlign: "center",
    paddingHorizontal: Spacing.four,
    color: "#D97706",
  },
  loadMoreButton: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  loadMoreButtonText: {
    color: "#10B981",
    fontSize: 13,
  },
  historyEndNotice: {
    fontSize: 12,
    textAlign: "center",
    paddingVertical: Spacing.two,
  },
  dayEntries: { gap: Spacing.two },
  clusterContainer: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
    backgroundColor: "rgba(16, 185, 129, 0.04)",
  },
  clusterHeader: {
    gap: Spacing.two,
  },
  clusterHeaderLeft: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    minWidth: 0,
    gap: 6,
  },
  clusterIcon: {
    fontSize: 16,
  },
  clusterTitle: {
    fontSize: 15,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 120,
    minWidth: 0,
  },
  clusterCountBadge: {
    flexShrink: 0,
    maxWidth: "100%",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  clusterHeaderActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  clusterTotalsText: {
    fontSize: 12,
    color: "#10B981",
    fontWeight: "600",
  },
  clusterChildrenList: {
    gap: Spacing.two,
    marginTop: 2,
  },
  childEntryCard: {
    borderLeftWidth: 3,
    borderLeftColor: "#10B981",
    backgroundColor: "rgba(148, 163, 184, 0.06)",
  },
  entryCard: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
    backgroundColor: "rgba(148, 163, 184, 0.04)",
  },
  selectedEntryCard: {
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  entryHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  checkboxContainer: {
    paddingRight: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#94A3B8",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: "#10B981",
    borderColor: "#10B981",
  },
  checkboxCheckText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  entryName: { flex: 1, fontSize: 15 },
  gramsBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  gramsBadgeText: {
    fontSize: 11,
    color: "#10B981",
  },
  macroBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  calorieBadge: {
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  calorieBadgeText: {
    fontSize: 12,
  },
  proteinBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  proteinBadgeText: {
    fontSize: 11,
    color: "#10B981",
    fontWeight: "700",
  },
  carbsBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  carbsBadgeText: {
    fontSize: 11,
    color: "#F59E0B",
    fontWeight: "700",
  },
  fatBadge: {
    backgroundColor: "rgba(139, 92, 246, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  fatBadgeText: {
    fontSize: 11,
    color: "#8B5CF6",
    fontWeight: "700",
  },
  aiCalcBadge: {
    backgroundColor: "rgba(168, 85, 247, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  aiCalcBadgeText: {
    fontSize: 11,
    color: "#9333EA",
    fontWeight: "700",
  },
  entryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.1)",
    paddingTop: Spacing.one,
  },
  entryAction: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.1)",
  },
  entryGroupAction: {
    minHeight: 44,
    maxWidth: "100%",
    flexShrink: 1,
    justifyContent: "center",
  },
  entryActionDestructive: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  entryActionLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  pressed: { opacity: 0.6 },
  destructiveText: { color: "#EF4444" },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.four,
  },
  modalKeyboardAvoidingView: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  modalScrollableContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.four,
  },
  modalCard: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  modalPresetsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  presetChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
  },
  presetChipActive: {
    backgroundColor: "#10B981",
  },
  presetChipText: {
    fontSize: 12,
    color: "#64748B",
  },
  presetChipTextActive: {
    fontSize: 12,
    color: "#FFFFFF",
  },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.two,
    padding: Spacing.three,
    fontSize: 16,
  },
  gramsInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  gramsUnit: {
    fontSize: 16,
    color: "#10B981",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chipButton: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  chipButtonText: {
    fontSize: 11,
    color: "#059669",
  },
  previewBox: {
    padding: Spacing.three,
    borderRadius: 12,
    backgroundColor: "rgba(16, 185, 129, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.15)",
    gap: 6,
  },
  previewTitle: {
    fontSize: 12,
    color: "#059669",
  },
  modalActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  modalCancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  modalConfirmButton: {
    backgroundColor: "#10B981",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  modalConfirmText: {
    color: "#FFFFFF",
    fontSize: 13,
  },
});
