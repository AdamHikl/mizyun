import { Pressable, StyleSheet, View } from "react-native";
import type { Exercise, Workout, WorkoutSet } from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
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
  const cardStyle = [
    styles.card,
    {
      backgroundColor: theme.backgroundElement,
      borderColor: theme.border,
    },
  ];

  return (
    <View style={styles.feed} testID="completed-workout-review">
      <View style={cardStyle}>
        <ThemedText type="smallBold">Completed workout</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {date}
        </ThemedText>
        <View style={styles.summaryRow}>
          <View style={styles.duration}>
            <ThemedText type="small" themeColor="textSecondary">
              Duration
            </ThemedText>
            <ThemedText type="subtitle">{duration}</ThemedText>
          </View>
          <View style={styles.totals}>
            <ThemedText type="small">
              {props.savedSets.length} saved sets
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {volume} {unit} working-set volume
            </ThemedText>
          </View>
        </View>
      </View>
      {props.savedSets.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No sets were recorded for this workout.
        </ThemedText>
      ) : null}
      {Array.from(groups, ([id, group]) => (
        <View key={id} style={cardStyle}>
          <View style={styles.exerciseHeader}>
            <View style={styles.exerciseTitle}>
              <ThemedText type="smallBold">{group.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {group.sets.length} saved sets
              </ThemedText>
            </View>
            {group.hasHistory ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View history for ${group.name}`}
                onPress={() => props.onOpenHistory(group.name)}
                style={[styles.history, { borderColor: theme.border }]}
              >
                <ThemedText type="smallBold">History →</ThemedText>
              </Pressable>
            ) : null}
          </View>
          {group.sets.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No sets recorded.
            </ThemedText>
          ) : (
            <>
              <View style={styles.setRow}>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.setLabel}
                >
                  SET
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.value}
                >
                  {unit.toUpperCase()}
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.value}
                >
                  REPS
                </ThemedText>
              </View>
              {[...group.sets]
                .sort((a, b) => a.sequence - b.sequence)
                .map((set, index) => (
                  <View
                    key={set.id}
                    style={[styles.recordedSet, { borderColor: theme.border }]}
                  >
                    <View style={styles.setRow}>
                      <ThemedText type="small" style={styles.setLabel}>
                        {index + 1}
                        {set.setType !== "normal" ? ` · ${set.setType}` : ""}
                      </ThemedText>
                      <ThemedText type="smallBold" style={styles.value}>
                        {set.loadKg === null
                          ? "—"
                          : kilogramsToDisplayWeight(
                              set.loadKg,
                              props.unitSystem,
                            )}
                      </ThemedText>
                      <ThemedText type="smallBold" style={styles.value}>
                        {set.repetitions ?? "—"}
                      </ThemedText>
                    </View>
                    {set.durationSeconds !== null ||
                    set.distanceMeters !== null ||
                    set.perceivedExertion !== null ? (
                      <ThemedText type="small" themeColor="textSecondary">
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
            </>
          )}
        </View>
      ))}
      {props.workout.notes?.trim() ? (
        <View style={cardStyle}>
          <ThemedText type="smallBold">Workout notes</ThemedText>
          <ThemedText type="small">{props.workout.notes}</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  feed: { gap: 16 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "center",
  },
  duration: { gap: 4 },
  totals: { flexGrow: 1, flexShrink: 1, flexBasis: 160, gap: 4 },
  exerciseHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
  exerciseTitle: { flexGrow: 1, flexShrink: 1, flexBasis: 160, gap: 4 },
  history: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  setRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  setLabel: { flex: 2, flexShrink: 1 },
  value: { flex: 1, textAlign: "right" },
  recordedSet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 8,
  },
});
