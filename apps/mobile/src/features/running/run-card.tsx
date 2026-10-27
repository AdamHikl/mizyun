import { runSourceLabel, spokenRunPace } from "@/features/running/presentation";
import { StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import type { RunRecord } from "@mizyun/contracts";
import {
  distanceFromMetres,
  formatRunDuration,
  formatRunPace,
  summarizeRuns,
} from "@mizyun/core";
import { ThemedText } from "@/components/themed-text";
import { Button, Card, IconBadge } from "@/components/ui";
import { Spacing } from "@/constants/theme";

export function RunCard({ run, unit }: { run: RunRecord; unit: "km" | "mi" }) {
  const pace = formatRunPace(
    run.summary.durationSeconds,
    run.summary.distanceMeters,
    unit,
  );
  return (
    <Card>
      <View style={styles.header}>
        <IconBadge name="run" tone="primary" />
        <View style={styles.titleBlock}>
          <ThemedText type="headline">{run.name}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {run.summary.activityDate}
            {run.summary.origin.kind !== "manual"
              ? ` · ${runSourceLabel(run)}`
              : ""}
          </ThemedText>
        </View>
      </View>
      <ThemedText type="small">
        {run.summary.distanceMeters === null
          ? "Distance not recorded"
          : `${Number(distanceFromMetres(run.summary.distanceMeters, unit).toFixed(2))} ${unit}`}{" "}
        · {formatRunDuration(run.summary.durationSeconds)}
      </ThemedText>
      {pace ? (
        <ThemedText
          type="footnote"
          themeColor="textSecondary"
          accessibilityLabel={spokenRunPace(pace)}
        >
          Average pace · {pace}
        </ThemedText>
      ) : null}
      <View style={styles.actions}>
        <Button
          label="View run"
          variant="secondary"
          size="small"
          accessibilityLabel={`View run on ${run.summary.activityDate}`}
          onPress={() => router.push(`/run/${run.id}` as Href)}
        />
      </View>
    </Card>
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
    <Card>
      <View style={styles.header}>
        <IconBadge name="run" tone="neutral" />
        <View style={styles.titleBlock}>
          <ThemedText type="headline">Running this week</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {from}–{to}
          </ThemedText>
        </View>
      </View>
      <ThemedText type="small">
        {runs.length} {runs.length === 1 ? "run" : "runs"} ·{" "}
        {formatRunDuration(total.seconds)}
      </ThemedText>
      <ThemedText type="small">
        Known distance ·{" "}
        {Number(distanceFromMetres(total.metres, unit).toFixed(2))} {unit}
      </ThemedText>
      {total.missing ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {total.missing} {total.missing === 1 ? "run" : "runs"} without
          distance
        </ThemedText>
      ) : null}
      {incomplete ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          More runs are loading. Totals are incomplete.
        </ThemedText>
      ) : null}
      <ThemedText type="footnote" themeColor="textSecondary">
        Monday–Sunday. Overnight runs count on their start date.
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  titleBlock: { flex: 1, gap: Spacing.half },
  actions: { flexDirection: "row", marginTop: Spacing.one },
});
