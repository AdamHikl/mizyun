import { spokenRunPace } from "@/features/running/presentation";
import { Pressable, StyleSheet } from "react-native";
import { router, type Href } from "expo-router";
import type { RunRecord } from "@mizyun/contracts";
import {
  distanceFromMetres,
  formatRunDuration,
  formatRunPace,
  summarizeRuns,
} from "@mizyun/core";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
export function RunCard({ run, unit }: { run: RunRecord; unit: "km" | "mi" }) {
  const pace = formatRunPace(
    run.summary.durationSeconds,
    run.summary.distanceMeters,
    unit,
  );
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">
        {run.name} · {run.summary.activityDate}
      </ThemedText>
      <ThemedText>
        {run.summary.distanceMeters === null
          ? "Distance not recorded"
          : `${Number(distanceFromMetres(run.summary.distanceMeters, unit).toFixed(2))} ${unit}`}{" "}
        · {formatRunDuration(run.summary.durationSeconds)}
      </ThemedText>
      {pace ? (
        <ThemedText type="small" accessibilityLabel={spokenRunPace(pace)}>
          Average pace · {pace}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View run on ${run.summary.activityDate}`}
        onPress={() => router.push(`/run/${run.id}` as Href)}
        style={styles.action}
      >
        <ThemedText type="smallBold">View run →</ThemedText>
      </Pressable>
    </ThemedView>
  );
}
export function RunningWeek({
  runs,
  unit,
  from,
  to,
  incomplete = false,
}: {
  runs: readonly RunRecord[];
  unit: "km" | "mi";
  from: string;
  to: string;
  incomplete?: boolean;
}) {
  if (!runs.length) return null;
  const summary = summarizeRuns(runs, from, to);
  const total = {
    seconds: summary.durationSeconds,
    metres: summary.distanceMeters,
    missing: summary.missingDistanceCount,
  };
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">
        Running this week · {from}–{to}
      </ThemedText>
      <ThemedText>
        {runs.length} {runs.length === 1 ? "run" : "runs"} ·{" "}
        {formatRunDuration(total.seconds)}
      </ThemedText>
      <ThemedText>
        Known distance ·{" "}
        {Number(distanceFromMetres(total.metres, unit).toFixed(2))} {unit}
      </ThemedText>
      {total.missing ? (
        <ThemedText type="small">
          {total.missing} {total.missing === 1 ? "run" : "runs"} without
          distance
        </ThemedText>
      ) : null}
      {incomplete ? (
        <ThemedText type="small">
          More runs are loading. Totals are incomplete.
        </ThemedText>
      ) : null}
      <ThemedText type="small">
        Monday–Sunday. Overnight runs count on their start date.
      </ThemedText>
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, gap: 8 },
  action: { minHeight: 48, paddingVertical: 12, justifyContent: "center" },
});
