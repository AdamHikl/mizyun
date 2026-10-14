import { RecurringMealSuggestionCard } from "@/features/recurring-meals";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Network from "expo-network";
import * as Crypto from "expo-crypto";
import type { FoodEntry } from "@mizyun/contracts";
import {
  createBlankWorkout,
  formatStopwatch,
  useOptionalActiveWorkout,
} from "@/features/workouts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TabHeader, useTabHeaderLayout } from "@/components/tab-header";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import {
  apiClient,
  invalidateSessionReads,
  peekSessionRead,
  getSessionReadVersion,
} from "@/composition/api-client";
import type { AuthSession } from "@mizyun/identity";
import type { RequestOptions } from "@mizyun/api-client";
import {
  subscribeSessionReadUpdates,
  isSavedDisplayResult,
  savedDisplayTime,
} from "@/composition/personal-read-events";
import { analyticsClient } from "@/composition/analytics-client";
import { trackDashboardControl } from "@/features/analytics/ui-analytics";
import { isProgressPhotosEnabled } from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import {
  readTodaySteps,
  type DailyStepsResult,
} from "@/features/health-steps/health-steps";
import { useTheme } from "@/hooks/use-theme";
import { formatTime12 } from "@/components/ui/ios-time-picker";
import {
  prepareQuickMealRepeat,
  completeQuickMealRepeat,
  loadQuickMealRepeat,
  isQuickMealRepeatOwnerActive,
  type QuickMealRepeatOperation,
} from "./quick-meal-repeat";
import {
  copyFoodEntry,
  fetchFoodDateHistory,
} from "../log-meal/meal-lifecycle-data";
import {
  loadFirstMealReminders,
  reconcileFirstMealReminders,
  type FirstMealReminderSettings,
} from "../log-meal/first-meal-reminders";
import { reconcileEveningReminders } from "../log-meal/evening-catch-up-reminders";
import { DailyNutrients } from "./daily-nutrients";

import {
  combineNutritionReview,
  computeDailyNutritionDisplay,
  extractFirstEligibleMeal,
  fetchDailySummary,
  fetchEnergySummary,
  fetchLatestWeight,
  fetchNutritionReviewSummaries,
  fetchWorkoutCountForPeriod,
  readDashboardSnapshot,
  type DailyDataResult,
  type DailySummary,
  type EnergySummary,
  type LatestWeight,
  type NutritionReview,
} from "./dashboard-data";
import {
  loadCachedDashboard,
  saveCachedDashboard,
  type CachedDashboardSnapshot,
  type DashboardMetricsData,
} from "../offline-cache/offline-cache-storage";

export interface SectionStatus {
  readonly loading: boolean;
  readonly hasError: boolean;
  /** Time this display value was saved locally, not a backend freshness lease. */
  readonly savedAt: string | null;
}

interface MetricsState {
  readonly caloriesToday: number | null;
  readonly macros: DailySummary | null;
  readonly latestWeightKg: number | null;
  readonly workoutsInReview: number | null;
  readonly energy: EnergySummary | null;
  readonly nutritionReview: NutritionReview | null;
  readonly loading: boolean;
  readonly hasError: boolean;
  readonly scope: string;
  readonly reviewPeriod: ReviewPeriod;
  readonly sectionStatus: {
    readonly nutritionToday: SectionStatus;
    readonly weight: SectionStatus;
    readonly energy: SectionStatus;
    readonly review: SectionStatus;
  };
}

const DEFAULT_SECTION_STATUS: SectionStatus = {
  loading: true,
  hasError: false,
  savedAt: null,
};

const EMPTY_METRICS: MetricsState = {
  caloriesToday: null,
  macros: null,
  latestWeightKg: null,
  workoutsInReview: null,
  energy: null,
  nutritionReview: null,
  loading: true,
  hasError: false,
  scope: "",
  reviewPeriod: "week",
  sectionStatus: {
    nutritionToday: DEFAULT_SECTION_STATUS,
    weight: DEFAULT_SECTION_STATUS,
    energy: DEFAULT_SECTION_STATUS,
    review: DEFAULT_SECTION_STATUS,
  },
};

const isoLocalDate = (now: Date): string => {
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const startOfLocalWeek = (now: Date): string => {
  const start = new Date(now);
  const mondayBasedDay = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayBasedDay);
  return isoLocalDate(start);
};

const startOfLocalMonth = (now: Date): string => {
  const start = new Date(now);
  start.setDate(1);
  return isoLocalDate(start);
};

const localYesterday = (now: Date): string => {
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  return isoLocalDate(yest);
};

type ReviewPeriod = "week" | "month";

const formatCalories = (kcal: number | null): string =>
  kcal === null ? "—" : `${Math.round(kcal)} kcal`;

const formatWeight = (
  kg: number | null,
  unitSystem: "metric" | "imperial",
): string => {
  if (kg === null) return "—";
  return unitSystem === "imperial"
    ? `${(kg * 2.204_622_621_8).toFixed(1)} lb`
    : `${kg.toFixed(1)} kg`;
};

const formatCount = (n: number | null): string =>
  n === null ? "—" : String(n);

const formatCachedTime = (isoString: string | null): string => {
  if (!isoString) return "earlier";
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "earlier";
  }
};

// UNKNOWN is not proof of disconnection. A reachable network is also not proof
// that Mizyun's backend is available; API errors keep neutral wording.
const disconnected = (state: Network.NetworkState): boolean =>
  state.type === Network.NetworkStateType.NONE ||
  (state.isConnected === false &&
    state.type !== undefined &&
    state.type !== Network.NetworkStateType.UNKNOWN);

const caloriesDetail = (
  summary: DailySummary | null,
  energy: EnergySummary | null,
): string => {
  if (summary === null) return "Start with a meal";
  if (summary.entryCount === 0) {
    if (energy?.targetProteinG != null) {
      return `Target: ${energy.targetProteinG}g P · ${energy.targetCarbohydrateG}g C · ${energy.targetFatG}g F`;
    }
    return "No entries yet today";
  }
  const p = summary.proteinG ?? 0;
  const c = summary.carbohydrateG ?? 0;
  const f = summary.fatG ?? 0;
  if (energy?.targetProteinG != null) {
    return `${p}/${energy.targetProteinG}g P · ${c}/${energy.targetCarbohydrateG}g C · ${f}/${energy.targetFatG}g F`;
  }
  return `${p}P / ${c}C / ${f}F · ${summary.entryCount} ${summary.entryCount === 1 ? "entry" : "entries"}`;
};

const energyReason = (reason: EnergySummary["incompleteReason"]): string => {
  switch (reason) {
    case "weight_missing":
      return "Add a confirmed weight to calculate a target.";
    case "height_missing":
      return "Height is needed for the energy formula.";
    case "birth_year_missing":
      return "Birth year is needed for the energy formula.";
    case "sex_missing":
      return "A formula sex input is needed for this estimate.";
    case "activity_unset":
      return "Choose your usual activity level.";
    case "no_active_goal":
      return "An active primary goal is needed for a target.";
    case "below_safety_floor":
      return "The calculated target is below the safety floor.";
    case "exercise_data_stale":
      return "Recent exercise data is not sufficient yet.";
    case null:
      return "The estimate is not complete yet.";
  }
};

const formatEnergyBalance = (summary: EnergySummary | null): string => {
  if (summary?.balanceKcal == null) return "—";
  const amount = Math.abs(Math.round(summary.balanceKcal));
  if (summary.balanceKcal === 0) return "On target";
  return summary.balanceKcal < 0
    ? `${amount} kcal under target`
    : `${amount} kcal over target`;
};

const titleCaseToken = (value: string | null): string =>
  value === null
    ? "missing"
    : value.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());

const actions = [
  {
    label: "Log a meal",
    control: "quick_log_meal",
    path: "/log-meal" as Href,
    hint: "Photo or manual entry",
    icon: "🥗",
  },
  {
    label: "Start workout",
    control: "quick_log_workout",
    path: "/log-workout" as Href,
    hint: "One-time training session",
    icon: "🏋️",
  },
  {
    label: "Log weight",
    control: "quick_log_weight",
    path: "/log-weight" as Href,
    hint: "Today's scale reading",
    icon: "⚖️",
  },
  {
    label: "Progress photo",
    control: "quick_log_photo",
    path: "/progress-photos" as Href,
    hint: "Private photo & compare",
    icon: "📷",
  },
] as const;

function initialMetricsFor(session: AuthSession | null): MetricsState {
  if (!session) return EMPTY_METRICS;
  const now = new Date();
  const today = isoLocalDate(now);
  const offset = -now.getTimezoneOffset();
  const snapshot = readDashboardSnapshot(
    <T,>(options: RequestOptions) => peekSessionRead<T>(options, session),
    {
      date: today,
      fromIsoDate: startOfLocalWeek(now),
      toIsoDate: localYesterday(now),
      utcOffsetMinutes: offset,
    },
  );
  const status = (
    read: { readonly savedAt?: number } | null,
  ): SectionStatus => ({
    loading: read === null,
    hasError: false,
    savedAt: read
      ? new Date(read.savedAt ?? now.getTime()).toISOString()
      : null,
  });
  const reviewReady =
    snapshot.daily !== null &&
    snapshot.history !== null &&
    snapshot.workouts !== null;
  return {
    ...EMPTY_METRICS,
    scope: `${session.user.id}:${session.accessToken}:${today}:${offset}`,
    caloriesToday: snapshot.daily?.value?.caloriesKcal ?? null,
    macros: snapshot.daily?.value ?? null,
    latestWeightKg: snapshot.weight?.value?.weightKg ?? null,
    energy: snapshot.energy?.value ?? null,
    workoutsInReview: snapshot.workouts?.value ?? null,
    nutritionReview:
      snapshot.daily && snapshot.history
        ? combineNutritionReview(snapshot.history.value, snapshot.daily.value)
        : null,
    loading:
      !snapshot.daily || !snapshot.weight || !snapshot.energy || !reviewReady,
    sectionStatus: {
      nutritionToday: status(snapshot.daily),
      weight: status(snapshot.weight),
      energy: status(snapshot.energy),
      review: reviewReady
        ? status({
            savedAt: Math.min(
              ...[snapshot.daily, snapshot.history, snapshot.workouts].map(
                (read) => read?.savedAt ?? now.getTime(),
              ),
            ),
          })
        : DEFAULT_SECTION_STATUS,
    },
  };
}

export function DashboardScreen() {
  const { headerHeight, onHeaderLayout } = useTabHeaderLayout();
  const { profile, session, openOnboarding } = useAuth();
  const [prefetchRevision, setPrefetchRevision] = useState(0);
  useEffect(
    () =>
      subscribeSessionReadUpdates(() =>
        setPrefetchRevision((value) => value + 1),
      ),
    [],
  );
  const readVersion = getSessionReadVersion();
  const initialMetrics = useMemo(
    () => initialMetricsFor(session),
    [session?.user.id, session?.accessToken, prefetchRevision, readVersion],
  );
  const [storedMetrics, setMetrics] = useState<MetricsState>(initialMetrics);
  const [storedSteps, setSteps] = useState<DailyStepsResult>({ kind: "off" });
  const stepsRequestId = useRef(0);
  const [storedYesterdayFirstMeal, setYesterdayFirstMeal] = useState<{
    readonly scope: string;
    readonly entry: FoodEntry | null;
  } | null>(null);
  const [storedFirstMealReminders, setFirstMealReminders] =
    useState<FirstMealReminderSettings | null>(null);
  const [mealCopiedScope, setMealCopiedScope] = useState<string | null>(null);
  const [reviewPeriod, setReviewPeriod] = useState<ReviewPeriod>("week");
  const activeRequestId = useRef(0);
  const userId = session?.user.id ?? null;
  const accessToken = session?.accessToken ?? null;
  const unitSystem = profile?.unitSystem ?? "metric";
  const ownerKey = `${userId ?? ""}:${accessToken ?? ""}`;
  const currentOwner = useRef(ownerKey);
  currentOwner.current = ownerKey;
  const loadedMetrics = useRef(!initialMetrics.loading);
  const displayScope = useRef(initialMetrics.scope);
  const [offline, setOffline] = useState(false);
  const refreshPending = useRef<{
    owner: string;
    promise: Promise<void>;
  } | null>(null);
  const manualRefreshPending = useRef(false);
  useEffect(() => {
    activeRequestId.current += 1;
    stepsRequestId.current += 1;
    loadedMetrics.current = !initialMetrics.loading;
    displayScope.current = initialMetrics.scope;
    setMetrics(initialMetrics);
    setSteps({ kind: "off" });
    setYesterdayFirstMeal(null);
    setFirstMealReminders(null);
    setRefreshing(false);
    manualRefreshPending.current = false;
  }, [ownerKey]);

  const principal =
    userId === null || accessToken === null
      ? null
      : {
          userId,
          accessToken,
        };

  const [refreshing, setRefreshing] = useState(false);

  const loadMetrics = useCallback(async (): Promise<void> => {
    if (principal === null) {
      setMetrics(EMPTY_METRICS);
      return;
    }
    const requestId = ++activeRequestId.current;
    const requestOwner = ownerKey;
    const isCurrentRequest = () =>
      requestId === activeRequestId.current &&
      requestOwner === currentOwner.current;
    const now = new Date();
    const todayDate = isoLocalDate(now);
    const utcOffsetMinutes = -now.getTimezoneOffset();
    const periodStartDate =
      reviewPeriod === "week" ? startOfLocalWeek(now) : startOfLocalMonth(now);
    const yesterdayDate = localYesterday(now);
    const hasHistoricalDays = periodStartDate <= yesterdayDate;
    const scope = `${ownerKey}:${todayDate}:${utcOffsetMinutes}`;
    let usedSavedRead = false;
    let oldestSavedRead: number | undefined;
    const displayClient: typeof apiClient = {
      status: () => apiClient.status(),
      request: async <T,>(options: RequestOptions) => {
        const result = await apiClient.request<T>(options);
        if (isSavedDisplayResult(result)) usedSavedRead = true;
        const savedAt = savedDisplayTime(result);
        if (savedAt !== undefined)
          oldestSavedRead = Math.min(oldestSavedRead ?? savedAt, savedAt);
        return result;
      },
    };
    if (displayScope.current !== scope) {
      loadedMetrics.current = false;
      displayScope.current = scope;
      setYesterdayFirstMeal(null);
    }
    setMetrics((previous) => {
      const current = previous.scope === scope ? previous : EMPTY_METRICS;
      const sameReview = current.reviewPeriod === reviewPeriod;
      const updating = (status: SectionStatus): SectionStatus => ({
        ...status,
        loading: true,
      });
      return {
        ...current,
        scope,
        reviewPeriod,
        nutritionReview: sameReview ? current.nutritionReview : null,
        workoutsInReview: sameReview ? current.workoutsInReview : null,
        loading: !loadedMetrics.current,
        sectionStatus: {
          nutritionToday: updating(current.sectionStatus.nutritionToday),
          weight: updating(current.sectionStatus.weight),
          energy: updating(current.sectionStatus.energy),
          review: updating(
            sameReview ? current.sectionStatus.review : DEFAULT_SECTION_STATUS,
          ),
        },
      };
    });

    // Pre-populate with cached snapshot immediately on cold start
    let cachedSnapshot: CachedDashboardSnapshot | null = null;
    if (userId) {
      void loadFirstMealReminders(userId).then((stored) => {
        if (isCurrentRequest()) setFirstMealReminders(stored);
      });
      void fetchFoodDateHistory(yesterdayDate).then((res) => {
        if (isCurrentRequest())
          setYesterdayFirstMeal({
            scope,
            entry: extractFirstEligibleMeal(res.entries),
          });
      });
      cachedSnapshot = await loadCachedDashboard(userId, todayDate, {
        reviewPeriod,
        utcOffsetMinutes,
      });
      if (!isCurrentRequest()) return;
      if (cachedSnapshot !== null) {
        setMetrics((current) => {
          const snapshot = cachedSnapshot!;
          const restore = (status: SectionStatus): SectionStatus =>
            status.savedAt === null
              ? { ...status, savedAt: snapshot.cachedAt }
              : status;
          return {
            ...current,
            caloriesToday:
              current.sectionStatus.nutritionToday.savedAt === null
                ? snapshot.data.caloriesToday
                : current.caloriesToday,
            macros:
              current.sectionStatus.nutritionToday.savedAt === null
                ? snapshot.data.macros
                : current.macros,
            latestWeightKg:
              current.sectionStatus.weight.savedAt === null
                ? snapshot.data.latestWeightKg
                : current.latestWeightKg,
            workoutsInReview:
              current.sectionStatus.review.savedAt === null
                ? snapshot.data.workoutsInReview
                : current.workoutsInReview,
            energy:
              current.sectionStatus.energy.savedAt === null
                ? snapshot.data.energy
                : current.energy,
            nutritionReview:
              current.sectionStatus.review.savedAt === null
                ? snapshot.data.nutritionReview
                : current.nutritionReview,
            sectionStatus: {
              nutritionToday: restore(current.sectionStatus.nutritionToday),
              weight: restore(current.sectionStatus.weight),
              energy: restore(current.sectionStatus.energy),
              review: restore(current.sectionStatus.review),
            },
          };
        });
      }
    }

    // Launch Tier 1: Immediate Daily Signals in parallel
    const todaySummaryPromise = fetchDailySummary(displayClient, principal, {
      date: todayDate,
      utcOffsetMinutes,
    });
    const weightPromise = fetchLatestWeight(displayClient, principal);
    const energyPromise = fetchEnergySummary(
      displayClient,
      principal,
      utcOffsetMinutes,
    );

    // Launch Tier 2: Period Review Signals in parallel (without duplicate today fetch)
    const workoutsPromise = fetchWorkoutCountForPeriod(
      displayClient,
      principal,
      {
        fromIsoDate: periodStartDate,
        toIsoDate: todayDate,
      },
    );
    const historicalReviewPromise = hasHistoricalDays
      ? fetchNutritionReviewSummaries(displayClient, principal, {
          fromIsoDate: periodStartDate,
          toIsoDate: yesterdayDate,
          utcOffsetMinutes,
        })
      : Promise.resolve<DailyDataResult<ReadonlyArray<DailySummary>>>({
          value: [],
          error: null,
        });

    // Handle Tier 1 resolution independently:
    const dailySignalsPromise = Promise.all([
      todaySummaryPromise,
      weightPromise,
      energyPromise,
    ]).then(([summary, weight, energy]) => {
      if (!isCurrentRequest()) return;

      setMetrics((current) => {
        const hasNutritionError = summary.error !== null;
        const freshCalories = !hasNutritionError
          ? (summary.value?.caloriesKcal ?? null)
          : current.caloriesToday;
        const freshMacros = !hasNutritionError
          ? (summary.value ?? null)
          : current.macros;

        const hasWeightError = weight.error !== null;
        const freshWeight = !hasWeightError
          ? (weight.value?.weightKg ?? null)
          : current.latestWeightKg;

        const hasEnergyError = energy.error !== null;
        const freshEnergy = !hasEnergyError
          ? (energy.value ?? null)
          : current.energy;

        if (userId && !usedSavedRead && !hasNutritionError && summary.value) {
          const entryCount = summary.value.entryCount ?? 0;
          void Promise.resolve(
            reconcileFirstMealReminders(userId, {
              todayLogged: entryCount > 0,
            }),
          ).catch(() => {});
          const targetKcal = energy.value?.dailyTargetKcal ?? null;
          const consumedKcal = summary.value.caloriesKcal ?? null;
          const calorieTargetReached =
            targetKcal !== null &&
            consumedKcal !== null &&
            targetKcal > 0 &&
            consumedKcal >= targetKcal;
          const nowHour = new Date().getHours();
          const hasMealAfter6Pm = entryCount > 0 && nowHour >= 18;
          void reconcileEveningReminders(userId, {
            calorieTargetReached,
            hasMealAfter6Pm,
          });
        }

        return {
          ...current,
          caloriesToday: freshCalories,
          macros: freshMacros,
          latestWeightKg: freshWeight,
          energy: freshEnergy,
          sectionStatus: {
            ...current.sectionStatus,
            nutritionToday: {
              loading: false,
              hasError: hasNutritionError,
              savedAt: hasNutritionError
                ? current.sectionStatus.nutritionToday.savedAt
                : new Date(oldestSavedRead ?? Date.now()).toISOString(),
            },
            weight: {
              loading: false,
              hasError: hasWeightError,
              savedAt: hasWeightError
                ? current.sectionStatus.weight.savedAt
                : new Date(oldestSavedRead ?? Date.now()).toISOString(),
            },
            energy: {
              loading: false,
              hasError: hasEnergyError,
              savedAt: hasEnergyError
                ? current.sectionStatus.energy.savedAt
                : new Date(oldestSavedRead ?? Date.now()).toISOString(),
            },
          },
        };
      });
    });

    // Handle Tier 2 review resolution independently:
    const reviewSignalsPromise = Promise.all([
      workoutsPromise,
      historicalReviewPromise,
      todaySummaryPromise,
    ]).then(([count, historicalResult, summaryResult]) => {
      if (!isCurrentRequest()) return;

      const hasHistoricalError =
        historicalResult.error !== null || summaryResult.error !== null;
      const hasWorkoutsError = count.error !== null;
      const hasReviewError = hasHistoricalError || hasWorkoutsError;

      let combinedReview: NutritionReview | null = null;
      if (!hasHistoricalError && historicalResult.value !== null) {
        combinedReview = combineNutritionReview(
          historicalResult.value,
          summaryResult.value ?? null,
        );
      }

      setMetrics((current) => {
        const effectiveNutritionReview =
          !hasHistoricalError && combinedReview !== null
            ? combinedReview
            : current.nutritionReview;

        const effectiveWorkouts = !hasWorkoutsError
          ? count.value
          : current.workoutsInReview;

        // Under NO circumstances does a review failure overwrite fresh caloriesToday or latestWeightKg!
        return {
          ...current,
          nutritionReview: effectiveNutritionReview,
          workoutsInReview: effectiveWorkouts,
          sectionStatus: {
            ...current.sectionStatus,
            review: {
              loading: false,
              hasError: hasReviewError,
              savedAt: hasReviewError
                ? current.sectionStatus.review.savedAt
                : new Date(oldestSavedRead ?? Date.now()).toISOString(),
            },
          },
        };
      });
    });

    // Wait for all to settle before saving cache and clearing overall loading
    await Promise.allSettled([dailySignalsPromise, reviewSignalsPromise]);
    if (!isCurrentRequest()) return;
    loadedMetrics.current = true;

    setMetrics((current) => {
      const overallHasError =
        current.sectionStatus.nutritionToday.hasError ||
        current.sectionStatus.weight.hasError ||
        current.sectionStatus.energy.hasError ||
        current.sectionStatus.review.hasError;

      const overallLoading =
        current.sectionStatus.nutritionToday.loading ||
        current.sectionStatus.weight.loading ||
        current.sectionStatus.energy.loading ||
        current.sectionStatus.review.loading;

      // Save fresh merged snapshot if we have valid non-empty daily data
      if (userId && !overallHasError && !usedSavedRead) {
        void saveCachedDashboard(userId, {
          localDate: todayDate,
          reviewPeriod,
          utcOffsetMinutes,
          data: {
            caloriesToday: current.caloriesToday,
            macros: current.macros,
            latestWeightKg: current.latestWeightKg,
            workoutsInReview: current.workoutsInReview,
            energy: current.energy,
            nutritionReview: current.nutritionReview,
          },
        });
      }

      return {
        ...current,
        loading: overallLoading,
        hasError: overallHasError,
      };
    });
  }, [accessToken, reviewPeriod, userId, ownerKey]);

  const loadSteps = useCallback(async (): Promise<void> => {
    const requestId = ++stepsRequestId.current;
    setSteps((current) =>
      current.kind === "off" ? { kind: "loading" } : current,
    );
    if (userId === null) {
      setSteps({ kind: "off" });
      return;
    }
    const result = await readTodaySteps(userId);
    if (requestId === stepsRequestId.current) setSteps(result);
  }, [userId]);

  const refreshMetrics = useCallback(
    (force = false): Promise<void> => {
      const owner = `${ownerKey}:${reviewPeriod}:${isoLocalDate(new Date())}:${new Date().getTimezoneOffset()}`;
      if (!force && refreshPending.current?.owner === owner)
        return refreshPending.current.promise;
      if (force) invalidateSessionReads();
      const record = { owner, promise: Promise.resolve() };
      record.promise = loadMetrics().finally(() => {
        if (refreshPending.current === record) refreshPending.current = null;
      });
      refreshPending.current = record;
      return record.promise;
    },
    [loadMetrics, ownerKey, reviewPeriod],
  );

  const handleRefresh = useCallback(async () => {
    if (manualRefreshPending.current) return;
    manualRefreshPending.current = true;
    const requestOwner = ownerKey;
    setRefreshing(true);
    try {
      await Promise.all([refreshMetrics(true), loadSteps()]);
    } finally {
      if (currentOwner.current === requestOwner) {
        manualRefreshPending.current = false;
        setRefreshing(false);
      }
    }
  }, [refreshMetrics, loadSteps, ownerKey]);

  useFocusEffect(
    useCallback(() => {
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "dashboard" },
      });
      let active = true;
      let foreground =
        AppState.currentState !== "background" &&
        AppState.currentState !== "inactive";
      void refreshMetrics();
      void loadSteps();
      let networkOffline = false;
      let networkUnavailable = false;
      let networkRevision = 0;
      const onNetworkState = (state: Network.NetworkState) => {
        if (!active) return;
        const wasUnavailable = networkUnavailable;
        networkOffline = disconnected(state);
        networkUnavailable =
          networkOffline ||
          (state.isInternetReachable === false &&
            state.type !== undefined &&
            state.type !== Network.NetworkStateType.UNKNOWN);
        setOffline(networkOffline);
        if (
          wasUnavailable &&
          !networkUnavailable &&
          state.isConnected === true &&
          foreground
        ) {
          // Retire failed/pending personal reads and retry immediately.
          void refreshMetrics(true);
        }
      };
      const networkSubscription = Network.addNetworkStateListener((state) => {
        networkRevision++;
        onNetworkState(state);
      });
      const initialNetworkRevision = networkRevision;
      void Network.getNetworkStateAsync()
        .then((state) => {
          if (networkRevision === initialNetworkRevision) onNetworkState(state);
        })
        .catch(() => {});
      // Recurring meals can change nutrition while Home stays open.
      const timer = setInterval(() => {
        if (foreground && !networkUnavailable) void refreshMetrics();
      }, 60_000);
      const subscription = AppState.addEventListener("change", (state) => {
        const wasForeground = foreground;
        foreground = state === "active";
        if (foreground && !wasForeground) {
          void refreshMetrics(true);
          void loadSteps();
        }
      });
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeSessionReadUpdates((path) => {
        if (
          !/^\/v1\/(food-entries|energy|body-measurements|workouts|profile|goals)([/?]|$)/.test(
            path,
          )
        )
          return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          if (foreground) void refreshMetrics();
        }, 50);
      });
      return () => {
        active = false;
        clearInterval(timer);
        clearTimeout(refreshTimer);
        unsubscribe();
        subscription.remove();
        networkSubscription.remove();
        activeRequestId.current += 1;
        refreshPending.current = null;
        stepsRequestId.current += 1;
      };
    }, [refreshMetrics, loadSteps]),
  );

  const workoutContext = useOptionalActiveWorkout();
  const activeWorkout = workoutContext?.activeWorkout;
  const elapsedSeconds = workoutContext?.elapsedSeconds ?? 0;
  const startingWorkout = useRef(false);
  const workoutOperation = useRef<{ owner: string; id: string } | null>(null);
  const [startingOneTime, setStartingOneTime] = useState(false);

  const handleStartWorkout = useCallback(async () => {
    if (activeWorkout) {
      router.push(`/log-workout?workoutId=${activeWorkout.id}` as Href);
      return;
    }
    if (userId === null || startingWorkout.current) return;
    startingWorkout.current = true;
    setStartingOneTime(true);
    try {
      if (
        !workoutOperation.current ||
        workoutOperation.current.owner !== userId
      ) {
        workoutOperation.current = {
          owner: userId,
          id: Crypto.randomUUID(),
        };
      }
      const result = await createBlankWorkout(
        "One-time Workout",
        workoutOperation.current.id,
      );
      if (currentOwner.current !== ownerKey) return;
      if (result.ok && result.workout) {
        workoutOperation.current = null;
        router.push({
          pathname: "/log-workout",
          params: { workoutId: result.workout.id },
        });
      } else if (!result.ok) {
        Alert.alert("Could not start workout", result.message);
      }
    } catch {
      if (currentOwner.current === ownerKey) {
        Alert.alert(
          "Could not start workout",
          "The workout could not be started. Please try again.",
        );
      }
    } finally {
      startingWorkout.current = false;
      setStartingOneTime(false);
    }
  }, [activeWorkout, ownerKey, userId]);

  const quickLogActions = useMemo(() => {
    return actions
      .filter(
        (action) =>
          action.label !== "Progress photo" || isProgressPhotosEnabled(),
      )
      .map((action) => {
        if (action.path === "/log-workout" && activeWorkout) {
          return {
            label: "Resume workout",
            control: action.control,
            path: `/log-workout?workoutId=${activeWorkout.id}` as Href,
            hint: `⏱️ ${formatStopwatch(elapsedSeconds)} in progress`,
            icon: "🏋️",
          };
        }
        return action;
      });
  }, [activeWorkout, elapsedSeconds]);

  // Hide an old account/day immediately, including the frame before focus
  // effects execute. Review-period changes retain today's independent values.
  const renderScope = `${ownerKey}:${isoLocalDate(new Date())}:${-new Date().getTimezoneOffset()}`;
  const ownsDisplay = storedMetrics.scope === renderScope;
  const steps: DailyStepsResult = ownsDisplay ? storedSteps : { kind: "off" };
  const firstMealReminders = ownsDisplay ? storedFirstMealReminders : null;
  const yesterdayFirstMeal =
    storedYesterdayFirstMeal?.scope === renderScope
      ? storedYesterdayFirstMeal.entry
      : null;
  const scopedMetrics =
    storedMetrics.scope === renderScope &&
    Object.values(storedMetrics.sectionStatus).some(
      (status) => status.savedAt !== null,
    )
      ? storedMetrics
      : initialMetrics.scope === renderScope
        ? initialMetrics
        : EMPTY_METRICS;
  const metrics =
    scopedMetrics.reviewPeriod === reviewPeriod
      ? scopedMetrics
      : {
          ...scopedMetrics,
          nutritionReview: null,
          workoutsInReview: null,
          sectionStatus: {
            ...scopedMetrics.sectionStatus,
            review: DEFAULT_SECTION_STATUS,
          },
        };

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <TabHeader onLayout={onHeaderLayout} />
        <ScrollView
          style={{ marginTop: -headerHeight }}
          contentContainerStyle={[
            styles.content,
            { paddingTop: headerHeight + Spacing.four },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              progressViewOffset={headerHeight}
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor="#22C55E"
            />
          }
        >
          {/* Top Header */}
          <View style={styles.header}>
            <ThemedText type="subtitle">
              {profile?.displayName
                ? `Welcome back, ${profile.displayName}`
                : "Your day, in one place."}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Confirmed food, training, and body metrics for your goal.
            </ThemedText>
          </View>

          {!profile?.displayName ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set up Mizyun"
              onPress={() => {
                trackDashboardControl("complete_setup");
                openOnboarding();
              }}
              style={styles.setupBanner}
            >
              <View style={styles.setupBannerText}>
                <ThemedText type="smallBold" style={styles.setupBannerTitle}>
                  Set up Mizyun
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  5 short steps: add your name, units, starting weight, and goal
                  to personalize your daily targets.
                </ThemedText>
              </View>
              <View style={styles.setupBannerBadge}>
                <ThemedText type="smallBold" style={styles.setupBannerAction}>
                  Start →
                </ThemedText>
              </View>
            </Pressable>
          ) : null}

          {/* Quick logging stays ahead of review content. */}
          <View style={styles.section}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              QUICK LOG
            </ThemedText>
            <View style={styles.actionGrid}>
              {quickLogActions.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  accessibilityState={
                    action.control === "quick_log_workout"
                      ? { busy: startingOneTime, disabled: startingOneTime }
                      : undefined
                  }
                  disabled={
                    action.control === "quick_log_workout" && startingOneTime
                  }
                  onPress={() => {
                    trackDashboardControl(action.control);
                    if (action.control === "quick_log_workout") {
                      void handleStartWorkout();
                    } else {
                      void router.push(action.path);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.action,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.actionIconContainer}>
                    <ThemedText style={styles.actionIcon}>
                      {action.icon}
                    </ThemedText>
                  </View>
                  <View style={styles.actionBody}>
                    <ThemedText type="smallBold">{action.label}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {action.control === "quick_log_workout" && startingOneTime
                        ? "Starting…"
                        : action.hint}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.actionPlus}>＋</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {/* First-Meal Routine & Quick Reuse Card */}
          {userId !== null && (metrics.macros?.entryCount ?? 0) === 0 ? (
            <FirstMealDashboardCard
              key={`${ownerKey}:${isoLocalDate(new Date())}`}
              userId={userId}
              isCurrent={() => currentOwner.current === ownerKey}
              onAcknowledged={(date) =>
                setMealCopiedScope(`${ownerKey}:${date}`)
              }
              yesterdayFirstMeal={yesterdayFirstMeal}
              reminderSettings={firstMealReminders}
              onMealCopied={loadMetrics}
            />
          ) : null}

          {mealCopiedScope === `${ownerKey}:${isoLocalDate(new Date())}` ||
          ((metrics.macros?.entryCount ?? 0) > 0 &&
            !metrics.sectionStatus.nutritionToday.loading &&
            !metrics.sectionStatus.nutritionToday.hasError) ? (
            <ThemedText accessibilityLiveRegion="polite" type="smallBold">
              First meal saved! ✨
            </ThemedText>
          ) : null}

          <RecurringMealSuggestionCard
            userId={userId}
            hidden={(metrics.macros?.entryCount ?? 0) === 0}
          />

          {/* 1. Daily Nutrition & Macro Visual Card */}
          <DailyNutritionCard
            key={renderScope}
            summary={metrics.macros}
            energy={metrics.energy}
            caloriesToday={metrics.caloriesToday}
            loading={metrics.sectionStatus.nutritionToday.loading}
            hasError={metrics.sectionStatus.nutritionToday.hasError}
            onPress={() => {
              trackDashboardControl("nutrition_card");
              void router.push("/meals" as Href);
            }}
          />
          <RefreshNotice
            label="Today’s nutrition"
            status={metrics.sectionStatus.nutritionToday}
            hasData={metrics.macros !== null || metrics.caloriesToday !== null}
            offline={offline}
            retrying={refreshing}
            onRetry={handleRefresh}
          />

          {/* 2. Key Signals Grid (Weight & Training) */}
          <View style={styles.signalsGrid}>
            <View style={styles.signalColumn}>
              <MetricCard
                label="Current weight"
                value={formatWeight(metrics.latestWeightKg, unitSystem)}
                detail="Raw scale reading →"
                onPress={() => {
                  trackDashboardControl("weight_card");
                  void router.push("/body" as Href);
                }}
              />
              <RefreshNotice
                label="Current weight"
                status={metrics.sectionStatus.weight}
                hasData={metrics.latestWeightKg !== null}
                offline={offline}
                retrying={refreshing}
                onRetry={handleRefresh}
              />
            </View>
            <MetricCard
              label="Training"
              value={formatCount(metrics.workoutsInReview)}
              detail={`this ${reviewPeriod} →`}
              onPress={() => {
                trackDashboardControl("training_card");
                void router.push("/workouts" as Href);
              }}
            />
          </View>

          <MetricCard
            label="Steps today"
            accessibilityLabel={
              steps.kind === "ready"
                ? `Steps today: ${steps.count.toLocaleString()}. Open Health steps settings.`
                : "Steps today unavailable. Open Health steps settings."
            }
            value={steps.kind === "ready" ? steps.count.toLocaleString() : "—"}
            detail={
              steps.kind === "ready"
                ? `Read on this device from ${Platform.OS === "ios" ? "Apple Health" : "Health Connect"}`
                : steps.kind === "loading"
                  ? "Reading steps…"
                  : steps.kind === "off"
                    ? "Enable in Settings →"
                    : steps.kind === "install_required"
                      ? "Install Health Connect in Settings →"
                      : steps.kind === "no_data"
                        ? "No readable step data today; check permissions →"
                        : "Steps unavailable; check Settings →"
            }
            onPress={() => {
              trackDashboardControl("steps_card");
              void router.push("/account-settings/health-steps" as Href);
            }}
          />

          {/* 4. Energy Balance & Formula Breakdown */}
          <EnergyCard
            summary={metrics.energy}
            caloriesToday={metrics.caloriesToday}
          />
          <RefreshNotice
            label="Energy balance"
            status={metrics.sectionStatus.energy}
            hasData={metrics.energy !== null}
            offline={offline}
            retrying={refreshing}
            onRetry={handleRefresh}
          />

          {/* 5. Weekly/Monthly Progress Review */}
          <ProgressReviewCard
            nutrition={metrics.nutritionReview}
            workouts={metrics.workoutsInReview}
            period={reviewPeriod}
            loading={metrics.sectionStatus.review.loading}
            hasError={metrics.sectionStatus.review.hasError}
            onChangePeriod={(period) => {
              trackDashboardControl(
                period === "week" ? "review_week" : "review_month",
              );
              setReviewPeriod(period);
            }}
          />
          <RefreshNotice
            label="Period review"
            status={metrics.sectionStatus.review}
            hasData={
              metrics.nutritionReview !== null ||
              metrics.workoutsInReview !== null
            }
            offline={offline}
            retrying={refreshing}
            onRetry={handleRefresh}
          />

          {metrics.loading &&
          metrics.sectionStatus.nutritionToday.savedAt === null &&
          metrics.sectionStatus.weight.savedAt === null ? (
            <ThemedText type="small" themeColor="textSecondary">
              Refreshing your dashboard…
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function RefreshNotice(props: {
  readonly label: string;
  readonly status: SectionStatus;
  readonly hasData: boolean;
  readonly offline: boolean;
  readonly retrying: boolean;
  readonly onRetry: () => Promise<void>;
}) {
  if (!props.status.hasError) return null;
  const title = props.offline ? "You’re offline" : "Couldn’t update";
  return (
    <View style={styles.refreshNotice}>
      <View style={styles.actionBody}>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={
            props.offline
              ? `${props.label}: ${title}`
              : `${title} ${props.label}`
          }
        >
          {title}
          {props.status.loading ? " · Retrying…" : ""}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {props.hasData
            ? `Showing saved data${props.status.savedAt ? ` · Saved ${formatCachedTime(props.status.savedAt)}` : ""}`
            : "Data unavailable"}
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry dashboard refresh"
        accessibilityState={{ disabled: props.retrying, busy: props.retrying }}
        disabled={props.retrying}
        onPress={() => {
          trackDashboardControl("refresh_retry");
          void props.onRetry();
        }}
        style={styles.retryButton}
      >
        <ThemedText type="smallBold">Retry</ThemedText>
      </Pressable>
    </View>
  );
}

function FirstMealDashboardCard(props: {
  readonly userId: string;
  readonly yesterdayFirstMeal: FoodEntry | null;
  readonly reminderSettings: FirstMealReminderSettings | null;
  readonly onMealCopied: () => Promise<void>;
  readonly isCurrent: () => boolean;
  readonly onAcknowledged: (localDate: string) => void;
}) {
  const {
    userId,
    yesterdayFirstMeal: suggestedMeal,
    reminderSettings,
    onMealCopied,
  } = props;
  const currentProps = useRef(props);
  currentProps.current = props;
  const [recovered, setRecovered] = useState<QuickMealRepeatOperation | null>(
    null,
  );
  const yesterdayFirstMeal =
    recovered &&
    !recovered.completed &&
    recovered.owner === userId &&
    recovered.localDate === isoLocalDate(new Date()) &&
    props.isCurrent()
      ? ({
          ...recovered.payload,
          id: recovered.sourceEntryId,
          userId: recovered.owner,
          photoAssetId: recovered.sourcePhotoAssetId ?? null,
        } as FoodEntry)
      : suggestedMeal;
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const hydrationCheck = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const day = isoLocalDate(new Date());
    let active = true;
    const isCurrent = () =>
      active &&
      mounted.current &&
      currentProps.current.isCurrent() &&
      isQuickMealRepeatOwnerActive(userId) &&
      isoLocalDate(new Date()) === day;
    hydrationCheck.current = loadQuickMealRepeat(userId, day)
      .then((pending) => {
        if (!isCurrent()) return false;
        setRecovered(pending);
        if (pending?.completed) {
          setCopied(true);
          currentProps.current.onAcknowledged(day);
          void Promise.resolve(
            reconcileFirstMealReminders(userId, { todayLogged: true }),
          ).catch(() => {});
        }
        return true;
      })
      .catch(() => {
        if (isCurrent())
          setError("Could not recover the meal copy. Try again safely.");
        return false;
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const retryRecovery = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const day = isoLocalDate(new Date());
    const isCurrent = () =>
      mounted.current &&
      currentProps.current.isCurrent() &&
      isQuickMealRepeatOwnerActive(userId) &&
      isoLocalDate(new Date()) === day;
    try {
      const pending = await loadQuickMealRepeat(userId, day);
      if (!isCurrent()) return;
      setRecovered(pending);
      hydrationCheck.current = Promise.resolve(true);
      if (pending?.completed) {
        setCopied(true);
        currentProps.current.onAcknowledged(day);
        await Promise.resolve(
          reconcileFirstMealReminders(userId, { todayLogged: true }),
        ).catch(() => {});
      }
    } catch {
      if (isCurrent())
        setError("Could not recover the meal copy. Try again safely.");
    } finally {
      inFlight.current = false;
      if (isCurrent()) setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!yesterdayFirstMeal || inFlight.current || copied) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const day = isoLocalDate(new Date());
    const isCurrent = () =>
      mounted.current &&
      props.isCurrent() &&
      isQuickMealRepeatOwnerActive(userId) &&
      isoLocalDate(new Date()) === day;
    try {
      if (hydrationCheck.current) {
        const hydrated = await hydrationCheck.current;
        if (!isCurrent()) return;
        if (!hydrated) {
          // The failed mount read cannot authorize a fresh operation. A later
          // explicit tap may re-read storage before preparing a safe retry.
          hydrationCheck.current = null;
          setError("Could not recover the meal copy. Try again safely.");
          return;
        }
      }
      const pending = await prepareQuickMealRepeat(
        userId,
        day,
        yesterdayFirstMeal,
      );
      if (!isCurrent()) return;
      if (pending.completed) {
        setCopied(true);
        props.onAcknowledged(day);
        await Promise.resolve(
          reconcileFirstMealReminders(userId, { todayLogged: true }),
        ).catch(() => {});
        if (!isCurrent()) return;
        await onMealCopied();
        return;
      }
      const result = await copyFoodEntry(
        {
          ...yesterdayFirstMeal,
          id: pending.sourceEntryId,
          userId: pending.owner,
          photoAssetId: pending.sourcePhotoAssetId ?? null,
        },
        false,
        {
          isCurrent,
          expectedUserId: userId,
          payload: pending.payload,
        },
      );
      if (!isCurrent()) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Acknowledgement belongs to the parent: refreshed totals remove this card.
      setCopied(true);
      props.onAcknowledged(day);
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "quick_meal_repeat" },
      });
      // Keep the immutable snapshot if completion persistence fails; replay stays safe.
      try {
        await completeQuickMealRepeat(pending);
      } catch {
        /* replay remains idempotent */
      }
      if (!isCurrent()) return;
      await Promise.resolve(
        reconcileFirstMealReminders(userId, { todayLogged: true }),
      ).catch(() => {});
      if (!isCurrent()) return;
      if (new Date().getHours() >= 18)
        void reconcileEveningReminders(userId, { hasMealAfter6Pm: true });
      await onMealCopied();
    } catch {
      if (isCurrent())
        setError("Could not confirm the meal copy. Try again safely.");
    } finally {
      inFlight.current = false;
      if (isCurrent()) setBusy(false);
    }
  };

  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.firstMealCard, { borderColor: theme.border }]}
    >
      <View style={styles.firstMealHeaderRow}>
        <ThemedText style={styles.firstMealIcon}>🌅</ThemedText>
        <View style={styles.firstMealHeaderContent}>
          <ThemedText type="smallBold">Start with your first meal</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Logging early sets today's routine.
          </ThemedText>
        </View>
      </View>

      {yesterdayFirstMeal !== null ? (
        <View
          style={[
            styles.firstMealRepeatBox,
            {
              backgroundColor:
                theme.background === "#F8FAF9"
                  ? "#FFFFFF"
                  : "rgba(255, 255, 255, 0.04)",
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.firstMealRepeatInfo}>
            <ThemedText type="smallBold">{yesterdayFirstMeal.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {yesterdayFirstMeal.caloriesKcal != null
                ? `${yesterdayFirstMeal.caloriesKcal} kcal`
                : "—"}
              {yesterdayFirstMeal.proteinG != null
                ? ` · ${yesterdayFirstMeal.proteinG}P`
                : ""}
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy ${yesterdayFirstMeal.name} to today`}
            accessibilityState={{ busy, disabled: busy || copied }}
            disabled={busy || copied}
            onPress={() => {
              trackDashboardControl("first_meal_copy");
              void handleCopy();
            }}
            style={({ pressed }) => [
              styles.copyToTodayButton,
              (pressed || busy) && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <ThemedText type="smallBold" style={styles.copyToTodayButtonText}>
                {copied ? "Saved! ✨" : "Copy to Today"}
              </ThemedText>
            )}
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <View>
          <ThemedText accessibilityRole="alert" type="small">
            {error}
          </ThemedText>
          {yesterdayFirstMeal === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry saved meal recovery"
              disabled={busy}
              accessibilityState={{ busy, disabled: busy }}
              onPress={() => {
                void retryRecovery();
              }}
            >
              <ThemedText type="smallBold">Retry saved meal</ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.firstMealFooterRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log a new meal"
          onPress={() => {
            trackDashboardControl("first_meal_log");
            router.push("/log-meal" as Href);
          }}
          style={({ pressed }) => [
            styles.firstMealLogLink,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" style={styles.firstMealLogLinkText}>
            🥗 Log a meal →
          </ThemedText>
        </Pressable>

        {reminderSettings?.enabled ? (
          <ThemedText type="small" themeColor="textSecondary">
            ⏰ Reminder:{" "}
            {formatTime12(reminderSettings.hour, reminderSettings.minute)}
          </ThemedText>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Set reminder in settings"
            onPress={() => {
              trackDashboardControl("first_meal_reminder");
              router.push("/settings" as Href);
            }}
            style={({ pressed }) => [
              styles.firstMealLogLink,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="small" themeColor="textSecondary">
              ⏰ Set reminder
            </ThemedText>
          </Pressable>
        )}
      </View>
    </ThemedView>
  );
}

function DailyNutritionCard(props: {
  readonly summary: DailySummary | null;
  readonly energy: EnergySummary | null;
  readonly caloriesToday: number | null;
  readonly loading?: boolean;
  readonly hasError?: boolean;
  readonly onPress: () => void;
}) {
  const {
    summary,
    energy,
    caloriesToday,
    loading = false,
    hasError = false,
    onPress,
  } = props;
  const { fontScale } = useWindowDimensions();
  const display = computeDailyNutritionDisplay({
    summary,
    energy,
    caloriesToday,
    loading,
    hasError,
  });

  return (
    <ThemedView type="backgroundElement" style={styles.dailyNutritionCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View Meals Hub"
        onPress={onPress}
        style={({ pressed }) => [
          styles.dailyNutritionCardWrapper,
          pressed && styles.pressed,
        ]}
      >
        <View style={{ gap: Spacing.three }}>
          <View style={styles.dailyNutritionHeader}>
            <View style={styles.nutritionHeaderCopy}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                TODAY'S NUTRITION
              </ThemedText>
              <View style={styles.calorieRow}>
                <ThemedText type="title" style={styles.dailyCalorieValue}>
                  {display.consumedKcal !== null
                    ? `${display.consumedKcal}`
                    : "—"}
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.dailyTargetSub}
                >
                  {display.targetKcal !== null
                    ? ` / ${display.targetKcal} kcal`
                    : " kcal"}
                </ThemedText>
              </View>
            </View>
            <View
              style={[
                styles.remainingBadge,
                display.badgeType === "over" && styles.remainingBadgeOver,
                display.badgeType === "alert" && styles.remainingBadgeAlert,
              ]}
            >
              <ThemedText
                type="smallBold"
                style={[
                  styles.remainingBadgeText,
                  display.badgeType === "over" && styles.remainingBadgeTextOver,
                  display.badgeType === "alert" &&
                    styles.remainingBadgeTextAlert,
                ]}
              >
                {display.badgeText}
              </ThemedText>
            </View>
          </View>

          {/* Calorie Progress Bar */}
          {display.targetKcal !== null ? (
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${display.kcalPercent}%` },
                  display.badgeType === "over" && styles.progressBarFillOver,
                ]}
              />
            </View>
          ) : null}

          {/* Macro Columns */}
          <View
            style={[styles.macroBarsRow, fontScale > 1.3 && styles.stackedRow]}
          >
            <MacroBar
              label="Protein"
              current={display.proteinG}
              target={display.targetProteinG}
              color="#10B981"
              percent={display.proteinPercent}
            />
            <MacroBar
              label="Carbs"
              current={display.carbohydrateG}
              target={display.targetCarbohydrateG}
              color="#F59E0B"
              percent={display.carbohydratePercent}
            />
            <MacroBar
              label="Fat"
              current={display.fatG}
              target={display.targetFatG}
              color="#8B5CF6"
              percent={display.fatPercent}
            />
          </View>

          {/* Incomplete nutrition notice */}
          {display.hasIncompleteMeals ? (
            <View style={styles.incompleteNotice}>
              <ThemedText type="small" style={styles.incompleteNoticeText}>
                Some meals have unconfirmed nutrition · Review in Meals Hub →
              </ThemedText>
            </View>
          ) : null}
        </View>
      </Pressable>
      <DailyNutrients
        summary={summary}
        dailyTargetKcal={display.targetKcal}
        loading={loading}
        hasError={hasError}
      />
    </ThemedView>
  );
}

function MacroBar(props: {
  readonly label: string;
  readonly current: number | null;
  readonly target: number | null;
  readonly color: string;
  readonly percent: number;
}) {
  const { label, current, target, color, percent } = props;
  const roundedCurrent = current !== null ? Math.round(current) : null;
  const roundedTarget = target !== null ? Math.round(target) : null;

  return (
    <View style={styles.macroBarItem}>
      <View style={styles.macroHeaderRow}>
        <View style={[styles.macroColorDot, { backgroundColor: color }]} />
        <ThemedText type="smallBold" style={[styles.macroLabelText, { color }]}>
          {label}
        </ThemedText>
      </View>
      <View style={styles.macroTrack}>
        <View
          style={[
            styles.macroFill,
            {
              backgroundColor: color,
              width: target && roundedCurrent !== null ? `${percent}%` : "0%",
            },
          ]}
        />
      </View>
      <View style={styles.macroValueRow}>
        <ThemedText type="small" style={styles.macroValueContainer}>
          <ThemedText type="smallBold" style={styles.macroCurrentNum}>
            {roundedCurrent !== null ? `${roundedCurrent}g` : "—"}
          </ThemedText>
          {roundedTarget !== null ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.macroTargetNum}
            >
              {` / ${roundedTarget}g`}
            </ThemedText>
          ) : null}
        </ThemedText>
      </View>
    </View>
  );
}

function EnergyCard(props: {
  readonly summary: EnergySummary | null;
  readonly caloriesToday: number | null;
}) {
  const summary = props.summary;
  const complete = summary?.complete === true;
  return (
    <ThemedView type="backgroundElement" style={styles.detailCard}>
      <View style={styles.cardHeading}>
        <View style={styles.actionBody}>
          <ThemedText type="smallBold">Energy balance</ThemedText>
          <ThemedText type="subtitle" style={styles.energySubtitle}>
            {complete ? formatEnergyBalance(summary) : "Needs confirmed inputs"}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review energy inputs"
          onPress={() => {
            trackDashboardControl("energy_setup");
            void router.push("/energy-setup" as Href);
          }}
          style={styles.compactButton}
        >
          <ThemedText type="smallBold">Review inputs</ThemedText>
        </Pressable>
      </View>

      {summary === null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Energy data has not loaded yet.
        </ThemedText>
      ) : complete ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Today: {formatCalories(props.caloriesToday)} consumed ·{" "}
            {formatCalories(summary.dailyTargetKcal)} target
          </ThemedText>
          <View style={styles.auditGrid}>
            <AuditValue
              label="Target Protein"
              value={
                summary.targetProteinG !== null
                  ? `${summary.targetProteinG} g`
                  : "—"
              }
            />
            <AuditValue
              label="Target Carbs"
              value={
                summary.targetCarbohydrateG !== null
                  ? `${summary.targetCarbohydrateG} g`
                  : "—"
              }
            />
            <AuditValue
              label="Target Fat"
              value={
                summary.targetFatG !== null ? `${summary.targetFatG} g` : "—"
              }
            />
            <AuditValue
              label="Target Calories"
              value={formatCalories(summary.dailyTargetKcal)}
            />
            <AuditValue label="BMR" value={formatCalories(summary.bmrKcal)} />
            <AuditValue label="TDEE" value={formatCalories(summary.tdeeKcal)} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Inputs: {summary.inputs.weightKg ?? "—"} kg ·{" "}
            {summary.inputs.heightCm ?? "—"} cm · born{" "}
            {summary.inputs.birthYear ?? "—"} ·{" "}
            {titleCaseToken(summary.inputs.sexAtBirth)} ·{" "}
            {titleCaseToken(summary.inputs.activityLevel)} ·{" "}
            {titleCaseToken(summary.inputs.goalKind)} (
            {titleCaseToken(summary.inputs.goalPace)})
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Formula {summary.formulaVersion}. Advisory estimate; confirmed
            tracking remains authoritative.
          </ThemedText>
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {energyReason(summary.incompleteReason)} No missing value is guessed.
        </ThemedText>
      )}
    </ThemedView>
  );
}

function ProgressReviewCard(props: {
  readonly nutrition: NutritionReview | null;
  readonly workouts: number | null;
  readonly period: ReviewPeriod;
  readonly loading?: boolean;
  readonly hasError?: boolean;
  readonly onChangePeriod: (period: ReviewPeriod) => void;
}) {
  const nutrition = props.nutrition;
  return (
    <ThemedView type="backgroundElement" style={styles.detailCard}>
      <View style={styles.cardHeading}>
        <ThemedText type="smallBold">This {props.period} so far</ThemedText>
        <View style={styles.periodChoices}>
          {(["week", "month"] as const).map((period) => (
            <Pressable
              key={period}
              accessibilityRole="radio"
              accessibilityState={{ selected: props.period === period }}
              onPress={() => props.onChangePeriod(period)}
              style={[
                styles.periodChoice,
                props.period === period && styles.periodChoiceSelected,
              ]}
            >
              <ThemedText type="smallBold">
                {period === "week" ? "Week" : "Month"}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.auditGrid}>
        <AuditValue
          label="Nutrition days"
          value={nutrition === null ? "—" : String(nutrition.loggedDays)}
        />
        <AuditValue
          label="Food entries"
          value={nutrition === null ? "—" : String(nutrition.entryCount)}
        />
        <AuditValue
          label="Calories logged"
          value={formatCalories(nutrition?.caloriesKcal ?? null)}
        />
        <AuditValue
          label="Completed workouts"
          value={formatCount(props.workouts)}
        />
      </View>
      {nutrition !== null && nutrition.incompleteDays > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Period calories are withheld because {nutrition.incompleteDays} logged
          {nutrition.incompleteDays === 1 ? " day has" : " days have"}{" "}
          incomplete nutrition values.
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

function AuditValue(props: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.auditValue}>
      <ThemedText type="small" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <ThemedText type="smallBold">{props.value}</ThemedText>
    </View>
  );
}

function MetricCard(props: {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly value: string;
  readonly detail: string;
  readonly onPress?: () => void;
}) {
  const content = (
    <ThemedView type="backgroundElement" style={styles.metricCard}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <ThemedText type="title" style={styles.metricValue}>
        {props.value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {props.detail}
      </ThemedText>
    </ThemedView>
  );

  if (props.onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        onPress={props.onPress}
        style={{ flex: 1 }}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  header: { gap: Spacing.one },
  setupBanner: {
    borderRadius: 16,
    padding: Spacing.four,
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    borderWidth: 1,
    borderColor: "#10B981",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  setupBannerText: { flex: 1, gap: Spacing.one },
  setupBannerTitle: { color: "#10B981", fontSize: 16 },
  setupBannerBadge: {
    backgroundColor: "#10B981",
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  setupBannerAction: { color: "#ffffff" },
  dailyNutritionCardWrapper: { width: "100%" },
  dailyNutritionCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.18)",
  },
  dailyNutritionHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  nutritionHeaderCopy: {
    flexBasis: 160,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  calorieRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 4,
    marginTop: 2,
  },
  dailyCalorieValue: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: Platform.select({ ios: -0.5, default: 0 }),
  },
  dailyTargetSub: {
    fontSize: 14,
    fontWeight: "500",
  },
  remainingBadge: {
    maxWidth: "100%",
    flexShrink: 1,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  remainingBadgeOver: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  remainingBadgeAlert: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  remainingBadgeText: {
    fontSize: 12,
    color: "#10B981",
  },
  remainingBadgeTextOver: {
    color: "#EF4444",
  },
  remainingBadgeTextAlert: {
    color: "#D97706",
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: "rgba(148, 163, 184, 0.2)",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#10B981",
    borderRadius: 4,
  },
  progressBarFillOver: {
    backgroundColor: "#EF4444",
  },
  stackedRow: { flexDirection: "column" },
  macroBarsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  incompleteNotice: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 8,
  },
  incompleteNoticeText: {
    fontSize: 12,
    color: "#D97706",
    fontWeight: "600",
  },
  macroBarItem: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: 12,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    gap: 6,
  },
  macroHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  macroColorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  macroLabelText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  macroTrack: {
    height: 4,
    backgroundColor: "rgba(148, 163, 184, 0.2)",
    borderRadius: 2,
    overflow: "hidden",
  },
  macroFill: {
    height: "100%",
    borderRadius: 2,
  },
  macroValueRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  macroValueContainer: {
    flexShrink: 1,
    fontSize: 11,
  },
  macroCurrentNum: {
    fontSize: 11,
    fontWeight: "700",
  },
  macroTargetNum: {
    fontSize: 11,
    fontWeight: "400",
  },
  signalsGrid: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  signalColumn: { flex: 1, gap: Spacing.one },
  metricCard: {
    borderRadius: 18,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.half,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.12)",
  },
  metricValue: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: Platform.select({ ios: -0.5, default: 0 }),
  },
  section: { gap: Spacing.two },
  sectionTitle: {
    letterSpacing: 0.8,
    fontSize: 11,
    opacity: 0.75,
  },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  action: {
    minWidth: "47%",
    flexBasis: 240,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    borderRadius: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + Spacing.half,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  actionIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionIcon: {
    fontSize: 16,
  },
  actionPlus: {
    color: "#10B981",
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  foundationCard: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  actionBody: { flex: 1, minWidth: 0, gap: Spacing.half },
  refreshNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.12)",
  },
  energySubtitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
  },
  cardHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  compactButton: {
    borderWidth: 1,
    borderColor: "#10B981",
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  auditGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  auditValue: { minWidth: "45%", flexGrow: 1, gap: Spacing.one },
  periodChoices: { flexDirection: "row", gap: Spacing.one },
  periodChoice: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  periodChoiceSelected: {
    borderWidth: 1.5,
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
  },
  reviewErrorNotice: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 8,
  },
  reviewErrorText: {
    fontSize: 12,
    color: "#D97706",
    fontWeight: "600",
  },
  firstMealCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  firstMealHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  firstMealIcon: {
    fontSize: 22,
  },
  firstMealHeaderContent: {
    flex: 1,
    gap: 2,
  },
  firstMealRepeatBox: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  firstMealRepeatInfo: {
    flexBasis: 140,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  copyToTodayButton: {
    maxWidth: "100%",
    flexShrink: 1,
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  copyToTodayButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
  },
  firstMealFooterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Spacing.half,
  },
  firstMealLogLink: {
    minHeight: 44,
    maxWidth: "100%",
    justifyContent: "center",
    paddingVertical: Spacing.half,
  },
  firstMealLogLinkText: {
    color: "#10B981",
    fontSize: 13,
  },
});
