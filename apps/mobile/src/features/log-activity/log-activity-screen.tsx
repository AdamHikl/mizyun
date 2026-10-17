import { useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router, Stack } from "expo-router";
import * as Crypto from "expo-crypto";
import { listTimedActivities } from "@mizyun/core";
import type { ApiClient } from "@mizyun/api-client";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  ChoiceChip,
  ChoiceGroup,
  FormField,
  FormStatus,
  FormTextInput,
} from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { apiClient, invalidateSessionReads } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import {
  saveLoggedActivityWith,
  type LogActivityPlan,
} from "./log-activity-data";
import {
  activityDistanceUnit,
  activityTimes,
  activityTracksDistance,
  parseActivityForm,
  recentDayLabels,
} from "./log-activity-form";

const activities = listTimedActivities();

export function LogActivityScreen() {
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? null;
  // Owner is the account, not the token: a token refresh mid-save is fine.
  const owner = useRef(userId);
  owner.current = userId;
  const busyRef = useRef(false);
  // Set on the first save attempt; kept so every retry sends the same body.
  const pending = useRef<LogActivityPlan | null>(null);
  // True once any attempt for the pending plan may have sent its workout.
  const workoutSent = useRef(false);

  const [activityId, setActivityId] = useState(activities[0]?.id ?? "");
  const [dayOffset, setDayOffset] = useState(0);
  const [minutes, setMinutes] = useState("");
  const [seconds, setSeconds] = useState("");
  const [distance, setDistance] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [retryable, setRetryable] = useState(true);

  const activity =
    activities.find((candidate) => candidate.id === activityId) ??
    activities[0];
  const unitSystem = profile?.unitSystem === "imperial" ? "imperial" : "metric";
  const tracksDistance = activity ? activityTracksDistance(activity) : false;
  const unit = activity ? activityDistanceUnit(activity, unitSystem) : "km";
  const disabled = busy || locked;

  const save = async () => {
    if (!activity || !userId || busyRef.current) return;
    const saveOwner = owner.current;
    let plan = pending.current;
    if (plan && plan.ownerId !== userId) {
      // Never resend one account's activity under another account.
      pending.current = null;
      workoutSent.current = false;
      plan = null;
      setLocked(false);
      setRetryable(true);
      setError(
        "You switched accounts, so the unfinished save was discarded. Check the details and save again.",
      );
      return;
    }
    if (!plan) {
      const parsed = parseActivityForm({
        minutes,
        seconds,
        distance,
        unit,
        tracksDistance,
      });
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
      const times = activityTimes(
        new Date(),
        dayOffset,
        parsed.durationSeconds,
      );
      plan = {
        ownerId: userId,
        operationId: Crypto.randomUUID(),
        activity,
        ...times,
        durationSeconds: parsed.durationSeconds,
        distanceMeters: parsed.distanceMeters,
        notes,
      };
      pending.current = plan;
      setLocked(true);
    }
    const isCurrent = () => owner.current === saveOwner;
    const scoped: ApiClient = {
      status: () => apiClient.status(),
      request: (options) =>
        apiClient.request({ ...options, expectedUserId: userId, isCurrent }),
    };
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await saveLoggedActivityWith(scoped, plan);
      // Record a possibly sent workout even if the response is now stale.
      if (!result.ok && result.workoutRequested) workoutSent.current = true;
      if (!isCurrent()) return;
      if (result.ok) {
        invalidateSessionReads();
        router.back();
        return;
      }
      setError(result.message);
      if (!workoutSent.current) {
        // No attempt reached the workout step: edit and save afresh.
        pending.current = null;
        setLocked(false);
      } else {
        setRetryable(result.retryable);
      }
    } catch {
      // The workout may have been sent; keep the plan for an identical retry.
      workoutSent.current = true;
      if (isCurrent())
        setError(
          "The response was lost. Nothing was duplicated. Retry to finish saving.",
        );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Log activity" }} />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <ThemedText type="subtitle">Log a finished activity</ThemedText>
        <FormField label="Activity">
          <ChoiceGroup>
            {activities.map((candidate) => (
              <ChoiceChip
                key={candidate.id}
                label={candidate.name}
                selected={candidate.id === activityId}
                disabled={disabled}
                onPress={() => setActivityId(candidate.id)}
              />
            ))}
          </ChoiceGroup>
        </FormField>
        <FormField label="Date">
          <ChoiceGroup>
            {recentDayLabels(new Date()).map((day) => (
              <ChoiceChip
                key={day.offset}
                label={day.label}
                selected={day.offset === dayOffset}
                disabled={disabled}
                onPress={() => setDayOffset(day.offset)}
              />
            ))}
          </ChoiceGroup>
        </FormField>
        <View style={styles.row}>
          <View style={styles.cell}>
            <FormField label="Minutes">
              <FormTextInput
                accessibilityLabel="Minutes"
                value={minutes}
                editable={!disabled}
                keyboardType="number-pad"
                maxLength={4}
                onChangeText={setMinutes}
              />
            </FormField>
          </View>
          <View style={styles.cell}>
            <FormField label="Seconds">
              <FormTextInput
                accessibilityLabel="Seconds"
                value={seconds}
                editable={!disabled}
                keyboardType="number-pad"
                maxLength={2}
                onChangeText={setSeconds}
              />
            </FormField>
          </View>
        </View>
        <ThemedText type="footnote" themeColor="textSecondary">
          Total time. Minutes can be greater than 59.
        </ThemedText>
        {tracksDistance ? (
          <FormField label={`Distance (${unit}, optional)`}>
            <FormTextInput
              accessibilityLabel={`Distance (${unit}, optional)`}
              value={distance}
              editable={!disabled}
              keyboardType="decimal-pad"
              maxLength={12}
              onChangeText={setDistance}
            />
          </FormField>
        ) : null}
        <FormField label="Notes (optional)">
          <FormTextInput
            accessibilityLabel="Notes (optional)"
            value={notes}
            editable={!disabled}
            multiline
            maxLength={4000}
            onChangeText={setNotes}
          />
        </FormField>
        {error ? <FormStatus tone="error">{error}</FormStatus> : null}
        {locked && error && !retryable ? (
          <Button
            label="Close"
            accessibilityLabel="Close"
            block
            onPress={() => router.back()}
          />
        ) : (
          <Button
            label={busy ? "Saving…" : locked && error ? "Retry save" : "Save"}
            accessibilityLabel={locked && error ? "Retry save" : "Save"}
            loading={busy}
            disabled={busy}
            block
            onPress={() => void save()}
          />
        )}
        {locked && !busy && retryable ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            Details are locked while this save is unfinished so a retry cannot
            create a second workout.
          </ThemedText>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingBottom: 64,
  },
  row: { flexDirection: "row", gap: 12 },
  cell: { flex: 1 },
});
