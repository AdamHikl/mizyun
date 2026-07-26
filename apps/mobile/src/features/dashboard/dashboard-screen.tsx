import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useState } from "react";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { apiClient } from "@/composition/api-client";
import { analyticsClient } from "@/composition/analytics-client";
import { useAuth } from "@/features/auth/auth-context";

import {
  fetchDailySummary,
  fetchEnergySummary,
  fetchLatestWeight,
  fetchNutritionReview,
  fetchWorkoutCountForPeriod,
  type DailySummary,
  type EnergySummary,
  type LatestWeight,
  type LocalDayQuery,
  type NutritionReview,
} from "./dashboard-data";

interface MetricsState {
  readonly caloriesToday: number | null;
  readonly macros: DailySummary | null;
  readonly latestWeightKg: number | null;
  readonly workoutsInReview: number | null;
  readonly energy: EnergySummary | null;
  readonly nutritionReview: NutritionReview | null;
  readonly loading: boolean;
  readonly hasError: boolean;
}

const EMPTY_METRICS: MetricsState = {
  caloriesToday: null,
  macros: null,
  latestWeightKg: null,
  workoutsInReview: null,
  energy: null,
  nutritionReview: null,
  loading: true,
  hasError: false,
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

type ReviewPeriod = "week" | "month";

const localReviewDaysThroughToday = (
  now: Date,
  period: ReviewPeriod,
): ReadonlyArray<LocalDayQuery> => {
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (period === "week") {
    const mondayBasedDay = (cursor.getDay() + 6) % 7;
    cursor.setDate(cursor.getDate() - mondayBasedDay);
  } else {
    cursor.setDate(1);
  }
  const days: LocalDayQuery[] = [];
  while (isoLocalDate(cursor) <= isoLocalDate(now)) {
    days.push({
      date: isoLocalDate(cursor),
      utcOffsetMinutes: -cursor.getTimezoneOffset(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

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

const caloriesDetail = (summary: DailySummary | null): string => {
  if (summary === null) return "Start with a meal";
  if (summary.entryCount === 0) return "No entries yet today";
  const p = summary.proteinG ?? 0;
  const c = summary.carbohydrateG ?? 0;
  const f = summary.fatG ?? 0;
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
    path: "/log-meal" as Href,
    hint: "What did you eat?",
  },
  {
    label: "Today's meals",
    path: "/nutrition" as Href,
    hint: "Review or edit entries",
  },
  {
    label: "Start a workout",
    path: "/log-workout" as Href,
    hint: "Name your session",
  },
  {
    label: "Add weight",
    path: "/log-weight" as Href,
    hint: "Just today's reading",
  },
  {
    label: "Weight history",
    path: "/body" as Href,
    hint: "Raw readings and trend",
  },
  {
    label: "Progress photos",
    path: "/progress-photos" as Href,
    hint: "Private timeline and compare",
  },
] as const;

export function DashboardScreen() {
  const { profile, session, openOnboarding } = useAuth();
  const [metrics, setMetrics] = useState<MetricsState>(EMPTY_METRICS);
  const [reviewPeriod, setReviewPeriod] = useState<ReviewPeriod>("week");
  const userId = session?.user.id ?? null;
  const accessToken = session?.accessToken ?? null;
  const unitSystem = profile?.unitSystem ?? "metric";

  // AuthSession carries the access token the API client reads on
  // each request. When the session is null we render the
  // placeholder UX (the SessionGate has already routed the user
  // out of this screen).
  const principal =
    userId === null || accessToken === null
      ? null
      : {
          userId,
          accessToken,
        };

  const loadMetrics = useCallback(async (): Promise<void> => {
    if (principal === null) {
      setMetrics(EMPTY_METRICS);
      return;
    }
    setMetrics((current) => ({ ...current, loading: true, hasError: false }));
    const now = new Date();
    const utcOffsetMinutes = -now.getTimezoneOffset();
    const reviewDays = localReviewDaysThroughToday(now, reviewPeriod);
    const [summary, weight, count, energy, nutritionReview] = await Promise.all(
      [
        fetchDailySummary(apiClient, principal, {
          date: isoLocalDate(now),
          utcOffsetMinutes,
        }),
        fetchLatestWeight(apiClient, principal),
        fetchWorkoutCountForPeriod(apiClient, principal, {
          fromIsoDate:
            reviewPeriod === "week"
              ? startOfLocalWeek(now)
              : (reviewDays[0]?.date ?? isoLocalDate(now)),
          toIsoDate: isoLocalDate(now),
        }),
        fetchEnergySummary(apiClient, principal, utcOffsetMinutes),
        fetchNutritionReview(apiClient, principal, reviewDays),
      ],
    );
    setMetrics({
      caloriesToday: summary.value?.caloriesKcal ?? null,
      macros: summary.value ?? null,
      latestWeightKg: weight.value?.weightKg ?? null,
      workoutsInReview: count.value,
      energy: energy.value,
      nutritionReview: nutritionReview.value,
      loading: false,
      hasError:
        summary.error !== null ||
        weight.error !== null ||
        count.error !== null ||
        energy.error !== null ||
        nutritionReview.error !== null,
    });
  }, [accessToken, reviewPeriod, userId]);

  // Re-fetch every time the screen gains focus so the user sees
  // their entry as soon as they navigate back from the log form.
  useFocusEffect(
    useCallback(() => {
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "dashboard" },
      });
      void loadMetrics();
    }, [loadMetrics]),
  );

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                MIZYUN
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Account settings"
                onPress={() => void router.push("/settings" as Href)}
                style={styles.headerSettingsButton}
              >
                <ThemedText type="smallBold" style={styles.headerSettingsText}>
                  ⚙️ Account
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="subtitle">Your day, in one place.</ThemedText>
            <ThemedText themeColor="textSecondary">
              Explore tracking and tools freely. Set up your primary goal
              whenever you're ready.
            </ThemedText>
          </View>

          {!profile?.displayName ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set up Mizyun"
              onPress={openOnboarding}
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

          <View style={styles.metrics}>
            <MetricCard
              label="Calories today"
              value={formatCalories(metrics.caloriesToday)}
              detail={caloriesDetail(metrics.macros)}
            />
            <MetricCard
              label="Current weight"
              value={formatWeight(metrics.latestWeightKg, unitSystem)}
              detail="Latest measurement"
            />
            <MetricCard
              label="Training"
              value={formatCount(metrics.workoutsInReview)}
              detail={`completed this ${reviewPeriod}`}
            />
          </View>

          <EnergyCard
            summary={metrics.energy}
            caloriesToday={metrics.caloriesToday}
          />

          <ProgressReviewCard
            nutrition={metrics.nutritionReview}
            workouts={metrics.workoutsInReview}
            period={reviewPeriod}
            onChangePeriod={setReviewPeriod}
          />

          {metrics.loading ? (
            <ThemedText type="small" themeColor="textSecondary">
              Refreshing your dashboard…
            </ThemedText>
          ) : null}
          {metrics.hasError ? (
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
                  void loadMetrics();
                }}
              >
                <ThemedText type="smallBold">Retry</ThemedText>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.section}>
            <ThemedText type="smallBold">Quick add</ThemedText>
            <View style={styles.actionGrid}>
              {actions.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => {
                    void router.push(action.path);
                  }}
                  style={({ pressed }) => [
                    styles.action,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.actionBody}>
                    <ThemedText type="smallBold">{action.label}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {action.hint}
                    </ThemedText>
                  </View>
                  <ThemedText themeColor="textSecondary">＋</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          <ThemedView type="backgroundElement" style={styles.foundationCard}>
            <ThemedText type="smallBold">Foundation mode</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Model APIs are intentionally disconnected. Tracking features
              remain independent and the coach has a replaceable provider
              boundary.
            </ThemedText>
          </ThemedView>

          {profile?.displayName === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Finish setting up Mizyun"
              onPress={() => void router.push("/onboarding" as Href)}
              style={styles.foundationCard}
            >
              <ThemedText type="smallBold">Finish setting up Mizyun</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Add your display name, units, height, baseline weight, and goal
                so the dashboard and energy targets become useful.
              </ThemedText>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
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
          <ThemedText type="subtitle">
            {complete ? formatEnergyBalance(summary) : "Needs confirmed inputs"}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review energy inputs"
          onPress={() => void router.push("/energy-setup" as Href)}
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
            <AuditValue label="BMR" value={formatCalories(summary.bmrKcal)} />
            <AuditValue label="TDEE" value={formatCalories(summary.tdeeKcal)} />
            <AuditValue
              label="Activity"
              value={summary.activityMultiplier?.toFixed(2) ?? "—"}
            />
            <AuditValue
              label="Goal adjustment"
              value={formatCalories(summary.goalAdjustmentKcal)}
            />
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
  readonly value: string;
  readonly detail: string;
}) {
  return (
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
    gap: Spacing.five,
  },
  header: { gap: Spacing.one },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSettingsButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
  },
  headerSettingsText: {
    color: "#10B981",
    fontSize: 12,
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
  metrics: { gap: Spacing.three },
  metricCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.half,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.12)",
  },
  metricValue: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  section: { gap: Spacing.three },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  action: {
    minWidth: "47%",
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    borderRadius: 16,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
});
