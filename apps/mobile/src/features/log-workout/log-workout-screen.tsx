import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoggingFlowMeasurement } from "@/features/analytics/flow-measurement";
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
  type WorkoutSetType,
  type CompanionCommand,
} from "@mizyun/contracts";
import {
  computeWorkoutProgressions,
  getCatalogExerciseNames,
  isRoutineDetails,
  readWorkoutLifecycle,
  type CatalogExercise,
} from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { classifyAnalyticsFailure } from "@/features/analytics/classify-failure";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { ShareWorkoutModal, useCommunityProfile } from "@/features/community";
import { useAuth } from "@/features/auth/auth-context";
import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";
import { useTheme } from "@/hooks/use-theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  displayWeightToKilograms,
  kilogramsToDisplayWeight,
  parseTargetLoadToDisplay,
  weightUnitLabel,
} from "@/lib/weight-units";
import { ExerciseLibraryModal } from "@/features/workouts/exercise-library-modal";
import { ExerciseProgressionModal } from "@/features/workouts/exercise-progression-modal";
import { ReorderExercisesModal } from "@/features/workouts/reorder-exercises-modal";
import { SetTypeModal } from "@/features/workouts/set-type-modal";
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
  restTimerNextAction,
  findCatalogExerciseRecord,
  useOptionalActiveWorkout,
  type CurrentWorkoutNextAction,
  type RestTimerState,
} from "@/features/workouts";
import {
  completedSetsForNotificationEntry,
  dismissActiveWorkoutNotification,
  formatNextSetSummary,
  selectNextExerciseIndexForNotification,
  shouldSyncActiveWorkoutNotification,
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
  reorderWorkoutExercises,
  startWorkout,
  type PlannedExercise,
  type WorkoutWorkspace,
} from "./log-workout-data";
import {
  WatchWorkoutControls,
  type CompanionOutcome,
  type CompanionWorkoutView,
} from "@/features/workout-companion";
import { CompletedWorkoutFeed } from "./completed-workout-feed";
import { plannedSetTypeForSequence } from "@/features/workouts/planned-set-types";

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
  readonly setTypes?: readonly WorkoutSetType[];
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
  setType?: WorkoutSetType;
  setTypeSequence?: number;
}

function pendingSetType(
  input: PendingSetInput | undefined,
  entry: ExerciseEntry,
  completedSets: readonly WorkoutSet[],
): WorkoutSetType {
  const sequence = completedSets.length + 1;
  if (
    input?.setType &&
    (input.setTypeSequence === undefined || input.setTypeSequence === sequence)
  )
    return input.setType;
  const previous = [...completedSets]
    .sort((a, b) => a.sequence - b.sequence)
    .at(-1);
  return plannedSetTypeForSequence(entry.setTypes, sequence, previous?.setType);
}

export function LogWorkoutScreen() {
  const { workoutId } = useLocalSearchParams<{ workoutId?: string }>();
  const { profile, session } = useAuth();
  const community = useCommunityProfile({
    principalKey: session?.user.id ?? null,
    birthYear: profile?.birthYear,
  });
  const [completedShareId, setCompletedShareId] = useState<string | null>(null);
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
  const measurement = useLoggingFlowMeasurement(
    "workout",
    userId,
    !loading &&
      (workspace.workout === null
        ? !workoutId
        : workspace.workout.completedAt === null),
  );

  // Live session state
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
  const [exerciseSelectionMessage, setExerciseSelectionMessage] = useState<
    string | null
  >(null);
  const [selectedSetTypeEntry, setSelectedSetTypeEntry] =
    useState<ExerciseEntry | null>(null);
  const [reorderModalVisible, setReorderModalVisible] = useState(false);
  const [orderedExerciseKeys, setOrderedExerciseKeys] = useState<
    ReadonlyArray<string>
  >([]);
  const [restTimer, setRestTimer] = useState<RestTimerState | null>(() =>
    contextRestTimer && Date.now() < contextRestTimer.endsAt
      ? contextRestTimer
      : null,
  );
  const [, setRestTick] = useState(0);
  const [globalRestSeconds, setGlobalRestSeconds] =
    useState<number>(DEFAULT_REST_SECONDS);
  const [liveNotificationEnabled, setLiveNotificationEnabled] =
    useState<boolean>(false);
  const [workoutPreferencesLoaded, setWorkoutPreferencesLoaded] =
    useState(false);
  const [autoAdvanceTargetWeights, setAutoAdvanceTargetWeights] =
    useState<boolean>(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const hadFailure = useRef(false);
  const setSaveInFlight = useRef(false);
  const exerciseMutationInFlight = useRef(false);
  const currentWorkoutOwner = useRef("");
  currentWorkoutOwner.current = `${userId}:${workspace.workout?.id ?? ""}`;
  const isOneTimeWorkout =
    workspace.workout?.details?.sessionMode === "one_time";
  const isCompletedWorkout = workspace.workout?.completedAt != null;
  const isActiveSession =
    workspace.workout !== null &&
    !isCompletedWorkout &&
    !isRoutineDetails(workspace.workout.details);
  const restNotificationGeneration = useRef(0);

  useEffect(
    () => () => {
      currentWorkoutOwner.current = "";
      restNotificationGeneration.current++;
    },
    [],
  );

  const plannedExercises = useMemo(
    () => extractPlannedExercises(workspace.workout, draft.workoutProposal),
    [workspace.workout, draft.workoutProposal],
  );

  const refreshCounter = useRef(0);
  const routineStartRef = useRef<string | null>(null);

  const refresh = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const attempt = measurement.current;
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
        attempt?.fail("load", classifyAnalyticsFailure(next.message), true);
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
      routine.completedAt !== null ||
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
    if (userId === null || workoutId) return;
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
  }, [userId, workoutId]);

  useEffect(() => {
    if (!draftLoaded || userId === null || workoutId) return;
    void saveLoggingDraft(userId, "workout", draft);
  }, [draft, draftLoaded, userId, workoutId]);

  // Load workout preferences (global rest timer setting and live notification toggle)
  useEffect(() => {
    let active = true;
    setWorkoutPreferencesLoaded(false);
    void loadWorkoutPreferences(userId ?? undefined).then((prefs) => {
      if (!active) return;
      setGlobalRestSeconds(prefs.defaultRestSeconds);
      setLiveNotificationEnabled(prefs.liveNotificationEnabled);
      setAutoAdvanceTargetWeights(prefs.autoAdvanceTargetWeights);
      setWorkoutPreferencesLoaded(true);
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
    if (!isActiveSession || !restTimer) return;
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
  }, [isActiveSession, restTimer]);

  // AppState listener to immediately refresh/expire rest timer when app returns to foreground
  useEffect(() => {
    if (!isActiveSession) return;
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
  }, [isActiveSession]);

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
    if (!isActiveSession) return;
    if (restTimer && Date.now() < restTimer.endsAt) {
      startContextRestTimer?.(restTimer);
    } else if (restTimer === null) {
      clearContextRestTimer?.();
    }
  }, [
    clearContextRestTimer,
    isActiveSession,
    restTimer,
    startContextRestTimer,
  ]);

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
      const targetLoad = isOneTimeWorkout
        ? undefined
        : p.targetLoad || resolveTargetLoadFromMetadata(matched);
      map.set(p.name.trim().toLowerCase(), {
        id,
        name: p.name,
        catalogId: p.catalogId,
        targetSets: p.sets || 3,
        ...(p.setTypes && !isOneTimeWorkout ? { setTypes: p.setTypes } : {}),
        repsMin: p.repsMin,
        repsMax: p.repsMax,
        durationMinutes: p.durationMinutes,
        restSeconds: p.restSeconds || globalRestSeconds,
        targetLoad,
        isPlanned: !isOneTimeWorkout,
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
            targetLoad: isOneTimeWorkout
              ? undefined
              : resolveTargetLoadFromMetadata(matched),
            isPlanned: false,
          });
        }
      }
    });

    const list = Array.from(map.values());
    if (orderedExerciseKeys.length === 0) {
      return list;
    }
    return [...list].sort((a, b) => {
      const keyA = a.name.trim().toLowerCase();
      const keyB = b.name.trim().toLowerCase();
      const idxA = orderedExerciseKeys.indexOf(keyA);
      const idxB = orderedExerciseKeys.indexOf(keyB);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });
  }, [
    isOneTimeWorkout,
    globalRestSeconds,
    orderedExerciseKeys,
    plannedExercises,
    workspace.exercises,
    workspace.sets,
  ]);

  useEffect(() => {
    setOrderedExerciseKeys([]);
  }, [workspace.workout?.id]);

  const handleMoveExercise = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (
        busy ||
        exerciseMutationInFlight.current ||
        setSaveInFlight.current ||
        !workspace.workout ||
        workspace.workout.completedAt !== null ||
        isRoutineDetails(workspace.workout.details) ||
        fromIndex < 0 ||
        fromIndex >= exerciseEntries.length ||
        toIndex < 0 ||
        toIndex >= exerciseEntries.length ||
        fromIndex === toIndex
      )
        return;
      const next = [...exerciseEntries];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return;
      next.splice(toIndex, 0, moved);
      exerciseMutationInFlight.current = true;
      const owner = currentWorkoutOwner.current;
      setBusy(true);
      void (async () => {
        try {
          const result = await reorderWorkoutExercises(
            workspace.workout!,
            next,
          );
          if (currentWorkoutOwner.current !== owner) return;
          if (!result.ok) {
            setMessage(result.message);
            return;
          }
          refreshCounter.current++;
          setOrderedExerciseKeys(
            next.map((entry) => entry.name.trim().toLowerCase()),
          );
          setWorkspace((current) => ({ ...current, workout: result.workout }));
        } catch {
          if (currentWorkoutOwner.current === owner)
            setMessage("Could not reorder exercises. Try again.");
        } finally {
          exerciseMutationInFlight.current = false;
          setBusy(false);
        }
      })();
    },
    [busy, exerciseEntries, workspace.workout],
  );

  // Pre-load recent performance for all active exercises
  useEffect(() => {
    if (!isActiveSession || !workspace.workout) return;
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
  }, [
    exerciseEntries,
    isActiveSession,
    recentPerformanceMap,
    workspace.workout,
  ]);

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
      if (!isOneTimeWorkout) totalPlannedSetsCount += ex.targetSets || 3;
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

    const restingIndex = exerciseEntries.findIndex(
      (entry) => entry.name === restTimer?.exerciseName,
    );
    const nextExerciseIndex = isOneTimeWorkout
      ? exerciseEntries.length === 0
        ? null
        : restingIndex >= 0
          ? restingIndex
          : exerciseEntries.length - 1
      : selectNextExerciseIndexForNotification(
          exerciseProgress,
          restTimer?.exerciseName,
        );
    const currentEntry =
      nextExerciseIndex === null
        ? undefined
        : exerciseEntries[nextExerciseIndex];
    const allPlannedSetsCompleted =
      !isOneTimeWorkout &&
      exerciseEntries.length > 0 &&
      nextExerciseIndex === null;

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
    isOneTimeWorkout,
    restTimer,
    unitSystem,
    workspace.exercises,
    workspace.sets,
    workspace.workout,
  ]);

  // Synchronize live workout session notification
  useEffect(() => {
    if (
      !shouldSyncActiveWorkoutNotification(
        workoutPreferencesLoaded,
        liveNotificationEnabled,
        activeSessionSummary !== null,
      ) ||
      !activeSessionSummary ||
      userId === null
    ) {
      return;
    }

    void updateActiveWorkoutNotification({
      userId,
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
  }, [
    activeSessionSummary,
    liveNotificationEnabled,
    restTimer,
    workoutPreferencesLoaded,
    userId,
  ]);

  // Clean up notification if user disabled the setting
  useEffect(() => {
    if (
      isActiveSession &&
      workoutPreferencesLoaded &&
      !liveNotificationEnabled
    ) {
      void dismissActiveWorkoutNotification();
    }
  }, [isActiveSession, liveNotificationEnabled, workoutPreferencesLoaded]);

  // Start workout action
  const onStart = useCallback(async () => {
    const attempt = measurement.current;
    attempt?.tap();
    if (hadFailure.current) {
      attempt?.retry();
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
      attempt?.fail("submit", classifyAnalyticsFailure(result.message), true);
      return setMessage(result.message);
    }
    setWorkspace((current) => ({
      ...current,
      workout: result.workout,
      sets: [],
      message: null,
    }));
  }, [draft.name, draft.notes, draft.workoutProposal]);

  // Save selections before the first set so reopening the session keeps them.
  const handleSelectCatalogExercise = useCallback(
    async (catalogExercises: readonly CatalogExercise[]) => {
      if (
        busy ||
        exerciseMutationInFlight.current ||
        setSaveInFlight.current ||
        !workspace.workout ||
        workspace.workout.completedAt !== null ||
        isRoutineDetails(workspace.workout.details)
      )
        return false;
      exerciseMutationInFlight.current = true;
      const owner = currentWorkoutOwner.current;
      setBusy(true);
      setMessage(null);
      setExerciseSelectionMessage(null);
      const reportSelectionError = (text: string) => {
        setMessage(text);
        setExerciseSelectionMessage(text);
      };
      measurement.current?.tap();
      try {
        const entries = [...exerciseEntries];
        const savedExercises = [...workspace.exercises];
        for (const catalogEx of catalogExercises) {
          const knownNames = new Set(
            getCatalogExerciseNames(catalogEx).map((name) =>
              name.trim().toLowerCase(),
            ),
          );
          if (
            entries.some((entry) =>
              knownNames.has(entry.name.trim().toLowerCase()),
            )
          )
            continue;
          let targetExercise = findCatalogExerciseRecord(
            savedExercises,
            catalogEx,
          );
          if (
            !targetExercise &&
            savedExercises.some((exercise) =>
              knownNames.has(exercise.name.trim().toLowerCase()),
            )
          ) {
            reportSelectionError(
              "Multiple saved exercises match this movement. Select the existing exercise to keep its history.",
            );
            return false;
          }
          if (!targetExercise) {
            if (savedExercises.length >= 200) {
              reportSelectionError(
                "Your saved exercise list may be incomplete. Open the existing exercise before adding this movement.",
              );
              return false;
            }
            const created = await createExercise(
              catalogEx.name,
              catalogEx.instructions
                .map((step, index) => `${index + 1}. ${step}`)
                .join("\n"),
            );
            if (currentWorkoutOwner.current !== owner) return false;
            if (!created.ok) {
              reportSelectionError(created.message);
              return false;
            }
            targetExercise = created.exercise;
            savedExercises.push(created.exercise);
            setWorkspace((current) => ({
              ...current,
              exercises: [...current.exercises, created.exercise].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
            }));
          }
          const newEntry: ExerciseEntry = {
            id: targetExercise.id,
            name: targetExercise.name,
            catalogId: catalogEx.id,
            targetSets: 3,
            repsMin: isOneTimeWorkout ? null : 8,
            repsMax: isOneTimeWorkout ? null : 12,
            durationMinutes: null,
            restSeconds: globalRestSeconds,
            isPlanned: false,
          };
          entries.push(newEntry);
        }
        if (entries.length === exerciseEntries.length) return true;
        const result = await reorderWorkoutExercises(
          workspace.workout,
          entries,
        );
        if (currentWorkoutOwner.current !== owner) return false;
        if (!result.ok) {
          reportSelectionError(result.message);
          return false;
        }
        // A previous background read must not replace this confirmed list.
        refreshCounter.current++;
        setWorkspace((current) => ({ ...current, workout: result.workout }));
        return true;
      } catch {
        if (currentWorkoutOwner.current === owner)
          reportSelectionError(
            "Could not add these exercises. Select them again to retry.",
          );
        return false;
      } finally {
        exerciseMutationInFlight.current = false;
        setBusy(false);
      }
    },
    [
      busy,
      exerciseEntries,
      globalRestSeconds,
      isOneTimeWorkout,
      workspace.exercises,
      workspace.workout,
    ],
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
    async (
      entry: ExerciseEntry,
      watchInput?: Extract<CompanionCommand, { kind: "log-set" }>,
    ): Promise<CompanionOutcome> => {
      const attempt = measurement.current;
      if (
        workspace.workout === null ||
        workspace.workout.completedAt !== null ||
        busy ||
        exerciseMutationInFlight.current ||
        setSaveInFlight.current
      )
        return "rejected";
      const mutationOwner = currentWorkoutOwner.current;
      setSaveInFlight.current = true;
      attempt?.tap();

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
              return "rejected";
            }
          }
        }

        // Read current input values or fallback to smart defaults
        if (currentWorkoutOwner.current !== mutationOwner) return "rejected";
        const currentInput = watchInput
          ? {
              load: String(
                kilogramsToDisplayWeight(watchInput.loadKg, unitSystem),
              ),
              reps: String(watchInput.repetitions),
              durationSeconds: "",
              distanceMeters: "",
              rpe: "",
              setType:
                watchInput.setType === "working"
                  ? ("normal" as const)
                  : watchInput.setType,
            }
          : (pendingInputs[entry.id] ??
            pendingInputs[entry.name] ?? {
              load: "",
              reps: "",
              durationSeconds: "",
              distanceMeters: "",
              rpe: "",
            });

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
        const setTypeVal = pendingSetType(currentInput, entry, completedSets);
        const result = await addWorkoutSet(workspace.workout.id, {
          exerciseId: resolvedExerciseId,
          repetitions: repsVal,
          load: loadVal,
          durationSeconds: currentInput.durationSeconds,
          distanceMeters: currentInput.distanceMeters,
          perceivedExertion: currentInput.rpe,
          setType: setTypeVal,
          unitSystem,
          ...(watchInput
            ? {
                sequence:
                  Math.max(0, ...workspace.sets.map((set) => set.sequence)) + 1,
                completedAt: new Date(watchInput.createdAtMs).toISOString(),
                canonicalLoadKg: Math.round(watchInput.loadKg * 1000) / 1000,
              }
            : {}),
        });
        setBusy(false);
        if (currentWorkoutOwner.current !== mutationOwner) {
          if (!result.ok)
            attempt?.fail(
              "submit",
              classifyAnalyticsFailure(result.message),
              true,
            );
          return "uncertain";
        }

        if (!result.ok) {
          hadFailure.current = true;
          attempt?.fail(
            "submit",
            classifyAnalyticsFailure(result.message),
            true,
          );
          setMessage(result.message);
          return "uncertain";
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
        const nextExerciseIndex = isOneTimeWorkout
          ? exerciseEntries.findIndex(
              (exercise) => exercise.name === entry.name,
            )
          : selectNextExerciseIndexForNotification(
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
          !isOneTimeWorkout &&
          exerciseEntries.length > 0 &&
          nextExerciseIndex === null;
        const notificationGeneration = ++restNotificationGeneration.current;
        const restEndsAt = Date.now() + restDuration * 1000;
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
          if (
            notificationGeneration !== restNotificationGeneration.current ||
            currentWorkoutOwner.current !== mutationOwner
          ) {
            await cancelRestNotification(notificationId);
            return;
          }
          setRestTimer({
            endsAt: restEndsAt,
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
        const nextSetType: WorkoutSetType = plannedSetTypeForSequence(
          entry.setTypes,
          completedSets.length + 2,
          setTypeVal,
        );
        updatePendingInput(entry.id, {
          load: loadVal,
          reps: repsVal,
          setType: nextSetType,
          setTypeSequence: completedSets.length + 2,
        });
        if (resolvedExerciseId !== entry.id) {
          updatePendingInput(resolvedExerciseId, {
            load: loadVal,
            reps: repsVal,
            setType: nextSetType,
            setTypeSequence: completedSets.length + 2,
          });
        }

        // Silently reconcile with backend in the background without unmounting or resetting scroll
        void refresh();
        return "saved";
      } catch {
        setMessage("We couldn't save this set. Please try again.");
        return "uncertain";
      } finally {
        setBusy(false);
        setSaveInFlight.current = false;
      }
    },
    [
      busy,
      isOneTimeWorkout,
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
      if (workspace.workout === null || workspace.workout.completedAt !== null)
        return;
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
  const handleFinish = useCallback(
    async (
      watchCommand?: Extract<CompanionCommand, { kind: "finish" }>,
    ): Promise<CompanionOutcome> => {
      if (busy || exerciseMutationInFlight.current || setSaveInFlight.current)
        return "rejected";
      const attempt = measurement.current;
      if (workspace.workout === null || workspace.workout.completedAt !== null)
        return "rejected";
      if (isRoutineDetails(workspace.workout.details)) {
        setMessage(
          "Wait for the workout session to start before finishing it.",
        );
        return "rejected";
      }
      attempt?.tap();

      const totalSets = workspace.sets.length;
      const formattedDuration = formatStopwatch(elapsedSeconds);

      const progressions = isOneTimeWorkout
        ? []
        : computeWorkoutProgressions({
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

      const expectedOwner = `${userId}:${workspace.workout.id}`;
      const commitFinish = async (): Promise<CompanionOutcome> => {
        if (
          currentWorkoutOwner.current !== expectedOwner ||
          setSaveInFlight.current ||
          exerciseMutationInFlight.current
        )
          return "rejected";
        const mutationOwner = currentWorkoutOwner.current;
        setSaveInFlight.current = true;
        try {
          restNotificationGeneration.current += 1;
          if (restTimer?.notificationId) {
            await cancelRestNotification(restTimer.notificationId);
          }
          setRestTimer(null);
          clearContextRestTimer?.();
          setContextActiveWorkout?.(null);
          setBusy(true);

          if (autoAdvanceTargetWeights && progressedItems.length > 0) {
            await applyCompletedWorkoutProgressions(
              workspace.workout!,
              workspace.sets,
              workspace.exercises,
            );
          }

          if (currentWorkoutOwner.current !== mutationOwner) return "rejected";
          const result = watchCommand
            ? await completeWorkout(
                workspace.workout!.id,
                workspace.workout!.startedAt,
                new Date(watchCommand.createdAtMs).toISOString(),
              )
            : await completeWorkout(
                workspace.workout!.id,
                workspace.workout!.startedAt,
              );
          setBusy(false);
          if (!result.ok) {
            hadFailure.current = true;
            attempt?.fail(
              "submit",
              classifyAnalyticsFailure(result.message),
              true,
            );
            setMessage(result.message);
            return "uncertain";
          }
          if (currentWorkoutOwner.current !== mutationOwner) return "uncertain";
          refreshCounter.current++;
          setWorkspace((current) => ({
            ...current,
            workout: result.workout,
          }));
          void dismissActiveWorkoutNotification();
          attempt?.complete();
          if (userId !== null) await clearLoggingDraft(userId, "workout");
          if (community.isEnrolled && !watchCommand) {
            Alert.alert(
              "Workout saved privately",
              "Sharing is optional. Review a separate card before publishing.",
              [
                {
                  text: "Keep private",
                  style: "cancel",
                  onPress: () => router.back(),
                },
                {
                  text: "Review sharing",
                  onPress: () => setCompletedShareId(workspace.workout!.id),
                },
              ],
            );
          } else if (!watchCommand) router.back();

          return "saved";
        } catch {
          setMessage("Check your saved workout before trying again.");
          return "uncertain";
        } finally {
          setBusy(false);
          setSaveInFlight.current = false;
        }
      };
      if (watchCommand) return commitFinish();

      Alert.alert(
        "Finish Workout?",
        `Completed in ${formattedDuration} with ${totalSets} saved sets.${progressionSummary}`,
        [
          { text: "Keep Logging", style: "cancel" },
          {
            text: "Finish & Save",
            onPress: () => {
              void commitFinish();
            },
          },
        ],
      );
      return "rejected";
    },
    [
      community.isEnrolled,
      busy,
      isOneTimeWorkout,
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
    ],
  );

  const skipCompanionRest = useCallback(async (): Promise<CompanionOutcome> => {
    if (
      !restTimer ||
      busy ||
      setSaveInFlight.current ||
      exerciseMutationInFlight.current
    )
      return "rejected";
    restNotificationGeneration.current++;
    setRestTimer(null);
    clearContextRestTimer?.();
    if (restTimer.notificationId)
      await cancelRestNotification(restTimer.notificationId);
    return "saved";
  }, [restTimer, busy, clearContextRestTimer]);

  const companionView = useMemo<CompanionWorkoutView | null>(() => {
    const workout = workspace.workout;
    if (!workout || isRoutineDetails(workout.details)) return null;
    const entry = exerciseEntries.find(
      (item) => item.name === activeSessionSummary?.currentExerciseName,
    );
    const sets = entry
      ? completedSetsForNotificationEntry(
          entry,
          workspace.exercises,
          workspace.sets,
        )
      : [];
    const last = sets.at(-1);
    const input = entry
      ? (pendingInputs[entry.id] ?? pendingInputs[entry.name])
      : undefined;
    const inputLoad = input?.load.trim() ? Number(input.load) : null;
    const targetDisplay = entry?.targetLoad
      ? parseTargetLoadToDisplay(entry.targetLoad, unitSystem)
      : null;
    const loadKg =
      inputLoad !== null && Number.isFinite(inputLoad)
        ? displayWeightToKilograms(inputLoad, unitSystem)
        : (last?.loadKg ??
          (targetDisplay !== null
            ? displayWeightToKilograms(Number(targetDisplay), unitSystem)
            : null));
    const inputReps = input?.reps.trim() ? Number(input.reps) : null;
    const reps =
      inputReps !== null && Number.isFinite(inputReps)
        ? inputReps
        : (last?.repetitions ?? entry?.repsMax ?? entry?.repsMin ?? null);
    const setType = entry ? pendingSetType(input, entry, sets) : "normal";
    return {
      workoutId: workout.id,
      status: workout.completedAt ? "completed" : "active",
      exercise:
        entry && !workout.completedAt
          ? {
              exerciseId: entry.id,
              name: entry.name.slice(0, 120),
              completedSets: sets.length,
              targetSets: entry.targetSets || 3,
              repetitions:
                reps !== null &&
                Number.isInteger(reps) &&
                reps >= 0 &&
                reps <= 1000
                  ? reps
                  : null,
              loadKg:
                loadKg !== null && loadKg >= 0 && loadKg <= 2000
                  ? Math.round(loadKg * 1000) / 1000
                  : null,
              setType: setType === "normal" ? "working" : setType,
              loadUnit: unitSystem === "imperial" ? "lb" : "kg",
            }
          : null,
      restEndsAtMs: workout.completedAt ? null : (restTimer?.endsAt ?? null),
      restDurationSeconds: workout.completedAt
        ? null
        : (restTimer?.total ?? null),
      canLogSet:
        !workout.completedAt &&
        !busy &&
        Boolean(entry && entry.durationMinutes === null),
      canFinish: !workout.completedAt && !busy,
    };
  }, [
    workspace,
    exerciseEntries,
    activeSessionSummary?.currentExerciseName,
    pendingInputs,
    unitSystem,
    restTimer,
    busy,
  ]);

  const executeCompanionCommand = useCallback(
    async (command: CompanionCommand): Promise<CompanionOutcome> => {
      if (
        !workspace.workout ||
        command.workoutId !== workspace.workout.id ||
        workspace.workout.completedAt ||
        busy ||
        currentWorkoutOwner.current !== `${userId}:${command.workoutId}`
      )
        return "rejected";
      if (command.kind === "finish") return handleFinish(command);
      if (command.kind === "skip-rest") return skipCompanionRest();
      const entry = exerciseEntries.find(
        (item) => item.id === command.exerciseId,
      );
      if (!entry || entry.durationMinutes !== null) return "rejected";
      return handleLogSet(entry, command);
    },
    [
      workspace.workout,
      busy,
      userId,
      exerciseEntries,
      handleFinish,
      skipCompanionRest,
      handleLogSet,
    ],
  );

  // Confirm abandon
  const confirmAbandon = useCallback(() => {
    if (busy || exerciseMutationInFlight.current || setSaveInFlight.current)
      return;
    const attempt = measurement.current;
    if (workspace.workout === null || workspace.workout.completedAt !== null)
      return;
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
          setBusy(true);
          void (async () => {
            try {
              restNotificationGeneration.current += 1;
              if (restTimer?.notificationId) {
                await cancelRestNotification(restTimer.notificationId);
              }
              setRestTimer(null);
              clearContextRestTimer?.();
              setContextActiveWorkout?.(null);
              const result = await abandonWorkout(workspace.workout!.id);
              if (!result.ok) return setMessage(result.message);
              attempt?.exit("cancel");
              void dismissActiveWorkoutNotification();
              if (userId !== null) await clearLoggingDraft(userId, "workout");
              router.back();
            } catch {
              setMessage("Unable to discard this session. Please try again.");
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }, [
    busy,
    clearContextRestTimer,
    restTimer?.notificationId,
    setContextActiveWorkout,
    userId,
    workspace.workout,
  ]);

  const finishHeaderButton =
    workspace.workout !== null ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isCompletedWorkout ? "Close workout" : "Finish Workout"
        }
        accessibilityHint={
          isCompletedWorkout
            ? "Return to workout history."
            : "Review and save this workout."
        }
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={
          isCompletedWorkout ? () => router.back() : () => void handleFinish()
        }
        style={({ pressed }) => [
          styles.headerFinishButton,
          pressed && styles.headerFinishButtonPressed,
          busy && styles.actionDisabled,
        ]}
      >
        <ThemedText type="smallBold" style={styles.headerFinishText}>
          {isCompletedWorkout ? "Close" : "Finish"}
        </ThemedText>
      </Pressable>
    ) : null;

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen
        options={{
          title:
            workspace.workout?.name || (workoutId ? "Workout" : "Live Workout"),
          headerLeft: () =>
            isCompletedWorkout ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isActiveSession ? "Minimize workout" : "Close workout"
                }
                onPress={() => router.back()}
                style={styles.headerMinimizeButton}
              >
                <ThemedText type="smallBold" style={styles.headerMinimizeText}>
                  ✕
                </ThemedText>
              </Pressable>
            ),
          headerRight: () => finishHeaderButton,
          // iOS otherwise adds a second glass capsule around the green button.
          unstable_headerRightItems:
            Platform.OS === "ios"
              ? () =>
                  finishHeaderButton
                    ? [
                        {
                          type: "custom",
                          element: finishHeaderButton,
                          hidesSharedBackground: true,
                        },
                      ]
                    : []
              : undefined,
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
              isActiveSession &&
                restTimer !== null &&
                styles.contentWithRestTimer,
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
              workoutId ? (
                <View style={styles.center}>
                  <ThemedText type="small" themeColor="textSecondary">
                    This workout could not be loaded. Try again or close this
                    view.
                  </ThemedText>
                  <Button label="Close" onPress={() => router.back()} />
                  {message === null ? (
                    <Button label="Retry" onPress={() => void refresh()} />
                  ) : null}
                </View>
              ) : (
                <StartSection
                  draft={draft}
                  inputColor={theme.text}
                  busy={busy}
                  onPatch={patchDraft}
                  onStart={onStart}
                  onInteraction={() => measurement.current?.tap()}
                />
              )
            ) : isCompletedWorkout ? (
              <CompletedWorkoutFeed
                workout={workspace.workout}
                exercises={exerciseEntries}
                allExercises={workspace.exercises}
                savedSets={workspace.sets}
                unitSystem={unitSystem}
                onOpenHistory={setProgressionExerciseName}
              />
            ) : (
              <ActiveWorkoutFeed
                oneTime={isOneTimeWorkout}
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
                onOpenSetTypeModal={(entry) => setSelectedSetTypeEntry(entry)}
                onOpenLibrary={() => {
                  setExerciseSelectionMessage(null);
                  setLibraryVisible(true);
                }}
                onMoveExercise={handleMoveExercise}
                onOpenReorderModal={() => setReorderModalVisible(true)}
                onAbandon={confirmAbandon}
                onInteraction={() => measurement.current?.tap()}
              />
            )}

            {userId && companionView ? (
              <WatchWorkoutControls
                key={`${userId}:${companionView.workoutId}`}
                ownerId={userId}
                view={companionView}
                execute={executeCompanionCommand}
              />
            ) : null}

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
      {isActiveSession && restTimer !== null ? (
        <FloatingRestTimer
          rest={restTimer}
          current={activeSessionSummary}
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

      {completedShareId && (
        <ShareWorkoutModal
          key={`${session?.user.id}:${completedShareId}`}
          visible
          workoutId={completedShareId}
          onDismiss={() => {
            setCompletedShareId(null);
            router.back();
          }}
        />
      )}
      {/* Exercise Library Modal to Add Exercises */}
      {isActiveSession && libraryVisible ? (
        <ExerciseLibraryModal
          visible={libraryVisible}
          onClose={() => setLibraryVisible(false)}
          onSelectExercises={handleSelectCatalogExercise}
          errorMessage={exerciseSelectionMessage}
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

      {/* Set Type Modal */}
      {isActiveSession && selectedSetTypeEntry !== null ? (
        <SetTypeModal
          visible={selectedSetTypeEntry !== null}
          currentType={(() => {
            const resolved = workspace.exercises.find(
              (exercise) =>
                exercise.id === selectedSetTypeEntry.id ||
                exercise.name.trim().toLowerCase() ===
                  selectedSetTypeEntry.name.trim().toLowerCase(),
            );
            const completed = workspace.sets
              .filter(
                (set) =>
                  set.exerciseId === (resolved?.id ?? selectedSetTypeEntry.id),
              )
              .sort((a, b) => a.sequence - b.sequence);
            return pendingSetType(
              pendingInputs[selectedSetTypeEntry.id] ??
                pendingInputs[selectedSetTypeEntry.name],
              selectedSetTypeEntry,
              completed,
            );
          })()}
          exerciseName={selectedSetTypeEntry.name}
          onSelectType={(newType) => {
            const resolved = workspace.exercises.find(
              (exercise) =>
                exercise.id === selectedSetTypeEntry.id ||
                exercise.name.trim().toLowerCase() ===
                  selectedSetTypeEntry.name.trim().toLowerCase(),
            );
            const setTypeSequence =
              workspace.sets.filter(
                (set) =>
                  set.exerciseId === (resolved?.id ?? selectedSetTypeEntry.id),
              ).length + 1;
            updatePendingInput(selectedSetTypeEntry.id, {
              setType: newType,
              setTypeSequence,
            });
            if (selectedSetTypeEntry.id !== selectedSetTypeEntry.name) {
              updatePendingInput(selectedSetTypeEntry.name, {
                setType: newType,
                setTypeSequence,
              });
            }
            setSelectedSetTypeEntry(null);
          }}
          onClose={() => setSelectedSetTypeEntry(null)}
        />
      ) : null}

      {/* Reorder Exercises Modal */}
      {isActiveSession && reorderModalVisible ? (
        <ReorderExercisesModal
          visible={reorderModalVisible}
          exercises={exerciseEntries}
          onMoveExercise={handleMoveExercise}
          onClose={() => setReorderModalVisible(false)}
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
  readonly oneTime: boolean;
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
  readonly onOpenSetTypeModal: (entry: ExerciseEntry) => void;
  readonly onOpenLibrary: () => void;
  readonly onMoveExercise: (fromIndex: number, toIndex: number) => void;
  readonly onOpenReorderModal: () => void;
  readonly onAbandon: () => void;
  readonly onInteraction: () => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const actionColor = scheme === "light" ? "#047857" : "#34D399";
  const discardColor = scheme === "light" ? "#B91C1C" : "#F87171";
  const unit = weightUnitLabel(props.unitSystem);
  const totalSets = props.savedSets.length;
  const totalVolumeKg = useMemo(() => {
    return props.savedSets.reduce((acc, s) => {
      if (
        s.setType !== "warmup" &&
        s.loadKg !== null &&
        s.repetitions !== null
      ) {
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
          <View style={styles.liveHeaderRight}>
            <ThemedText type="small" themeColor="textSecondary">
              {totalSets} sets · {displayVolume} {unit} volume
            </ThemedText>
          </View>
        </View>
      </View>

      {/* Exercise Cards */}
      {props.exercises.length === 0 ? (
        <View style={styles.emptyExercisesCard}>
          <ThemedText type="smallBold" style={styles.emptyExercisesText}>
            No exercises in this workout yet.
          </ThemedText>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.emptyExercisesText}
          >
            Add an exercise, then log each set as you go.
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
              oneTime={props.oneTime}
              entry={entry}
              index={index}
              totalExercises={props.exercises.length}
              completedSets={completedSets}
              recentPerformance={recentPerf}
              pendingInput={{
                ...(props.pendingInputs[entry.id] ??
                  props.pendingInputs[entry.name] ?? {
                    load: "",
                    reps: "",
                    durationSeconds: "",
                    distanceMeters: "",
                    rpe: "",
                  }),
                setType: pendingSetType(
                  props.pendingInputs[entry.id] ??
                    props.pendingInputs[entry.name],
                  entry,
                  completedSets,
                ),
              }}
              unitSystem={props.unitSystem}
              inputColor={props.inputColor}
              busy={props.busy}
              onUpdatePendingInput={(patch) =>
                props.onUpdatePendingInput(entry.id, patch)
              }
              onLogSet={() => props.onLogSet(entry)}
              onRemoveSet={props.onRemoveSet}
              onOpenProgression={() => props.onOpenProgression(entry.name)}
              onOpenSetTypeModal={() => props.onOpenSetTypeModal(entry)}
              onMoveUp={() => props.onMoveExercise(index, index - 1)}
              onMoveDown={() => props.onMoveExercise(index, index + 1)}
              onInteraction={props.onInteraction}
            />
          );
        })
      )}

      {/* Session editing is separate from the destructive action. */}
      <View style={styles.bottomControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add Exercise to Workout"
          accessibilityHint="Open the exercise library."
          accessibilityState={{ disabled: props.busy }}
          disabled={props.busy}
          onPress={() => {
            if (props.busy) return;
            props.onInteraction();
            props.onOpenLibrary();
          }}
          style={({ pressed }) => [
            styles.addExerciseButton,
            { backgroundColor: theme.primaryLight, borderColor: actionColor },
            pressed && styles.actionPressed,
            props.busy && styles.actionDisabled,
          ]}
        >
          <ThemedText
            type="smallBold"
            style={[styles.actionText, { color: actionColor }]}
          >
            + Add Exercise
          </ThemedText>
        </Pressable>
        {props.exercises.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reorder exercises"
            accessibilityState={{ disabled: props.busy }}
            disabled={props.busy}
            onPress={() => {
              if (props.busy) return;
              props.onInteraction();
              props.onOpenReorderModal();
            }}
            style={({ pressed }) => [
              styles.reorderAllButton,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
              pressed && styles.actionPressed,
              props.busy && styles.actionDisabled,
            ]}
          >
            <ThemedText type="smallBold" style={styles.actionText}>
              ⇅ Reorder
            </ThemedText>
          </Pressable>
        ) : null}
        <View style={[styles.discardSection, { borderColor: theme.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard Session"
            accessibilityHint="Confirm deletion of this session and its logged sets."
            accessibilityState={{ disabled: props.busy }}
            disabled={props.busy}
            onPress={props.onAbandon}
            style={({ pressed }) => [
              styles.discardButton,
              pressed && styles.actionPressed,
              props.busy && styles.actionDisabled,
            ]}
          >
            <ThemedText
              type="smallBold"
              style={[styles.actionText, { color: discardColor }]}
            >
              Discard Session
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function renderSetBadge(setType: WorkoutSetType | undefined, sequence: number) {
  if (setType === "warmup") {
    return (
      <View style={[styles.badgeBase, styles.warmupBadge]}>
        <ThemedText style={styles.warmupBadgeText}>W</ThemedText>
      </View>
    );
  }
  if (setType === "failure") {
    return (
      <View style={[styles.badgeBase, styles.failureBadge]}>
        <ThemedText style={styles.failureBadgeText}>F</ThemedText>
      </View>
    );
  }
  if (setType === "drop") {
    return (
      <View style={[styles.badgeBase, styles.dropBadge]}>
        <ThemedText style={styles.dropBadgeText}>D</ThemedText>
      </View>
    );
  }
  return (
    <ThemedText type="smallBold" style={styles.colSet}>
      {sequence}
    </ThemedText>
  );
}

// ==========================================
// Individual Exercise Card with Inline Set Table
// ==========================================
function LiveExerciseCard(props: {
  readonly oneTime: boolean;
  readonly entry: ExerciseEntry;
  readonly index: number;
  readonly totalExercises: number;
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
  readonly onOpenSetTypeModal: () => void;
  readonly onMoveUp?: () => void;
  readonly onMoveDown?: () => void;
  readonly onInteraction: () => void;
}) {
  const theme = useTheme();
  const unit = weightUnitLabel(props.unitSystem);
  const nextSetSequence = props.completedSets.length + 1;
  const pendingType = props.pendingInput.setType ?? "normal";
  const pendingTypeLabel = pendingType[0]!.toUpperCase() + pendingType.slice(1);

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
          : props.oneTime
            ? "—"
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
            {props.oneTime ? (
              `${props.completedSets.length} sets logged · ${props.entry.restSeconds}s rest`
            ) : (
              <>
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
              </>
            )}
          </ThemedText>
        </View>

        <View style={styles.exerciseHeaderRight}>
          {props.totalExercises > 1 ? (
            <View style={styles.cardReorderButtons}>
              {props.index > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${props.entry.name} up`}
                  onPress={() => {
                    props.onInteraction();
                    props.onMoveUp?.();
                  }}
                  style={styles.cardReorderBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                >
                  <ThemedText style={styles.cardReorderBtnText}>↑</ThemedText>
                </Pressable>
              ) : null}
              {props.index < props.totalExercises - 1 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${props.entry.name} down`}
                  onPress={() => {
                    props.onInteraction();
                    props.onMoveDown?.();
                  }}
                  style={styles.cardReorderBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                >
                  <ThemedText style={styles.cardReorderBtnText}>↓</ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View progression for ${props.entry.name}`}
            onPress={props.onOpenProgression}
            style={styles.progressionBadge}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ThemedText type="smallBold" style={styles.progressionBadgeText}>
              📈 History →
            </ThemedText>
          </Pressable>
        </View>
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
              <View style={styles.colSetWrapper}>
                {renderSetBadge(set.setType, i + 1)}
              </View>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.colPrev}
              >
                {loadStr} {unit} × {repsStr}
              </ThemedText>
              <ThemedText
                type="smallBold"
                style={[styles.colInputDone, { color: theme.text }]}
              >
                {loadStr}
              </ThemedText>
              <ThemedText
                type="smallBold"
                style={[styles.colInputDone, { color: theme.text }]}
              >
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Set ${nextSetSequence} type: ${props.pendingInput.setType ?? "normal"}. Tap to change set type.`}
            accessibilityState={{ disabled: props.busy }}
            disabled={props.busy}
            hitSlop={{ top: 0, bottom: 0, left: 8, right: 8 }}
            onPress={props.onOpenSetTypeModal}
            style={styles.colSetPressable}
          >
            {renderSetBadge(props.pendingInput.setType, nextSetSequence)}
          </Pressable>

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

      <Pressable
        testID="pending-set-type-control"
        accessibilityRole="button"
        accessibilityLabel={`Set ${nextSetSequence} type: ${pendingTypeLabel}`}
        accessibilityHint="Opens Normal, Warmup, Failure and Drop choices for the unfinished set."
        accessibilityState={{ disabled: props.busy }}
        disabled={props.busy}
        onPress={props.onOpenSetTypeModal}
        style={({ pressed }) => [
          styles.pendingSetTypeControl,
          {
            borderColor: theme.border,
            backgroundColor: theme.backgroundElement,
          },
          (pressed || props.busy) && { opacity: 0.6 },
        ]}
      >
        <View style={styles.pendingSetTypeLabel}>
          <ThemedText type="small" themeColor="textSecondary">
            Set {nextSetSequence} type
          </ThemedText>
          <ThemedText type="smallBold">{pendingTypeLabel}</ThemedText>
        </View>
        <ThemedText
          style={styles.pendingSetTypeChevron}
          accessible={false}
          importantForAccessibility="no"
        >
          ▾
        </ThemedText>
      </Pressable>

      {/* Log Set Footer */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Log set ${nextSetSequence} for ${props.entry.name}`}
        disabled={props.busy}
        onPress={props.onLogSet}
        style={styles.logSetFooterRow}
      >
        <ThemedText type="smallBold" style={styles.logSetFooterText}>
          ✓ Log Set {nextSetSequence}
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
  readonly current: CurrentWorkoutNextAction | null;
  readonly onAdjust: (delta: number) => void;
  readonly onSkip: () => void;
}) {
  const showNextAction = Platform.OS === "ios";
  const nextAction = showNextAction
    ? restTimerNextAction(props.rest, props.current)
    : null;
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
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={nextAction ? 2 : 1}
          >
            ⏱ {nextAction?.title ?? `Rest (${props.rest.exerciseName})`}
          </ThemedText>
          {nextAction?.detail ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={1}
            >
              {nextAction.detail}
            </ThemedText>
          ) : null}
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
    backgroundColor: "#047857",
    minHeight: 44,
    minWidth: 80,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  headerFinishButtonPressed: {
    backgroundColor: "#065F46",
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
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.two,
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
  liveHeaderRight: {
    maxWidth: "100%",
  },
  emptyExercisesCard: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
    gap: Spacing.two,
  },
  emptyExercisesText: { textAlign: "center" },
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
  exerciseHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardReorderButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cardReorderBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  cardReorderBtnText: {
    fontSize: 13,
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
    textAlign: "center",
  },
  colSetWrapper: {
    width: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  colSetPressable: {
    width: 36,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeBase: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  warmupBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderColor: "#F59E0B",
  },
  warmupBadgeText: {
    color: "#F59E0B",
    fontSize: 12,
    fontWeight: "700",
  },
  failureBadge: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderColor: "#EF4444",
  },
  failureBadgeText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "700",
  },
  dropBadge: {
    backgroundColor: "rgba(139, 92, 246, 0.15)",
    borderColor: "#8B5CF6",
  },
  dropBadgeText: {
    color: "#8B5CF6",
    fontSize: 12,
    fontWeight: "700",
  },
  colPrev: {
    flex: 1,
    paddingRight: Spacing.one,
    fontSize: 12,
  },
  colInputDone: {
    width: 64,
    textAlign: "center",
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
  logSetFooterRow: {
    paddingVertical: Spacing.two,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Spacing.two,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  pendingSetTypeControl: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  pendingSetTypeLabel: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  pendingSetTypeChevron: {
    flexShrink: 0,
  },
  logSetFooterText: {
    color: "#10B981",
    fontSize: 14,
    fontWeight: "700",
  },
  bottomControls: {
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  addExerciseButton: {
    width: "100%",
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
    flexShrink: 1,
  },
  actionPressed: { opacity: 0.75 },
  actionDisabled: { opacity: 0.5 },
  reorderAllButton: {
    alignSelf: "center",
    maxWidth: "100%",
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
  },
  discardSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  discardButton: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Spacing.two,
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
