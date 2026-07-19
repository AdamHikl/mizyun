import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useState } from "react";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";

import {
  fetchDailySummary,
  fetchLatestWeight,
  fetchWorkoutCountThisWeek,
  type DailySummary,
  type LatestWeight,
} from "./dashboard-data";

interface MetricsState {
  readonly caloriesToday: number | null;
  readonly macros: DailySummary | null;
  readonly latestWeightKg: number | null;
  readonly workoutsThisWeek: number | null;
  readonly loading: boolean;
  readonly hasError: boolean;
}

const EMPTY_METRICS: MetricsState = {
  caloriesToday: null,
  macros: null,
  latestWeightKg: null,
  workoutsThisWeek: null,
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
] as const;

export function DashboardScreen() {
  const { profile, session } = useAuth();
  const [metrics, setMetrics] = useState<MetricsState>(EMPTY_METRICS);
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
    const [summary, weight, count] = await Promise.all([
      fetchDailySummary(apiClient, principal, {
        date: isoLocalDate(now),
        utcOffsetMinutes: -now.getTimezoneOffset(),
      }),
      fetchLatestWeight(apiClient, principal),
      fetchWorkoutCountThisWeek(apiClient, principal, {
        fromIsoDate: startOfLocalWeek(now),
        toIsoDate: isoLocalDate(now),
      }),
    ]);
    setMetrics({
      caloriesToday: summary.value?.caloriesKcal ?? null,
      macros: summary.value ?? null,
      latestWeightKg: weight.value?.weightKg ?? null,
      workoutsThisWeek: count.value,
      loading: false,
      hasError:
        summary.error !== null || weight.error !== null || count.error !== null,
    });
  }, [accessToken, userId]);

  // Re-fetch every time the screen gains focus so the user sees
  // their entry as soon as they navigate back from the log form.
  useFocusEffect(
    useCallback(() => {
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
            <ThemedText type="smallBold" themeColor="textSecondary">
              MIZYUN
            </ThemedText>
            <ThemedText type="subtitle">Your day, in one place.</ThemedText>
            <ThemedText themeColor="textSecondary">
              Build the record first. Coaching and automation can plug into the
              same data later.
            </ThemedText>
          </View>

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
              value={formatCount(metrics.workoutsThisWeek)}
              detail="workouts this week"
            />
          </View>

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
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function MetricCard(props: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.metricCard}>
      <ThemedText type="small" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <ThemedText type="subtitle">{props.value}</ThemedText>
      <ThemedText type="small">{props.detail}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.five,
  },
  header: { gap: Spacing.two },
  metrics: { gap: Spacing.three },
  metricCard: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  section: { gap: Spacing.three },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  action: {
    minWidth: "47%",
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.three,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pressed: { opacity: 0.65 },
  foundationCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  actionBody: { flex: 1, gap: Spacing.one },
  refreshError: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
});
