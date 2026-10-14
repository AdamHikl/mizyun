import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
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
import {
  BottomTabInset,
  MaxContentWidth,
  PageGutter,
  Spacing,
} from "@/constants/theme";
import {
  Button,
  Card,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  SectionHeader,
} from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { analyticsClient } from "@/composition/analytics-client";
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
  const { profile, session } = useAuth();
  const unitSystem = profile?.unitSystem ?? "metric";
  const [measurements, setMeasurements] = useState<
    ReadonlyArray<BodyMeasurement>
  >([]);
  const [trend, setTrend] = useState<WeightTrendSummary>(EMPTY_TREND);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const ownerKey = `${session?.user.id ?? ""}:${session?.accessToken ?? ""}`;
  const currentOwner = useRef(ownerKey);
  currentOwner.current = ownerKey;
  const requestVersion = useRef(0);
  const loaded = useRef(false);
  useEffect(() => {
    requestVersion.current += 1;
    loaded.current = false;
    setMeasurements([]);
    setTrend(EMPTY_TREND);
    setMessage(null);
    setLoading(true);
  }, [ownerKey]);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const requestOwner = ownerKey;
    setLoading(!loaded.current);
    const result = await fetchBodyHistory();
    if (
      version !== requestVersion.current ||
      requestOwner !== currentOwner.current
    )
      return;
    if (result.message !== null) {
      setMessage(result.message);
      setLoading(false);
      return;
    }
    loaded.current = true;
    setMeasurements(result.measurements);
    setTrend(result.trend);
    setMessage(result.message);
    setLoading(false);
  }, [ownerKey]);

  useFocusEffect(
    useCallback(() => {
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "body_history" },
      });
      void refresh();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => subscription.remove();
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
          <TrendCard trend={trend} unitSystem={unitSystem} />
          <RawChart measurements={measurements} unitSystem={unitSystem} />

          <Button
            label="Add measurement"
            variant="primary"
            icon="add"
            block
            onPress={() => router.push("/log-weight" as Href)}
          />

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Refreshing measurements…
              </ThemedText>
            </View>
          ) : null}

          {message !== null ? (
            <Notice
              tone="danger"
              message={message}
              action={
                <Button
                  label="Retry"
                  variant="plain"
                  size="small"
                  onPress={() => void refresh()}
                />
              }
            />
          ) : null}

          <View style={styles.section}>
            <SectionHeader title="Raw history" />
            {!loading && measurements.length === 0 ? (
              <Card>
                <ThemedText type="small" themeColor="textSecondary">
                  No measurements yet. Add a weight or body measurement to start
                  the record.
                </ThemedText>
              </Card>
            ) : (
              <ListGroup>
                {measurements.map((measurement) => (
                  <MeasurementRow
                    key={measurement.id}
                    measurement={measurement}
                    unitSystem={unitSystem}
                    onDelete={() => confirmDelete(measurement)}
                  />
                ))}
              </ListGroup>
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
    <Card>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Smoothed weight trend
      </ThemedText>
      <ThemedText type="title">{smoothed}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {trend.status === "ready"
          ? `${rate} over the newest ${trend.windowDays}-day window`
          : `Need at least 3 weights spanning 7 days for a weekly rate (${trend.observationCount} available).`}
      </ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        Raw readings remain visible below. Exponential smoothing uses a{" "}
        {trend.smoothingHalfLifeDays}-day half-life and elapsed time between
        irregular readings; the trend is a deterministic interpretation, not a
        replacement for what your scale recorded.
      </ThemedText>
    </Card>
  );
}

function RawChart(props: {
  readonly measurements: ReadonlyArray<BodyMeasurement>;
  readonly unitSystem: "metric" | "imperial";
}) {
  const theme = useTheme();
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
    <Card accessibilityLabel="Raw weight readings chart">
      <ThemedText type="smallBold">Raw readings · newest 14</ThemedText>
      <View style={styles.chart}>
        {weights.map((measurement) => (
          <View
            key={measurement.id}
            accessibilityLabel={`${new Date(measurement.measuredAt).toLocaleDateString()}: ${formatWeight(measurement.weightKg, props.unitSystem)}`}
            style={[
              styles.bar,
              {
                backgroundColor: theme.primary,
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
    </Card>
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
    <ListRow
      title={formatWeight(props.measurement.weightKg, props.unitSystem)}
      subtitle={[
        new Date(props.measurement.measuredAt).toLocaleString(),
        details,
      ]
        .filter((part) => part.length > 0)
        .join("\n")}
      trailing={
        <IconButton
          icon="trash"
          variant="plain"
          accessibilityLabel="Delete measurement"
          onPress={props.onDelete}
        />
      }
    />
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
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  section: { gap: Spacing.two },
  chart: {
    height: 84,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.one,
  },
  bar: { flex: 1, minWidth: 4, borderRadius: 3 },
  loading: { alignItems: "center", gap: Spacing.two },
});
