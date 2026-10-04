import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FoodEntry } from "@mizyun/contracts";
import { formatStopwatch, useOptionalActiveWorkout } from "@/features/workouts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BrandWordmark } from "@/components/brand-wordmark";
import { AccountHeaderActions } from "@/components/account-header-button";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { apiClient, invalidateSessionReads } from "@/composition/api-client";
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
  copyFoodEntry,
  fetchFoodHistory,
} from "../log-meal/meal-lifecycle-data";
import {
  loadFirstMealReminders,
  reconcileFirstMealReminders,
  type FirstMealReminderSettings,
} from "../log-meal/first-meal-reminders";
import { reconcileEveningReminders } from "../log-meal/evening-catch-up-reminders";

import {
  combineNutritionReview,
  computeDailyNutritionDisplay,
  extractMostRecentEligibleMeal,
  fetchDailySummary,
  fetchEnergySummary,
  fetchLatestWeight,
  fetchNutritionReviewSummaries,
  fetchWorkoutCountForPeriod,
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
  readonly isOfflineSnapshot: boolean;
  readonly cachedAt: string | null;
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
  isOfflineSnapshot: false,
  cachedAt: null,
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
    hint: "Active training session",
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

export function DashboardScreen() {
  const { profile, session, openOnboarding } = useAuth();
  const [metrics, setMetrics] = useState<MetricsState>(EMPTY_METRICS);
  const [steps, setSteps] = useState<DailyStepsResult>({ kind: "off" });
  const stepsRequestId = useRef(0);
  const [recentMeal, setRecentMeal] = useState<FoodEntry | null>(null);
  const [firstMealReminders, setFirstMealReminders] =
    useState<FirstMealReminderSettings | null>(null);
  const [reviewPeriod, setReviewPeriod] = useState<ReviewPeriod>("week");
  const activeRequestId = useRef(0);
  const userId = session?.user.id ?? null;
  const accessToken = session?.accessToken ?? null;
  const unitSystem = profile?.unitSystem ?? "metric";
  const ownerKey = `${userId ?? ""}:${accessToken ?? ""}`;
  const currentOwner = useRef(ownerKey);
  currentOwner.current = ownerKey;
  const loadedMetrics = useRef(false);
  useEffect(() => {
    activeRequestId.current += 1;
    stepsRequestId.current += 1;
    loadedMetrics.current = false;
    setMetrics(EMPTY_METRICS);
    setSteps({ kind: "off" });
    setRecentMeal(null);
    setFirstMealReminders(null);
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

    setMetrics((current) => ({
      ...current,
      loading: !loadedMetrics.current,
      hasError: false,
      sectionStatus: {
        nutritionToday: { loading: !loadedMetrics.current, hasError: false },
        weight: { loading: !loadedMetrics.current, hasError: false },
        energy: { loading: !loadedMetrics.current, hasError: false },
        review: { loading: !loadedMetrics.current, hasError: false },
      },
    }));

    // Pre-populate with cached snapshot immediately on cold start
    let cachedSnapshot: CachedDashboardSnapshot | null = null;
    if (userId) {
      void loadFirstMealReminders(userId).then((stored) => {
        if (isCurrentRequest()) setFirstMealReminders(stored);
      });
      void fetchFoodHistory({ limit: 5 }).then((res) => {
        if (isCurrentRequest())
          setRecentMeal(extractMostRecentEligibleMeal(res.entries));
      });
      cachedSnapshot = await loadCachedDashboard(
        userId,
        todayDate,
        reviewPeriod,
      );
      if (!isCurrentRequest()) return;
      if (cachedSnapshot !== null) {
        setMetrics((current) => {
          if (
            current.loading &&
            current.caloriesToday === null &&
            current.latestWeightKg === null
          ) {
            return {
              ...current,
              caloriesToday: cachedSnapshot!.data.caloriesToday,
              macros: cachedSnapshot!.data.macros,
              latestWeightKg: cachedSnapshot!.data.latestWeightKg,
              workoutsInReview: cachedSnapshot!.data.workoutsInReview,
              energy: cachedSnapshot!.data.energy,
              nutritionReview: cachedSnapshot!.data.nutritionReview,
              isOfflineSnapshot: true,
              cachedAt: cachedSnapshot!.cachedAt,
            };
          }
          return current;
        });
      }
    }

    // Launch Tier 1: Immediate Daily Signals in parallel
    const todaySummaryPromise = fetchDailySummary(apiClient, principal, {
      date: todayDate,
      utcOffsetMinutes,
    });
    const weightPromise = fetchLatestWeight(apiClient, principal);
    const energyPromise = fetchEnergySummary(
      apiClient,
      principal,
      utcOffsetMinutes,
    );

    // Launch Tier 2: Period Review Signals in parallel (without duplicate today fetch)
    const workoutsPromise = fetchWorkoutCountForPeriod(apiClient, principal, {
      fromIsoDate: periodStartDate,
      toIsoDate: todayDate,
    });
    const historicalReviewPromise = hasHistoricalDays
      ? fetchNutritionReviewSummaries(apiClient, principal, {
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
          : (current.caloriesToday ??
            cachedSnapshot?.data.caloriesToday ??
            null);
        const freshMacros = !hasNutritionError
          ? (summary.value ?? null)
          : (current.macros ?? cachedSnapshot?.data.macros ?? null);

        const hasWeightError = weight.error !== null;
        const freshWeight = !hasWeightError
          ? (weight.value?.weightKg ?? null)
          : (current.latestWeightKg ??
            cachedSnapshot?.data.latestWeightKg ??
            null);

        const hasEnergyError = energy.error !== null;
        const freshEnergy = !hasEnergyError
          ? (energy.value ?? null)
          : (current.energy ?? cachedSnapshot?.data.energy ?? null);

        const isPartialOffline =
          (hasNutritionError && cachedSnapshot !== null) ||
          (hasWeightError && cachedSnapshot !== null) ||
          (hasEnergyError && cachedSnapshot !== null);

        if (userId && !hasNutritionError && summary.value) {
          const entryCount = summary.value.entryCount ?? 0;
          void reconcileFirstMealReminders(userId, {
            todayLogged: entryCount > 0,
          });
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
          isOfflineSnapshot: isPartialOffline,
          cachedAt: isPartialOffline
            ? (cachedSnapshot?.cachedAt ?? current.cachedAt)
            : null,
          sectionStatus: {
            ...current.sectionStatus,
            nutritionToday: { loading: false, hasError: hasNutritionError },
            weight: { loading: false, hasError: hasWeightError },
            energy: { loading: false, hasError: hasEnergyError },
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

      const hasHistoricalError = historicalResult.error !== null;
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
            : (current.nutritionReview ??
              cachedSnapshot?.data.nutritionReview ??
              null);

        const effectiveWorkouts = !hasWorkoutsError
          ? count.value
          : (current.workoutsInReview ??
            cachedSnapshot?.data.workoutsInReview ??
            null);

        // Under NO circumstances does a review failure overwrite fresh caloriesToday or latestWeightKg!
        return {
          ...current,
          nutritionReview: effectiveNutritionReview,
          workoutsInReview: effectiveWorkouts,
          sectionStatus: {
            ...current.sectionStatus,
            review: { loading: false, hasError: hasReviewError },
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
      if (userId && !overallHasError) {
        void saveCachedDashboard(userId, {
          localDate: todayDate,
          reviewPeriod,
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

      const dailyOffline =
        (current.sectionStatus.nutritionToday.hasError ||
          current.sectionStatus.weight.hasError ||
          current.sectionStatus.energy.hasError) &&
        cachedSnapshot !== null;

      return {
        ...current,
        loading: overallLoading,
        hasError: overallHasError,
        isOfflineSnapshot: dailyOffline,
        cachedAt: dailyOffline ? current.cachedAt : null,
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

  const handleRefresh = useCallback(async () => {
    invalidateSessionReads();
    setRefreshing(true);
    await Promise.all([loadMetrics(), loadSteps()]);
    setRefreshing(false);
  }, [loadMetrics, loadSteps]);

  useFocusEffect(
    useCallback(() => {
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "dashboard" },
      });
      let pending: Promise<void> | null = null;
      const refreshMetrics = () => {
        if (pending !== null) return;
        pending = loadMetrics().finally(() => {
          pending = null;
        });
      };
      let foreground =
        AppState.currentState !== "background" &&
        AppState.currentState !== "inactive";
      refreshMetrics();
      void loadSteps();
      // Recurring meals can change nutrition while Home stays open.
      const timer = setInterval(() => {
        if (foreground) refreshMetrics();
      }, 60_000);
      const subscription = AppState.addEventListener("change", (state) => {
        foreground = state === "active";
        if (foreground) {
          refreshMetrics();
          void loadSteps();
        }
      });
      return () => {
        clearInterval(timer);
        subscription.remove();
        stepsRequestId.current += 1;
      };
    }, [loadMetrics, loadSteps]),
  );

  const workoutContext = useOptionalActiveWorkout();
  const activeWorkout = workoutContext?.activeWorkout;
  const elapsedSeconds = workoutContext?.elapsedSeconds ?? 0;

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

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor="#22C55E"
            />
          }
        >
          {/* Top Header */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <BrandWordmark />
              <AccountHeaderActions />
            </View>
            <ThemedText type="subtitle">
              {profile?.displayName
                ? `Welcome back, ${profile.displayName}`
                : "Your day, in one place."}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Confirmed food, training, and body metrics for your goal.
            </ThemedText>
          </View>

          {metrics.isOfflineSnapshot ? (
            <View
              style={styles.offlineBanner}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Offline snapshot cached ${formatCachedTime(metrics.cachedAt)}`}
            >
              <View style={styles.offlineBannerContent}>
                <ThemedText style={styles.offlineBannerIcon}>⚡️</ThemedText>
                <View style={styles.offlineBannerTextGroup}>
                  <ThemedText
                    type="smallBold"
                    style={styles.offlineBannerTitle}
                  >
                    Offline Snapshot
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {metrics.cachedAt
                      ? `Viewing cached data from ${formatCachedTime(metrics.cachedAt)}`
                      : "Showing locally cached health data"}
                  </ThemedText>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh dashboard"
                onPress={() => {
                  trackDashboardControl("refresh_retry");
                  void loadMetrics();
                }}
                style={({ pressed }) => [
                  styles.offlineRefreshButton,
                  pressed && styles.pressed,
                ]}
              >
                <ThemedText
                  type="smallBold"
                  style={styles.offlineRefreshButtonText}
                >
                  Refresh
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

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

          {/* First-Meal Routine & Quick Reuse Card */}
          {userId !== null ? (
            <FirstMealDashboardCard
              userId={userId}
              todayDate={isoLocalDate(new Date())}
              todayEntryCount={metrics.macros?.entryCount ?? 0}
              caloriesToday={metrics.caloriesToday}
              recentMeal={recentMeal}
              reminderSettings={firstMealReminders}
              onMealCopied={loadMetrics}
            />
          ) : null}

          {/* 1. Daily Nutrition & Macro Visual Card */}
          <DailyNutritionCard
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

          {/* 2. Key Signals Grid (Weight & Training) */}
          <View style={styles.signalsGrid}>
            <MetricCard
              label="Current weight"
              value={formatWeight(metrics.latestWeightKg, unitSystem)}
              detail="Raw scale reading →"
              onPress={() => {
                trackDashboardControl("weight_card");
                void router.push("/body" as Href);
              }}
            />
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
                ? `Steps today: ${steps.count.toLocaleString()}. Open Settings.`
                : "Steps today unavailable. Open Settings."
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
              void router.push("/settings" as Href);
            }}
          />

          {/* 3. Quick Log Action Dock */}
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
                  onPress={() => {
                    trackDashboardControl(action.control);
                    void router.push(action.path);
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
                      {action.hint}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.actionPlus}>＋</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 4. Energy Balance & Formula Breakdown */}
          <EnergyCard
            summary={metrics.energy}
            caloriesToday={metrics.caloriesToday}
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

          {metrics.loading ? (
            <ThemedText type="small" themeColor="textSecondary">
              Refreshing your dashboard…
            </ThemedText>
          ) : null}
          {metrics.hasError && !metrics.isOfflineSnapshot ? (
            <View style={styles.refreshError}>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                accessibilityRole="alert"
              >
                Some dashboard values could not be refreshed.
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry dashboard refresh"
                onPress={() => {
                  trackDashboardControl("refresh_retry");
                  void loadMetrics();
                }}
              >
                <ThemedText type="smallBold">Retry</ThemedText>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function FirstMealDashboardCard(props: {
  readonly userId: string;
  readonly todayDate: string;
  readonly todayEntryCount: number;
  readonly caloriesToday: number | null;
  readonly recentMeal: FoodEntry | null;
  readonly reminderSettings: FirstMealReminderSettings | null;
  readonly onMealCopied: () => Promise<void>;
}) {
  const {
    userId,
    todayDate,
    todayEntryCount,
    caloriesToday,
    recentMeal,
    reminderSettings,
    onMealCopied,
  } = props;
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!recentMeal || busy) return;
    setBusy(true);
    setCopied(false);
    const startMs = Date.now();
    const result = await copyFoodEntry(recentMeal);
    if (result.ok) {
      const elapsed = Date.now() - startMs;
      void analyticsClient.track({
        name: "feature_viewed",
        properties: {
          feature: "quick_meal_repeat",
        },
      });
      await reconcileFirstMealReminders(userId, { todayLogged: true });
      if (new Date().getHours() >= 18) {
        void reconcileEveningReminders(userId, { hasMealAfter6Pm: true });
      }
      await onMealCopied();
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
    setBusy(false);
  };

  if (todayEntryCount > 0) {
    return (
      <ThemedView
        type="backgroundElement"
        style={[
          styles.firstMealCard,
          {
            borderColor: "rgba(16, 185, 129, 0.25)",
            backgroundColor:
              theme.background === "#F8FAF9"
                ? "rgba(16, 185, 129, 0.05)"
                : "rgba(16, 185, 129, 0.08)",
          },
        ]}
      >
        <View style={styles.firstMealHeaderRow}>
          <ThemedText style={styles.firstMealIcon}>✨</ThemedText>
          <View style={styles.firstMealHeaderContent}>
            <ThemedText type="smallBold" style={{ color: "#10B981" }}>
              {todayEntryCount === 1
                ? "First meal logged today!"
                : "Today's food log"}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {todayEntryCount} {todayEntryCount === 1 ? "meal" : "meals"}{" "}
              logged · {formatCalories(caloriesToday)} so far
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log another meal"
            onPress={() => {
              trackDashboardControl("first_meal_log");
              router.push("/log-meal" as Href);
            }}
            style={({ pressed }) => [
              styles.firstMealAddButton,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" style={styles.firstMealAddButtonText}>
              ＋ Next
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

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

      {recentMeal !== null ? (
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
            <ThemedText type="smallBold" numberOfLines={1}>
              {recentMeal.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {recentMeal.caloriesKcal != null
                ? `${recentMeal.caloriesKcal} kcal`
                : "—"}
              {recentMeal.proteinG != null ? ` · ${recentMeal.proteinG}P` : ""}
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy ${recentMeal.name} to today`}
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
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
            style={({ pressed }) => pressed && styles.pressed}
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
  const display = computeDailyNutritionDisplay({
    summary,
    energy,
    caloriesToday,
    loading,
    hasError,
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View Meals Hub"
      onPress={onPress}
      style={({ pressed }) => [
        styles.dailyNutritionCardWrapper,
        pressed && styles.pressed,
      ]}
    >
      <ThemedView type="backgroundElement" style={styles.dailyNutritionCard}>
        <View style={styles.dailyNutritionHeader}>
          <View style={styles.actionBody}>
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
                display.badgeType === "alert" && styles.remainingBadgeTextAlert,
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
        <View style={styles.macroBarsRow}>
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
      </ThemedView>
    </Pressable>
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
        <ThemedText
          type="smallBold"
          numberOfLines={1}
          style={[styles.macroLabelText, { color }]}
        >
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
        <ThemedText
          type="small"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={styles.macroValueContainer}
        >
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
      {props.hasError ? (
        <View style={styles.reviewErrorNotice}>
          <ThemedText type="small" style={styles.reviewErrorText}>
            Period review could not be refreshed.
          </ThemedText>
        </View>
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
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  calorieRow: {
    flexDirection: "row",
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
  macroBarsRow: {
    flexDirection: "row",
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
    flex: 1,
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
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  action: {
    minWidth: "47%",
    flexBasis: 240,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    borderRadius: 16,
    padding: Spacing.three,
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
  actionBody: { flex: 1, gap: Spacing.half },
  refreshError: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
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
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(234, 179, 8, 0.08)",
    borderColor: "rgba(234, 179, 8, 0.25)",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  offlineBannerContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  offlineBannerIcon: {
    fontSize: 18,
  },
  offlineBannerTextGroup: {
    flex: 1,
    gap: 1,
  },
  offlineBannerTitle: {
    color: "#EAB308",
  },
  offlineRefreshButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#EAB308",
  },
  offlineRefreshButtonText: {
    color: "#EAB308",
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
  firstMealAddButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 8,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  firstMealAddButtonText: {
    color: "#10B981",
    fontSize: 13,
  },
  firstMealRepeatBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  firstMealRepeatInfo: {
    flex: 1,
    gap: 2,
  },
  copyToTodayButton: {
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 10,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  copyToTodayButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
  },
  firstMealFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Spacing.half,
  },
  firstMealLogLink: {
    paddingVertical: Spacing.half,
  },
  firstMealLogLinkText: {
    color: "#10B981",
    fontSize: 13,
  },
});
