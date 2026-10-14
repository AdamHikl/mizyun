import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  trainingPrescriptionResponseSchema,
  type TrainingPrescription,
  type TrainingPrescriptionResponse,
} from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";
import { ThemedText } from "@/components/themed-text";
import { Button, Card } from "@/components/ui";
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
    <Card>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <ThemedText type="headline">Your training plan</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Deterministic · updates from confirmed records
          </ThemedText>
        </View>
        <Button
          label={expanded ? "Hide" : "View"}
          variant="tinted"
          size="small"
          accessibilityState={{ expanded }}
          disabled={prescription === null}
          onPress={() => setExpanded((value) => !value)}
        />
      </View>

      {loading ? (
        <ThemedText type="small" themeColor="textSecondary">
          Building from your goal and preferences…
        </ThemedText>
      ) : error !== null ? (
        <View style={styles.row}>
          <ThemedText type="small" style={styles.flex}>
            {error}
          </ThemedText>
          <Button
            label="Retry"
            variant="plain"
            size="small"
            onPress={() => void load()}
          />
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
          <Button
            label="Open Coach preferences"
            variant="tinted"
            size="small"
            onPress={() => router.push("/settings")}
          />
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
                    <ThemedText
                      key={exercise.catalogId}
                      type="small"
                      themeColor="textSecondary"
                    >
                      {exercise.name} · {exercise.sets}×
                      {exercise.repsMin !== null
                        ? `${exercise.repsMin}–${exercise.repsMax}`
                        : `${exercise.durationMinutes} min`}
                    </ThemedText>
                  ))}
                </View>
              ))}
              <ThemedText type="footnote" themeColor="textSecondary">
                Double progression: reach the top of the rep range with
                controlled technique and RPE ≤ 8 before adding 2–5% load.
              </ThemedText>
              <Button
                label="Adjust plan inputs"
                variant="tinted"
                size="small"
                onPress={() => router.push("/settings")}
              />
              {prescription.warnings.map((warning) => (
                <ThemedText
                  key={warning}
                  type="footnote"
                  themeColor="textSecondary"
                >
                  {warning}
                </ThemedText>
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  headingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  headingCopy: { flex: 1, minWidth: 160, gap: Spacing.half },
  section: { gap: Spacing.two },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  flex: { flexShrink: 1 },
  sessions: { gap: Spacing.three },
  sessionScroll: { maxHeight: 320 },
  session: { gap: Spacing.one },
});
