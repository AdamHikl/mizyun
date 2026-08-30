import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  trainingPrescriptionResponseSchema,
  type TrainingPrescription,
  type TrainingPrescriptionResponse,
} from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

const missingLabel: Readonly<Record<string, string>> = {
  active_goal: "active goal",
  experience_level: "experience",
  training_days: "days per week",
  session_duration: "session length",
};

export function TrainingPlanCard() {
  const router = useRouter();
  const [prescription, setPrescription] = useState<TrainingPrescription | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiClient.request<TrainingPrescriptionResponse>({
      method: "GET",
      path: "/v1/coach/training-prescription",
      schema: trainingPrescriptionResponseSchema,
    });
    if (result.ok) {
      setPrescription(result.value.prescription);
    } else {
      setError("Training plan could not be loaded.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <ThemedText type="smallBold">Your training plan</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Deterministic · updates from confirmed records
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          disabled={prescription === null}
          onPress={() => setExpanded((value) => !value)}
          style={styles.compactButton}
        >
          <ThemedText type="smallBold">{expanded ? "Hide" : "View"}</ThemedText>
        </Pressable>
      </View>

      {loading ? (
        <ThemedText type="small" themeColor="textSecondary">
          Building from your goal and preferences…
        </ThemedText>
      ) : error !== null ? (
        <View style={styles.row}>
          <ThemedText type="small">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => void load()}>
            <ThemedText type="smallBold">Retry</ThemedText>
          </Pressable>
        </View>
      ) : prescription !== null && !prescription.complete ? (
        <View style={styles.section}>
          <ThemedText type="small">
            Add{" "}
            {prescription.missingInputs
              .map((item) => missingLabel[item] ?? item)
              .join(", ")}{" "}
            to build your plan.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/settings")}
            style={styles.settingsButton}
          >
            <ThemedText type="smallBold">Open Coach preferences</ThemedText>
          </Pressable>
        </View>
      ) : prescription !== null ? (
        <>
          <ThemedText type="small">
            {prescription.resistanceDaysPerWeek} resistance days ·{" "}
            {prescription.aerobicMinutesPerWeek} aerobic min ·{" "}
            {prescription.volumeAction} volume
          </ThemedText>
          {expanded ? (
            <ScrollView
              style={styles.sessionScroll}
              contentContainerStyle={styles.sessions}
              nestedScrollEnabled
            >
              {prescription.sessions.map((session) => (
                <View key={session.index} style={styles.session}>
                  <ThemedText type="smallBold">
                    {session.label} · {session.estimatedMinutes} min
                  </ThemedText>
                  {session.exercises.map((exercise) => (
                    <ThemedText key={exercise.catalogId} type="small">
                      {exercise.name} · {exercise.sets}×
                      {exercise.repsMin !== null
                        ? `${exercise.repsMin}–${exercise.repsMax}`
                        : `${exercise.durationMinutes} min`}
                    </ThemedText>
                  ))}
                </View>
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                Double progression: reach the top of the rep range with
                controlled technique and RPE ≤ 8 before adding 2–5% load.
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/settings")}
                style={styles.settingsButton}
              >
                <ThemedText type="smallBold">Adjust plan inputs</ThemedText>
              </Pressable>
              {prescription.warnings.map((warning) => (
                <ThemedText
                  key={warning}
                  type="small"
                  themeColor="textSecondary"
                >
                  {warning}
                </ThemedText>
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.18)",
    padding: Spacing.three,
    gap: Spacing.two,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  headingCopy: { flex: 1, gap: 2 },
  compactButton: {
    minHeight: 32,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  section: { gap: Spacing.two },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  settingsButton: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  sessions: { gap: Spacing.three },
  sessionScroll: { maxHeight: 320 },
  session: { gap: Spacing.one },
});
