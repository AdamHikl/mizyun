import { StyleSheet, View } from "react-native";
import type { Exercise, Workout, WorkoutSet } from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { Button, Card, SectionHeader } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { calculateWorkoutVolume, formatStopwatch } from "@/features/workouts";
import { kilogramsToDisplayWeight, weightUnitLabel } from "@/lib/weight-units";

interface RecordedExercise {
  readonly id: string;
  readonly name: string;
}

export function CompletedWorkoutFeed(props: {
  readonly workout: Workout;
  readonly exercises: ReadonlyArray<RecordedExercise>;
  readonly allExercises: ReadonlyArray<Exercise>;
  readonly savedSets: ReadonlyArray<WorkoutSet>;
  readonly unitSystem: "metric" | "imperial";
  readonly onOpenHistory: (name: string) => void;
}) {
  const theme = useTheme();
  const unit = weightUnitLabel(props.unitSystem);
  const start = new Date(props.workout.startedAt).getTime();
  const end = new Date(props.workout.completedAt ?? "").getTime();
  const duration =
    Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? formatStopwatch((end - start) / 1000)
      : "Not recorded";
  const date = Number.isFinite(end)
    ? new Date(end).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Date not recorded";
  const volume = kilogramsToDisplayWeight(
    calculateWorkoutVolume(
      props.savedSets.filter((set) => set.setType !== "warmup"),
    ),
    props.unitSystem,
  );
  const groups = new Map<
    string,
    { name: string; hasHistory: boolean; sets: WorkoutSet[] }
  >();
  for (const entry of props.exercises) {
    const exercise = props.allExercises.find(
      (candidate) =>
        candidate.id === entry.id ||
        candidate.name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
    );
    groups.set(exercise?.id ?? entry.id, {
      name: entry.name,
      hasHistory: exercise !== undefined,
      sets: [],
    });
  }
  for (const set of props.savedSets) {
    if (!groups.has(set.exerciseId)) {
      const exercise = props.allExercises.find(
        (candidate) => candidate.id === set.exerciseId,
      );
      groups.set(set.exerciseId, {
        name: exercise?.name ?? "Recorded exercise",
        hasHistory: exercise !== undefined,
        sets: [],
      });
    }
    groups.get(set.exerciseId)!.sets.push(set);
  }
  return (
    <View style={styles.feed} testID="completed-workout-review">
      <Card>
        <ThemedText type="headline">Completed workout</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {date}
        </ThemedText>
        <View style={styles.summaryRow}>
          <View style={styles.duration}>
            <ThemedText type="footnote" themeColor="textSecondary">
              Duration
            </ThemedText>
            <ThemedText type="subtitle" style={styles.tabular}>
              {duration}
            </ThemedText>
          </View>
          <View style={styles.totals}>
            <ThemedText type="smallBold">
              {props.savedSets.length} saved sets
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {volume} {unit} working-set volume
            </ThemedText>
          </View>
        </View>
      </Card>
      {props.savedSets.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No sets were recorded for this workout.
        </ThemedText>
      ) : null}
      {groups.size > 0 ? <SectionHeader title="Exercises" /> : null}
      {Array.from(groups, ([id, group]) => (
        <Card key={id} style={styles.exerciseCard}>
          <View style={styles.exerciseHeader}>
            <View style={styles.exerciseTitle}>
              <ThemedText type="headline">{group.name}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {group.sets.length} saved sets
              </ThemedText>
            </View>
            {group.hasHistory ? (
              <Button
                label="History"
                variant="tinted"
                size="small"
                icon="chart"
                accessibilityLabel={`View history for ${group.name}`}
                onPress={() => props.onOpenHistory(group.name)}
              />
            ) : null}
          </View>
          {group.sets.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No sets recorded.
            </ThemedText>
          ) : (
            <View>
              <View style={styles.setRow}>
                <ThemedText
                  type="caption"
                  themeColor="textTertiary"
                  style={styles.setLabel}
                >
                  Set
                </ThemedText>
                <ThemedText
                  type="caption"
                  themeColor="textTertiary"
                  style={styles.value}
                >
                  {unit}
                </ThemedText>
                <ThemedText
                  type="caption"
                  themeColor="textTertiary"
                  style={styles.value}
                >
                  Reps
                </ThemedText>
              </View>
              {[...group.sets]
                .sort((a, b) => a.sequence - b.sequence)
                .map((set, index) => (
                  <View
                    key={set.id}
                    style={[
                      styles.recordedSet,
                      { borderColor: theme.separator },
                    ]}
                  >
                    <View style={styles.setRow}>
                      <View style={[styles.setLabel, styles.setLabelRow]}>
                        <ThemedText type="small">{index + 1}</ThemedText>
                        {set.setType !== "normal" ? (
                          <ThemedText
                            type="caption"
                            style={[
                              styles.setType,
                              {
                                backgroundColor: theme.backgroundSelected,
                                color: theme.textSecondary,
                              },
                            ]}
                          >
                            {set.setType}
                          </ThemedText>
                        ) : null}
                      </View>
                      <ThemedText type="headline" style={styles.value}>
                        {set.loadKg === null
                          ? "—"
                          : kilogramsToDisplayWeight(
                              set.loadKg,
                              props.unitSystem,
                            )}
                      </ThemedText>
                      <ThemedText type="headline" style={styles.value}>
                        {set.repetitions ?? "—"}
                      </ThemedText>
                    </View>
                    {set.durationSeconds !== null ||
                    set.distanceMeters !== null ||
                    set.perceivedExertion !== null ? (
                      <ThemedText type="footnote" themeColor="textSecondary">
                        {[
                          set.durationSeconds !== null
                            ? `${formatStopwatch(set.durationSeconds)} duration`
                            : null,
                          set.distanceMeters !== null
                            ? `${set.distanceMeters} m distance`
                            : null,
                          set.perceivedExertion !== null
                            ? `RPE ${set.perceivedExertion}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </ThemedText>
                    ) : null}
                  </View>
                ))}
            </View>
          )}
        </Card>
      ))}
      {props.workout.notes?.trim() ? (
        <>
          <SectionHeader title="Notes" />
          <Card>
            <ThemedText type="small">{props.workout.notes}</ThemedText>
          </Card>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  feed: { gap: Spacing.three },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
    alignItems: "center",
  },
  duration: { gap: Spacing.half },
  tabular: { fontVariant: ["tabular-nums"] },
  totals: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    gap: Spacing.half,
  },
  exerciseCard: { gap: Spacing.three },
  exerciseHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
  exerciseTitle: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    gap: Spacing.half,
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  setLabel: { flex: 2, flexShrink: 1 },
  setLabelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  setType: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.pill,
    overflow: "hidden",
  },
  value: { flex: 1, textAlign: "right", fontVariant: ["tabular-nums"] },
  recordedSet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
});
