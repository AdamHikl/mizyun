import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoggingFlowMeasurement } from "@mizyun/observability";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  Exercise,
  ExerciseRecentSetsResponse,
  WorkoutSet,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { analyticsClient } from "@/composition/analytics-client";
import { classifyAnalyticsFailure } from "@/features/analytics/classify-failure";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";
import { useTheme } from "@/hooks/use-theme";
import { kilogramsToDisplayWeight, weightUnitLabel } from "@/lib/weight-units";

import {
  abandonWorkout,
  addWorkoutSet,
  completeWorkout,
  createExercise,
  deleteWorkoutSet,
  loadRecentPerformance,
  loadWorkoutWorkspace,
  startWorkout,
  type WorkoutWorkspace,
} from "./log-workout-data";

interface WorkoutDraft {
  readonly name: string;
  readonly notes: string;
  readonly selectedExerciseId: string;
  readonly repetitions: string;
  readonly load: string;
  readonly durationSeconds: string;
  readonly distanceMeters: string;
  readonly perceivedExertion: string;
}

const EMPTY_DRAFT: WorkoutDraft = {
  name: "",
  notes: "",
  selectedExerciseId: "",
  repetitions: "",
  load: "",
  durationSeconds: "",
  distanceMeters: "",
  perceivedExertion: "",
};

const EMPTY_WORKSPACE: WorkoutWorkspace = {
  exercises: [],
  workout: null,
  sets: [],
  message: null,
};

export function LogWorkoutScreen() {
  const { profile, session } = useAuth();
  const theme = useTheme();
  const userId = session?.user.id ?? null;
  const unitSystem = profile?.unitSystem ?? "metric";
  const [workspace, setWorkspace] = useState<WorkoutWorkspace>(EMPTY_WORKSPACE);
  const [draft, setDraft] = useState<WorkoutDraft>(EMPTY_DRAFT);
  const [exerciseName, setExerciseName] = useState("");
  const [exerciseInstructions, setExerciseInstructions] = useState("");
  const [recent, setRecent] = useState<ExerciseRecentSetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const measurement = useRef<LoggingFlowMeasurement | null>(null);
  const hadFailure = useRef(false);

  useEffect(() => {
    measurement.current = new LoggingFlowMeasurement(
      "workout",
      analyticsClient,
    );
    return () => {
      measurement.current = null;
    };
  }, []);

  const selectedExercise = useMemo(
    () =>
      workspace.exercises.find(
        (exercise) => exercise.id === draft.selectedExerciseId,
      ) ?? null,
    [draft.selectedExerciseId, workspace.exercises],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await loadWorkoutWorkspace();
    setWorkspace(next);
    setMessage(next.message);
    if (next.message !== null) {
      hadFailure.current = true;
      measurement.current?.fail(
        "load",
        classifyAnalyticsFailure(next.message),
        true,
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (userId === null) return;
    let active = true;
    void loadLoggingDraft(userId, "workout", isStoredWorkoutDraft).then(
      (saved) => {
        if (!active) return;
        if (saved !== null) setDraft({ ...EMPTY_DRAFT, ...saved });
        setDraftLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!draftLoaded || userId === null) return;
    void saveLoggingDraft(userId, "workout", draft);
  }, [draft, draftLoaded, userId]);

  useEffect(() => {
    if (draft.selectedExerciseId.length === 0) {
      setRecent(null);
      return;
    }
    let active = true;
    void loadRecentPerformance(
      draft.selectedExerciseId,
      workspace.workout?.id,
    ).then((value) => {
      if (active) setRecent(value);
    });
    return () => {
      active = false;
    };
  }, [draft.selectedExerciseId, workspace.workout?.id]);

  const patchDraft = useCallback((patch: Partial<WorkoutDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const onStart = useCallback(async () => {
    measurement.current?.tap();
    if (hadFailure.current) {
      measurement.current?.retry();
      hadFailure.current = false;
    }
    setBusy(true);
    setMessage(null);
    const result = await startWorkout(draft.name, draft.notes);
    setBusy(false);
    if (!result.ok) {
      hadFailure.current = true;
      measurement.current?.fail(
        "submit",
        classifyAnalyticsFailure(result.message),
        true,
      );
      return setMessage(result.message);
    }
    setWorkspace((current) => ({
      ...current,
      workout: result.workout,
      sets: [],
      message: null,
    }));
  }, [draft.name, draft.notes]);

  const onCreateExercise = useCallback(async () => {
    measurement.current?.tap();
    if (hadFailure.current) {
      measurement.current?.retry();
      hadFailure.current = false;
    }
    setBusy(true);
    setMessage(null);
    const result = await createExercise(exerciseName, exerciseInstructions);
    setBusy(false);
    if (!result.ok) {
      hadFailure.current = true;
      measurement.current?.fail(
        "submit",
        classifyAnalyticsFailure(result.message),
        true,
      );
      return setMessage(result.message);
    }
    setWorkspace((current) => ({
      ...current,
      exercises: [...current.exercises, result.exercise].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    }));
    patchDraft({ selectedExerciseId: result.exercise.id });
    setExerciseName("");
    setExerciseInstructions("");
  }, [exerciseInstructions, exerciseName, patchDraft]);

  const onAddSet = useCallback(async () => {
    if (workspace.workout === null) return;
    measurement.current?.tap();
    if (hadFailure.current) {
      measurement.current?.retry();
      hadFailure.current = false;
    }
    setBusy(true);
    setMessage(null);
    const result = await addWorkoutSet(workspace.workout.id, {
      exerciseId: draft.selectedExerciseId,
      repetitions: draft.repetitions,
      load: draft.load,
      durationSeconds: draft.durationSeconds,
      distanceMeters: draft.distanceMeters,
      perceivedExertion: draft.perceivedExertion,
      unitSystem,
    });
    setBusy(false);
    if (!result.ok) {
      hadFailure.current = true;
      measurement.current?.fail(
        "submit",
        classifyAnalyticsFailure(result.message),
        true,
      );
      return setMessage(result.message);
    }
    patchDraft({
      repetitions: "",
      load: "",
      durationSeconds: "",
      distanceMeters: "",
      perceivedExertion: "",
    });
    await refresh();
    if (draft.selectedExerciseId.length > 0) {
      setRecent(
        await loadRecentPerformance(
          draft.selectedExerciseId,
          workspace.workout.id,
        ),
      );
    }
  }, [draft, patchDraft, refresh, unitSystem, workspace.workout]);

  const finish = useCallback(async () => {
    if (workspace.workout === null) return;
    measurement.current?.tap();
    if (hadFailure.current) {
      measurement.current?.retry();
      hadFailure.current = false;
    }
    setBusy(true);
    const result = await completeWorkout(workspace.workout.id);
    setBusy(false);
    if (!result.ok) {
      hadFailure.current = true;
      measurement.current?.fail(
        "submit",
        classifyAnalyticsFailure(result.message),
        true,
      );
      return setMessage(result.message);
    }
    measurement.current?.complete();
    if (userId !== null) await clearLoggingDraft(userId, "workout");
    router.back();
  }, [userId, workspace.workout]);

  const confirmAbandon = useCallback(() => {
    if (workspace.workout === null) return;
    Alert.alert(
      "Delete this workout?",
      "The workout and its logged sets will be permanently removed.",
      [
        { text: "Keep workout", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const result = await abandonWorkout(workspace.workout!.id);
              if (!result.ok) return setMessage(result.message);
              if (userId !== null) await clearLoggingDraft(userId, "workout");
              router.back();
            })();
          },
        },
      ],
    );
  }, [userId, workspace.workout]);

  const removeSet = useCallback(
    (set: WorkoutSet) => {
      if (workspace.workout === null) return;
      Alert.alert("Delete set?", `Remove set ${set.sequence}?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const result = await deleteWorkoutSet(
                workspace.workout!.id,
                set.id,
              );
              if (!result.ok) return setMessage(result.message);
              await refresh();
            })();
          },
        },
      ]);
    },
    [refresh, workspace.workout],
  );

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Workout" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Recovering your workout…
              </ThemedText>
            </View>
          ) : workspace.workout === null ? (
            <StartSection
              draft={draft}
              inputColor={theme.text}
              busy={busy}
              onPatch={patchDraft}
              onStart={onStart}
              onInteraction={() => measurement.current?.tap()}
            />
          ) : (
            <ActiveSection
              workoutName={workspace.workout.name}
              exercises={workspace.exercises}
              selectedExercise={selectedExercise}
              draft={draft}
              sets={workspace.sets}
              recent={recent}
              unitSystem={unitSystem}
              inputColor={theme.text}
              busy={busy}
              exerciseName={exerciseName}
              exerciseInstructions={exerciseInstructions}
              onExerciseName={setExerciseName}
              onExerciseInstructions={setExerciseInstructions}
              onPatch={patchDraft}
              onCreateExercise={onCreateExercise}
              onAddSet={onAddSet}
              onRemoveSet={removeSet}
              onFinish={finish}
              onAbandon={confirmAbandon}
              onInteraction={() => measurement.current?.tap()}
            />
          )}

          {message !== null ? (
            <View style={styles.message} accessibilityRole="alert">
              <ThemedText>{message}</ThemedText>
              <Button
                label="Retry"
                onPress={() => {
                  measurement.current?.tap();
                  measurement.current?.retry();
                  hadFailure.current = false;
                  void refresh();
                }}
              />
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function StartSection(props: {
  readonly draft: WorkoutDraft;
  readonly inputColor: string;
  readonly busy: boolean;
  readonly onPatch: (patch: Partial<WorkoutDraft>) => void;
  readonly onStart: () => void;
  readonly onInteraction: () => void;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">Start a recoverable session.</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Once started, the workout and every saved set are authoritative on the
        server. Unsaved field text stays encrypted on this device.
      </ThemedText>
      <Field
        testID="workout-name-input"
        label="Workout name"
        value={props.draft.name}
        onChangeText={(name) => props.onPatch({ name })}
        onFocus={props.onInteraction}
        placeholder="Leg day"
        inputColor={props.inputColor}
      />
      <Field
        testID="workout-notes-input"
        label="Notes (optional)"
        value={props.draft.notes}
        onChangeText={(notes) => props.onPatch({ notes })}
        onFocus={props.onInteraction}
        placeholder="Strength focus"
        inputColor={props.inputColor}
      />
      <Button
        label={props.busy ? "Starting…" : "Start workout"}
        disabled={props.busy}
        onPress={props.onStart}
      />
    </View>
  );
}

function ActiveSection(props: {
  readonly workoutName: string;
  readonly exercises: ReadonlyArray<Exercise>;
  readonly selectedExercise: Exercise | null;
  readonly draft: WorkoutDraft;
  readonly sets: ReadonlyArray<WorkoutSet>;
  readonly recent: ExerciseRecentSetsResponse | null;
  readonly unitSystem: "metric" | "imperial";
  readonly inputColor: string;
  readonly busy: boolean;
  readonly exerciseName: string;
  readonly exerciseInstructions: string;
  readonly onExerciseName: (next: string) => void;
  readonly onExerciseInstructions: (next: string) => void;
  readonly onPatch: (patch: Partial<WorkoutDraft>) => void;
  readonly onCreateExercise: () => void;
  readonly onAddSet: () => void;
  readonly onRemoveSet: (set: WorkoutSet) => void;
  readonly onFinish: () => void;
  readonly onAbandon: () => void;
  readonly onInteraction: () => void;
}) {
  const unit = weightUnitLabel(props.unitSystem);
  return (
    <>
      <View style={styles.section}>
        <ThemedText type="subtitle">{props.workoutName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Active session · {props.sets.length} saved sets
        </ThemedText>
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Choose an exercise</ThemedText>
        {props.exercises.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Create your first exercise below.
          </ThemedText>
        ) : (
          <View style={styles.choices}>
            {props.exercises.map((exercise) => (
              <Pressable
                key={exercise.id}
                accessibilityRole="button"
                accessibilityState={{
                  selected: props.draft.selectedExerciseId === exercise.id,
                }}
                onPress={() => {
                  props.onInteraction();
                  props.onPatch({ selectedExerciseId: exercise.id });
                }}
                style={[
                  styles.choice,
                  props.draft.selectedExerciseId === exercise.id &&
                    styles.choiceSelected,
                ]}
              >
                <ThemedText type="smallBold">{exercise.name}</ThemedText>
              </Pressable>
            ))}
          </View>
        )}
        <Field
          testID="exercise-name-input"
          label="New exercise name"
          value={props.exerciseName}
          onChangeText={props.onExerciseName}
          onFocus={props.onInteraction}
          placeholder="Back squat"
          inputColor={props.inputColor}
        />
        <Field
          testID="exercise-instructions-input"
          label="Instructions (optional)"
          value={props.exerciseInstructions}
          onChangeText={props.onExerciseInstructions}
          onFocus={props.onInteraction}
          placeholder="Brace before descending"
          inputColor={props.inputColor}
        />
        <Button
          label={props.busy ? "Creating…" : "Create exercise"}
          disabled={props.busy}
          onPress={props.onCreateExercise}
        />
      </View>

      {props.selectedExercise !== null ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">
            Previous · {props.selectedExercise.name}
          </ThemedText>
          {props.recent === null ? (
            <ThemedText type="small" themeColor="textSecondary">
              No previous performance yet.
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Best load{" "}
              {formatLoad(props.recent.summary.bestLoadKg, props.unitSystem)} ·
              Last volume{" "}
              {formatLoad(
                props.recent.summary.lastSessionVolumeKg,
                props.unitSystem,
              )}{" "}
              · {props.recent.summary.totalSetCount} total sets
            </ThemedText>
          )}
          <View style={styles.grid}>
            <Field
              testID="workout-reps-input"
              label="Reps"
              value={props.draft.repetitions}
              onChangeText={(repetitions) => props.onPatch({ repetitions })}
              onFocus={props.onInteraction}
              keyboardType="decimal-pad"
              inputColor={props.inputColor}
            />
            <Field
              testID="workout-load-input"
              label={`Load (${unit})`}
              value={props.draft.load}
              onChangeText={(load) => props.onPatch({ load })}
              onFocus={props.onInteraction}
              keyboardType="decimal-pad"
              inputColor={props.inputColor}
            />
            <Field
              testID="workout-duration-input"
              label="Duration (sec)"
              value={props.draft.durationSeconds}
              onChangeText={(durationSeconds) =>
                props.onPatch({ durationSeconds })
              }
              onFocus={props.onInteraction}
              keyboardType="number-pad"
              inputColor={props.inputColor}
            />
            <Field
              testID="workout-distance-input"
              label="Distance (m)"
              value={props.draft.distanceMeters}
              onChangeText={(distanceMeters) =>
                props.onPatch({ distanceMeters })
              }
              onFocus={props.onInteraction}
              keyboardType="decimal-pad"
              inputColor={props.inputColor}
            />
            <Field
              testID="workout-rpe-input"
              label="RPE (0–10)"
              value={props.draft.perceivedExertion}
              onChangeText={(perceivedExertion) =>
                props.onPatch({ perceivedExertion })
              }
              onFocus={props.onInteraction}
              keyboardType="decimal-pad"
              inputColor={props.inputColor}
            />
          </View>
          <Button
            label={props.busy ? "Saving…" : "Save set"}
            disabled={props.busy}
            onPress={props.onAddSet}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="smallBold">Saved sets</ThemedText>
        {props.sets.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No sets saved yet.
          </ThemedText>
        ) : (
          props.sets.map((set) => (
            <View key={set.id} style={styles.setRow}>
              <View style={styles.setCopy}>
                <ThemedText type="smallBold">Set {set.sequence}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatSet(set, props.exercises, props.unitSystem)}
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete set ${set.sequence}`}
                onPress={() => props.onRemoveSet(set)}
                style={styles.deleteButton}
              >
                <ThemedText type="smallBold">Delete</ThemedText>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={styles.actions}>
        <Button
          label={props.busy ? "Finishing…" : "Finish workout"}
          disabled={props.busy}
          onPress={props.onFinish}
        />
        <Button label="Delete workout" destructive onPress={props.onAbandon} />
      </View>
    </>
  );
}

function Field(props: {
  readonly testID?: string;
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly onFocus?: () => void;
  readonly placeholder?: string;
  readonly keyboardType?: "default" | "decimal-pad" | "number-pad";
  readonly inputColor: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <TextInput
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        placeholder={props.placeholder}
        placeholderTextColor="#8A8D91"
        keyboardType={props.keyboardType ?? "default"}
        accessibilityLabel={props.label}
        style={[styles.input, { color: props.inputColor }]}
      />
    </View>
  );
}

function Button(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled === true}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        props.destructive === true && styles.buttonDestructive,
        (pressed || props.disabled === true) && styles.buttonPressed,
      ]}
    >
      <ThemedText type="smallBold">{props.label}</ThemedText>
    </Pressable>
  );
}

const formatLoad = (
  kg: number | null,
  unitSystem: "metric" | "imperial",
): string =>
  kg === null
    ? "—"
    : `${kilogramsToDisplayWeight(kg, unitSystem)} ${weightUnitLabel(unitSystem)}`;

const formatSet = (
  set: WorkoutSet,
  exercises: ReadonlyArray<Exercise>,
  unitSystem: "metric" | "imperial",
): string => {
  const exercise = exercises.find(
    (candidate) => candidate.id === set.exerciseId,
  );
  const values = [
    exercise?.name ?? "Exercise",
    set.repetitions !== null ? `${set.repetitions} reps` : null,
    set.loadKg !== null ? formatLoad(set.loadKg, unitSystem) : null,
    set.durationSeconds !== null ? `${set.durationSeconds}s` : null,
    set.distanceMeters !== null ? `${set.distanceMeters}m` : null,
    set.perceivedExertion !== null ? `RPE ${set.perceivedExertion}` : null,
  ];
  return values.filter((value): value is string => value !== null).join(" · ");
};

type StoredWorkoutDraft = WorkoutDraft | Pick<WorkoutDraft, "name" | "notes">;

const isStoredWorkoutDraft = (value: unknown): value is StoredWorkoutDraft => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== "string" || typeof candidate.notes !== "string")
    return false;
  return Object.keys(EMPTY_DRAFT).every(
    (key) => candidate[key] === undefined || typeof candidate[key] === "string",
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  center: {
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  section: { gap: Spacing.three },
  field: { flex: 1, minWidth: 140, gap: Spacing.one },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.two,
    padding: Spacing.three,
    fontSize: 16,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  choice: {
    minHeight: 48,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    paddingHorizontal: Spacing.three,
    justifyContent: "center",
  },
  choiceSelected: { borderColor: "#18633d", backgroundColor: "#18633d" },
  button: {
    minHeight: 50,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F1F23",
    paddingHorizontal: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDestructive: { borderColor: "#A13A25" },
  buttonPressed: { opacity: 0.6 },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#8A8D91",
    paddingTop: Spacing.two,
  },
  setCopy: { flex: 1, gap: Spacing.one },
  deleteButton: {
    minHeight: 44,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { gap: Spacing.two },
  message: {
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#A13A25",
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
});
