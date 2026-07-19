import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router, Stack, useFocusEffect, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import type { BodyMeasurement } from "@mizyun/contracts";
import type { WeightTrendSummary } from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { kilogramsToDisplayWeight, weightUnitLabel } from "@/lib/weight-units";

import { deleteBodyMeasurement, fetchBodyHistory } from "./body-history-data";

const EMPTY_TREND: WeightTrendSummary = {
  status: "insufficient",
  latestWeightKg: null,
  smoothedWeightKg: null,
  weeklyChangeKg: null,
  observationCount: 0,
  spanDays: 0,
  windowDays: 28,
  smoothingHalfLifeDays: 7,
};

export function BodyHistoryScreen() {
  const { profile } = useAuth();
  const unitSystem = profile?.unitSystem ?? "metric";
  const [measurements, setMeasurements] = useState<
    ReadonlyArray<BodyMeasurement>
  >([]);
  const [trend, setTrend] = useState<WeightTrendSummary>(EMPTY_TREND);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await fetchBodyHistory();
    setMeasurements(result.measurements);
    setTrend(result.trend);
    setMessage(result.message);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const confirmDelete = useCallback(
    (measurement: BodyMeasurement) => {
      Alert.alert(
        "Delete measurement?",
        "Use this only to correct an accidental or wrong-day reading.",
        [
          { text: "Keep", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void (async () => {
                const result = await deleteBodyMeasurement(measurement.id);
                if (!result.ok) return setMessage(result.message);
                await refresh();
              })();
            },
          },
        ],
      );
    },
    [refresh],
  );

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Body progress" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <ThemedText type="subtitle">
              Trend, without hiding noise.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Raw readings remain visible below. The trend is a deterministic
              interpretation, not a replacement for what your scale recorded.
            </ThemedText>
          </View>

          <TrendCard trend={trend} unitSystem={unitSystem} />
          <RawChart measurements={measurements} unitSystem={unitSystem} />

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/log-weight" as Href)}
            style={styles.primaryButton}
          >
            <ThemedText type="smallBold">Add measurement</ThemedText>
          </Pressable>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Refreshing measurements…
              </ThemedText>
            </View>
          ) : null}

          {message !== null ? (
            <View style={styles.message} accessibilityRole="alert">
              <ThemedText type="small">{message}</ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refresh()}
              >
                <ThemedText type="smallBold">Retry</ThemedText>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.section}>
            <ThemedText type="smallBold">Raw history</ThemedText>
            {!loading && measurements.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No measurements yet. Add a weight or body measurement to start
                the record.
              </ThemedText>
            ) : (
              measurements.map((measurement) => (
                <MeasurementRow
                  key={measurement.id}
                  measurement={measurement}
                  unitSystem={unitSystem}
                  onDelete={() => confirmDelete(measurement)}
                />
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function TrendCard(props: {
  readonly trend: WeightTrendSummary;
  readonly unitSystem: "metric" | "imperial";
}) {
  const { trend, unitSystem } = props;
  const smoothed = formatWeight(trend.smoothedWeightKg, unitSystem);
  const rate = formatRate(trend.weeklyChangeKg, unitSystem);
  return (
    <View style={styles.card}>
      <ThemedText type="smallBold">Smoothed weight trend</ThemedText>
      <ThemedText type="title">{smoothed}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {trend.status === "ready"
          ? `${rate} over the newest ${trend.windowDays}-day window`
          : `Need at least 3 weights spanning 7 days for a weekly rate (${trend.observationCount} available).`}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Exponential smoothing uses a {trend.smoothingHalfLifeDays}-day half-life
        and elapsed time between irregular readings.
      </ThemedText>
    </View>
  );
}

function RawChart(props: {
  readonly measurements: ReadonlyArray<BodyMeasurement>;
  readonly unitSystem: "metric" | "imperial";
}) {
  const weights = [...props.measurements]
    .filter(
      (measurement): measurement is BodyMeasurement & { weightKg: number } =>
        measurement.weightKg !== null,
    )
    .slice(0, 14)
    .reverse();
  if (weights.length < 2) return null;
  const values = weights.map((measurement) => measurement.weightKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.1);
  return (
    <View style={styles.card} accessibilityLabel="Raw weight readings chart">
      <ThemedText type="smallBold">Raw readings · newest 14</ThemedText>
      <View style={styles.chart}>
        {weights.map((measurement) => (
          <View
            key={measurement.id}
            accessibilityLabel={`${new Date(measurement.measuredAt).toLocaleDateString()}: ${formatWeight(measurement.weightKg, props.unitSystem)}`}
            style={[
              styles.bar,
              {
                height: 12 + ((measurement.weightKg - min) / span) * 68,
              },
            ]}
          />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Range {formatWeight(min, props.unitSystem)}–
        {formatWeight(max, props.unitSystem)}
      </ThemedText>
    </View>
  );
}

function MeasurementRow(props: {
  readonly measurement: BodyMeasurement;
  readonly unitSystem: "metric" | "imperial";
  readonly onDelete: () => void;
}) {
  const details = Object.entries(props.measurement.measurements)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([key, value]) =>
      key.endsWith("_cm")
        ? `${labelMeasurement(key)} ${formatLength(value, props.unitSystem)}`
        : `${labelMeasurement(key)} ${value}`,
    )
    .join(" · ");
  return (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <ThemedText type="smallBold">
          {formatWeight(props.measurement.weightKg, props.unitSystem)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {new Date(props.measurement.measuredAt).toLocaleString()}
        </ThemedText>
        {details.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {details}
          </ThemedText>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete measurement"
        onPress={props.onDelete}
        style={styles.deleteButton}
      >
        <ThemedText type="smallBold">Delete</ThemedText>
      </Pressable>
    </View>
  );
}

const formatWeight = (
  kg: number | null,
  unitSystem: "metric" | "imperial",
): string =>
  kg === null
    ? "No weight"
    : `${kilogramsToDisplayWeight(kg, unitSystem)} ${weightUnitLabel(unitSystem)}`;

const formatRate = (
  kgPerWeek: number | null,
  unitSystem: "metric" | "imperial",
): string => {
  if (kgPerWeek === null) return "No weekly rate";
  const displayed = kilogramsToDisplayWeight(Math.abs(kgPerWeek), unitSystem);
  const sign = kgPerWeek > 0 ? "+" : kgPerWeek < 0 ? "−" : "";
  return `${sign}${displayed} ${weightUnitLabel(unitSystem)}/week`;
};

const formatLength = (
  centimeters: number,
  unitSystem: "metric" | "imperial",
): string =>
  unitSystem === "imperial"
    ? `${Math.round((centimeters / 2.54) * 10) / 10} in`
    : `${Math.round(centimeters * 10) / 10} cm`;

const labelMeasurement = (key: string): string =>
  key.replace(/_cm$/, "").replaceAll("_", " ");

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  header: { gap: Spacing.two },
  section: { gap: Spacing.two },
  card: {
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  chart: {
    height: 84,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.one,
  },
  bar: { flex: 1, minWidth: 4, borderRadius: 3, backgroundColor: "#18633d" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#8A8D91",
    paddingTop: Spacing.two,
  },
  rowCopy: { flex: 1, gap: Spacing.one },
  deleteButton: { minHeight: 44, minWidth: 64, justifyContent: "center" },
  primaryButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F1F23",
  },
  loading: { alignItems: "center", gap: Spacing.two },
  message: {
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#A13A25",
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
});
