import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoggingFlowMeasurement } from "@mizyun/observability";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  coachWorkoutProposalSchema,
  type CoachWorkoutProposal,
  type Exercise,
  type ExerciseRecentSetsResponse,
  type Workout,
  type WorkoutSet,
} from "@mizyun/contracts";
import {
  computeWorkoutProgressions,
  isRoutineDetails,
  readWorkoutLifecycle,
  type CatalogExercise,
} from "@mizyun/core";

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
import {
  displayWeightToKilograms,
  kilogramsToDisplayWeight,
  parseTargetLoadToDisplay,
  weightUnitLabel,
} from "@/lib/weight-units";
import { ExerciseLibraryModal } from "@/features/workouts/exercise-library-modal";
import { ExerciseProgressionModal } from "@/features/workouts/exercise-progression-modal";
import { startRoutineSession } from "@/features/workouts/workouts-hub-data";
import {
  DEFAULT_REST_SECONDS,
  loadWorkoutPreferences,
} from "@/features/workouts/workout-preferences";
import {
  cancelRestNotification,
  scheduleRestNotification,
} from "@/features/workouts/rest-timer-notifications";
import {
  useOptionalActiveWorkout,
  type RestTimerState,
} from "@/features/workouts";
import {
  completedSetsForNotificationEntry,
  dismissActiveWorkoutNotification,
  formatNextSetSummary,
  selectNextExerciseIndexForNotification,
  updateActiveWorkoutNotification,
} from "@/features/workouts/workout-notification";

import {
  abandonWorkout,
  addWorkoutSet,
  applyCompletedWorkoutProgressions,
  completeWorkout,
  createExercise,
  deleteWorkoutSet,
  extractPlannedExercises,
  loadRecentPerformance,
  loadWorkoutWorkspace,
  startWorkout,
  type PlannedExercise,
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
  readonly workoutProposal?: CoachWorkoutProposal;
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

export interface ExerciseEntry {
  readonly id: string;
  readonly name: string;
  readonly catalogId: string;
  readonly targetSets: number;
  readonly repsMin: number | null;
  readonly repsMax: number | null;
  readonly durationMinutes: number | null;
  readonly restSeconds: number;
  readonly targetLoad?: string;
  readonly isPlanned: boolean;
}

interface PendingSetInput {
  load: string;
  reps: string;
  durationSeconds: string;
  distanceMeters: string;
  rpe: string;
}

export function LogWorkoutScreen() {
  const { workoutId } = useLocalSearchParams<{ workoutId?: string }>();
  const { profile, session } = useAuth();
  const theme = useTheme();
  const workoutContext = useOptionalActiveWorkout();
  const setContextActiveWorkout = workoutContext?.setActiveWorkout;
  const contextRestTimer = workoutContext?.restTimer;
  const startContextRestTimer = workoutContext?.startRestTimer;
  const clearContextRestTimer = workoutContext?.clearRestTimer;
  const userId = session?.user.id ?? null;
  const unitSystem = profile?.unitSystem ?? "metric";
  const [workspace, setWorkspace] = useState<WorkoutWorkspace>(EMPTY_WORKSPACE);
  const [draft, setDraft] = useState<WorkoutDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Live session state
  const [extraExercises, setExtraExercises] = useState<
    ReadonlyArray<ExerciseEntry>
  >([]);
  const [pendingInputs, setPendingInputs] = useState<
    Record<string, PendingSetInput>
  >({});
  const [recentPerformanceMap, setRecentPerformanceMap] = useState<
    Record<string, ExerciseRecentSetsResponse | null>
  >({});
  const [progressionExerciseName, setProgressionExerciseName] = useState<
    string | null
  >(null);
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [restTimer, setRestTimer] = useState<RestTimerState | null>(() =>
    contextRestTimer && Date.now() < contextRestTimer.endsAt
      ? contextRestTimer
      : null,
  );
  const [, setRestTick] = useState(0);
  const [globalRestSeconds, setGlobalRestSeconds] =
    useState<number>(DEFAULT_REST_SECONDS);
  const [liveNotificationEnabled, setLiveNotificationEnabled] =
    useState<boolean>(true);
  const [autoAdvanceTargetWeights, setAutoAdvanceTargetWeights] =
    useState<boolean>(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const measurement = useRef<LoggingFlowMeasurement | null>(null);
  const hadFailure = useRef(false);
  const setSaveInFlight = useRef(false);
  const restNotificationGeneration = useRef(0);

  useEffect(() => {
    measurement.current = new LoggingFlowMeasurement(
      "workout",
      analyticsClient,
    );
    return () => {
      measurement.current = null;
    };
  }, []);

  const plannedExercises = useMemo(
    () => extractPlannedExercises(workspace.workout, draft.workoutProposal),
    [workspace.workout, draft.workoutProposal],
  );

  const refreshCounter = useRef(0);
  const routineStartRef = useRef<string | null>(null);

  const refresh = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const requestId = ++refreshCounter.current;
      if (options?.showLoading) {
        setLoading(true);
      }
      const next = await loadWorkoutWorkspace(workoutId);
      if (requestId !== refreshCounter.current) {
        return;
      }
      setWorkspace((current) => {
        if (next.workout === null && current.workout !== null) {
          return {
            ...current,
            message: next.message,
          };
        }
        return next;
      });
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
    },
    [workoutId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deep links and older Coach cards may still point at the routine itself.
  // Convert that intent into a fresh session rather than ever timing or
  // mutating the reusable template.
  useEffect(() => {
    const routine = workspace.workout;
    if (
      routine === null ||
      !isRoutineDetails(routine.details) ||
      routineStartRef.current === routine.id
    ) {
      return;
    }
    routineStartRef.current = routine.id;
    setBusy(true);
    void (async () => {
      try {
        const result = await startRoutineSession(routine);
        if (result.ok && result.workout) {
          router.replace({
            pathname: "/log-workout",
            params: { workoutId: result.workout.id },
          });
        } else if (!result.ok) {
          routineStartRef.current = null;
          setMessage(result.message);
        }
      } catch {
        routineStartRef.current = null;
        setMessage("The session could not be started. Please try again.");
      } finally {
        setBusy(false);
      }
    })();
  }, [workspace.workout]);

  // Draft save/load
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

  // Load workout preferences (global rest timer setting and live notification toggle)
  useEffect(() => {
    let active = true;
    void loadWorkoutPreferences(userId ?? undefined).then((prefs) => {
      if (!active) return;
      setGlobalRestSeconds(prefs.defaultRestSeconds);
      setLiveNotificationEnabled(prefs.liveNotificationEnabled);
      setAutoAdvanceTargetWeights(prefs.autoAdvanceTargetWeights);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  // Stopwatch duration ticker
  useEffect(() => {
    if (
      !workspace.workout ||
      workspace.workout.completedAt !== null ||
      isRoutineDetails(workspace.workout.details)
    ) {
      setElapsedSeconds(0);
      return;
    }
    const startTime = new Date(workspace.workout.startedAt).getTime();
    const updateElapsed = () => {
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - startTime) / 1000)));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [workspace.workout]);

  // Wall-clock rest timer ticker
  useEffect(() => {
    if (!restTimer) return;
    const checkTimer = () => {
      const now = Date.now();
      if (now >= restTimer.endsAt) {
        restNotificationGeneration.current += 1;
        if (restTimer.notificationId) {
          void cancelRestNotification(restTimer.notificationId);
        }
        setRestTimer(null);
      } else {
        setRestTick((t) => (t + 1) % 10000);
      }
    };
    checkTimer();
    const interval = setInterval(checkTimer, 500);
    return () => clearInterval(interval);
  }, [restTimer]);

  // AppState listener to immediately refresh/expire rest timer when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setRestTimer((current) => {
          if (!current) return null;
          if (Date.now() >= current.endsAt) {
            restNotificationGeneration.current += 1;
            if (current.notificationId) {
              void cancelRestNotification(current.notificationId);
            }
            return null;
          }
          return current;
        });
        setRestTick((t) => (t + 1) % 10000);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  // Synchronize active workout session into global context
  useEffect(() => {
    if (
      workspace.workout &&
      !isRoutineDetails(workspace.workout.details) &&
      workspace.workout.completedAt === null
    ) {
      setContextActiveWorkout?.({
        id: workspace.workout.id,
        name: workspace.workout.name,
        startedAt: workspace.workout.startedAt,
      });
    }
  }, [setContextActiveWorkout, workspace.workout]);

  // Synchronize rest timer into global context
  useEffect(() => {
    if (restTimer && Date.now() < restTimer.endsAt) {
      startContextRestTimer?.(restTimer);
    } else if (restTimer === null) {
      clearContextRestTimer?.();
    }
  }, [clearContextRestTimer, restTimer, startContextRestTimer]);

  const patchDraft = useCallback((patch: Partial<WorkoutDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  // Compute unified exercises list for the active workout
  const exerciseEntries: ReadonlyArray<ExerciseEntry> = useMemo(() => {
    const map = new Map<string, ExerciseEntry>();

    const resolveTargetLoadFromMetadata = (
      exercise?: Exercise | null,
    ): string | undefined => {
      if (!exercise?.metadata || typeof exercise.metadata !== "object") {
        return undefined;
      }
      const meta = exercise.metadata as Record<string, unknown>;
      if (typeof meta.targetLoadKg === "number" && meta.targetLoadKg > 0) {
        return `${meta.targetLoadKg} kg`;
      }
      if (
        typeof meta.targetLoad === "string" &&
        meta.targetLoad.trim().length > 0
      ) {
        return meta.targetLoad.trim();
      }
      return undefined;
    };

    // 1. Add planned exercises
    plannedExercises.forEach((p) => {
      const matched = workspace.exercises.find(
        (e) => e.name.trim().toLowerCase() === p.name.trim().toLowerCase(),
      );
      const id = matched?.id ?? `planned-${p.catalogId || p.name}`;
      const targetLoad = p.targetLoad || resolveTargetLoadFromMetadata(matched);
      map.set(p.name.trim().toLowerCase(), {
        id,
        name: p.name,
        catalogId: p.catalogId,
        targetSets: p.sets || 3,
        repsMin: p.repsMin,
        repsMax: p.repsMax,
        durationMinutes: p.durationMinutes,
        restSeconds: p.restSeconds || globalRestSeconds,
        targetLoad,
        isPlanned: true,
      });
    });

    // 2. Add exercises that already have logged sets
    workspace.sets.forEach((set) => {
      const matched = workspace.exercises.find((e) => e.id === set.exerciseId);
      if (matched) {
        const key = matched.name.trim().toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            id: matched.id,
            name: matched.name,
            catalogId: "",
            targetSets: 3,
            repsMin: null,
            repsMax: null,
            durationMinutes: null,
            restSeconds: globalRestSeconds,
            targetLoad: resolveTargetLoadFromMetadata(matched),
            isPlanned: false,
          });
        }
      }
    });

    // 3. Add any dynamically added exercises
    extraExercises.forEach((extra) => {
      const key = extra.name.trim().toLowerCase();
      if (!map.has(key)) {
        const matched = workspace.exercises.find(
          (e) => e.name.trim().toLowerCase() === key,
        );
        const targetLoad =
          extra.targetLoad || resolveTargetLoadFromMetadata(matched);
        map.set(key, {
          ...extra,
          targetLoad,
        });
      }
    });

    return Array.from(map.values());
  }, [
    extraExercises,
    globalRestSeconds,
    plannedExercises,
    workspace.exercises,
    workspace.sets,
  ]);

  // Pre-load recent performance for all active exercises
  useEffect(() => {
    if (!workspace.workout) return;
    const workoutIdVal = workspace.workout.id;
    exerciseEntries.forEach((entry) => {
      if (entry.id.startsWith("planned-")) return;
      if (recentPerformanceMap[entry.id] === undefined) {
        void loadRecentPerformance(entry.id, workoutIdVal).then((perf) => {
          setRecentPerformanceMap((curr) => ({
            ...curr,
            [entry.id]: perf,
          }));
        });
      }
    });
  }, [exerciseEntries, recentPerformanceMap, workspace.workout]);

  // Active session summary for the persistent live notification
  const activeSessionSummary = useMemo(() => {
    if (
      !workspace.workout ||
      workspace.workout.completedAt !== null ||
      isRoutineDetails(workspace.workout.details)
    ) {
      return null;
    }

    const completedSetsCount = workspace.sets.length;
    let totalPlannedSetsCount = 0;
    for (const ex of exerciseEntries) {
      totalPlannedSetsCount += ex.targetSets || 3;
    }

    const exerciseProgress = exerciseEntries.map((entry) => ({
      name: entry.name,
      targetSetsCount: entry.targetSets || 3,
      completedSetsCount: completedSetsForNotificationEntry(
        entry,
        workspace.exercises,
        workspace.sets,
      ).length,
    }));

    const nextExerciseIndex = selectNextExerciseIndexForNotification(
      exerciseProgress,
      restTimer?.exerciseName,
    );
    const currentEntry =
      nextExerciseIndex === null
        ? undefined
        : exerciseEntries[nextExerciseIndex];
    const allPlannedSetsCompleted =
      exerciseEntries.length > 0 && nextExerciseIndex === null;

    if (!currentEntry) {
      return {
        workoutId: workspace.workout.id,
        workoutName: workspace.workout.name || "Live Workout",
        currentExerciseName: "Workout",
        completedSetsCount,
        totalPlannedSetsCount,
        nextSetSequence: completedSetsCount + 1,
        nextSetSummary: undefined,
        allPlannedSetsCompleted,
      };
    }

    const completedForEntry = completedSetsForNotificationEntry(
      currentEntry,
      workspace.exercises,
      workspace.sets,
    );

    const lastCompletedSet =
      completedForEntry.length > 0
        ? completedForEntry[completedForEntry.length - 1]
        : null;
    const nextSetSequence = completedForEntry.length + 1;

    const nextSetSummary = formatNextSetSummary(
      currentEntry,
      nextSetSequence,
      unitSystem,
      lastCompletedSet,
    );

    return {
      workoutId: workspace.workout.id,
      workoutName: workspace.workout.name || "Live Workout",
      currentExerciseName: currentEntry.name,
      completedSetsCount,
      totalPlannedSetsCount,
      nextSetSequence,
      nextSetSummary,
      allPlannedSetsCompleted,
    };
  }, [
    exerciseEntries,
    restTimer,
    unitSystem,
    workspace.exercises,
    workspace.sets,
    workspace.workout,
  ]);

  // Synchronize live workout session notification
  useEffect(() => {
    if (!liveNotificationEnabled || !activeSessionSummary) {
      return;
    }

    void updateActiveWorkoutNotification({
      workoutId: activeSessionSummary.workoutId,
      workoutName: activeSessionSummary.workoutName,
      currentExerciseName: activeSessionSummary.currentExerciseName,
      completedSetsCount: activeSessionSummary.completedSetsCount,
      totalPlannedSetsCount: activeSessionSummary.totalPlannedSetsCount,
      nextSetSequence: activeSessionSummary.nextSetSequence,
      nextSetSummary: activeSessionSummary.nextSetSummary,
      allPlannedSetsCompleted: activeSessionSummary.allPlannedSetsCompleted,
      restTimer: restTimer
        ? {
            endsAt: restTimer.endsAt,
            total: restTimer.total,
            exerciseName: restTimer.exerciseName,
          }
        : null,
    });
  }, [activeSessionSummary, liveNotificationEnabled, restTimer]);

  // Clean up notification if user disabled the setting
  useEffect(() => {
    if (!liveNotificationEnabled) {
      void dismissActiveWorkoutNotification();
    }
  }, [liveNotificationEnabled]);

  // Start workout action
  const onStart = useCallback(async () => {
    measurement.current?.tap();
    if (hadFailure.current) {
      measurement.current?.retry();
      hadFailure.current = false;
    }
    setBusy(true);
    setMessage(null);
    const result = await startWorkout(
      draft.name,
      draft.notes,
      draft.workoutProposal === undefined
        ? undefined
        : {
            aiDraft: {
              ...draft.workoutProposal,
              userConfirmed: true,
            },
          },
    );
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
  }, [draft.name, draft.notes, draft.workoutProposal]);

  // Add exercise from library or catalog
  const handleSelectCatalogExercise = useCallback(
    async (catalogEx: CatalogExercise) => {
      setLibraryVisible(false);
      measurement.current?.tap();

      let targetExercise = workspace.exercises.find(
        (e) =>
          e.name.trim().toLowerCase() === catalogEx.name.trim().toLowerCase(),
      );

      if (!targetExercise) {
        setBusy(true);
        const created = await createExercise(
          catalogEx.name,
          catalogEx.instructions.join(" "),
        );
        setBusy(false);
        if (created.ok) {
          targetExercise = created.exercise;
          setWorkspace((curr) => ({
            ...curr,
            exercises: [...curr.exercises, created.exercise].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          }));
        } else {
          setMessage(created.message);
          return;
        }
      }

      const newEntry: ExerciseEntry = {
        id: targetExercise.id,
        name: targetExercise.name,
        catalogId: catalogEx.id,
        targetSets: 3,
        repsMin: 8,
        repsMax: 12,
        durationMinutes: null,
        restSeconds: 90,
        isPlanned: false,
      };

      setExtraExercises((curr) => [...curr, newEntry]);
    },
    [workspace.exercises],
  );

  // Update pending set input for an exercise
  const updatePendingInput = useCallback(
    (exerciseIdOrName: string, patch: Partial<PendingSetInput>) => {
      setPendingInputs((curr) => {
        const existing = curr[exerciseIdOrName] ?? {
          load: "",
          reps: "",
          durationSeconds: "",
          distanceMeters: "",
          rpe: "",
        };
        return {
          ...curr,
          [exerciseIdOrName]: { ...existing, ...patch },
        };
      });
    },
    [],
  );

  // Complete / log an inline set for an exercise
  const handleLogSet = useCallback(
    async (entry: ExerciseEntry) => {
      if (workspace.workout === null || setSaveInFlight.current) return;
      setSaveInFlight.current = true;
      measurement.current?.tap();

      try {
        // Ensure the exercise exists in the database
        let resolvedExerciseId = entry.id;
        if (entry.id.startsWith("planned-")) {
          const existing = workspace.exercises.find(
            (e) =>
              e.name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
          );
          if (existing) {
            resolvedExerciseId = existing.id;
          } else {
            setBusy(true);
            const created = await createExercise(entry.name, "");
            setBusy(false);
            if (created.ok) {
              setWorkspace((current) => ({
                ...current,
                exercises: [...current.exercises, created.exercise].sort(
                  (a, b) => a.name.localeCompare(b.name),
                ),
              }));
              resolvedExerciseId = created.exercise.id;
            } else {
              setMessage(created.message);
              return;
            }
          }
        }

        // Read current input values or fallback to smart defaults
        const currentInput = pendingInputs[entry.id] ??
          pendingInputs[entry.name] ?? {
            load: "",
            reps: "",
            durationSeconds: "",
            distanceMeters: "",
            rpe: "",
          };

        const completedSets = workspace.sets.filter(
          (s) => s.exerciseId === resolvedExerciseId,
        );

        // Smart defaults: previous completed set or target
        let loadVal = currentInput.load.trim();
        let repsVal = currentInput.reps.trim();

        if (loadVal.length === 0) {
          if (completedSets.length > 0) {
            const lastSet = completedSets[completedSets.length - 1];
            if (lastSet?.loadKg !== null && lastSet?.loadKg !== undefined) {
              loadVal = String(
                kilogramsToDisplayWeight(lastSet.loadKg, unitSystem),
              );
            }
          } else if (entry.targetLoad) {
            const targetDisplay = parseTargetLoadToDisplay(
              entry.targetLoad,
              unitSystem,
            );
            if (targetDisplay !== null) {
              loadVal = targetDisplay;
            }
          } else {
            const perf =
              recentPerformanceMap[resolvedExerciseId] ??
              recentPerformanceMap[entry.id];
            const recentSet = perf?.sets?.[0];
            if (
              recentSet?.loadKg !== null &&
              recentSet?.loadKg !== undefined &&
              recentSet.loadKg > 0
            ) {
              loadVal = String(
                kilogramsToDisplayWeight(recentSet.loadKg, unitSystem),
              );
            }
          }
        }

        if (repsVal.length === 0) {
          if (completedSets.length > 0) {
            const lastSet = completedSets[completedSets.length - 1];
            if (
              lastSet?.repetitions !== null &&
              lastSet?.repetitions !== undefined
            ) {
              repsVal = String(lastSet.repetitions);
            }
          } else if (entry.repsMax !== null) {
            repsVal = String(entry.repsMax);
          } else if (entry.repsMin !== null) {
            repsVal = String(entry.repsMin);
          }
        }

        setBusy(true);
        setMessage(null);
        const result = await addWorkoutSet(workspace.workout.id, {
          exerciseId: resolvedExerciseId,
          repetitions: repsVal,
          load: loadVal,
          durationSeconds: currentInput.durationSeconds,
          distanceMeters: currentInput.distanceMeters,
          perceivedExertion: currentInput.rpe,
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
          setMessage(result.message);
          return;
        }

        // Start rest timer with wall-clock endsAt and background notification
        const restDuration =
          entry.restSeconds > 0 ? entry.restSeconds : globalRestSeconds;
        const setsAfterSave = [...workspace.sets, result.workoutSet];
        const exerciseProgressAfterSave = exerciseEntries.map(
          (exerciseEntry) => ({
            name: exerciseEntry.name,
            targetSetsCount: exerciseEntry.targetSets || 3,
            completedSetsCount: completedSetsForNotificationEntry(
              exerciseEntry,
              workspace.exercises,
              setsAfterSave,
              exerciseEntry.name.trim().toLowerCase() ===
                entry.name.trim().toLowerCase()
                ? resolvedExerciseId
                : undefined,
            ).length,
          }),
        );
        const nextExerciseIndex = selectNextExerciseIndexForNotification(
          exerciseProgressAfterSave,
          entry.name,
        );
        const nextExercise =
          nextExerciseIndex === null
            ? undefined
            : exerciseEntries[nextExerciseIndex];
        const nextExerciseSets = nextExercise
          ? completedSetsForNotificationEntry(
              nextExercise,
              workspace.exercises,
              setsAfterSave,
              nextExercise.name.trim().toLowerCase() ===
                entry.name.trim().toLowerCase()
                ? resolvedExerciseId
                : undefined,
            )
          : [];
        const nextSetSummary = nextExercise
          ? formatNextSetSummary(
              nextExercise,
              nextExerciseSets.length + 1,
              unitSystem,
              nextExerciseSets[nextExerciseSets.length - 1] ?? null,
            )
          : undefined;
        const allPlannedSetsCompleted =
          exerciseEntries.length > 0 && nextExerciseIndex === null;
        const notificationGeneration = ++restNotificationGeneration.current;
        void (async () => {
          if (restTimer?.notificationId) {
            await cancelRestNotification(restTimer.notificationId);
          }
          const notificationId = await scheduleRestNotification(
            {
              exerciseName: nextExercise?.name,
              setSummary: nextSetSummary,
              allPlannedSetsCompleted,
            },
            restDuration,
          );
          if (notificationGeneration !== restNotificationGeneration.current) {
            await cancelRestNotification(notificationId);
            return;
          }
          setRestTimer({
            endsAt: Date.now() + restDuration * 1000,
            total: restDuration,
            exerciseName: entry.name,
            nextExerciseName: nextExercise?.name,
            nextSetSummary,
            allPlannedSetsCompleted,
            notificationId,
          });
        })();

        // Immediately append the newly created set into workspace state so UI updates without reload
        setWorkspace((current) => ({
          ...current,
          sets: [...current.sets, result.workoutSet],
        }));

        // Keep load and reps prefilled for next set so next tap is ready!
        updatePendingInput(entry.id, {
          load: loadVal,
          reps: repsVal,
        });
        if (resolvedExerciseId !== entry.id) {
          updatePendingInput(resolvedExerciseId, {
            load: loadVal,
            reps: repsVal,
          });
        }

        // Silently reconcile with backend in the background without unmounting or resetting scroll
        void refresh();
      } catch {
        setMessage("We couldn't save this set. Please try again.");
      } finally {
        setBusy(false);
        setSaveInFlight.current = false;
      }
    },
    [
      globalRestSeconds,
      exerciseEntries,
      pendingInputs,
      refresh,
      restTimer?.notificationId,
      unitSystem,
      updatePendingInput,
      workspace.exercises,
      workspace.sets,
      workspace.workout,
    ],
  );

  // Remove / delete a completed set
  const handleRemoveSet = useCallback(
    (set: WorkoutSet) => {
      if (workspace.workout === null) return;
      Alert.alert("Delete Set?", `Remove set ${set.sequence}?`, [
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
              setWorkspace((current) => ({
                ...current,
                sets: current.sets.filter((s) => s.id !== set.id),
              }));
              void refresh();
            })();
          },
        },
      ]);
    },
    [refresh, workspace.workout],
  );

  // Complete workout
  const handleFinish = useCallback(async () => {
    if (workspace.workout === null) return;
    if (isRoutineDetails(workspace.workout.details)) {
      setMessage("Wait for the workout session to start before finishing it.");
      return;
    }
    measurement.current?.tap();

    const totalSets = workspace.sets.length;
    const formattedDuration = formatStopwatch(elapsedSeconds);

    const progressions = computeWorkoutProgressions({
      plannedExercises,
      completedSets: workspace.sets,
      exercises: workspace.exercises.map((e) => ({
        id: e.id,
        name: e.name,
        metadata: e.metadata,
      })),
    });
    const progressedItems = progressions.filter(
      (p) => p.progressed && p.nextTargetKg !== null && p.nextTargetKg > 0,
    );

    const unit = weightUnitLabel(unitSystem);
    const progressionSummary =
      progressedItems.length > 0 && autoAdvanceTargetWeights
        ? `\n\n🎯 Next session targets updated:\n` +
          progressedItems
            .map((p) => {
              const prev = p.previousTargetKg
                ? `${kilogramsToDisplayWeight(p.previousTargetKg, unitSystem)} ${unit}`
                : "None";
              const next = `${kilogramsToDisplayWeight(p.nextTargetKg!, unitSystem)} ${unit}`;
              return `• ${p.exerciseName}: ${prev} → ${next}`;
            })
            .join("\n")
        : "";

    Alert.alert(
      "Finish Workout?",
      `Completed in ${formattedDuration} with ${totalSets} saved sets.${progressionSummary}`,
      [
        { text: "Keep Logging", style: "cancel" },
        {
          text: "Finish & Save",
          onPress: () => {
            void (async () => {
              restNotificationGeneration.current += 1;
              if (restTimer?.notificationId) {
                await cancelRestNotification(restTimer.notificationId);
              }
              setRestTimer(null);
              clearContextRestTimer?.();
              setContextActiveWorkout?.(null);
              void dismissActiveWorkoutNotification();
              setBusy(true);

              if (autoAdvanceTargetWeights && progressedItems.length > 0) {
                await applyCompletedWorkoutProgressions(
                  workspace.workout!,
                  workspace.sets,
                  workspace.exercises,
                );
              }

              const result = await completeWorkout(
                workspace.workout!.id,
                workspace.workout!.startedAt,
              );
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
            })();
          },
        },
      ],
    );
  }, [
    autoAdvanceTargetWeights,
    clearContextRestTimer,
    elapsedSeconds,
    plannedExercises,
    restTimer?.notificationId,
    setContextActiveWorkout,
    unitSystem,
    userId,
    workspace.exercises,
    workspace.sets,
    workspace.workout,
  ]);

  // Confirm abandon
  const confirmAbandon = useCallback(() => {
    if (workspace.workout === null) return;
    if (isRoutineDetails(workspace.workout.details)) {
      setMessage("Wait for the workout session to start before discarding it.");
      return;
    }
    const lifecycle = readWorkoutLifecycle(workspace.workout.details);
    const discardMessage =
      lifecycle?.kind === "session" && lifecycle.routineId
        ? "This session and its logged sets will be deleted. Your saved routine will remain available."
        : "This session and its logged sets will be permanently deleted.";
    Alert.alert("Discard Session?", discardMessage, [
      { text: "Keep Logging", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          void (async () => {
            restNotificationGeneration.current += 1;
            if (restTimer?.notificationId) {
              await cancelRestNotification(restTimer.notificationId);
            }
            setRestTimer(null);
            clearContextRestTimer?.();
            setContextActiveWorkout?.(null);
            void dismissActiveWorkoutNotification();
            const result = await abandonWorkout(workspace.workout!.id);
            if (!result.ok) return setMessage(result.message);
            if (userId !== null) await clearLoggingDraft(userId, "workout");
            router.back();
          })();
        },
      },
    ]);
  }, [
    clearContextRestTimer,
    restTimer?.notificationId,
    setContextActiveWorkout,
    userId,
    workspace.workout,
  ]);

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen
        options={{
          title: workspace.workout?.name || "Live Workout",
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Minimize workout"
              onPress={() => router.back()}
              style={styles.headerMinimizeButton}
            >
              <ThemedText type="smallBold" style={styles.headerMinimizeText}>
                ✕
              </ThemedText>
            </Pressable>
          ),
          headerRight: () =>
            workspace.workout !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Finish Workout"
                onPress={handleFinish}
                style={styles.headerFinishButton}
              >
                <ThemedText type="smallBold" style={styles.headerFinishText}>
                  Finish
                </ThemedText>
              </Pressable>
            ) : null,
        }}
      />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardContainer}
        >
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[
              styles.content,
              restTimer !== null && styles.contentWithRestTimer,
            ]}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator />
                <ThemedText type="small" themeColor="textSecondary">
                  Loading workout session…
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
              <ActiveWorkoutFeed
                workout={workspace.workout}
                exercises={exerciseEntries}
                allExercises={workspace.exercises}
                savedSets={workspace.sets}
                recentPerformanceMap={recentPerformanceMap}
                pendingInputs={pendingInputs}
                unitSystem={unitSystem}
                inputColor={theme.text}
                busy={busy}
                elapsedSeconds={elapsedSeconds}
                onUpdatePendingInput={updatePendingInput}
                onLogSet={handleLogSet}
                onRemoveSet={handleRemoveSet}
                onOpenProgression={(name) => setProgressionExerciseName(name)}
                onOpenLibrary={() => setLibraryVisible(true)}
                onFinish={handleFinish}
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
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Floating Rest Timer Bar */}
      {restTimer !== null ? (
        <FloatingRestTimer
          rest={restTimer}
          onAdjust={(delta) => {
            const currentEndsAt = restTimer.endsAt;
            const currentTotal = restTimer.total;
            const notificationId = restTimer.notificationId;
            const exerciseName = restTimer.exerciseName;
            const nextExerciseName = restTimer.nextExerciseName;
            const nextSetSummary = restTimer.nextSetSummary;
            const allPlannedSetsCompleted = restTimer.allPlannedSetsCompleted;

            const now = Date.now();
            const currentRemaining = Math.max(
              0,
              Math.ceil((currentEndsAt - now) / 1000),
            );
            const nextRemaining = Math.max(0, currentRemaining + delta);

            if (nextRemaining <= 0) {
              restNotificationGeneration.current += 1;
              if (notificationId) {
                void cancelRestNotification(notificationId);
              }
              setRestTimer(null);
              return;
            }

            const nextEndsAt = now + nextRemaining * 1000;
            const nextTotal = Math.max(currentTotal, nextRemaining);
            const notificationGeneration = ++restNotificationGeneration.current;

            void (async () => {
              if (notificationId) {
                await cancelRestNotification(notificationId);
              }
              const newNotificationId = await scheduleRestNotification(
                {
                  exerciseName: nextExerciseName,
                  setSummary: nextSetSummary,
                  allPlannedSetsCompleted,
                },
                nextRemaining,
              );
              if (
                notificationGeneration !== restNotificationGeneration.current
              ) {
                await cancelRestNotification(newNotificationId);
                return;
              }
              setRestTimer({
                endsAt: nextEndsAt,
                total: nextTotal,
                exerciseName,
                nextExerciseName,
                nextSetSummary,
                allPlannedSetsCompleted,
                notificationId: newNotificationId,
              });
            })();
          }}
          onSkip={() => {
            restNotificationGeneration.current += 1;
            if (restTimer.notificationId) {
              void cancelRestNotification(restTimer.notificationId);
            }
            setRestTimer(null);
          }}
        />
      ) : null}

      {/* Exercise Library Modal to Add Exercises */}
      {libraryVisible ? (
        <ExerciseLibraryModal
          visible={libraryVisible}
          onClose={() => setLibraryVisible(false)}
          onSelectExercise={(ex) => void handleSelectCatalogExercise(ex)}
        />
      ) : null}

      {/* Exercise Progression Sheet */}
      {progressionExerciseName !== null ? (
        <ExerciseProgressionModal
          visible={progressionExerciseName !== null}
          onClose={() => setProgressionExerciseName(null)}
          exerciseName={progressionExerciseName}
        />
      ) : null}
    </ThemedView>
  );
}

// ==========================================
// Start Workout Section (When no active session)
// ==========================================
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
      <ThemedText type="subtitle">Start a workout session.</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Track sets, weight, and reps live. Sets are securely saved to your
        account in real time.
      </ThemedText>
      <Field
        testID="workout-name-input"
        label="Workout name"
        value={props.draft.name}
        onChangeText={(name) => props.onPatch({ name })}
        onFocus={props.onInteraction}
        placeholder="Upper Body A"
        inputColor={props.inputColor}
      />
      {props.draft.workoutProposal !== undefined ? (
        <View style={styles.planCard}>
          <ThemedText type="smallBold">Coach Workout Proposal</ThemedText>
          {props.draft.workoutProposal.session.exercises.map((exercise) => (
            <View key={exercise.catalogId} style={styles.planExercise}>
              <View style={styles.setCopy}>
                <ThemedText type="smallBold">{exercise.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {exercise.sets} sets ·{" "}
                  {exercise.repsMin === null
                    ? `${exercise.durationMinutes} min`
                    : `${exercise.repsMin}–${exercise.repsMax} reps`}{" "}
                  · {exercise.restSeconds}s rest
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <Field
        testID="workout-notes-input"
        label="Notes (optional)"
        value={props.draft.notes}
        onChangeText={(notes) => props.onPatch({ notes })}
        onFocus={props.onInteraction}
        placeholder="Focus on controlled eccentrics"
        inputColor={props.inputColor}
      />
      <Button
        label={props.busy ? "Starting…" : "Start Workout"}
        disabled={props.busy}
        onPress={props.onStart}
      />
    </View>
  );
}

// ==========================================
// Active Workout Feed (Hevy/Strong Card Design)
// ==========================================
function ActiveWorkoutFeed(props: {
  readonly workout: Workout;
  readonly exercises: ReadonlyArray<ExerciseEntry>;
  readonly allExercises: ReadonlyArray<Exercise>;
  readonly savedSets: ReadonlyArray<WorkoutSet>;
  readonly recentPerformanceMap: Record<
    string,
    ExerciseRecentSetsResponse | null
  >;
  readonly pendingInputs: Record<string, PendingSetInput>;
  readonly unitSystem: "metric" | "imperial";
  readonly inputColor: string;
  readonly busy: boolean;
  readonly elapsedSeconds: number;
  readonly onUpdatePendingInput: (
    idOrName: string,
    patch: Partial<PendingSetInput>,
  ) => void;
  readonly onLogSet: (exercise: ExerciseEntry) => void;
  readonly onRemoveSet: (set: WorkoutSet) => void;
  readonly onOpenProgression: (name: string) => void;
  readonly onOpenLibrary: () => void;
  readonly onFinish: () => void;
  readonly onAbandon: () => void;
  readonly onInteraction: () => void;
}) {
  const unit = weightUnitLabel(props.unitSystem);
  const totalSets = props.savedSets.length;
  const totalVolumeKg = useMemo(() => {
    return props.savedSets.reduce((acc, s) => {
      if (s.loadKg !== null && s.repetitions !== null) {
        return acc + s.loadKg * s.repetitions;
      }
      return acc;
    }, 0);
  }, [props.savedSets]);

  const displayVolume = kilogramsToDisplayWeight(
    totalVolumeKg,
    props.unitSystem,
  );

  return (
    <View style={styles.feedContainer}>
      {/* Live Header Bar */}
      <View style={styles.liveHeader}>
        <View style={styles.liveHeaderTop}>
          <View style={styles.liveStopwatchRow}>
            <View style={styles.livePulseDot} />
            <ThemedText type="subtitle">
              {formatStopwatch(props.elapsedSeconds)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {totalSets} sets · {displayVolume} {unit} volume
          </ThemedText>
        </View>
      </View>

      {/* Exercise Cards */}
      {props.exercises.length === 0 ? (
        <View style={styles.emptyExercisesCard}>
          <ThemedText type="smallBold">
            No exercises in this workout yet.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Tap "+ Add Exercise" below to pick from 870+ exercises.
          </ThemedText>
        </View>
      ) : (
        props.exercises.map((entry, index) => {
          const matchingDbExercise = props.allExercises.find(
            (e) =>
              e.id === entry.id ||
              e.name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
          );
          const resolvedDbId = matchingDbExercise?.id ?? entry.id;

          const completedSets = props.savedSets
            .filter((s) => s.exerciseId === resolvedDbId)
            .sort((a, b) => a.sequence - b.sequence);

          const recentPerf = props.recentPerformanceMap[resolvedDbId] ?? null;

          return (
            <LiveExerciseCard
              key={`${entry.name}-${index}`}
              entry={entry}
              completedSets={completedSets}
              recentPerformance={recentPerf}
              pendingInput={
                props.pendingInputs[entry.id] ??
                props.pendingInputs[entry.name] ?? {
                  load: "",
                  reps: "",
                  durationSeconds: "",
                  distanceMeters: "",
                  rpe: "",
                }
              }
              unitSystem={props.unitSystem}
              inputColor={props.inputColor}
              busy={props.busy}
              onUpdatePendingInput={(patch) =>
                props.onUpdatePendingInput(entry.id, patch)
              }
              onLogSet={() => props.onLogSet(entry)}
              onRemoveSet={props.onRemoveSet}
              onOpenProgression={() => props.onOpenProgression(entry.name)}
              onInteraction={props.onInteraction}
            />
          );
        })
      )}

      {/* Add Exercise & Workout Controls */}
      <View style={styles.bottomControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add Exercise to Workout"
          onPress={() => {
            props.onInteraction();
            props.onOpenLibrary();
          }}
          style={styles.addExerciseButton}
        >
          <ThemedText type="smallBold" style={styles.addExerciseText}>
            + Add Exercise
          </ThemedText>
        </Pressable>

        <View style={styles.finishActions}>
          <Button
            label={props.busy ? "Finishing…" : "Finish Workout"}
            disabled={props.busy}
            onPress={props.onFinish}
          />
          <Button
            label="Discard Session"
            destructive
            onPress={props.onAbandon}
          />
        </View>
      </View>
    </View>
  );
}

// ==========================================
// Individual Exercise Card with Inline Set Table
// ==========================================
function LiveExerciseCard(props: {
  readonly entry: ExerciseEntry;
  readonly completedSets: ReadonlyArray<WorkoutSet>;
  readonly recentPerformance: ExerciseRecentSetsResponse | null;
  readonly pendingInput: PendingSetInput;
  readonly unitSystem: "metric" | "imperial";
  readonly inputColor: string;
  readonly busy: boolean;
  readonly onUpdatePendingInput: (patch: Partial<PendingSetInput>) => void;
  readonly onLogSet: () => void;
  readonly onRemoveSet: (set: WorkoutSet) => void;
  readonly onOpenProgression: () => void;
  readonly onInteraction: () => void;
}) {
  const unit = weightUnitLabel(props.unitSystem);
  const nextSetSequence = props.completedSets.length + 1;

  const targetLoadDisplay = props.entry.targetLoad
    ? parseTargetLoadToDisplay(props.entry.targetLoad, props.unitSystem)
    : null;

  // Compute smart placeholder for next set
  const previousSet =
    props.completedSets.length > 0
      ? props.completedSets[props.completedSets.length - 1]
      : null;

  const previousBestLoad = props.recentPerformance?.summary.bestLoadKg ?? null;

  const smartPlaceholderLoad =
    previousSet?.loadKg !== null && previousSet?.loadKg !== undefined
      ? String(kilogramsToDisplayWeight(previousSet.loadKg, props.unitSystem))
      : targetLoadDisplay !== null
        ? targetLoadDisplay
        : previousBestLoad !== null
          ? String(kilogramsToDisplayWeight(previousBestLoad, props.unitSystem))
          : "—";

  const smartPlaceholderReps =
    previousSet?.repetitions !== null && previousSet?.repetitions !== undefined
      ? String(previousSet.repetitions)
      : props.entry.repsMax !== null
        ? String(props.entry.repsMax)
        : props.entry.repsMin !== null
          ? String(props.entry.repsMin)
          : "10";

  return (
    <View style={styles.exerciseCard}>
      {/* Exercise Card Header */}
      <View style={styles.exerciseCardHeader}>
        <View style={styles.exerciseTitleBlock}>
          <ThemedText type="default" style={styles.exerciseNameText}>
            {props.entry.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Target: {props.entry.targetSets} sets ·{" "}
            {props.entry.repsMin === null
              ? props.entry.durationMinutes
                ? `${props.entry.durationMinutes} min`
                : "reps"
              : `${props.entry.repsMin}–${props.entry.repsMax} reps`}
            {targetLoadDisplay !== null
              ? ` · ${targetLoadDisplay} ${unit}`
              : ""}{" "}
            · {props.entry.restSeconds}s rest
          </ThemedText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View progression for ${props.entry.name}`}
          onPress={props.onOpenProgression}
          style={styles.progressionBadge}
        >
          <ThemedText type="smallBold" style={styles.progressionBadgeText}>
            📈 History →
          </ThemedText>
        </Pressable>
      </View>

      {/* Set Table */}
      <View style={styles.setTable}>
        {/* Table Header */}
        <View style={styles.setTableHeaderRow}>
          <ThemedText type="small" style={styles.colSetHeader}>
            SET
          </ThemedText>
          <ThemedText type="small" style={styles.colPrevHeader}>
            PREVIOUS
          </ThemedText>
          <ThemedText type="small" style={styles.colInputHeader}>
            {unit.toUpperCase()}
          </ThemedText>
          <ThemedText type="small" style={styles.colInputHeader}>
            REPS
          </ThemedText>
          <ThemedText type="small" style={styles.colCheckHeader}>
            ✓
          </ThemedText>
        </View>

        {/* Completed Sets */}
        {props.completedSets.map((set, i) => {
          const loadStr =
            set.loadKg !== null
              ? kilogramsToDisplayWeight(set.loadKg, props.unitSystem)
              : "—";
          const repsStr = set.repetitions !== null ? `${set.repetitions}` : "—";

          return (
            <View key={set.id} style={styles.completedSetRow}>
              <ThemedText type="smallBold" style={styles.colSet}>
                {i + 1}
              </ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.colPrev}
              >
                {loadStr} {unit} × {repsStr}
              </ThemedText>
              <ThemedText type="smallBold" style={styles.colInputDone}>
                {loadStr}
              </ThemedText>
              <ThemedText type="smallBold" style={styles.colInputDone}>
                {repsStr}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete completed set ${i + 1}`}
                onPress={() => props.onRemoveSet(set)}
                style={styles.checkedCircle}
              >
                <ThemedText type="smallBold" style={styles.checkIconText}>
                  ✓
                </ThemedText>
              </Pressable>
            </View>
          );
        })}

        {/* Active / Pending Set Row */}
        <View style={styles.activeSetRow}>
          <ThemedText type="smallBold" style={styles.colSet}>
            {nextSetSequence}
          </ThemedText>

          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.colPrev}
            numberOfLines={1}
          >
            {previousSet !== null && smartPlaceholderLoad !== "—"
              ? `${smartPlaceholderLoad} ${unit} × ${smartPlaceholderReps}`
              : targetLoadDisplay !== null
                ? `Target: ${targetLoadDisplay} ${unit}`
                : smartPlaceholderLoad !== "—"
                  ? `${smartPlaceholderLoad} ${unit} × ${smartPlaceholderReps}`
                  : "First set"}
          </ThemedText>

          <View style={styles.colInputCell}>
            <TextInput
              testID={`set-load-input-${props.entry.id}`}
              value={props.pendingInput.load}
              onChangeText={(load) => props.onUpdatePendingInput({ load })}
              onFocus={props.onInteraction}
              placeholder={
                smartPlaceholderLoad !== "—" ? smartPlaceholderLoad : "0"
              }
              placeholderTextColor="#6B7280"
              keyboardType="decimal-pad"
              style={[styles.tableInput, { color: props.inputColor }]}
            />
          </View>

          <View style={styles.colInputCell}>
            <TextInput
              testID={`set-reps-input-${props.entry.id}`}
              value={props.pendingInput.reps}
              onChangeText={(reps) => props.onUpdatePendingInput({ reps })}
              onFocus={props.onInteraction}
              placeholder={smartPlaceholderReps}
              placeholderTextColor="#6B7280"
              keyboardType="decimal-pad"
              style={[styles.tableInput, { color: props.inputColor }]}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Log set ${nextSetSequence} for ${props.entry.name}`}
            disabled={props.busy}
            onPress={props.onLogSet}
            style={styles.checkButton}
          >
            <ThemedText type="smallBold" style={styles.checkButtonText}>
              ✓
            </ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Add Set Footer */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add Set for ${props.entry.name}`}
        disabled={props.busy}
        onPress={props.onLogSet}
        style={styles.addSetRow}
      >
        <ThemedText type="smallBold" style={styles.addSetText}>
          + Add Set {nextSetSequence}
        </ThemedText>
      </Pressable>
    </View>
  );
}

// ==========================================
// Floating Rest Timer Bar
// ==========================================
function FloatingRestTimer(props: {
  readonly rest: RestTimerState;
  readonly onAdjust: (delta: number) => void;
  readonly onSkip: () => void;
}) {
  const remaining = Math.max(
    0,
    Math.ceil((props.rest.endsAt - Date.now()) / 1000),
  );
  const percent = Math.min(
    100,
    Math.max(0, (remaining / Math.max(1, props.rest.total)) * 100),
  );

  return (
    <View style={styles.floatingTimerContainer}>
      <View style={styles.floatingTimerBar}>
        <View style={styles.timerInfoBlock}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            ⏱ Rest ({props.rest.exerciseName})
          </ThemedText>
          <ThemedText type="subtitle" style={styles.timerCountdown}>
            {formatStopwatch(remaining)}
          </ThemedText>
        </View>

        <View style={styles.timerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Subtract 15 seconds"
            onPress={() => props.onAdjust(-15)}
            style={styles.timerAdjustButton}
          >
            <ThemedText type="smallBold">-15s</ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add 15 seconds"
            onPress={() => props.onAdjust(15)}
            style={styles.timerAdjustButton}
          >
            <ThemedText type="smallBold">+15s</ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip rest timer"
            onPress={props.onSkip}
            style={styles.timerSkipButton}
          >
            <ThemedText type="smallBold" style={styles.timerSkipText}>
              Skip
            </ThemedText>
          </Pressable>
        </View>
      </View>
      {/* Progress line */}
      <View style={styles.timerProgressTrack}>
        <View style={[styles.timerProgressFill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
}

// ==========================================
// Form & Button Helpers
// ==========================================
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

const formatStopwatch = (totalSeconds: number): string => {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${remMins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

type StoredWorkoutDraft = WorkoutDraft | Pick<WorkoutDraft, "name" | "notes">;

const isStoredWorkoutDraft = (value: unknown): value is StoredWorkoutDraft => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== "string" || typeof candidate.notes !== "string")
    return false;
  const stringsValid = Object.keys(EMPTY_DRAFT).every(
    (key) => candidate[key] === undefined || typeof candidate[key] === "string",
  );
  const proposalValid =
    candidate.workoutProposal === undefined ||
    coachWorkoutProposalSchema.safeParse(candidate.workoutProposal).success;
  return stringsValid && proposalValid;
};

// ==========================================
// Styles
// ==========================================
const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  keyboardContainer: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  contentWithRestTimer: {
    paddingBottom: BottomTabInset + Spacing.six + 90,
  },
  center: {
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  section: { gap: Spacing.three },
  feedContainer: {
    gap: Spacing.four,
  },
  headerMinimizeButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: Spacing.two,
    marginLeft: Spacing.two,
    justifyContent: "center",
    alignItems: "center",
  },
  headerMinimizeText: {
    fontSize: 16,
  },
  headerFinishButton: {
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.two,
    marginRight: Spacing.two,
  },
  headerFinishText: {
    color: "#FFFFFF",
  },
  liveHeader: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: Spacing.three,
    padding: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  liveHeaderTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  liveStopwatchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  livePulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#10B981",
  },
  emptyExercisesCard: {
    padding: Spacing.six,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
    gap: Spacing.two,
  },
  exerciseCard: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.1)",
    padding: Spacing.three,
    gap: Spacing.three,
  },
  exerciseCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  exerciseTitleBlock: {
    flex: 1,
    gap: 2,
  },
  exerciseNameText: {
    fontSize: 17,
    fontWeight: "700",
  },
  progressionBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  progressionBadgeText: {
    color: "#10B981",
    fontSize: 12,
  },
  setTable: {
    gap: Spacing.one,
  },
  setTableHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
  },
  colSetHeader: {
    width: 36,
    color: "#8A8D91",
    fontSize: 11,
    fontWeight: "700",
  },
  colPrevHeader: {
    flex: 1,
    color: "#8A8D91",
    fontSize: 11,
    fontWeight: "700",
  },
  colInputHeader: {
    width: 64,
    textAlign: "center",
    color: "#8A8D91",
    fontSize: 11,
    fontWeight: "700",
  },
  colCheckHeader: {
    width: 44,
    textAlign: "center",
    color: "#8A8D91",
    fontSize: 11,
    fontWeight: "700",
  },
  completedSetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  activeSetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: Spacing.two,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  colSet: {
    width: 36,
    color: "#8A8D91",
  },
  colPrev: {
    flex: 1,
    paddingRight: Spacing.one,
    fontSize: 12,
  },
  colInputDone: {
    width: 64,
    textAlign: "center",
    color: "#FFFFFF",
  },
  colInputCell: {
    width: 64,
    paddingHorizontal: 3,
  },
  tableInput: {
    height: 38,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.2)",
    textAlign: "center",
    fontSize: 15,
    fontWeight: "600",
  },
  checkedCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  checkIconText: {
    color: "#FFFFFF",
    fontSize: 16,
  },
  checkButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  checkButtonText: {
    color: "#10B981",
    fontSize: 16,
  },
  addSetRow: {
    paddingVertical: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Spacing.two,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  addSetText: {
    color: "#10B981",
  },
  bottomControls: {
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  addExerciseButton: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
  },
  addExerciseText: {
    color: "#10B981",
  },
  finishActions: {
    gap: Spacing.two,
  },
  planCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#18633d",
  },
  planExercise: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  setCopy: { flex: 1, gap: Spacing.one },
  field: { flex: 1, minWidth: 140, gap: Spacing.one },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.two,
    padding: Spacing.three,
    fontSize: 16,
  },
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
  message: {
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#A13A25",
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  floatingTimerContainer: {
    position: "absolute",
    bottom: Spacing.four + BottomTabInset,
    left: Spacing.four,
    right: Spacing.four,
    backgroundColor: "#18181B",
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(16, 185, 129, 0.4)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
    overflow: "hidden",
  },
  floatingTimerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.three,
  },
  timerInfoBlock: {
    flex: 1,
    gap: 2,
  },
  timerCountdown: {
    color: "#10B981",
    fontWeight: "700",
  },
  timerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  timerAdjustButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  timerSkipButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
  },
  timerSkipText: {
    color: "#EF4444",
  },
  timerProgressTrack: {
    height: 3,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    width: "100%",
  },
  timerProgressFill: {
    height: "100%",
    backgroundColor: "#10B981",
  },
});
