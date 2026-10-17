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
  formatTrackedDuration,
  getCatalogTrackingMode,
  type CatalogExercise,
  type ExerciseTrackingMode,
  type TrackedDistanceUnit,
} from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { classifyAnalyticsFailure } from "@/features/analytics/classify-failure";
import {
  BottomTabInset,
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconButton,
} from "@/components/ui";
import { ShareWorkoutModal, useCommunityProfile } from "@/features/community";
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
import { PlateCalculatorModal } from "@/features/workouts/plate-calculator-modal";
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
import {
  buildTimedSetFields,
  distanceUnitName,
  entryDistanceUnit,
  entryTrackingMode,
  formatTimedSet,
  isTimedTrackingMode,
  metersToDisplayDistance,
} from "./timed-set-input";
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
  /** Inline validation message for the timed inputs (#278). */
  timeError?: string;
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
  return plannedSetTypeForSequence(entry.setTypes, sequence);
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
  const [plateCalculatorVisible, setPlateCalculatorVisible] = useState(false);
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
      {
        ...currentEntry,
        timed: isTimedTrackingMode(
          entryTrackingMode(currentEntry, workspace.exercises),
        ),
      },
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
              {
                catalogId: catalogEx.id,
                trackingMode: getCatalogTrackingMode(catalogEx),
              },
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
      const trackingMode = entryTrackingMode(entry, workspace.exercises);
      const timed = isTimedTrackingMode(trackingMode);
      let timedFields: Extract<
        ReturnType<typeof buildTimedSetFields>,
        { ok: true }
      > | null = null;
      if (timed) {
        // The watch companion cannot supply a time or distance.
        if (watchInput) return "rejected";
        const pending =
          pendingInputs[entry.id] ?? pendingInputs[entry.name] ?? null;
        const fields = buildTimedSetFields(
          trackingMode,
          {
            durationSeconds: pending?.durationSeconds ?? "",
            distanceMeters: pending?.distanceMeters ?? "",
          },
          entryDistanceUnit(entry, workspace.exercises, unitSystem),
        );
        if (!fields.ok) {
          updatePendingInput(entry.id, { timeError: fields.message });
          return "rejected";
        }
        timedFields = fields;
      }
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

        if (timed) {
          // Time-based sets carry no load or reps, so skip those defaults.
        } else if (loadVal.length === 0) {
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

        if (timed) {
          loadVal = "";
          repsVal = "";
        } else if (repsVal.length === 0) {
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
          durationSeconds: timedFields
            ? timedFields.durationSeconds
            : currentInput.durationSeconds,
          distanceMeters: timedFields
            ? timedFields.distanceMeters
            : currentInput.distanceMeters,
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
              {
                ...nextExercise,
                timed: isTimedTrackingMode(
                  entryTrackingMode(nextExercise, workspace.exercises),
                ),
              },
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
        );
        const carriedInput = timed
          ? {
              durationSeconds: currentInput.durationSeconds,
              distanceMeters: currentInput.distanceMeters,
              timeError: "",
            }
          : { load: loadVal, reps: repsVal };
        updatePendingInput(entry.id, {
          ...carriedInput,
          setType: nextSetType,
          setTypeSequence: completedSets.length + 2,
        });
        if (resolvedExerciseId !== entry.id) {
          updatePendingInput(resolvedExerciseId, {
            ...carriedInput,
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
        Boolean(
          entry &&
          entry.durationMinutes === null &&
          !isTimedTrackingMode(entryTrackingMode(entry, workspace.exercises)),
        ),
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
      // Planned aerobic entries and time-based exercises need a time (and
      // distance) that the watch cannot send, so they are logged on the phone.
      if (
        !entry ||
        entry.durationMinutes !== null ||
        isTimedTrackingMode(entryTrackingMode(entry, workspace.exercises))
      )
        return "rejected";
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
      workspace.exercises,
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
      <Button
        label={isCompletedWorkout ? "Close" : "Finish"}
        variant={isCompletedWorkout ? "tinted" : "primary"}
        size="small"
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
        style={styles.headerFinishButton}
      />
    ) : null;

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen
        options={{
          title:
            workspace.workout?.name || (workoutId ? "Workout" : "Live Workout"),
          headerLeft: () =>
            isCompletedWorkout ? null : (
              <IconButton
                icon={isActiveSession ? "chevronDown" : "close"}
                variant="plain"
                accessibilityLabel={
                  isActiveSession ? "Minimize workout" : "Close workout"
                }
                onPress={() => router.back()}
              />
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
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.centerText}
                  >
                    This workout could not be loaded. Try again or close this
                    view.
                  </ThemedText>
                  <View style={styles.centerActions}>
                    {message === null ? (
                      <Button
                        label="Retry"
                        variant="tinted"
                        onPress={() => void refresh()}
                      />
                    ) : null}
                    <Button
                      label="Close"
                      variant="secondary"
                      onPress={() => router.back()}
                    />
                  </View>
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
                onOpenPlateCalculator={() => setPlateCalculatorVisible(true)}
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
              <View
                style={[styles.message, { backgroundColor: theme.dangerLight }]}
                accessibilityRole="alert"
              >
                <View style={styles.messageRow}>
                  <Icon name="warning" size={18} color="danger" />
                  <ThemedText type="small" style={styles.flexText}>
                    {message}
                  </ThemedText>
                </View>
                <Button
                  label="Retry"
                  variant="secondary"
                  size="small"
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

      {isActiveSession && plateCalculatorVisible ? (
        <PlateCalculatorModal
          // Remount with fresh plates if the unit system changes while open.
          key={unitSystem}
          visible={plateCalculatorVisible}
          unitSystem={unitSystem}
          exercises={exerciseEntries}
          onUseWeight={(exerciseId, load) =>
            updatePendingInput(exerciseId, { load })
          }
          onClose={() => setPlateCalculatorVisible(false)}
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
      <Card style={styles.formCard}>
        <Field
          testID="workout-name-input"
          label="Workout name"
          value={props.draft.name}
          onChangeText={(name) => props.onPatch({ name })}
          onFocus={props.onInteraction}
          placeholder="Upper Body A"
          inputColor={props.inputColor}
        />
        <Field
          testID="workout-notes-input"
          label="Notes (optional)"
          value={props.draft.notes}
          onChangeText={(notes) => props.onPatch({ notes })}
          onFocus={props.onInteraction}
          placeholder="Focus on controlled eccentrics"
          inputColor={props.inputColor}
        />
      </Card>
      {props.draft.workoutProposal !== undefined ? (
        <Card>
          <ThemedText type="headline">Coach workout proposal</ThemedText>
          {props.draft.workoutProposal.session.exercises.map((exercise) => (
            <View key={exercise.catalogId} style={styles.planExercise}>
              <ThemedText type="smallBold">{exercise.name}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {exercise.sets} sets ·{" "}
                {exercise.repsMin === null
                  ? `${exercise.durationMinutes} min`
                  : `${exercise.repsMin}–${exercise.repsMax} reps`}{" "}
                · {exercise.restSeconds}s rest
              </ThemedText>
            </View>
          ))}
        </Card>
      ) : null}
      <Button
        label={props.busy ? "Starting…" : "Start workout"}
        icon="dumbbell"
        block
        disabled={props.busy}
        onPress={props.onStart}
      />
    </View>
  );
}

// ==========================================
// Active Workout Feed
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
  readonly onOpenPlateCalculator: () => void;
  readonly onAbandon: () => void;
  readonly onInteraction: () => void;
}) {
  const theme = useTheme();
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
      {/* Live session summary */}
      <Card style={styles.liveHeader}>
        <View style={styles.liveStopwatchRow}>
          <View
            style={[styles.livePulseDot, { backgroundColor: theme.success }]}
          />
          <ThemedText type="subtitle" style={styles.tabularNumbers}>
            {formatStopwatch(props.elapsedSeconds)}
          </ThemedText>
        </View>
        <ThemedText type="footnote" themeColor="textSecondary">
          {totalSets} sets · {displayVolume} {unit} volume
        </ThemedText>
      </Card>

      {/* Exercise Cards */}
      {props.exercises.length === 0 ? (
        <Card>
          <EmptyState
            icon="dumbbell"
            title="No exercises yet"
            message="Add an exercise, then log each set as you go."
          />
        </Card>
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
              trackingMode={entryTrackingMode(entry, props.allExercises)}
              distanceUnit={entryDistanceUnit(
                entry,
                props.allExercises,
                props.unitSystem,
              )}
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
        <Button
          label="Add exercise"
          variant="tinted"
          icon="add"
          block
          accessibilityLabel="Add Exercise to Workout"
          accessibilityHint="Open the exercise library."
          accessibilityState={{ disabled: props.busy }}
          disabled={props.busy}
          onPress={() => {
            if (props.busy) return;
            props.onInteraction();
            props.onOpenLibrary();
          }}
        />
        {props.exercises.length > 1 ? (
          <Button
            label="Reorder exercises"
            variant="plain"
            icon="reorder"
            accessibilityLabel="Reorder exercises"
            accessibilityState={{ disabled: props.busy }}
            disabled={props.busy}
            onPress={() => {
              if (props.busy) return;
              props.onInteraction();
              props.onOpenReorderModal();
            }}
            style={styles.centeredAction}
          />
        ) : null}
        <Button
          label="Plate calculator"
          variant="plain"
          icon="dumbbell"
          accessibilityHint="Work out the plates to load on each side of the bar."
          onPress={() => {
            props.onInteraction();
            props.onOpenPlateCalculator();
          }}
          style={styles.centeredAction}
        />
        <Button
          label="Discard session"
          variant="destructive"
          icon="trash"
          block
          accessibilityLabel="Discard Session"
          accessibilityHint="Confirm deletion of this session and its logged sets."
          accessibilityState={{ disabled: props.busy }}
          disabled={props.busy}
          onPress={props.onAbandon}
          style={styles.discardButton}
        />
      </View>
    </View>
  );
}

const SET_TYPE_BADGES: Partial<
  Record<
    WorkoutSetType,
    { label: string; tone: "warning" | "danger" | "neutral" }
  >
> = {
  warmup: { label: "W", tone: "warning" },
  failure: { label: "F", tone: "danger" },
  drop: { label: "D", tone: "neutral" },
};

function renderSetBadge(setType: WorkoutSetType | undefined, sequence: number) {
  const badge = setType === undefined ? undefined : SET_TYPE_BADGES[setType];
  if (badge !== undefined) {
    return <Chip label={badge.label} tone={badge.tone} />;
  }
  return (
    <ThemedText
      type="smallBold"
      themeColor="textSecondary"
      style={styles.colSet}
    >
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
  readonly trackingMode: ExerciseTrackingMode;
  readonly distanceUnit: TrackedDistanceUnit;
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const unit = weightUnitLabel(props.unitSystem);
  const nextSetSequence = props.completedSets.length + 1;
  const pendingType = props.pendingInput.setType ?? "normal";
  const pendingTypeLabel = pendingType[0]!.toUpperCase() + pendingType.slice(1);
  const canMoveUp = props.totalExercises > 1 && props.index > 0;
  const canMoveDown =
    props.totalExercises > 1 && props.index < props.totalExercises - 1;

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

  const inputStyle = [
    styles.tableInput,
    { color: props.inputColor, backgroundColor: theme.backgroundSelected },
  ];

  const timed = isTimedTrackingMode(props.trackingMode);
  const showDistance = props.trackingMode === "duration_distance";
  const distanceUnit = props.distanceUnit;
  const previousTimedSet =
    previousSet !== null &&
    (previousSet.durationSeconds !== null ||
      previousSet.distanceMeters !== null)
      ? previousSet
      : null;
  const timePlaceholder =
    previousTimedSet?.durationSeconds != null
      ? formatTrackedDuration(previousTimedSet.durationSeconds)
      : props.trackingMode === "duration"
        ? "sec or m:ss"
        : "mm:ss";
  const distancePlaceholder =
    previousTimedSet?.distanceMeters != null
      ? String(
          metersToDisplayDistance(
            previousTimedSet.distanceMeters,
            distanceUnit,
          ),
        )
      : "0";
  const timeError = props.pendingInput.timeError || null;

  return (
    <Card style={styles.exerciseCard}>
      {/* Exercise Card Header */}
      <View style={styles.exerciseCardHeader}>
        <View style={styles.exerciseTitleBlock}>
          <ThemedText type="headline">{props.entry.name}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {props.oneTime ? (
              `${props.completedSets.length} sets logged · ${props.entry.restSeconds}s rest`
            ) : (
              <>
                Target: {props.entry.targetSets} sets ·{" "}
                {timed
                  ? props.entry.durationMinutes
                    ? `${props.entry.durationMinutes} min`
                    : "time"
                  : props.entry.repsMin === null
                    ? props.entry.durationMinutes
                      ? `${props.entry.durationMinutes} min`
                      : "reps"
                    : `${props.entry.repsMin}–${props.entry.repsMax} reps`}
                {targetLoadDisplay !== null && !timed
                  ? ` · ${targetLoadDisplay} ${unit}`
                  : ""}{" "}
                · {props.entry.restSeconds}s rest
              </>
            )}
          </ThemedText>
        </View>
        <IconButton
          icon="more"
          testID={`exercise-actions-${props.entry.id}`}
          accessibilityLabel={`More actions for ${props.entry.name}`}
          accessibilityState={{ expanded: actionsOpen }}
          onPress={() => setActionsOpen((open) => !open)}
          style={styles.moreButton}
        />
      </View>

      {actionsOpen ? (
        <View style={styles.exerciseActions}>
          <Button
            label="History"
            variant="secondary"
            size="small"
            icon="chart"
            accessibilityLabel={`View progression for ${props.entry.name}`}
            onPress={() => {
              setActionsOpen(false);
              props.onOpenProgression();
            }}
          />
          {canMoveUp ? (
            <Button
              label="Move up"
              variant="secondary"
              size="small"
              icon="chevronUp"
              accessibilityLabel={`Move ${props.entry.name} up`}
              onPress={() => {
                props.onInteraction();
                props.onMoveUp?.();
              }}
            />
          ) : null}
          {canMoveDown ? (
            <Button
              label="Move down"
              variant="secondary"
              size="small"
              icon="chevronDown"
              accessibilityLabel={`Move ${props.entry.name} down`}
              onPress={() => {
                props.onInteraction();
                props.onMoveDown?.();
              }}
            />
          ) : null}
        </View>
      ) : null}

      {/* Set Table */}
      <View style={styles.setTable}>
        {/* Table Header */}
        <View style={styles.setTableHeaderRow}>
          <ThemedText
            type="caption"
            themeColor="textTertiary"
            style={styles.colSetHeader}
          >
            Set
          </ThemedText>
          <ThemedText
            type="caption"
            themeColor="textTertiary"
            style={styles.colPrev}
          >
            Previous
          </ThemedText>
          <ThemedText
            type="caption"
            themeColor="textTertiary"
            style={styles.colInputHeader}
          >
            {timed ? "Time" : unit}
          </ThemedText>
          {timed && !showDistance ? null : (
            <ThemedText
              type="caption"
              themeColor="textTertiary"
              style={styles.colInputHeader}
            >
              {timed ? `Dist (${distanceUnit})` : "Reps"}
            </ThemedText>
          )}
          <View style={styles.colCheckHeader}>
            <Icon name="check" size={13} color="textTertiary" />
          </View>
        </View>

        {/* Completed Sets */}
        {props.completedSets.map((set, i) => {
          const loadStr =
            set.loadKg !== null
              ? kilogramsToDisplayWeight(set.loadKg, props.unitSystem)
              : "—";
          const repsStr = set.repetitions !== null ? `${set.repetitions}` : "—";

          return (
            <View
              key={set.id}
              style={[styles.setRow, { backgroundColor: theme.successLight }]}
            >
              <View style={styles.colSetWrapper}>
                {renderSetBadge(set.setType, i + 1)}
              </View>
              <ThemedText
                type="footnote"
                themeColor="textSecondary"
                style={styles.colPrev}
              >
                {timed
                  ? formatTimedSet(set, distanceUnit)
                  : `${loadStr} ${unit} × ${repsStr}`}
              </ThemedText>
              <ThemedText
                type="headline"
                style={[styles.colInputDone, { color: theme.text }]}
              >
                {timed
                  ? set.durationSeconds !== null
                    ? formatTrackedDuration(set.durationSeconds)
                    : set.distanceMeters === null && set.repetitions !== null
                      ? `${set.repetitions} reps`
                      : "—"
                  : loadStr}
              </ThemedText>
              {timed && !showDistance ? null : (
                <ThemedText
                  type="headline"
                  style={[styles.colInputDone, { color: theme.text }]}
                >
                  {timed
                    ? set.distanceMeters !== null
                      ? String(
                          metersToDisplayDistance(
                            set.distanceMeters,
                            distanceUnit,
                          ),
                        )
                      : "—"
                    : repsStr}
                </ThemedText>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete completed set ${i + 1}`}
                onPress={() => props.onRemoveSet(set)}
                style={({ pressed }) => [
                  styles.checkCell,
                  pressed && styles.actionPressed,
                ]}
              >
                <View
                  style={[
                    styles.checkCircle,
                    { backgroundColor: theme.success },
                  ]}
                >
                  <Icon name="check" size={15} tintColor={theme.onPrimary} />
                </View>
              </Pressable>
            </View>
          );
        })}

        {/* Active / Pending Set Row */}
        <View style={styles.setRow}>
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
            type="footnote"
            themeColor="textSecondary"
            style={styles.colPrev}
            numberOfLines={1}
          >
            {timed
              ? previousSet !== null
                ? formatTimedSet(previousSet, distanceUnit)
                : "First set"
              : previousSet !== null && smartPlaceholderLoad !== "—"
                ? `${smartPlaceholderLoad} ${unit} × ${smartPlaceholderReps}`
                : targetLoadDisplay !== null
                  ? `Target: ${targetLoadDisplay} ${unit}`
                  : smartPlaceholderLoad !== "—"
                    ? `${smartPlaceholderLoad} ${unit} × ${smartPlaceholderReps}`
                    : "First set"}
          </ThemedText>

          {timed ? (
            <>
              <View style={styles.colInputCell}>
                <TextInput
                  testID={`set-duration-input-${props.entry.id}`}
                  accessibilityLabel={`Time for set ${nextSetSequence} of ${props.entry.name}, minutes and seconds`}
                  value={props.pendingInput.durationSeconds}
                  onChangeText={(durationSeconds) =>
                    props.onUpdatePendingInput({
                      durationSeconds,
                      timeError: "",
                    })
                  }
                  onFocus={props.onInteraction}
                  placeholder={timePlaceholder}
                  placeholderTextColor={theme.textTertiary}
                  keyboardType={
                    Platform.OS === "ios"
                      ? "numbers-and-punctuation"
                      : "default"
                  }
                  style={inputStyle}
                />
              </View>
              {showDistance ? (
                <View style={styles.colInputCell}>
                  <TextInput
                    testID={`set-distance-input-${props.entry.id}`}
                    accessibilityLabel={`Distance in ${distanceUnitName(distanceUnit)} for set ${nextSetSequence} of ${props.entry.name}, optional`}
                    value={props.pendingInput.distanceMeters}
                    onChangeText={(distanceMeters) =>
                      props.onUpdatePendingInput({
                        distanceMeters,
                        timeError: "",
                      })
                    }
                    onFocus={props.onInteraction}
                    placeholder={distancePlaceholder}
                    placeholderTextColor={theme.textTertiary}
                    keyboardType="decimal-pad"
                    style={inputStyle}
                  />
                </View>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.colInputCell}>
                <TextInput
                  testID={`set-load-input-${props.entry.id}`}
                  value={props.pendingInput.load}
                  onChangeText={(load) => props.onUpdatePendingInput({ load })}
                  onFocus={props.onInteraction}
                  placeholder={
                    smartPlaceholderLoad !== "—" ? smartPlaceholderLoad : "0"
                  }
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="decimal-pad"
                  style={inputStyle}
                />
              </View>

              <View style={styles.colInputCell}>
                <TextInput
                  testID={`set-reps-input-${props.entry.id}`}
                  value={props.pendingInput.reps}
                  onChangeText={(reps) => props.onUpdatePendingInput({ reps })}
                  onFocus={props.onInteraction}
                  placeholder={smartPlaceholderReps}
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="decimal-pad"
                  style={inputStyle}
                />
              </View>
            </>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Log set ${nextSetSequence} for ${props.entry.name}`}
            disabled={props.busy}
            onPress={props.onLogSet}
            style={({ pressed }) => [
              styles.checkCell,
              (pressed || props.busy) && styles.actionPressed,
            ]}
          >
            <View
              style={[
                styles.checkCircle,
                styles.checkCircleOutline,
                { borderColor: theme.success },
              ]}
            >
              <Icon name="check" size={15} color="success" />
            </View>
          </Pressable>
        </View>
        {timeError ? (
          <ThemedText
            testID={`set-duration-error-${props.entry.id}`}
            type="footnote"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{ color: theme.danger }}
          >
            {timeError}
          </ThemedText>
        ) : null}
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
          { backgroundColor: theme.backgroundSelected },
          (pressed || props.busy) && styles.actionPressed,
        ]}
      >
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.pendingSetTypeLabel}
        >
          Set {nextSetSequence} type
        </ThemedText>
        <ThemedText type="smallBold">{pendingTypeLabel}</ThemedText>
        <Icon name="chevronDown" size={13} color="textSecondary" />
      </Pressable>

      {/* Log Set Footer */}
      <Button
        label={`Log set ${nextSetSequence}`}
        variant="tinted"
        icon="check"
        block
        accessibilityLabel={`Log set ${nextSetSequence} for ${props.entry.name}`}
        disabled={props.busy}
        onPress={props.onLogSet}
      />
    </Card>
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
  const theme = useTheme();
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
    <View
      style={[
        styles.floatingTimerContainer,
        {
          backgroundColor: theme.backgroundElement,
          shadowColor: theme.overlay,
        },
      ]}
    >
      <View style={styles.floatingTimerBar}>
        <View style={styles.timerInfoBlock}>
          <ThemedText
            type="footnote"
            themeColor="textSecondary"
            numberOfLines={nextAction ? 2 : 1}
          >
            {nextAction?.title ?? `Rest (${props.rest.exerciseName})`}
          </ThemedText>
          {nextAction?.detail ? (
            <ThemedText
              type="footnote"
              themeColor="textSecondary"
              numberOfLines={1}
            >
              {nextAction.detail}
            </ThemedText>
          ) : null}
          <View style={styles.timerValueRow}>
            <Icon name="timer" size={20} color="primary" />
            <ThemedText
              type="subtitle"
              themeColor="primary"
              style={styles.tabularNumbers}
            >
              {formatStopwatch(remaining)}
            </ThemedText>
          </View>
        </View>

        <View style={styles.timerActions}>
          <Button
            label="-15s"
            variant="secondary"
            size="small"
            accessibilityLabel="Subtract 15 seconds"
            onPress={() => props.onAdjust(-15)}
          />
          <Button
            label="+15s"
            variant="secondary"
            size="small"
            accessibilityLabel="Add 15 seconds"
            onPress={() => props.onAdjust(15)}
          />
          <Button
            label="Skip"
            variant="plain"
            size="small"
            accessibilityLabel="Skip rest timer"
            onPress={props.onSkip}
          />
        </View>
      </View>
      {/* Progress line */}
      <View
        style={[
          styles.timerProgressTrack,
          { backgroundColor: theme.backgroundSelected },
        ]}
      >
        <View
          style={[
            styles.timerProgressFill,
            { width: `${percent}%`, backgroundColor: theme.primary },
          ]}
        />
      </View>
    </View>
  );
}

// ==========================================
// Form Helpers
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
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <TextInput
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        placeholder={props.placeholder}
        placeholderTextColor={theme.textTertiary}
        keyboardType={props.keyboardType ?? "default"}
        accessibilityLabel={props.label}
        style={[
          styles.input,
          {
            color: props.inputColor,
            backgroundColor: theme.backgroundSelected,
          },
        ]}
      />
    </View>
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
const COL_SET = 36;
const COL_INPUT = 64;
const COL_CHECK = 48;

const styles = StyleSheet.create({
  timerValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  page: { flex: 1 },
  safeArea: { flex: 1 },
  keyboardContainer: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  contentWithRestTimer: {
    paddingBottom: BottomTabInset + Spacing.six + 120,
  },
  center: {
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.six,
  },
  centerText: { textAlign: "center" },
  centerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.two,
  },
  section: { gap: Spacing.four },
  formCard: { gap: Spacing.three },
  feedContainer: {
    gap: Spacing.four,
  },
  headerFinishButton: {
    minWidth: 80,
  },
  tabularNumbers: { fontVariant: ["tabular-nums"] },
  flexText: { flex: 1 },
  liveHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
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
    borderRadius: Radius.pill,
  },
  exerciseCard: {
    gap: Spacing.three,
  },
  exerciseCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  exerciseTitleBlock: {
    flex: 1,
    gap: Spacing.half,
  },
  moreButton: {
    // Keep the 48pt target while aligning the visual circle with the card edge.
    marginTop: -Spacing.one,
    marginRight: -Spacing.one,
  },
  exerciseActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  setTable: {
    gap: Spacing.one,
  },
  setTableHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.one,
  },
  colSetHeader: {
    width: COL_SET,
    textAlign: "center",
  },
  colInputHeader: {
    width: COL_INPUT,
    textAlign: "center",
  },
  colCheckHeader: {
    width: COL_CHECK,
    alignItems: "center",
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: MinTouchTarget + Spacing.one,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.sm,
  },
  colSet: {
    width: COL_SET,
    textAlign: "center",
  },
  colSetWrapper: {
    width: COL_SET,
    alignItems: "center",
    justifyContent: "center",
  },
  colSetPressable: {
    width: COL_SET,
    minHeight: MinTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  colPrev: {
    flex: 1,
    paddingHorizontal: Spacing.one,
  },
  colInputDone: {
    width: COL_INPUT,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  colInputCell: {
    width: COL_INPUT,
    paddingHorizontal: Spacing.half,
  },
  tableInput: {
    minHeight: MinTouchTarget - Spacing.one,
    borderRadius: Radius.sm,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  checkCell: {
    width: COL_CHECK,
    minHeight: MinTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircle: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircleOutline: {
    borderWidth: 2,
  },
  pendingSetTypeControl: {
    minHeight: MinTouchTarget,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  pendingSetTypeLabel: {
    flex: 1,
  },
  bottomControls: {
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  actionPressed: { opacity: 0.6 },
  centeredAction: { alignSelf: "center" },
  discardButton: { marginTop: Spacing.three },
  planExercise: { gap: Spacing.half },
  field: { gap: Spacing.one },
  input: {
    minHeight: MinTouchTarget,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 17,
  },
  message: {
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: 12,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  floatingTimerContainer: {
    position: "absolute",
    bottom: Spacing.four + BottomTabInset,
    left: PageGutter,
    right: PageGutter,
    borderRadius: Radius.lg,
    borderCurve: "continuous",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 8,
    overflow: "hidden",
  },
  floatingTimerBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    padding: Spacing.three,
  },
  timerInfoBlock: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 120,
    gap: Spacing.half,
  },
  timerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  timerProgressTrack: {
    height: 3,
    width: "100%",
  },
  timerProgressFill: {
    height: "100%",
  },
});
