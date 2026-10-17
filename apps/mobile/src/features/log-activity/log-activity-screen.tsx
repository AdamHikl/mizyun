import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  draftActivityFromDescription,
  listTimedActivities,
  resolveActivityName,
  resolvedActivityLabel,
  type LocalDate,
} from "@mizyun/core";
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
  Notice,
} from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { apiClient, invalidateSessionReads } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { hasRunDraftContent, runDraftStore } from "@/features/log-run";
import { ActivityDatePicker } from "./activity-date-picker";
import {
  saveLoggedActivityWith,
  saveLoggedRunWith,
  type LogActivityPlan,
  type LogRunPlan,
} from "./log-activity-data";
import {
  activityTimes,
  deviceTimeZone,
  distanceFieldText,
  endedNowStart,
  formatTimeInput,
  localDateLabel,
  parseActivityForm,
  parseTimeInput,
  resolvedDistance,
  runCreateBody,
  toLocalDate,
} from "./log-activity-form";

const SUGGESTIONS = [
  "Running",
  ...listTimedActivities().map((activity) => activity.name),
];

type PendingSave =
  | { readonly kind: "workout"; readonly plan: LogActivityPlan }
  | { readonly kind: "run"; readonly plan: LogRunPlan };

type Environment = "outdoor" | "treadmill" | "unspecified";

const FIELD_NAMES = {
  activity: "activity",
  duration: "duration",
  distance: "distance",
  date: "date",
  time: "start time",
  note: "note",
} as const;

export function LogActivityScreen() {
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? null;
  // Owner is the account, not the token: a token refresh mid-save is fine.
  const owner = useRef(userId);
  owner.current = userId;
  const busyRef = useRef(false);
  // Set on the first save attempt; kept so every retry sends the same body.
  const pending = useRef<PendingSave | null>(null);
  // True once any attempt for the pending save may have reached the server.
  const workoutSent = useRef(false);

  const [description, setDescription] = useState("");
  const [drafted, setDrafted] = useState<string | null>(null);
  const [activityText, setActivityText] = useState("");
  const [date, setDate] = useState<LocalDate>(() => toLocalDate(new Date()));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [minutes, setMinutes] = useState("");
  const [seconds, setSeconds] = useState("");
  const [distance, setDistance] = useState("");
  const [environment, setEnvironment] = useState<Environment>("unspecified");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [retryable, setRetryable] = useState(true);
  const [unfinishedRun, setUnfinishedRun] = useState(false);

  useEffect(() => {
    // A run left unfinished in the run editor stays reachable from here.
    let active = true;
    setUnfinishedRun(false);
    if (!userId) return;
    void runDraftStore
      .load(userId)
      .then((draft) => {
        if (active && owner.current === userId) {
          setUnfinishedRun(!!draft && hasRunDraftContent(draft));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);

  const activity = resolveActivityName(activityText);
  const unitSystem = profile?.unitSystem === "imperial" ? "imperial" : "metric";
  const { tracksDistance, unit } = resolvedDistance(activity, unitSystem);
  const today = toLocalDate(new Date());
  const disabled = busy || locked;
  const typed = activityText.trim().toLowerCase();
  const suggestions = SUGGESTIONS.filter(
    (name) => typed.length === 0 || name.toLowerCase().includes(typed),
  );

  const fillFromDescription = () => {
    const draft = draftActivityFromDescription(description, new Date());
    const filled: string[] = [];
    let nextActivity = activity;
    if (draft.activity) {
      nextActivity = draft.activity;
      setActivityText(resolvedActivityLabel(draft.activity));
      filled.push(FIELD_NAMES.activity);
    }
    if (draft.durationSeconds !== null) {
      setMinutes(String(Math.floor(draft.durationSeconds / 60)));
      setSeconds(
        draft.durationSeconds % 60 === 0
          ? ""
          : String(draft.durationSeconds % 60),
      );
      filled.push(FIELD_NAMES.duration);
    }
    const nextDistance = resolvedDistance(nextActivity, unitSystem);
    if (draft.distance && nextDistance.tracksDistance) {
      setDistance(distanceFieldText(draft.distance, nextDistance.unit));
      filled.push(FIELD_NAMES.distance);
    }
    if (draft.date) {
      setDate(draft.date);
      filled.push(FIELD_NAMES.date);
    }
    const duration =
      draft.durationSeconds ??
      parseActivityForm({
        minutes,
        seconds,
        distance: "",
        unit,
        tracksDistance: false,
      });
    const knownDuration =
      typeof duration === "number"
        ? duration
        : duration.ok
          ? duration.durationSeconds
          : null;
    if (draft.startTime) {
      setStartTime(formatTimeInput(draft.startTime));
      filled.push(FIELD_NAMES.time);
    } else if (draft.endedNow && knownDuration !== null) {
      // "Just": it started that long ago, possibly yesterday.
      const start = endedNowStart(new Date(), knownDuration);
      setDate(start.date);
      setStartTime(formatTimeInput(start.startTime));
      filled.push(FIELD_NAMES.time);
    } else if (draft.endedNow || draft.date) {
      // A day without a time: today ends now, earlier days at noon.
      setStartTime("");
    }
    if (draft.environment) setEnvironment(draft.environment);
    if (draft.note && notes.trim().length === 0) {
      setNotes(draft.note);
      filled.push(FIELD_NAMES.note);
    }
    setError(null);
    setDrafted(
      filled.length > 0
        ? `Filled in ${filled.join(", ")}. Check the details, then save.`
        : "Couldn't find activity details in that description. Fill in the fields below.",
    );
  };

  const buildSave = (): PendingSave | string => {
    if (!userId) return "Sign in to log an activity.";
    if (!activity) return "Enter an activity, such as Running or Swimming.";
    if (activity.kind === "strength") {
      return `${activity.exercise.name} is logged with sets and reps. Use Log workout instead.`;
    }
    const parsed = parseActivityForm({
      minutes,
      seconds,
      distance,
      unit,
      tracksDistance,
    });
    if (!parsed.ok) return parsed.message;
    const time = parseTimeInput(startTime);
    if (time === "invalid") {
      return "Enter the start time like 19:00 or 7pm, or leave it blank.";
    }
    const now = new Date();
    if (activity.kind === "running") {
      const timeZone = deviceTimeZone();
      if (!timeZone) {
        return "This device's time zone is unavailable, so the run's date can't be recorded. Check the date and time settings.";
      }
      const run = runCreateBody({
        operationId: Crypto.randomUUID(),
        now,
        date,
        startTime: time,
        durationSeconds: parsed.durationSeconds,
        distanceMeters: parsed.distanceMeters,
        environment,
        notes,
        timeZone,
      });
      return run.ok
        ? { kind: "run", plan: { ownerId: userId, body: run.body } }
        : run.message;
    }
    const times = activityTimes(now, date, time, parsed.durationSeconds);
    if (!times.ok) return times.message;
    return {
      kind: "workout",
      plan: {
        ownerId: userId,
        operationId: Crypto.randomUUID(),
        activity:
          activity.kind === "catalog"
            ? activity.exercise
            : { custom: true, name: activity.name },
        startedAt: times.startedAt,
        completedAt: times.completedAt,
        durationSeconds: parsed.durationSeconds,
        distanceMeters: parsed.distanceMeters,
        notes,
      },
    };
  };

  const save = async () => {
    if (!userId || busyRef.current) return;
    const saveOwner = owner.current;
    let plan = pending.current;
    if (plan && plan.plan.ownerId !== userId) {
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
      const built = buildSave();
      if (typeof built === "string") {
        setError(built);
        return;
      }
      plan = built;
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
      const result =
        plan.kind === "run"
          ? await saveLoggedRunWith(scoped, plan.plan)
          : await saveLoggedActivityWith(scoped, plan.plan);
      // Record a possibly sent save even if the response is now stale.
      if (!result.ok && result.workoutRequested) workoutSent.current = true;
      if (!isCurrent()) return;
      if (result.ok) {
        invalidateSessionReads();
        router.back();
        return;
      }
      setError(result.message);
      if (!workoutSent.current) {
        // No attempt reached the server: edit and save afresh.
        pending.current = null;
        setLocked(false);
      } else {
        setRetryable(result.retryable);
      }
    } catch {
      // The save may have been sent; keep the plan for an identical retry.
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
        {unfinishedRun ? (
          <Notice
            tone="warning"
            title="Unfinished run"
            message="A run you started editing earlier hasn't been saved yet."
            action={
              <Button
                label="Open unfinished run"
                accessibilityLabel="Open unfinished run"
                variant="secondary"
                onPress={() => {
                  // It may be saved there; don't show a stale notice on return.
                  setUnfinishedRun(false);
                  router.push("/log-run" as Href);
                }}
              />
            }
          />
        ) : null}
        <FormField label="Describe it (optional)">
          <FormTextInput
            accessibilityLabel="Describe it (optional)"
            placeholder="I ran 10 km in 45 minutes yesterday at 19:00"
            value={description}
            editable={!disabled}
            multiline
            maxLength={500}
            onChangeText={setDescription}
          />
        </FormField>
        <Button
          label="Fill in from description"
          accessibilityLabel="Fill in from description"
          variant="secondary"
          disabled={disabled || description.trim().length === 0}
          onPress={fillFromDescription}
        />
        {drafted ? <FormStatus tone="neutral">{drafted}</FormStatus> : null}
        <FormField label="Activity">
          <FormTextInput
            accessibilityLabel="Activity"
            placeholder="Running, swimming, padel…"
            value={activityText}
            editable={!disabled}
            autoCapitalize="sentences"
            maxLength={200}
            onChangeText={setActivityText}
          />
        </FormField>
        {suggestions.length > 0 &&
        !(
          activity &&
          suggestions.length === 1 &&
          suggestions[0] === resolvedActivityLabel(activity)
        ) ? (
          <ChoiceGroup>
            {suggestions.map((name) => (
              <ChoiceChip
                key={name}
                label={name}
                selected={
                  activity ? resolvedActivityLabel(activity) === name : false
                }
                disabled={disabled}
                onPress={() => setActivityText(name)}
              />
            ))}
          </ChoiceGroup>
        ) : null}
        {activity?.kind === "running" ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            Saved to your runs.
          </ThemedText>
        ) : activity?.kind === "strength" ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {activity.exercise.name} is logged with sets and reps. Use Log
            workout instead.
          </ThemedText>
        ) : activity?.kind === "custom" ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            Saved as a new activity named {activity.name}.
          </ThemedText>
        ) : null}
        <FormField label="Date">
          <Button
            label={localDateLabel(date, today)}
            accessibilityLabel={`Date, ${localDateLabel(date, today)}`}
            variant="secondary"
            icon="calendar"
            disabled={disabled}
            onPress={() => setCalendarOpen((open) => !open)}
          />
        </FormField>
        {calendarOpen && !disabled ? (
          <ActivityDatePicker
            value={date}
            today={today}
            onChange={(next) => {
              setDate(next);
              setCalendarOpen(false);
            }}
          />
        ) : null}
        <FormField label="Start time (optional)">
          <FormTextInput
            accessibilityLabel="Start time (optional)"
            placeholder="19:00"
            value={startTime}
            editable={!disabled}
            keyboardType="numbers-and-punctuation"
            maxLength={8}
            onChangeText={setStartTime}
          />
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
        {activity?.kind === "running" ? (
          <FormField label="Where">
            <ChoiceGroup>
              {(
                [
                  ["outdoor", "Outdoors"],
                  ["treadmill", "Treadmill"],
                ] as const
              ).map(([value, label]) => (
                <ChoiceChip
                  key={value}
                  label={label}
                  selected={environment === value}
                  disabled={disabled}
                  onPress={() =>
                    setEnvironment(
                      environment === value ? "unspecified" : value,
                    )
                  }
                />
              ))}
            </ChoiceGroup>
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
            create a second entry.
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
