import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { WorkoutSharePreviewDto } from "@mizyun/contracts";
import { useTheme } from "@/hooks/use-theme";

export type SharedWorkoutDetailsData = NonNullable<
  WorkoutSharePreviewDto["workoutDetails"]
>;

const SET_LABELS = {
  normal: "Set",
  warmup: "Warm-up",
  drop: "Drop set",
  failure: "Failure set",
} as const;

export function SharedWorkoutDetails({
  details,
  compact = false,
}: {
  details: SharedWorkoutDetailsData;
  compact?: boolean;
}) {
  const colors = useTheme();
  const sets = details.exercises.reduce(
    (count, exercise) => count + exercise.sets.length,
    0,
  );
  if (compact)
    return (
      <View style={styles.container}>
        <Text style={[styles.summary, { color: colors.text }]}>
          {details.exercises.length}{" "}
          {details.exercises.length === 1 ? "exercise" : "exercises"} · {sets}{" "}
          {sets === 1 ? "set" : "sets"}
        </Text>
        <Text
          numberOfLines={2}
          style={[styles.values, { color: colors.textSecondary }]}
        >
          {details.exercises.map((exercise) => exercise.name).join(" · ")}
        </Text>
        <Text style={[styles.values, { color: colors.primary }]}>
          View workout details →
        </Text>
      </View>
    );
  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={[styles.summary, { color: colors.text }]}
      >
        Shared workout details
      </Text>
      {details.exercises.map((exercise, exerciseIndex) => (
        <View
          key={exerciseIndex}
          style={[
            styles.exercise,
            {
              backgroundColor: colors.backgroundElement,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[styles.name, { color: colors.text }]}
          >
            {exercise.name}
          </Text>
          {exercise.sets.map((set, setIndex) => {
            const values = [
              set.loadKg !== null ? `${set.loadKg} kg` : null,
              set.repetitions !== null ? `${set.repetitions} reps` : null,
              set.durationSeconds !== null
                ? `${set.durationSeconds} sec`
                : null,
            ]
              .filter((value) => value !== null)
              .join(" · ");
            const label = `${SET_LABELS[set.setType]} ${setIndex + 1}`;
            return (
              <View
                key={setIndex}
                accessible
                accessibilityLabel={`${label}: ${values || "No measurements recorded"}`}
                style={styles.row}
              >
                <Text style={[styles.set, { color: colors.textSecondary }]}>
                  {label}
                </Text>
                <Text style={[styles.values, { color: colors.text }]}>
                  {values || "No measurements recorded"}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 10, marginTop: 14 },
  summary: { fontSize: 15, fontWeight: "600" },
  exercise: { padding: 14, gap: 10, borderRadius: 14, borderWidth: 1 },
  name: { fontSize: 16, fontWeight: "600" },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  set: { fontSize: 14 },
  values: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
});
