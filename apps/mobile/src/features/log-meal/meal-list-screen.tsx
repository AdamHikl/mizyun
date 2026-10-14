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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type { DailyFoodSummary, FoodEntry } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TabHeader, useTabHeaderLayout } from "@/components/tab-header";
import {
  BottomTabInset,
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
  type ThemeColors,
} from "@/constants/theme";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  IconBadge,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  SectionHeader,
} from "@/components/ui";
import { analyticsClient } from "@/composition/analytics-client";
import { isAutomaticallyLogged } from "@/features/recurring-meals/public-data";
import { RecurringMealSuggestionCard } from "@/features/recurring-meals";
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
  readFoodHistorySnapshot,
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
  type FoodHistoryResult,
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

const stateFromHistory = (result: FoodHistoryResult | null): MealListState =>
  result
    ? {
        ...INITIAL_STATE,
        ...result,
        loading: false,
        nextCursor: result.nextCursor ?? null,
        cutoffDateIsPartial: result.cutoffDateIsPartial ?? false,
      }
    : INITIAL_STATE;

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
  const [storedWeeklySummaries, setWeeklySummaries] =
    useState<ReadonlyArray<DailyFoodSummary> | null>(null);
  const userId = session?.user?.id ?? null;
  const ownerKey = `${userId ?? ""}:${session?.accessToken ?? ""}`;
  const [prefetchRevision, setPrefetchRevision] = useState(0);
  useEffect(
    () =>
      subscribeSessionReadUpdates(() =>
        setPrefetchRevision((value) => value + 1),
      ),
    [],
  );
  const readVersion = getSessionReadVersion();
  const initialHistory = useMemo(
    () => readFoodHistorySnapshot(session),
    [ownerKey, prefetchRevision, readVersion],
  );
  const currentOwner = useRef(ownerKey);
  currentOwner.current = ownerKey;
  const requestVersion = useRef(0);
  const loaded = useRef(initialHistory !== null);
  const paginationPending = useRef(false);
  const historyReadPending = useRef(false);
  const addMealDate = useRef<string | null>(null);
  const lastLoad = useRef<{ version: string; completedAt: number } | null>(
    null,
  );
  useEffect(() => setWeeklySummaries(null), [userId]);
  const params = useLocalSearchParams<{ source?: string }>();
  const [storedState, setStoredState] = useState(() => ({
    ...stateFromHistory(initialHistory),
    ownerKey,
  }));
  const ownsDisplay = storedState.ownerKey === ownerKey;
  const weeklySummaries = ownsDisplay ? storedWeeklySummaries : null;
  const state =
    storedState.ownerKey === ownerKey &&
    (loaded.current || initialHistory === null)
      ? storedState
      : stateFromHistory(initialHistory);
  const setState = useCallback(
    (next: SetStateAction<MealListState>) => {
      setStoredState((current) => ({
        ...(typeof next === "function"
          ? next(
              current.ownerKey === ownerKey
                ? current
                : stateFromHistory(initialHistory),
            )
          : next),
        ownerKey,
      }));
    },
    [ownerKey, initialHistory],
  );
  const [dismissEveningBanner, setDismissEveningBanner] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [storedSearchQuery, setSearchQuery] = useState("");
  const [searchAttempt, setSearchAttempt] = useState(0);
  const searchSessionIdRef = useRef(0);
  const searchPaginationPending = useRef<number | null>(null);

  // Grouping selection state
  const [storedGroupingDate, setGroupingDate] = useState<string | null>(null);
  const [storedSelectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set(),
  );
  const [storedShowGroupModal, setShowGroupModal] = useState(false);
  const [groupModalName, setGroupModalName] = useState("Breakfast");

  // Rename group state
  const [storedRenameTarget, setRenameTarget] = useState<DayMealCluster | null>(
    null,
  );
  const [renameNewName, setRenameNewName] = useState("");

  // Portion adjusting modal state
  const [storedPortionTarget, setPortionTarget] =
    useState<PortionModalState | null>(null);

  const [storedServerSearch, setServerSearch] =
    useState<MealSearchState | null>(null);

  // Which entry or meal group currently shows its secondary actions.
  const [storedOpenActionsKey, setOpenActionsKey] = useState<string | null>(
    null,
  );

  const searchQuery = ownsDisplay ? storedSearchQuery : "";
  const groupingDate = ownsDisplay ? storedGroupingDate : null;
  const selectedEntryIds = ownsDisplay
    ? storedSelectedEntryIds
    : new Set<string>();
  const showGroupModal = ownsDisplay ? storedShowGroupModal : false;
  const renameTarget = ownsDisplay ? storedRenameTarget : null;
  const portionTarget = ownsDisplay ? storedPortionTarget : null;
  const serverSearch = ownsDisplay ? storedServerSearch : null;
  const openActionsKey = ownsDisplay ? storedOpenActionsKey : null;
  useEffect(() => {
    requestVersion.current += 1;
    loaded.current = initialHistory !== null;
    paginationPending.current = false;
    historyReadPending.current = false;
    lastLoad.current = null;
    addMealDate.current = null;
    setState(stateFromHistory(initialHistory));
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
    setOpenActionsKey(null);
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
        isCurrent: () => requestOwner === currentOwner.current,
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
      if (requestOwner === currentOwner.current && result.message)
        setState((current) => ({ ...current, message: result.message! }));
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

  const toggleActions = useCallback((key: string) => {
    setOpenActionsKey((current) => (current === key ? null : key));
  }, []);

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Meals" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <TabHeader title="Meals" onLayout={onHeaderLayout} />
        <ScrollView
          style={{ marginTop: -headerHeight }}
          contentContainerStyle={[
            styles.content,
            { paddingTop: headerHeight + Spacing.two },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <Button
            label="Log meal"
            icon="add"
            block
            accessibilityRole="button"
            accessibilityLabel="Log meal"
            accessibilityHint="Add a photo or enter food manually"
            onPress={() => router.push("/log-meal" as Href)}
          />

          <ListGroup>
            <ListRow
              key="cook"
              icon="cook"
              title="What can I cook?"
              subtitle="Ideas from your ingredients"
              accessibilityRole="button"
              accessibilityLabel="What can I cook?"
              accessibilityHint="Find recipe ideas from your ingredients"
              onPress={() => router.push("/meal-recipes" as Href)}
            />
            <ListRow
              key="recurring"
              icon="repeat"
              iconTone="info"
              title="Recurring meals"
              subtitle="Meals that log on a schedule"
              accessibilityRole="button"
              accessibilityLabel="Recurring meals"
              accessibilityHint="Manage meals that log on a schedule"
              onPress={() => router.push("/recurring-meals" as Href)}
            />
          </ListGroup>

          <RecurringMealSuggestionCard
            userId={userId}
            hidden={
              showGroupModal || renameTarget !== null || portionTarget !== null
            }
          />

          {state.message !== null ? (
            <Card>
              <ThemedText type="small" accessibilityRole="alert">
                {state.message}
              </ThemedText>
              <Button
                label="Retry"
                variant="plain"
                size="small"
                accessibilityLabel="Retry loading logged meals"
                onPress={() => void load()}
              />
            </Card>
          ) : null}

          {/* History Section */}
          <View style={styles.section}>
            <SectionHeader
              title="History"
              action={
                <ThemedText
                  type="footnote"
                  themeColor="textSecondary"
                  accessibilityLiveRegion="polite"
                >
                  {historySummary}
                </ThemedText>
              }
            />

            <View
              style={[
                styles.searchRow,
                { backgroundColor: theme.backgroundSelected },
              ]}
            >
              <Icon name="search" size={17} color="textSecondary" />
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
                <IconButton
                  icon="close"
                  variant="plain"
                  accessibilityLabel="Clear meal search"
                  onPress={() => setSearchQuery("")}
                />
              ) : null}
            </View>

            {advancedCapability.enabled ? (
              <ListGroup>
                <ListRow
                  key="nutrients"
                  icon="chart"
                  iconTone="fat"
                  title="More nutrients"
                  subtitle="Weekly and per-meal details"
                  chevron={false}
                  trailing={
                    <Icon
                      name={showAdvanced ? "chevronUp" : "chevronDown"}
                      size={14}
                      color="textTertiary"
                    />
                  }
                  accessibilityLabel={
                    showAdvanced
                      ? "Hide more nutrient totals"
                      : "Show more nutrient totals"
                  }
                  accessibilityHint="Shows nutrient details for this week and logged meals"
                  accessibilityState={{ expanded: showAdvanced }}
                  onPress={() => setShowAdvanced((value) => !value)}
                />
              </ListGroup>
            ) : null}
            {advancedCapability.enabled && showAdvanced ? (
              <Card>
                <ThemedText type="headline" accessibilityRole="header">
                  This week · more nutrients
                </ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Completeness reflects nutrient values in logged meals, not
                  everything you ate.
                </ThemedText>
                <View style={styles.chipWrap}>
                  {ADVANCED_DISPLAY_FIELDS.map(({ key, label }) => {
                    const checked = visibleAdvancedFields.includes(key);
                    return (
                      <Pressable
                        key={key}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        accessibilityLabel={`Show ${label}`}
                        onPress={() =>
                          setVisibleAdvancedFields((current) =>
                            current.includes(key)
                              ? current.filter((item) => item !== key)
                              : [...current, key],
                          )
                        }
                        style={({ pressed }) => [
                          styles.toggleChip,
                          {
                            backgroundColor: checked
                              ? theme.primaryLight
                              : theme.backgroundSelected,
                          },
                          pressed && styles.pressed,
                        ]}
                      >
                        {checked ? (
                          <Icon name="check" size={13} color="primary" />
                        ) : null}
                        <ThemedText
                          type="footnote"
                          themeColor={checked ? "primary" : "text"}
                        >
                          {label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
                {weeklySummaries === null ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Weekly nutrient summary unavailable.
                  </ThemedText>
                ) : (
                  weeklyAdvancedNutrientLines(
                    weeklySummaries,
                    visibleAdvancedFields,
                  ).map((line) => (
                    <ThemedText
                      key={line}
                      type="footnote"
                      themeColor="textSecondary"
                    >
                      {line}
                    </ThemedText>
                  ))
                )}
              </Card>
            ) : null}

            {state.loading && state.groups.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Loading logged meals…
              </ThemedText>
            ) : null}

            {hasSearchQuery && serverSearch?.error ? (
              <Card accessibilityRole="alert">
                <ThemedText type="small">
                  {serverSearch.error.message}
                </ThemedText>
                {serverSearch.error.phase === "initial" &&
                localFilteredGroups.length > 0 ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Showing matches from meals already loaded on this device.
                  </ThemedText>
                ) : null}
                <Button
                  label="Retry"
                  variant="plain"
                  size="small"
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
                />
              </Card>
            ) : null}

            {hasSearchQuery &&
            shouldShowNoMealSearchMatches(
              serverSearch,
              displayGroups.length,
            ) ? (
              <Card accessibilityRole="alert">
                <EmptyState
                  icon="search"
                  title={`No meals match “${searchQuery}”`}
                  message="Check the spelling or clear the search."
                  action={
                    <Button
                      label="Clear search"
                      variant="secondary"
                      size="small"
                      accessibilityLabel="Clear search"
                      onPress={() => setSearchQuery("")}
                      style={styles.centered}
                    />
                  }
                />
              </Card>
            ) : null}

            {!hasSearchQuery &&
            !state.loading &&
            state.groups.length === 0 &&
            state.message === null ? (
              <Card accessibilityRole="alert">
                <EmptyState
                  icon="fork"
                  title="Nothing logged yet"
                  message="Logged meals appear here by day, with calories and macros."
                  action={
                    <Button
                      label="Log your first meal"
                      variant="tinted"
                      size="small"
                      icon="add"
                      accessibilityLabel="Log your first meal"
                      onPress={() => router.push("/log-meal" as Href)}
                      style={styles.centered}
                    />
                  }
                />
              </Card>
            ) : null}

            {params.source === "evening_catch_up_reminder" &&
            !dismissEveningBanner ? (
              <Notice
                tone="success"
                title="Evening catch-up"
                message="Anything else to add from today? Consistency matters more than perfection."
                action={
                  <Button
                    label="Dismiss"
                    variant="plain"
                    size="small"
                    accessibilityLabel="Dismiss evening reminder banner"
                    onPress={() => setDismissEveningBanner(true)}
                  />
                }
              />
            ) : null}

            <View style={styles.groupList}>
              {displayGroups.map((group) => {
                const isGroupingThisDay = groupingDate === group.date;
                const clusters = clusterDayEntries(group.entries);
                const rowProps = (entry: FoodEntry) => ({
                  entry,
                  mealVisualsEnabled: mealVisualCapability.enabled,
                  showAdvanced: advancedCapability.enabled && showAdvanced,
                  visibleAdvancedFields,
                  isGrouping: isGroupingThisDay,
                  isSelected: selectedEntryIds.has(entry.id),
                  onToggleSelect: () => toggleSelectEntry(entry.id),
                  busy: busyEntryId === entry.id,
                  actionsOpen: openActionsKey === `entry:${entry.id}`,
                  onToggleActions: () => toggleActions(`entry:${entry.id}`),
                  onEdit: () =>
                    router.push(
                      `/edit-meal?id=${encodeURIComponent(entry.id)}` as Href,
                    ),
                  onRepeat: () =>
                    router.push(
                      `/recurring-meals?sourceEntryId=${encodeURIComponent(entry.id)}` as Href,
                    ),
                  onResize: () => openPortionAdjuster(entry),
                  onDelete: () => confirmDelete(entry),
                });

                return (
                  <Card key={group.date} style={styles.dayCard}>
                    {/* Day identity and totals stay separate from actions. */}
                    <View style={styles.dayTitleRow}>
                      <ThemedText
                        type="headline"
                        accessibilityRole="header"
                        style={styles.dayTitle}
                      >
                        {group.displayDate}
                      </ThemedText>
                      <View style={styles.inlineWrap}>
                        <ThemedText type="footnote" themeColor="textSecondary">
                          {group.summary.entryCount}{" "}
                          {group.summary.entryCount === 1 ? "meal" : "meals"}
                        </ThemedText>
                        {group.isPartial ? (
                          <View
                            style={[
                              styles.pill,
                              { backgroundColor: theme.warningLight },
                            ]}
                          >
                            <ThemedText type="caption" themeColor="warning">
                              Partial
                            </ThemedText>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    {isGroupingThisDay ? (
                      <View
                        style={[
                          styles.groupingToolbar,
                          { backgroundColor: theme.primaryLight },
                        ]}
                      >
                        <ThemedText
                          type="footnote"
                          themeColor="textSecondary"
                          style={styles.flexGrow}
                        >
                          {selectedEntryIds.size} selected
                        </ThemedText>
                        <View style={styles.inlineWrap}>
                          <Button
                            label="Group as…"
                            variant="primary"
                            size="small"
                            accessibilityLabel="Confirm grouping selected meals"
                            disabled={selectedEntryIds.size < 2}
                            onPress={() => setShowGroupModal(true)}
                          />
                          <Button
                            label="Cancel"
                            variant="plain"
                            size="small"
                            accessibilityLabel="Cancel grouping meals"
                            onPress={cancelGrouping}
                          />
                        </View>
                      </View>
                    ) : (
                      <View style={styles.inlineWrap}>
                        {hasSearchQuery || group.isPartial ? (
                          <ThemedText
                            type="footnote"
                            themeColor="textSecondary"
                          >
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
                              type={index === 0 ? "smallBold" : "footnote"}
                              themeColor={
                                index === 0 ? "text" : "textSecondary"
                              }
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
                          <ThemedText
                            type="footnote"
                            themeColor="textSecondary"
                          >
                            No nutrition totals
                          </ThemedText>
                        ) : null}
                      </View>
                    )}

                    {advancedCapability.enabled && showAdvanced
                      ? advancedNutrientLines(
                          group.entries,
                          visibleAdvancedFields,
                        ).map((line) => (
                          <ThemedText
                            key={line}
                            type="footnote"
                            themeColor="textSecondary"
                          >
                            {group.isPartial ? "Partial loaded history · " : ""}
                            {line}
                          </ThemedText>
                        ))
                      : null}

                    {/* Day Entries List (clusters & standalone meals) */}
                    <View
                      style={[
                        styles.dayEntries,
                        { borderTopColor: theme.separator },
                      ]}
                    >
                      {clusters.map((clusterItem, index) => {
                        if (clusterItem.kind === "group") {
                          const clusterKey = `cluster:${clusterItem.id}`;
                          const clusterActionsOpen =
                            openActionsKey === clusterKey;
                          return (
                            <View
                              key={`cluster-${clusterItem.id}-${index}`}
                              style={[
                                styles.cluster,
                                { backgroundColor: theme.background },
                              ]}
                            >
                              <View style={styles.clusterHeader}>
                                <IconBadge name="fork" size={26} />
                                <View style={styles.flexGrow}>
                                  <ThemedText
                                    type="headline"
                                    accessibilityRole="header"
                                  >
                                    {clusterItem.name}
                                  </ThemedText>
                                  <ThemedText
                                    type="footnote"
                                    themeColor="textSecondary"
                                  >
                                    {clusterItem.entries.length} items ·{" "}
                                    {formatGroupNutrition(clusterItem.summary)}
                                  </ThemedText>
                                </View>
                                <IconButton
                                  icon="more"
                                  variant="plain"
                                  accessibilityLabel={`More actions for ${clusterItem.name}`}
                                  accessibilityState={{
                                    expanded: clusterActionsOpen,
                                  }}
                                  onPress={() => toggleActions(clusterKey)}
                                />
                              </View>
                              {clusterActionsOpen ? (
                                <View style={styles.chipWrap}>
                                  <Button
                                    label="Rename"
                                    variant="tinted"
                                    size="small"
                                    icon="edit"
                                    accessibilityLabel="Rename meal"
                                    disabled={busyEntryId !== null}
                                    onPress={() => {
                                      setRenameTarget(clusterItem);
                                      setRenameNewName(clusterItem.name);
                                    }}
                                  />
                                  <Button
                                    label="Ungroup all"
                                    variant="secondary"
                                    size="small"
                                    accessibilityLabel="Ungroup all meal"
                                    disabled={busyEntryId !== null}
                                    onPress={() =>
                                      void handleUngroupAll(clusterItem)
                                    }
                                  />
                                </View>
                              ) : null}

                              {clusterItem.entries.map((child) => (
                                <MealEntryRow
                                  key={child.id}
                                  {...rowProps(child)}
                                  onUngroup={() =>
                                    void handleUngroupItem(child)
                                  }
                                  inGroup
                                />
                              ))}
                            </View>
                          );
                        }

                        // Standalone Meal Entry
                        return (
                          <MealEntryRow
                            key={clusterItem.entry.id}
                            {...rowProps(clusterItem.entry)}
                            onCopy={() => void copy(clusterItem.entry)}
                            inGroup={false}
                          />
                        );
                      })}
                    </View>

                    {!isGroupingThisDay ? (
                      <View style={styles.inlineWrap}>
                        <Button
                          testID={`add-meal-${group.date}`}
                          label="Add meal"
                          variant="tinted"
                          size="small"
                          icon="add"
                          accessibilityLabel={`Add meal on ${group.displayDate}`}
                          accessibilityHint="Opens a new meal entry for this day"
                          onPress={() => {
                            addMealDate.current = group.date;
                            router.push({
                              pathname: "/log-meal",
                              params: { date: group.date },
                            });
                          }}
                        />
                        {group.entries.length >= 2 ? (
                          <Button
                            label="Group meals"
                            variant="plain"
                            size="small"
                            accessibilityLabel={`Group meals on ${group.displayDate}`}
                            accessibilityHint="Select at least two entries to combine into a meal group"
                            onPress={() => startGrouping(group.date)}
                          />
                        ) : null}
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </View>

            {/* Pagination / History Continuation Footer */}
            {hasSearchQuery ? (
              <View style={styles.paginationFooter}>
                {serverSearch?.loadingMore ? (
                  <View style={styles.loadingMoreRow}>
                    <ActivityIndicator size="small" color={theme.primary} />
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Loading more matching meals…
                    </ThemedText>
                  </View>
                ) : serverSearch?.nextCursor &&
                  serverSearch.error?.phase !== "load-more" ? (
                  <Button
                    label="Load more matching meals"
                    variant="tinted"
                    size="small"
                    accessibilityLabel="Load more matching meals"
                    onPress={() => void loadMoreSearch()}
                    style={styles.centered}
                  />
                ) : serverSearch &&
                  !serverSearch.loading &&
                  !serverSearch.nextCursor &&
                  serverSearch.error === null &&
                  serverSearch.entries.length > 0 ? (
                  <ThemedText
                    type="footnote"
                    themeColor="textTertiary"
                    style={styles.centerText}
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
                    <ActivityIndicator size="small" color={theme.primary} />
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Loading older meals…
                    </ThemedText>
                  </View>
                ) : state.nextCursor ? (
                  <>
                    {state.cutoffDateIsPartial ? (
                      <ThemedText
                        type="footnote"
                        themeColor="warning"
                        style={styles.centerText}
                      >
                        The oldest day continues on the next page. Load older
                        meals to complete its totals.
                      </ThemedText>
                    ) : null}
                    <Button
                      label="Load older meals"
                      variant="tinted"
                      size="small"
                      accessibilityLabel="Load older meals"
                      onPress={() => void loadMore()}
                      style={styles.centered}
                    />
                  </>
                ) : !state.loading && state.entries.length > 0 ? (
                  <ThemedText
                    type="footnote"
                    themeColor="textTertiary"
                    style={styles.centerText}
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
        <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText type="title3" accessibilityRole="header">
              Group meals
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              Combine {selectedEntryIds.size} items into one meal. Each item
              stays editable.
            </ThemedText>

            <View style={styles.chipWrap}>
              {MEAL_GROUP_PRESETS.map((preset) => {
                const selected = groupModalName === preset;
                return (
                  <Pressable
                    key={preset}
                    accessibilityRole="button"
                    accessibilityLabel={preset}
                    accessibilityState={{ selected }}
                    onPress={() => setGroupModalName(preset)}
                    style={({ pressed }) => [
                      styles.toggleChip,
                      {
                        backgroundColor: selected
                          ? theme.primary
                          : theme.backgroundSelected,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <ThemedText
                      type="smallBold"
                      style={{
                        color: selected ? theme.onPrimary : theme.text,
                      }}
                    >
                      {preset}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              accessibilityLabel="Meal group name input"
              value={groupModalName}
              onChangeText={setGroupModalName}
              placeholder="e.g. Post-workout meal"
              placeholderTextColor={theme.textTertiary}
              style={[
                styles.modalInput,
                { color: theme.text, borderColor: theme.border },
              ]}
            />

            <View style={styles.modalActionsRow}>
              <Button
                label="Cancel"
                variant="secondary"
                size="small"
                onPress={() => setShowGroupModal(false)}
              />
              <Button
                label="Create group"
                size="small"
                onPress={() => void handleCreateGroup()}
              />
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
        <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText type="title3" accessibilityRole="header">
              Rename meal group
            </ThemedText>
            <TextInput
              accessibilityLabel="New meal group name"
              value={renameNewName}
              onChangeText={setRenameNewName}
              placeholder="e.g. Lunch"
              placeholderTextColor={theme.textTertiary}
              style={[
                styles.modalInput,
                { color: theme.text, borderColor: theme.border },
              ]}
              autoFocus
            />
            <View style={styles.modalActionsRow}>
              <Button
                label="Cancel"
                variant="secondary"
                size="small"
                onPress={() => setRenameTarget(null)}
              />
              <Button
                label="Save"
                size="small"
                onPress={() => void handleRenameGroup()}
              />
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

/** One quiet line of calories and macros; unknown values are omitted. */
function MacroLine(props: {
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
}) {
  const parts = (
    [
      [props.caloriesKcal, " kcal", "text"],
      [props.proteinG, "g P", "protein"],
      [props.carbohydrateG, "g C", "carbs"],
      [props.fatG, "g F", "fat"],
    ] as const
  ).filter(([value]) => value !== null);
  if (parts.length === 0) return null;
  return (
    <ThemedText type="footnote" themeColor="textSecondary">
      {parts.map(([value, unit, color], index) => (
        <ThemedText key={unit} type="footnote" themeColor={color}>
          {index > 0 ? " · " : ""}
          {value}
          {unit}
        </ThemedText>
      ))}
    </ThemedText>
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
  readonly actionsOpen: boolean;
  readonly onToggleActions: () => void;
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
    actionsOpen,
    onToggleActions,
    onEdit,
    onResize,
    onRepeat,
    onCopy,
    onUngroup,
    onDelete,
    inGroup,
  } = props;
  const theme = useTheme();
  const grams = getEntryGrams(entry);
  const calcText = getEntryCalculationText(entry);
  const time = formatMealTime(entry.consumedAt);
  const meta = grams !== null ? `${time} · ${grams} g` : time;

  return (
    <View
      style={[
        styles.entry,
        { borderTopColor: theme.separator },
        inGroup && styles.childEntry,
      ]}
    >
      <View style={styles.entryHeader}>
        <Pressable
          accessibilityRole={isGrouping ? "checkbox" : "button"}
          accessibilityLabel={`${entry.name}, ${meta}`}
          accessibilityHint={
            isGrouping ? "Selects this meal for grouping" : "Opens the meal"
          }
          accessibilityState={isGrouping ? { checked: isSelected } : undefined}
          onPress={isGrouping ? onToggleSelect : onEdit}
          style={({ pressed }) => [styles.entryMain, pressed && styles.pressed]}
        >
          {isGrouping ? (
            isSelected ? (
              <Icon name="checkCircle" size={22} color="primary" />
            ) : (
              <View
                style={[styles.checkbox, { borderColor: theme.textTertiary }]}
              />
            )
          ) : null}
          <View style={styles.entryText}>
            <ThemedText type="default">{entry.name}</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {meta}
            </ThemedText>
            <MacroLine
              caloriesKcal={entry.caloriesKcal}
              proteinG={entry.proteinG}
              carbohydrateG={entry.carbohydrateG}
              fatG={entry.fatG}
            />
            {isAutomaticallyLogged(entry.details) ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                Logged automatically · review if your meal changed
              </ThemedText>
            ) : null}
          </View>
        </Pressable>
        {isGrouping ? null : busy ? (
          <ActivityIndicator
            size="small"
            color={theme.textSecondary}
            style={styles.busyIndicator}
          />
        ) : null}
        {isGrouping ? null : (
          <IconButton
            icon="more"
            variant="plain"
            accessibilityLabel={`More actions for ${entry.name}`}
            accessibilityState={{ expanded: actionsOpen }}
            onPress={onToggleActions}
          />
        )}
      </View>

      <MealVisual
        entryId={entry.id}
        name={entry.name}
        enabled={mealVisualsEnabled}
        hasPhoto={Boolean(entry.photoAssetId)}
        editable
      />

      {showAdvanced
        ? advancedNutrientLines([entry], visibleAdvancedFields).map((line) => (
            <ThemedText key={line} type="footnote" themeColor="textSecondary">
              {line}
            </ThemedText>
          ))
        : null}

      {actionsOpen && !isGrouping ? (
        <View style={styles.chipWrap}>
          <Button
            label="Edit"
            variant="tinted"
            size="small"
            icon="edit"
            accessibilityLabel="Edit meal"
            disabled={busy}
            onPress={onEdit}
          />
          {calcText !== null ? (
            <Button
              label="AI calculation"
              variant="secondary"
              size="small"
              icon="sparkles"
              accessibilityLabel="View AI calculation in edit"
              onPress={onEdit}
            />
          ) : null}
          <Button
            label="Repeat"
            variant="secondary"
            size="small"
            icon="repeat"
            accessibilityLabel="Repeat meal"
            disabled={busy}
            onPress={onRepeat}
          />
          <Button
            label={grams !== null ? `Resize · ${grams} g` : "Resize"}
            variant="secondary"
            size="small"
            icon="scale"
            accessibilityLabel="Resize meal"
            accessibilityHint={
              grams !== null
                ? `Adjust ${entry.name} weight from ${grams} grams`
                : undefined
            }
            disabled={busy}
            onPress={onResize}
          />
          {inGroup && onUngroup !== undefined ? (
            <Button
              label="Ungroup"
              variant="secondary"
              size="small"
              accessibilityLabel="Ungroup meal"
              disabled={busy}
              onPress={onUngroup}
            />
          ) : null}
          {!inGroup && onCopy !== undefined ? (
            <Button
              label={busy ? "Working…" : "Copy to Today"}
              variant="secondary"
              size="small"
              icon="calendar"
              accessibilityLabel={busy ? "Working… meal" : "Copy to Today meal"}
              loading={busy}
              onPress={onCopy}
            />
          ) : null}
          <Button
            label="Delete"
            variant="destructive"
            size="small"
            icon="trash"
            accessibilityLabel="Delete meal"
            disabled={busy}
            onPress={onDelete}
          />
        </View>
      ) : null}
    </View>
  );
}

function AdjustPortionModal(props: {
  readonly portionTarget: PortionModalState;
  readonly onClose: () => void;
  readonly onSave: (grams: string) => void;
  readonly theme: ThemeColors;
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
        style={[
          styles.modalKeyboardAvoidingView,
          { backgroundColor: theme.overlay },
        ]}
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
            <ThemedText type="title3" accessibilityRole="header">
              Adjust portion
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {portionTarget.entry.name}
            </ThemedText>
            {portionTarget.baseGrams === null ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                Enter the current total weight to set this meal's portion. Its
                nutrition totals will stay unchanged.
              </ThemedText>
            ) : null}
            <View style={styles.gramsInputRow}>
              <TextInput
                accessibilityLabel="Adjust portion weight in grams"
                keyboardType="numeric"
                style={[
                  styles.modalInput,
                  styles.flexGrow,
                  { color: theme.text, borderColor: theme.border },
                ]}
                value={currentGrams}
                onChangeText={setCurrentGrams}
                autoFocus
              />
              <ThemedText type="headline" themeColor="textSecondary">
                grams
              </ThemedText>
            </View>

            {/* Stepper buttons */}
            <View style={styles.chipWrap}>
              {(
                [
                  ["-50g", () => adjustDelta(-50)],
                  ["-10g", () => adjustDelta(-10)],
                  ["+10g", () => adjustDelta(10)],
                  ["+50g", () => adjustDelta(50)],
                  ["0.5x", () => multiply(0.5)],
                  ["1.5x", () => multiply(1.5)],
                  ["2x", () => multiply(2)],
                ] as const
              ).map(([label, onPress]) => (
                <Button
                  key={label}
                  label={label}
                  variant="tinted"
                  size="small"
                  accessibilityLabel={label}
                  onPress={onPress}
                />
              ))}
            </View>

            {/* Dynamic live nutrition preview */}
            <View
              style={[
                styles.previewBox,
                { backgroundColor: theme.backgroundSelected },
              ]}
            >
              <ThemedText type="footnote" themeColor="textSecondary">
                New values
              </ThemedText>
              <MacroLine
                caloriesKcal={scaled.caloriesKcal}
                proteinG={scaled.proteinG}
                carbohydrateG={scaled.carbohydrateG}
                fatG={scaled.fatG}
              />
            </View>

            <View style={styles.modalActionsRow}>
              <Button
                label="Cancel"
                variant="secondary"
                size="small"
                onPress={onClose}
              />
              <Button
                label="Apply & save"
                size="small"
                onPress={() => onSave(currentGrams)}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.three,
  },
  flexGrow: { flex: 1 },
  centered: { alignSelf: "center" },
  centerText: { textAlign: "center" },
  pressed: { opacity: 0.6 },
  inlineWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: Spacing.three,
    rowGap: Spacing.one,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  toggleChip: {
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingHorizontal: 14,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  searchRow: {
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    borderRadius: Radius.md,
  },
  searchInput: {
    minHeight: MinTouchTarget,
    flex: 1,
    paddingVertical: Spacing.two,
    fontSize: 17,
  },
  groupList: { gap: Spacing.three },
  dayCard: {
    gap: Spacing.two,
  },
  dayTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  dayTitle: {
    flexGrow: 1,
    flexShrink: 1,
  },
  pill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.pill,
  },
  groupingToolbar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.md,
  },
  dayEntries: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.one,
  },
  cluster: {
    marginTop: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    gap: Spacing.one,
  },
  clusterHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  entry: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  childEntry: {
    paddingLeft: Spacing.one,
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  entryMain: {
    flex: 1,
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  entryText: {
    flex: 1,
    gap: Spacing.half,
  },
  busyIndicator: { marginLeft: Spacing.two },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  paginationFooter: {
    paddingVertical: Spacing.three,
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

  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.four,
  },
  modalKeyboardAvoidingView: {
    flex: 1,
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
    borderRadius: Radius.xl,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  modalInput: {
    minHeight: MinTouchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 17,
  },
  gramsInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  previewBox: {
    padding: 12,
    borderRadius: Radius.md,
    gap: Spacing.one,
  },
  modalActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
});
