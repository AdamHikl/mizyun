import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import {
  workoutListResponseSchema,
  type WorkoutListResponse,
} from "@mizyun/contracts";
import { apiClient, apiConfiguration } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import {
  computeElapsedSeconds,
  computeRestRemainingSeconds,
  findIncompleteWorkout,
  type ActiveWorkoutSummary,
  type RestTimerState,
} from "./active-workout-state";
import { cancelRestNotification } from "./rest-timer-notifications";
import { dismissOrphanedDevWorkoutLiveActivity } from "./workout-notification";
import { createActiveWorkoutUnmountCleanup } from "./active-workout-lifecycle";

export interface ActiveWorkoutContextValue {
  readonly activeWorkout: ActiveWorkoutSummary | null;
  readonly elapsedSeconds: number;
  readonly restTimer: RestTimerState | null;
  readonly restRemainingSeconds: number;
  setActiveWorkout(workout: ActiveWorkoutSummary | null): void;
  startRestTimer(state: RestTimerState): void;
  clearRestTimer(): void;
  refreshActiveWorkout(): Promise<void>;
}

const ActiveWorkoutContext = createContext<ActiveWorkoutContextValue | null>(
  null,
);

export function ActiveWorkoutProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { session } = useAuth();
  const [activeWorkout, setActiveWorkoutState] =
    useState<ActiveWorkoutSummary | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [restTimer, setRestTimerState] = useState<RestTimerState | null>(null);
  const [restRemainingSeconds, setRestRemainingSeconds] = useState(0);

  const activeWorkoutRef = useRef(activeWorkout);
  activeWorkoutRef.current = activeWorkout;

  const restTimerRef = useRef(restTimer);
  restTimerRef.current = restTimer;

  const setActiveWorkout = useCallback(
    (workout: ActiveWorkoutSummary | null) => {
      setActiveWorkoutState(workout);
      if (workout) {
        setElapsedSeconds(computeElapsedSeconds(workout.startedAt));
      } else {
        setElapsedSeconds(0);
      }
    },
    [],
  );

  const clearRestTimer = useCallback(() => {
    const current = restTimerRef.current;
    if (current?.notificationId) {
      void cancelRestNotification(current.notificationId);
    }
    setRestTimerState(null);
    setRestRemainingSeconds(0);
  }, []);

  const startRestTimer = useCallback((state: RestTimerState) => {
    const current = restTimerRef.current;
    if (
      current?.notificationId &&
      current.notificationId !== state.notificationId
    ) {
      void cancelRestNotification(current.notificationId);
    }
    setRestTimerState(state);
    setRestRemainingSeconds(computeRestRemainingSeconds(state));
  }, []);

  const refreshActiveWorkout = useCallback(async () => {
    if (!apiConfiguration.configured) {
      return;
    }
    if (!session?.user.id) {
      await dismissOrphanedDevWorkoutLiveActivity();
      return;
    }
    try {
      const result = await apiClient.request<WorkoutListResponse>({
        method: "GET",
        path: "/v1/workouts?limit=20",
        schema: workoutListResponseSchema,
      });
      if (!result.ok) return;

      const incomplete = findIncompleteWorkout(result.value.workouts);
      if (incomplete) {
        setActiveWorkoutState({
          id: incomplete.id,
          name: incomplete.name,
          startedAt: incomplete.startedAt,
        });
        setElapsedSeconds(computeElapsedSeconds(incomplete.startedAt));
      } else {
        await dismissOrphanedDevWorkoutLiveActivity();
        if (activeWorkoutRef.current !== null) {
          setActiveWorkoutState(null);
          setElapsedSeconds(0);
          clearRestTimer();
        }
      }
    } catch {
      // Non-fatal background refresh
    }
  }, [clearRestTimer, session?.user.id]);

  // Initial load when user session becomes active
  useEffect(() => {
    void refreshActiveWorkout();
  }, [refreshActiveWorkout]);

  // SessionGate unmounts this provider on sign-out, so remove sensitive
  // Lock Screen content from the teardown boundary rather than awaiting a
  // render with a null session.
  useEffect(
    () =>
      createActiveWorkoutUnmountCleanup(dismissOrphanedDevWorkoutLiveActivity),
    [],
  );

  // Master wall-clock interval timer
  useEffect(() => {
    const tick = () => {
      const currentWorkout = activeWorkoutRef.current;
      if (currentWorkout) {
        setElapsedSeconds(computeElapsedSeconds(currentWorkout.startedAt));
      } else {
        setElapsedSeconds(0);
      }

      const currentRest = restTimerRef.current;
      if (currentRest) {
        const remaining = computeRestRemainingSeconds(currentRest);
        setRestRemainingSeconds(remaining);
        if (remaining <= 0) {
          if (currentRest.notificationId) {
            void cancelRestNotification(currentRest.notificationId);
          }
          setRestTimerState(null);
        }
      } else {
        setRestRemainingSeconds(0);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync timers immediately upon foregrounding
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        const currentWorkout = activeWorkoutRef.current;
        if (currentWorkout) {
          setElapsedSeconds(computeElapsedSeconds(currentWorkout.startedAt));
        }

        const currentRest = restTimerRef.current;
        if (currentRest) {
          const remaining = computeRestRemainingSeconds(currentRest);
          setRestRemainingSeconds(remaining);
          if (remaining <= 0) {
            if (currentRest.notificationId) {
              void cancelRestNotification(currentRest.notificationId);
            }
            setRestTimerState(null);
          }
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const value = useMemo<ActiveWorkoutContextValue>(
    () => ({
      activeWorkout,
      elapsedSeconds,
      restTimer,
      restRemainingSeconds,
      setActiveWorkout,
      startRestTimer,
      clearRestTimer,
      refreshActiveWorkout,
    }),
    [
      activeWorkout,
      clearRestTimer,
      elapsedSeconds,
      refreshActiveWorkout,
      restRemainingSeconds,
      restTimer,
      setActiveWorkout,
      startRestTimer,
    ],
  );

  return (
    <ActiveWorkoutContext.Provider value={value}>
      {children}
    </ActiveWorkoutContext.Provider>
  );
}

export function useOptionalActiveWorkout(): ActiveWorkoutContextValue | null {
  return useContext(ActiveWorkoutContext);
}

export function useActiveWorkout(): ActiveWorkoutContextValue {
  const context = useContext(ActiveWorkoutContext);
  if (!context) {
    throw new Error(
      "useActiveWorkout must be used within an ActiveWorkoutProvider",
    );
  }
  return context;
}
