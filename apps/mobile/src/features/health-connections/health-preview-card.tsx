import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState, Platform, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { getAppVariant } from "@/composition/app-variant";
import { kilogramsToDisplayWeight, weightUnitLabel } from "@/lib/weight-units";
import { HealthPreviewController } from "./health-preview-controller";
import { nativeHealthPreviewReader } from "./native-reader";

export function HealthPreviewCard({
  userId,
  unitSystem = "metric",
}: {
  readonly userId: string;
  readonly unitSystem?: "metric" | "imperial";
}) {
  const theme = useTheme();
  const controller = useMemo(
    () =>
      new HealthPreviewController(
        nativeHealthPreviewReader,
        Platform.OS === "ios" ? "apple_health" : "health_connect",
      ),
    [userId],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.attach();
    controller.setActive(AppState.currentState === "active");
    const listener = AppState.addEventListener("change", (next) =>
      controller.setActive(next === "active"),
    );
    return () => {
      listener.remove();
      controller.destroy();
    };
  }, [controller]);
  useFocusEffect(
    React.useCallback(() => () => controller.clear(), [controller]),
  );
  const busy = state.phase === "reading" || state.phase === "authorizing";
  const source = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
  if (getAppVariant() !== "dev")
    return (
      <ThemedText>Health previews are not available in this build.</ThemedText>
    );
  return (
    <View style={styles.content}>
      <ThemedText type="small" themeColor="textSecondary">
        Preview weight or completed workouts from {source}. Choosing a category
        confirms that this phone’s health profile is yours and requests only
        that category’s read access.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Records stay in memory on this screen. Leaving it or backgrounding the
        app clears the preview. They are not saved to your account, used by
        Coach, shared with other apps, or added to your targets and workout
        statistics.
      </ThemedText>
      <View style={styles.buttons}>
        {(["weight", "workout"] as const).map((kind) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityLabel={
              kind === "weight"
                ? "Preview weight from Health"
                : "Preview completed workouts from Health"
            }
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => void controller.connect(kind)}
            style={[
              styles.button,
              { backgroundColor: theme.primary },
              busy && styles.disabled,
            ]}
          >
            <ThemedText type="smallBold" style={styles.buttonText}>
              {kind === "weight" ? "Preview weight" : "Preview workouts"}
            </ThemedText>
          </Pressable>
        ))}
        {state.kind && !busy ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void controller.refresh()}
            style={[
              styles.button,
              { borderColor: theme.border, borderWidth: 1 },
            ]}
          >
            <ThemedText type="smallBold">Refresh preview</ThemedText>
          </Pressable>
        ) : null}
        {state.phase !== "disabled" ? (
          <Pressable
            accessibilityRole="button"
            onPress={controller.clear}
            style={[
              styles.button,
              { borderColor: theme.border, borderWidth: 1 },
            ]}
          >
            <ThemedText type="smallBold">Clear and stop reading</ThemedText>
          </Pressable>
        ) : null}
      </View>
      {busy ? (
        <ThemedText accessibilityRole="alert">
          {state.phase === "authorizing"
            ? "Checking health access…"
            : "Reading preview…"}
        </ThemedText>
      ) : null}
      {state.message ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
        >
          {state.message}
        </ThemedText>
      ) : null}
      {state.from && state.to ? (
        <ThemedText type="small" themeColor="textSecondary">
          Requested window: {new Date(state.from).toLocaleString()} –{" "}
          {new Date(state.to).toLocaleString()}. Available history may be
          shorter.
        </ThemedText>
      ) : null}
      {state.lastReadAt ? (
        <ThemedText type="small" themeColor="textSecondary">
          Last read: {new Date(state.lastReadAt).toLocaleString()} ·{" "}
          {state.records.length} records
        </ThemedText>
      ) : null}
      {state.records.map((record) => (
        <View
          key={`${record.provider}:${record.sourceAppId}:${record.kind}:${record.externalId}`}
          style={[styles.record, { borderColor: theme.border }]}
        >
          <ThemedText type="smallBold">
            {record.kind === "weight"
              ? `${kilogramsToDisplayWeight(record.weightKg, unitSystem)} ${weightUnitLabel(unitSystem)}`
              : `${record.activityType} · ${Math.round(record.durationSeconds / 60)} min`}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {new Date(
              record.kind === "weight" ? record.measuredAt : record.startedAt,
            ).toLocaleString()}
            {record.kind === "workout"
              ? ` – ${new Date(record.endedAt).toLocaleString()}`
              : ""}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Source: {record.sourceAppName ?? record.sourceAppId} · {source}
            {record.sourceTimeZone
              ? ` · recorded zone ${record.sourceTimeZone}`
              : " · source timezone unavailable"}
          </ThemedText>
          {record.kind === "workout" ? (
            <ThemedText type="small" themeColor="textSecondary">
              Imported summary · no sets or personal records
            </ThemedText>
          ) : null}
        </View>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        Clear stops Mizyun reading for this preview. To revoke OS access too,
        change Mizyun’s permissions in your device health settings. Original
        health records are never changed.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  buttons: { gap: 10 },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "#FFFFFF" },
  disabled: { opacity: 0.5 },
  record: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
});
