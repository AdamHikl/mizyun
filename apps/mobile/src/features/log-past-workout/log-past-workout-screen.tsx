import { useEffect, useRef, useState } from "react";
import { noteTrainingSaved } from "@/features/evening-stretch/public-data";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, useNavigation, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import type { ApiClient } from "@mizyun/api-client";
import {
  getCatalogExerciseNames,
  resolveExerciseTrackingMode,
} from "@mizyun/core";
import {
  exerciseListResponseSchema,
  type Exercise,
  type ExerciseListResponse,
  type WorkoutSetType,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Card,
  FormField,
  FormStatus,
  FormTextInput,
} from "@/components/ui";
import {
  NativeDatePicker,
  NativeTimePicker,
} from "@/components/ui/native-date-time-picker";
import {
  fromDateInputValue,
  fromTimeInputValue,
  toDateInputValue,
  toTimeInputValue,
} from "@/components/ui/native-date-time-values";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { apiClient, invalidateSessionReads } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { createExerciseWith } from "@/features/log-workout/log-workout-data";
import { findCatalogExerciseRecord } from "@/features/workouts/catalog-exercise-record";
import { ExerciseLibraryModal } from "@/features/workouts/exercise-library-modal";
import {
  isSavedLibraryExercise,
  type LibraryExercise,
} from "@/features/workouts/library-exercise";
import { weightUnitLabel } from "@/lib/weight-units";
import {
  emptyPastWorkoutForm,
  hasPastWorkoutContent,
  localDateDaysAgo,
  parsePastWorkoutForm,
  releasePendingPastWorkout,
  releasePendingPastWorkoutLocally,
  pastWorkoutDraftStore,
  sendPastWorkout,
  type PastWorkoutDraft,
  type PastWorkoutExercise,
  type PastWorkoutForm,
  type PastWorkoutSetInput,
} from "./past-workout";

const SET_TYPE_LABELS: Record<WorkoutSetType, string> = {
  normal: "Working",
  warmup: "Warm-up",
  drop: "Drop",
  failure: "Failure",
};
const SET_TYPE_ORDER: readonly WorkoutSetType[] = [
  "normal",
  "warmup",
  "drop",
  "failure",
];
const newKey = () => Crypto.randomUUID();
const blankSet = (from?: PastWorkoutSetInput): PastWorkoutSetInput => ({
  key: newKey(),
  setType: from?.setType === "warmup" ? "normal" : (from?.setType ?? "normal"),
  reps: from?.reps ?? "",
  load: from?.load ?? "",
});

export function LogPastWorkoutScreen() {
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? null;
  const principal = `${userId}:${session?.accessToken ?? ""}`;
  const current = useRef(principal);
  current.current = principal;
  const isCurrent = () => current.current === principal;
  const navigation = useNavigation();
  const bypassBack = useRef(false);
  const busyRef = useRef(false);
  const [draft, setDraft] = useState<PastWorkoutDraft | null>(null);
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
  const live = useRef(draft);
  live.current = draftOwner === principal ? draft : null;
  const [exercises, setExercises] = useState<readonly Exercise[] | null>(null);
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unitSystem = profile?.unitSystem === "imperial" ? "imperial" : "metric";
  const ready = draftOwner === principal && draft !== null;
  const locked = busy || !!draft?.pending;

  const scoped = (attemptCurrent: () => boolean): ApiClient => ({
    status: () => apiClient.status(),
    request: (options) =>
      apiClient.request({
        ...options,
        expectedUserId: userId ?? "",
        isCurrent: attemptCurrent,
      }),
  });

  useEffect(() => {
    let active = true;
    setDraft(null);
    setDraftOwner(null);
    setExercises(null);
    setError(null);
    bypassBack.current = false;
    busyRef.current = false;
    setBusy(false);
    if (!userId) return;
    void (async () => {
      const restored = await pastWorkoutDraftStore.load(userId);
      if (!active || !isCurrent()) return;
      setDraft(
        restored && hasPastWorkoutContent(restored)
          ? restored
          : {
              version: 1,
              form: emptyPastWorkoutForm(unitSystem),
              pending: null,
            },
      );
      setDraftOwner(principal);
    })().catch(() => {
      if (!active || !isCurrent()) return;
      setError(
        "Your saved past-workout draft could not be read. Reopen this screen to retry. Nothing was sent or replaced.",
      );
    });
    void (async () => {
      const result = await scoped(isCurrent).request<ExerciseListResponse>({
        method: "GET",
        path: "/v1/exercises?limit=200",
        schema: exerciseListResponseSchema,
      });
      if (active && isCurrent() && result.ok)
        setExercises(result.value.exercises);
    })().catch(() => {});
    return () => {
      active = false;
    };
    // Session identity retires hydration and keeps draft writes scoped to their account.
  }, [principal]);

  useEffect(() => {
    if (!ready || !userId || !isCurrent() || bypassBack.current) return;
    if (!hasPastWorkoutContent(draft)) return;
    void pastWorkoutDraftStore.save(userId, draft).then((ok) => {
      if (!ok && isCurrent())
        setError(
          "Draft could not be kept on this device. Keep editing or retry.",
        );
    });
  }, [draft, ready, userId]);

  useEffect(() => {
    // The profile can load after hydration; adopt its unit while nothing is entered.
    setDraft((d) =>
      d &&
      !d.pending &&
      d.form.exercises.length === 0 &&
      d.form.unitSystem !== unitSystem
        ? { ...d, form: { ...d.form, unitSystem } }
        : d,
    );
  }, [unitSystem, draftOwner]);

  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        const saved = live.current;
        if (
          !isCurrent() ||
          bypassBack.current ||
          !userId ||
          !saved ||
          !hasPastWorkoutContent(saved)
        )
          return;
        event.preventDefault();
        void pastWorkoutDraftStore.save(userId, saved).then((ok) => {
          if (!isCurrent()) return;
          if (ok) {
            bypassBack.current = true;
            navigation.dispatch(event.data.action);
          } else
            Alert.alert(
              "Draft not saved",
              "Your past workout could not be kept on this device.",
              [
                { text: "Keep editing", style: "cancel" },
                {
                  text: "Leave without saving",
                  style: "destructive",
                  onPress: () => {
                    bypassBack.current = true;
                    navigation.dispatch(event.data.action);
                  },
                },
              ],
            );
        });
      }),
    [navigation, principal, userId],
  );

  const changeForm = (patch: Partial<PastWorkoutForm>) => {
    if (!ready || !isCurrent()) return;
    setDraft((d) =>
      d && !d.pending ? { ...d, form: { ...d.form, ...patch } } : d,
    );
  };
  const changeExercise = (
    key: string,
    update: (e: PastWorkoutExercise) => PastWorkoutExercise | null,
  ) => {
    if (!ready || !isCurrent()) return;
    setDraft((d) =>
      d && !d.pending
        ? {
            ...d,
            form: {
              ...d.form,
              exercises: d.form.exercises.flatMap((e) => {
                if (e.key !== key) return [e];
                const next = update(e);
                return next ? [next] : [];
              }),
            },
          }
        : d,
    );
  };
  const changeSet = (
    exerciseKey: string,
    setKey: string,
    patch: Partial<PastWorkoutSetInput> | null,
  ) =>
    changeExercise(exerciseKey, (e) => ({
      ...e,
      sets: e.sets.flatMap((s) =>
        s.key !== setKey ? [s] : patch === null ? [] : [{ ...s, ...patch }],
      ),
    }));

  /** Mirrors the live session: reuse the saved record for a catalog movement, or create it. */
  const addExercises = async (
    picked: readonly LibraryExercise[],
  ): Promise<boolean> => {
    if (!ready || !userId || locked) return false;
    setLibraryError(null);
    // Past workouts record weight and reps only (WO-08).
    const timed = picked.find(
      (exercise) =>
        isSavedLibraryExercise(exercise) &&
        resolveExerciseTrackingMode(exercise) !== "load_reps",
    );
    if (timed) {
      setLibraryError(
        `Past workouts record weight and reps, so ${timed.name} can't be added here. Use Log activity for timed exercises.`,
      );
      return false;
    }
    const owner = principal;
    let saved = exercises;
    if (saved === null) {
      const listed = await scoped(isCurrent).request<ExerciseListResponse>({
        method: "GET",
        path: "/v1/exercises?limit=200",
        schema: exerciseListResponseSchema,
      });
      if (current.current !== owner) return false;
      if (!listed.ok) {
        setLibraryError(
          "Could not load your exercises. Check your connection and try again.",
        );
        return false;
      }
      saved = listed.value.exercises;
    }
    const known = [...saved];
    const additions: PastWorkoutExercise[] = [];
    for (const catalogEx of picked) {
      // A saved custom exercise already has its record: use it as is.
      if (isSavedLibraryExercise(catalogEx)) {
        const index = known.findIndex((e) => e.id === catalogEx.id);
        if (index === -1) known.push(catalogEx);
        else known[index] = catalogEx;
        additions.push({
          key: newKey(),
          exerciseId: catalogEx.id,
          name: catalogEx.name,
          sets: [blankSet()],
        });
        continue;
      }
      let record = findCatalogExerciseRecord(known, catalogEx);
      if (!record) {
        const names = new Set(
          getCatalogExerciseNames(catalogEx).map((n) => n.trim().toLowerCase()),
        );
        if (known.some((e) => names.has(e.name.trim().toLowerCase()))) {
          setLibraryError(
            `Several saved exercises match ${catalogEx.name}. Its history can't be matched safely.`,
          );
          return false;
        }
        if (known.length >= 200) {
          setLibraryError(
            "Your saved exercise list may be incomplete, so this movement can't be added safely here.",
          );
          return false;
        }
        const created = await createExerciseWith(
          scoped(isCurrent),
          catalogEx.name,
          catalogEx.instructions
            .map((step, index) => `${index + 1}. ${step}`)
            .join("\n"),
        );
        if (current.current !== owner) return false;
        if (!created.ok) {
          setLibraryError(created.message);
          return false;
        }
        record = created.exercise;
        known.push(record);
      }
      additions.push({
        key: newKey(),
        exerciseId: record.id,
        name: record.name,
        catalogId: catalogEx.id,
        sets: [blankSet()],
      });
    }
    setExercises(known);
    setDraft((d) =>
      d && !d.pending
        ? {
            ...d,
            form: {
              ...d.form,
              exercises: [...d.form.exercises, ...additions],
            },
          }
        : d,
    );
    return true;
  };

  const run = async (
    task: (attemptCurrent: () => boolean) => Promise<void>,
  ) => {
    if (!userId || !ready || busyRef.current || !isCurrent()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await task(isCurrent);
    } catch {
      if (isCurrent())
        setError(
          "The response was lost. Your workout is kept on this device. Retry when online.",
        );
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const save = () =>
    void run(async (attemptCurrent) => {
      if (!draft || !userId) return;
      let next = draft;
      if (!next.pending) {
        const parsed = parsePastWorkoutForm(next.form, Crypto.randomUUID());
        if (!parsed.ok) {
          setError(parsed.message);
          return;
        }
        next = { ...next, pending: parsed.pending };
        setDraft(next);
      }
      const result = await sendPastWorkout(
        userId,
        next,
        scoped(attemptCurrent),
        attemptCurrent,
      );
      if (!attemptCurrent()) return;
      if (result.ok) {
        invalidateSessionReads();
        noteTrainingSaved();
        bypassBack.current = true;
        router.replace({
          pathname: "/(tabs)/workouts",
          params: { pastWorkoutSaved: "true" },
        } as Href);
        return;
      }
      setDraft(result.draft);
      setError(result.message);
    });

  const leave = () => {
    bypassBack.current = true;
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/workouts" as Href);
  };
  /** Leave a pending save to edit it or throw it away; server remnants are removed first. */
  const release = (mode: "edit" | "discard") =>
    void run(async (attemptCurrent) => {
      if (!draft || !userId) return;
      const finish = (next: PastWorkoutDraft | null) => {
        if (mode === "discard" || next === null) {
          invalidateSessionReads();
          leave();
        } else {
          invalidateSessionReads();
          setDraft(next);
        }
      };
      const result = await releasePendingPastWorkout(
        userId,
        draft,
        mode,
        scoped(attemptCurrent),
        attemptCurrent,
      );
      if (!attemptCurrent()) return;
      if (result.ok) return finish(result.draft);
      setDraft(result.draft);
      setError(result.message);
      if (!result.localRelease || result.draft.pending?.workoutId) return;
      const latest = result.draft;
      Alert.alert(
        mode === "edit" ? "Edit on this device?" : "Discard on this device?",
        result.message,
        [
          { text: "Keep", style: "cancel" },
          {
            text: mode === "edit" ? "Edit anyway" : "Discard anyway",
            style: "destructive",
            onPress: () =>
              void run(async (localCurrent) => {
                const local = await releasePendingPastWorkoutLocally(
                  userId,
                  latest,
                  mode,
                );
                if (!localCurrent()) return;
                if (local.ok) {
                  setError(null);
                  finish(local.draft);
                } else setError(local.message);
              }),
          },
        ],
      );
    });
  const discard = () => {
    if (!draft || !userId || !ready) return;
    if (!draft.pending) {
      Alert.alert(
        "Discard draft?",
        "This removes the workout you entered from this device.",
        [
          { text: "Keep", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () =>
              void run(async (attemptCurrent) => {
                const ok = await pastWorkoutDraftStore.clear(userId);
                if (!attemptCurrent()) return;
                if (ok) leave();
                else setError("Could not discard the draft. Try again.");
              }),
          },
        ],
      );
      return;
    }
    Alert.alert(
      "Discard this workout?",
      "Anything already saved for this workout is deleted from your history.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => release("discard"),
        },
      ],
    );
  };
  const edit = () => {
    if (!draft?.pending || !ready) return;
    if (!draft.pending.workoutId) return release("edit");
    Alert.alert(
      "Edit this workout?",
      "The part already saved is removed from your history, then you can change the details and save again.",
      [
        { text: "Keep", style: "cancel" },
        { text: "Edit", onPress: () => release("edit") },
      ],
    );
  };

  const form = draft?.form;
  const unit = weightUnitLabel(form?.unitSystem ?? unitSystem);
  const todayDate = fromDateInputValue(localDateDaysAgo(new Date(), 0))!;
  const startTime = fromTimeInputValue(form?.startTime ?? "") ?? {
    hour: 18,
    minute: 0,
  };
  const setCount = form?.exercises.reduce((n, e) => n + e.sets.length, 0) ?? 0;

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Log past workout" }} />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {!ready || !form ? (
          <ThemedText>{error ? "" : "Loading…"}</ThemedText>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              For a workout you did without your phone. It goes straight into
              your history; nothing is timed and it isn&apos;t sent to Health.
            </ThemedText>
            {draft.pending ? (
              <FormStatus tone="neutral">
                {draft.pending.workoutId
                  ? "Partly saved. Retry to finish saving the remaining sets."
                  : "Save pending. These details stay fixed until the server confirms them."}
              </FormStatus>
            ) : null}

            <FormField label="Name">
              <FormTextInput
                accessibilityLabel="Workout name"
                placeholder="Workout"
                value={form.name}
                editable={!locked}
                maxLength={200}
                onChangeText={(name) => changeForm({ name })}
              />
            </FormField>

            <NativeDatePicker
              label="Date"
              value={fromDateInputValue(form.date) ?? todayDate}
              maximumDate={todayDate}
              disabled={locked}
              onChange={(date) => changeForm({ date: toDateInputValue(date) })}
            />
            <NativeTimePicker
              label="Start time"
              hour={startTime.hour}
              minute={startTime.minute}
              disabled={locked}
              onChange={(hour, minute) =>
                changeForm({ startTime: toTimeInputValue(hour, minute) })
              }
            />
            <View style={styles.row}>
              <View style={styles.cell}>
                <FormField label="Duration (min)">
                  <FormTextInput
                    accessibilityLabel="Duration in minutes"
                    value={form.durationMinutes}
                    editable={!locked}
                    maxLength={3}
                    keyboardType="number-pad"
                    onChangeText={(durationMinutes) =>
                      changeForm({ durationMinutes })
                    }
                  />
                </FormField>
              </View>
            </View>

            {form.exercises.map((exercise) => (
              <Card key={exercise.key}>
                <View style={styles.exerciseHeader}>
                  <ThemedText type="smallBold" style={styles.grow}>
                    {exercise.name}
                  </ThemedText>
                  <Button
                    label="Remove"
                    variant="plain"
                    size="small"
                    accessibilityLabel={`Remove ${exercise.name}`}
                    disabled={locked}
                    onPress={() => changeExercise(exercise.key, () => null)}
                  />
                </View>
                {exercise.sets.map((set, setIndex) => {
                  const spoken = `${exercise.name} set ${setIndex + 1}`;
                  return (
                    <View key={set.key} style={styles.setRow}>
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        style={styles.setNumber}
                      >
                        {setIndex + 1}
                      </ThemedText>
                      <View style={styles.cell}>
                        <FormTextInput
                          accessibilityLabel={`${spoken} weight in ${unit}`}
                          placeholder={unit}
                          value={set.load}
                          editable={!locked}
                          maxLength={8}
                          keyboardType="decimal-pad"
                          onChangeText={(load) =>
                            changeSet(exercise.key, set.key, { load })
                          }
                        />
                      </View>
                      <View style={styles.cell}>
                        <FormTextInput
                          accessibilityLabel={`${spoken} reps`}
                          placeholder="reps"
                          value={set.reps}
                          editable={!locked}
                          maxLength={4}
                          keyboardType="number-pad"
                          onChangeText={(reps) =>
                            changeSet(exercise.key, set.key, { reps })
                          }
                        />
                      </View>
                      <Button
                        label={SET_TYPE_LABELS[set.setType]}
                        variant="secondary"
                        size="small"
                        accessibilityLabel={`${spoken} type, ${SET_TYPE_LABELS[set.setType]}. Change type`}
                        disabled={locked}
                        onPress={() => {
                          const at = SET_TYPE_ORDER.indexOf(set.setType);
                          changeSet(exercise.key, set.key, {
                            setType:
                              SET_TYPE_ORDER[(at + 1) % SET_TYPE_ORDER.length],
                          });
                        }}
                      />
                      <Button
                        label="✕"
                        variant="plain"
                        size="small"
                        accessibilityLabel={`Remove ${spoken}`}
                        disabled={locked}
                        onPress={() => changeSet(exercise.key, set.key, null)}
                      />
                    </View>
                  );
                })}
                <Button
                  label="Add set"
                  icon="add"
                  variant="tinted"
                  size="small"
                  accessibilityLabel={`Add set to ${exercise.name}`}
                  accessibilityHint={
                    exercise.sets.length > 0
                      ? "Copies the previous set's weight and reps"
                      : undefined
                  }
                  disabled={locked}
                  onPress={() =>
                    changeExercise(exercise.key, (e) => ({
                      ...e,
                      sets: [...e.sets, blankSet(e.sets[e.sets.length - 1])],
                    }))
                  }
                />
                {exercise.sets.length === 0 ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Exercises without sets aren&apos;t saved.
                  </ThemedText>
                ) : null}
              </Card>
            ))}

            <Button
              label="Add exercise"
              icon="add"
              variant="secondary"
              block
              disabled={locked}
              onPress={() => {
                setLibraryError(null);
                setLibraryVisible(true);
              }}
            />

            <FormField label="Notes (optional)">
              <FormTextInput
                accessibilityLabel="Notes"
                value={form.notes}
                editable={!locked}
                multiline
                maxLength={4000}
                onChangeText={(notes) => changeForm({ notes })}
              />
            </FormField>

            {error ? <FormStatus tone="error">{error}</FormStatus> : null}

            <Button
              label={
                busy
                  ? "Saving…"
                  : draft.pending
                    ? "Retry save"
                    : setCount > 0
                      ? `Save workout · ${setCount} ${setCount === 1 ? "set" : "sets"}`
                      : "Save workout"
              }
              block
              loading={busy}
              disabled={busy}
              onPress={save}
            />
            {draft.pending ? (
              <Button
                label="Edit workout"
                variant="secondary"
                block
                disabled={busy}
                onPress={edit}
              />
            ) : null}
            <Button
              label="Discard"
              variant="plain"
              block
              disabled={busy || !hasPastWorkoutContent(draft)}
              onPress={discard}
            />
          </>
        )}
        {!ready && error ? <FormStatus tone="error">{error}</FormStatus> : null}
      </ScrollView>
      <ExerciseLibraryModal
        visible={libraryVisible}
        errorMessage={libraryError}
        onClose={() => setLibraryVisible(false)}
        onSelectExercises={addExercises}
        strengthOnly
        inUseExerciseIds={
          draft?.form.exercises.map((exercise) => exercise.exerciseId) ?? []
        }
      />
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
  row: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  cell: { flexGrow: 1, flexBasis: 72 },
  grow: { flex: 1 },
  exerciseHeader: { flexDirection: "row", alignItems: "center" },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  setNumber: { width: 20, textAlign: "center" },
});
