import {
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  router,
  Stack,
  useFocusEffect,
  type Href,
  useLocalSearchParams,
} from "expo-router";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";
import { RunCard, RunningWeek, listRuns } from "@/features/running";
import { apiClient } from "@/composition/api-client";
import { subscribeSessionReadUpdates } from "@/composition/personal-read-events";
import type { Workout } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TabHeader, useTabHeaderLayout } from "@/components/tab-header";
import {
  BottomTabInset,
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Spacing,
} from "@/constants/theme";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  SectionHeader,
  SegmentedControl,
} from "@/components/ui";
import { analyticsClient } from "@/composition/analytics-client";
import {
  getSessionReadVersion,
  invalidateSessionReads,
} from "@/composition/api-client";
import { ShareWorkoutModal, useCommunityProfile } from "@/features/community";
import { useAuth } from "@/features/auth/auth-context";

import {
  createBlankWorkout,
  deleteWorkout,
  fetchWorkoutsHubData,
  peekWorkoutsHubData,
  startRoutineSession,
  type ProcessedWorkout,
  type WorkoutsHubResult,
} from "./workouts-hub-data";
import {
  deriveRoutineSuggestion,
  findRepeatableWorkout,
  planRepeat,
  repeatLabel,
  saveSuggestedRoutine,
  startRepeatSession,
  type ResolvedRoutineSuggestion,
} from "./workout-repeat";
import {
  dismissRoutineSuggestion,
  isRoutineSuggestionDismissed,
  loadDismissedRoutineSuggestions,
} from "./workout-routine-suggestion-store";
import { ExerciseLibraryModal } from "./exercise-library-modal";
import { WorkoutEditorModal } from "./workout-editor-modal";
import { ExerciseProgressionModal } from "./exercise-progression-modal";
import { computeElapsedSeconds, formatStopwatch } from "./active-workout-state";
import { useOptionalActiveWorkout } from "./active-workout-context";

type WorkoutsTab = "all" | "planned" | "history";

const INITIAL_DATA: WorkoutsHubResult = {
  activeAndPlanned: [],
  completed: [],
  exercises: [],
  message: null,
};

export function WorkoutsHubScreen() {
  const [, redrawPrefetch] = useState(0);
  useEffect(
    () =>
      subscribeSessionReadUpdates((path) => {
        if (
          path === "*" ||
          /^\/v1\/(workouts|exercises|runs)([/?]|$)/.test(path)
        )
          redrawPrefetch((revision) => revision + 1);
      }),
    [],
  );
  const params = useLocalSearchParams<{ runSaved?: string }>();
  const [historyFilter, setHistoryFilter] = useState<
    "all" | "strength" | "running"
  >("all");
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const workoutContext = useOptionalActiveWorkout();
  const { headerHeight, onHeaderLayout } = useTabHeaderLayout();
  const { profile, session } = useAuth();
  const community = useCommunityProfile({
    principalKey: session?.user.id ?? null,
    birthYear: profile?.birthYear,
  });
  const [sharingWorkoutId, setSharingWorkoutId] = useState<string | null>(null);
  const unitSystem = profile?.unitSystem ?? "metric";
  const principal = session?.user.id ?? "";
  const owner = `${principal}:${session?.accessToken ?? ""}`;
  const warmData = peekWorkoutsHubData(session);
  const [ownedData, setOwnedData] = useState<{
    owner: string;
    value: WorkoutsHubResult;
    ready: boolean;
  }>(() => ({
    owner,
    value: warmData ?? INITIAL_DATA,
    ready: warmData !== null,
  }));
  const data =
    ownedData.owner === owner && ownedData.ready
      ? ownedData.value
      : (warmData ??
        (ownedData.owner === owner ? ownedData.value : INITIAL_DATA));
  const ownsScreenState = ownedData.owner === owner;
  const setData = (
    next:
      WorkoutsHubResult | ((current: WorkoutsHubResult) => WorkoutsHubResult),
  ) =>
    setOwnedData((state) => ({
      owner,
      ready: true,
      value:
        typeof next === "function"
          ? next(state.owner === owner ? state.value : INITIAL_DATA)
          : next,
    }));
  const [loadingState, setLoading] = useState(warmData === null);
  const loading =
    ownedData.owner === owner && ownedData.ready
      ? loadingState
      : warmData === null;
  const [refreshing, setRefreshing] = useState(false);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const requestId = useRef(0);
  const loaded = useRef<{ version: string; at: number } | null>(null);
  const displayReady = useRef(warmData !== null);
  useEffect(() => {
    requestId.current++;
    loaded.current = null;
    displayReady.current = warmData !== null;
    setOwnedData({
      owner,
      value: warmData ?? INITIAL_DATA,
      ready: warmData !== null,
    });
    setLoading(warmData === null);
    setLoadingMoreRuns(false);
    setEditingWorkout(null);
    setEditorVisible(false);
    setLibraryVisible(false);
    setProgressionExerciseName(null);
    setSharingWorkoutId(null);
  }, [owner]);
  const [activeTab, setActiveTab] = useState<WorkoutsTab>("all");
  useEffect(() => {
    if (params.runSaved) {
      setActiveTab("history");
      setHistoryFilter("all");
    }
  }, [params.runSaved]);
  const [busyWorkoutId, setBusyWorkoutId] = useState<string | null>(null);
  const startingRoutineIds = useRef(new Set<string>());
  const routineOperationIds = useRef(new Map<string, string>());
  const blankOperationId = useRef<{ owner: string; id: string } | null>(null);
  const sessionStartInFlight = useRef(false);
  const [sessionStartBusy, setSessionStartBusy] = useState(false);
  const [startingOneTime, setStartingOneTime] = useState(false);
  const repeatOperationId = useRef<{ key: string; id: string } | null>(null);
  const [savedSignatures, setSavedSignatures] = useState<{
    principal: string;
    signatures: ReadonlySet<string>;
  }>({ principal: "", signatures: new Set() });
  const suggestionOperation = useRef<{ key: string; id: string } | null>(null);
  const savingSuggestion = useRef(false);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<{
    principal: string;
    hashes: ReadonlySet<string>;
  } | null>(null);
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingWorkout, setEditingWorkout] = useState<ProcessedWorkout | null>(
    null,
  );
  const [progressionExerciseName, setProgressionExerciseName] = useState<
    string | null
  >(null);

  const loadData = useCallback(async (): Promise<void> => {
    const id = ++requestId.current;
    const version = getSessionReadVersion();
    if (!loaded.current && !displayReady.current) setLoading(true);
    const result = await fetchWorkoutsHubData({
      status: () => apiClient.status(),
      request: (options) =>
        apiClient.request({
          ...options,
          expectedUserId: principal,
          isCurrent: () =>
            owner === currentOwner.current && id === requestId.current,
        }),
    });
    if (owner !== currentOwner.current || id !== requestId.current) return;
    setData((current) =>
      result.message !== null &&
      (current.activeAndPlanned.length > 0 ||
        current.completed.length > 0 ||
        (current.runs?.length ?? 0) > 0)
        ? { ...current, message: result.message }
        : result,
    );
    setLoading(false);
    displayReady.current = true;
    loaded.current =
      result.message === null ? { version, at: Date.now() } : null;
  }, [owner]);

  useFocusEffect(
    useCallback(() => {
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "workout_history" },
      });
      const previous = loaded.current;
      if (
        !previous ||
        previous.version !== getSessionReadVersion() ||
        Date.now() - previous.at >= 5 * 60_000
      )
        void loadData();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void loadData();
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeSessionReadUpdates((path) => {
        if (!/^\/v1\/(workouts|exercises|runs)([/?]|$)/.test(path)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          void loadData();
        }, 50);
      });
      return () => {
        clearTimeout(timer);
        unsubscribe();
        subscription.remove();
      };
    }, [loadData]),
  );

  const handleCreateRoutine = useCallback(() => {
    setEditingWorkout(null);
    setEditorVisible(true);
  }, []);

  const handleEditWorkout = useCallback((workout: ProcessedWorkout) => {
    setEditingWorkout(workout);
    setEditorVisible(true);
  }, []);

  const beginRoutineSession = useCallback(async (workout: Workout) => {
    if (
      startingRoutineIds.current.has(workout.id) ||
      sessionStartInFlight.current
    )
      return;
    startingRoutineIds.current.add(workout.id);
    sessionStartInFlight.current = true;
    setSessionStartBusy(true);
    setBusyWorkoutId(workout.id);
    try {
      let operationId = routineOperationIds.current.get(workout.id);
      if (!operationId) {
        operationId = Crypto.randomUUID();
        routineOperationIds.current.set(workout.id, operationId);
      }
      const result = await startRoutineSession(workout, operationId);
      if (result.ok && result.workout) {
        routineOperationIds.current.delete(workout.id);
        router.push({
          pathname: "/log-workout",
          params: { workoutId: result.workout.id },
        });
      } else if (!result.ok) {
        routineOperationIds.current.delete(workout.id);
        Alert.alert("Could not start session", result.message);
      }
    } catch {
      routineOperationIds.current.delete(workout.id);
      Alert.alert(
        "Could not start session",
        "The session could not be started. Please try again.",
      );
    } finally {
      startingRoutineIds.current.delete(workout.id);
      sessionStartInFlight.current = false;
      setSessionStartBusy(false);
      setBusyWorkoutId(null);
    }
  }, []);

  const handleSavedWorkout = useCallback(
    (workout: Workout, autoStart: boolean) => {
      void loadData();
      if (autoStart) void beginRoutineSession(workout);
    },
    [beginRoutineSession, loadData],
  );

  const handleStartBlank = useCallback(async () => {
    if (workoutContext?.activeWorkout) {
      router.push({
        pathname: "/log-workout",
        params: { workoutId: workoutContext.activeWorkout.id },
      });
      return;
    }
    if (sessionStartInFlight.current) return;
    sessionStartInFlight.current = true;
    setSessionStartBusy(true);
    setStartingOneTime(true);
    try {
      if (
        !blankOperationId.current ||
        blankOperationId.current.owner !== principal
      ) {
        blankOperationId.current = {
          owner: principal,
          id: Crypto.randomUUID(),
        };
      }
      const result = await createBlankWorkout(
        "One-time Workout",
        blankOperationId.current.id,
      );
      if (currentOwner.current !== owner) return;
      if (result.ok && result.workout) {
        blankOperationId.current = null;
        router.push({
          pathname: "/log-workout",
          params: { workoutId: result.workout.id },
        });
      } else if (!result.ok) {
        Alert.alert("Could not start workout", result.message);
      }
    } catch {
      if (currentOwner.current === owner) {
        Alert.alert(
          "Could not start workout",
          "The workout could not be started. Please try again.",
        );
      }
    } finally {
      sessionStartInFlight.current = false;
      setSessionStartBusy(false);
      setStartingOneTime(false);
    }
  }, [owner, principal, workoutContext?.activeWorkout]);

  useEffect(() => {
    if (principal === "") return;
    let current = true;
    void loadDismissedRoutineSuggestions(principal).then((hashes) => {
      if (current) setDismissedSuggestions({ principal, hashes });
    });
    return () => {
      current = false;
    };
  }, [principal]);

  const handleRepeatLast = useCallback(async () => {
    if (workoutContext?.activeWorkout) {
      router.push({
        pathname: "/log-workout",
        params: { workoutId: workoutContext.activeWorkout.id },
      });
      return;
    }
    const source = findRepeatableWorkout(data.completed);
    if (!source || sessionStartInFlight.current) return;
    const plan = planRepeat(source, data.activeAndPlanned);
    if (plan.kind === "routine") {
      await beginRoutineSession(plan.routine);
      return;
    }
    sessionStartInFlight.current = true;
    setSessionStartBusy(true);
    try {
      const key = `${principal}:${source.workout.id}`;
      if (repeatOperationId.current?.key !== key)
        repeatOperationId.current = { key, id: Crypto.randomUUID() };
      const result = await startRepeatSession(
        plan,
        repeatOperationId.current.id,
      );
      if (currentOwner.current !== owner) return;
      if (result.ok && result.workout) {
        repeatOperationId.current = null;
        router.push({
          pathname: "/log-workout",
          params: { workoutId: result.workout.id },
        });
      } else if (!result.ok) {
        Alert.alert("Could not start workout", result.message);
      }
    } catch {
      if (currentOwner.current === owner)
        Alert.alert(
          "Could not start workout",
          "The workout could not be started. Please try again.",
        );
    } finally {
      sessionStartInFlight.current = false;
      setSessionStartBusy(false);
    }
  }, [
    beginRoutineSession,
    data.activeAndPlanned,
    data.completed,
    owner,
    principal,
    workoutContext?.activeWorkout,
  ]);

  const handleSaveSuggestion = useCallback(
    async (resolved: ResolvedRoutineSuggestion) => {
      if (savingSuggestion.current) return;
      savingSuggestion.current = true;
      setSuggestionBusy(true);
      try {
        const key = `${principal}:${resolved.suggestion.signature}`;
        if (suggestionOperation.current?.key !== key)
          suggestionOperation.current = { key, id: Crypto.randomUUID() };
        const result = await saveSuggestedRoutine(
          resolved,
          suggestionOperation.current.id,
        );
        if (currentOwner.current !== owner) return;
        if (result.ok) {
          suggestionOperation.current = null;
          setSavedSignatures((current) => ({
            principal,
            signatures: new Set([
              ...(current.principal === principal ? current.signatures : []),
              resolved.suggestion.signature,
            ]),
          }));
          void loadData();
        } else {
          Alert.alert("Could not save routine", result.message);
        }
      } catch {
        if (currentOwner.current === owner)
          Alert.alert(
            "Could not save routine",
            "The routine could not be saved. Please try again.",
          );
      } finally {
        savingSuggestion.current = false;
        setSuggestionBusy(false);
      }
    },
    [loadData, owner, principal],
  );

  const handleDismissSuggestion = useCallback(
    async (resolved: ResolvedRoutineSuggestion) => {
      const userId = principal;
      const saved = await dismissRoutineSuggestion(userId, resolved.suggestion);
      if (currentOwner.current !== owner) return;
      const hashes = await loadDismissedRoutineSuggestions(userId);
      if (currentOwner.current !== owner) return;
      if (saved || hashes.size > 0)
        setDismissedSuggestions({ principal: userId, hashes });
    },
    [owner, principal],
  );

  const handleOpenWorkout = useCallback((workoutId: string) => {
    router.push({
      pathname: "/log-workout",
      params: { workoutId },
    });
  }, []);

  const handleStartOrContinue = useCallback(
    async (item: ProcessedWorkout) => {
      if (item.status === "in_progress") {
        handleOpenWorkout(item.workout.id);
        return;
      }

      await beginRoutineSession(item.workout);
    },
    [beginRoutineSession, handleOpenWorkout],
  );

  const handleConfirmDelete = useCallback(
    (workout: ProcessedWorkout) => {
      Alert.alert(
        "Delete workout?",
        `This permanently removes “${workout.workout.name}” and all its sets.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setBusyWorkoutId(workout.workout.id);
              const result = await deleteWorkout(workout.workout.id);
              setBusyWorkoutId(null);
              if (!result.ok) {
                Alert.alert("Delete failed", result.message);
                return;
              }
              await loadData();
            },
          },
        ],
      );
    },
    [loadData],
  );

  const loadMoreRuns = async () => {
    if (loadingMoreRuns || !data.runsNextCursor) return;
    setLoadingMoreRuns(true);
    const result = await listRuns(
      {
        status: () => apiClient.status(),
        request: (options) =>
          apiClient.request({
            ...options,
            expectedUserId: principal,
            isCurrent: () => owner === currentOwner.current,
          }),
      },
      { cursor: data.runsNextCursor },
    );
    if (owner === currentOwner.current) {
      if (result.ok)
        setData((d) => ({
          ...d,
          runs: [
            ...new Map(
              [...(d.runs ?? []), ...result.value.runs].map((run) => [
                run.id,
                run,
              ]),
            ).values(),
          ],
          runsNextCursor: result.value.nextCursor,
        }));
      else setData((d) => ({ ...d, message: result.message }));
      setLoadingMoreRuns(false);
    }
  };
  const history = [
    ...(historyFilter !== "running"
      ? data.completed.map((item) => ({
          kind: "strength" as const,
          item,
          date: (item.workout.completedAt ?? item.workout.startedAt).slice(
            0,
            10,
          ),
          id: item.workout.id,
        }))
      : []),
    ...(historyFilter !== "strength"
      ? (data.runs ?? []).map((run) => ({
          kind: "run" as const,
          run,
          date: run.summary.activityDate,
          id: run.id,
        }))
      : []),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const repeatSource = loading ? null : findRepeatableWorkout(data.completed);
  const routineSuggestion =
    loading ||
    !ownsScreenState ||
    dismissedSuggestions === null ||
    dismissedSuggestions.principal !== principal
      ? null
      : deriveRoutineSuggestion(
          data,
          new Date(),
          (signature) =>
            isRoutineSuggestionDismissed(dismissedSuggestions.hashes, {
              signature,
            }) ||
            (savedSignatures.principal === principal &&
              savedSignatures.signatures.has(signature)),
        );
  const showPlanned = activeTab === "all" || activeTab === "planned";
  const showHistory = activeTab === "all" || activeTab === "history";

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Workouts" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <TabHeader title="Workouts" onLayout={onHeaderLayout} />
        <ScrollView
          refreshControl={
            <RefreshControl
              progressViewOffset={headerHeight}
              refreshing={refreshing}
              onRefresh={() => {
                invalidateSessionReads();
                setRefreshing(true);
                void loadData().finally(() => setRefreshing(false));
              }}
            />
          }
          style={{ marginTop: -headerHeight }}
          contentContainerStyle={[
            styles.content,
            { paddingTop: headerHeight + Spacing.two },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.primaryBlock}>
            <Button
              label={
                workoutContext?.activeWorkout
                  ? "Resume workout"
                  : startingOneTime
                    ? "Starting…"
                    : "Start workout"
              }
              icon="dumbbell"
              block
              accessibilityLabel={
                workoutContext?.activeWorkout
                  ? "Resume workout"
                  : "Start one-time workout"
              }
              loading={startingOneTime}
              disabled={sessionStartBusy}
              onPress={handleStartBlank}
            />
            {workoutContext?.activeWorkout &&
            typeof workoutContext.elapsedSeconds === "number" ? (
              <ThemedText
                type="footnote"
                themeColor="textSecondary"
                style={styles.centerText}
              >
                In progress · {formatStopwatch(workoutContext.elapsedSeconds)}
              </ThemedText>
            ) : null}
          </View>

          <ListGroup>
            {repeatSource && !workoutContext?.activeWorkout ? (
              <ListRow
                key="repeat-last-workout"
                icon="history"
                title={repeatLabel(repeatSource)}
                subtitle={`${repeatSource.displayDate} · ${
                  repeatSource.plannedExercises.length ||
                  repeatSource.exerciseSummaries.length
                } exercises`}
                accessibilityLabel={repeatLabel(repeatSource)}
                disabled={sessionStartBusy}
                onPress={() => void handleRepeatLast()}
              />
            ) : null}
            <ListRow
              key="log-run"
              icon="run"
              title="Log run"
              subtitle="Distance is optional"
              accessibilityLabel="Log run"
              onPress={() => router.push("/log-run" as Href)}
            />
            <ListRow
              key="create-routine"
              icon="add"
              title="Create routine"
              subtitle="Plan exercises and sets"
              accessibilityLabel="Create custom workout routine"
              onPress={handleCreateRoutine}
            />
            <ListRow
              key="exercise-library"
              icon="search"
              title="Exercise library"
              subtitle="Instructions and muscle groups"
              accessibilityLabel="Browse exercise library"
              onPress={() => setLibraryVisible(true)}
            />
          </ListGroup>

          {routineSuggestion ? (
            <Card>
              <ThemedText type="headline">Save as routine?</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                You have done {routineSuggestion.suggestion.sessionIds.length}{" "}
                one-time workouts with the same exercises recently:{" "}
                {routineSuggestion.name}.
              </ThemedText>
              <View style={styles.cardActionsRow}>
                <Button
                  label={suggestionBusy ? "Saving…" : "Save as routine"}
                  variant="tinted"
                  size="small"
                  accessibilityLabel="Save these exercises as a routine"
                  disabled={suggestionBusy}
                  onPress={() => void handleSaveSuggestion(routineSuggestion)}
                />
                <Button
                  label="Not now"
                  variant="plain"
                  size="small"
                  accessibilityLabel="Dismiss routine suggestion"
                  disabled={suggestionBusy}
                  onPress={() =>
                    void handleDismissSuggestion(routineSuggestion)
                  }
                />
              </View>
            </Card>
          ) : null}

          <SegmentedControl
            accessibilityLabel="Workout view"
            value={activeTab}
            onChange={setActiveTab}
            options={[
              {
                value: "all",
                label: "All",
                count:
                  data.activeAndPlanned.length +
                  data.completed.length +
                  (data.runs?.length ?? 0),
                accessibilityLabel: "Show all workouts",
              },
              {
                value: "planned",
                label: "Routines",
                count: data.activeAndPlanned.length,
                accessibilityLabel: "Show available routines",
              },
              {
                value: "history",
                label: "History",
                count: data.completed.length + (data.runs?.length ?? 0),
                accessibilityLabel: "Show completed workout history",
              },
            ]}
          />

          {loading ? (
            <ThemedText type="small" themeColor="textSecondary">
              Loading workouts…
            </ThemedText>
          ) : null}

          {data.message ? (
            <View accessibilityRole="alert">
              <Notice
                tone="warning"
                message={data.message}
                action={
                  <Button
                    label="Check again"
                    variant="plain"
                    size="small"
                    onPress={() => void loadData()}
                  />
                }
              />
            </View>
          ) : null}

          {showPlanned ? (
            <View style={styles.section}>
              <SectionHeader title="Routines" />

              {data.activeAndPlanned.length === 0 && !loading ? (
                <Card>
                  <EmptyState
                    icon="dumbbell"
                    title="No routines yet"
                    message="Create a routine or ask the AI Coach to plan one."
                    action={
                      <View style={styles.emptyActions}>
                        <Button
                          label="Create routine"
                          icon="add"
                          variant="tinted"
                          size="small"
                          accessibilityLabel="Create custom routine"
                          onPress={handleCreateRoutine}
                        />
                        <Button
                          label="Ask Coach"
                          variant="plain"
                          size="small"
                          accessibilityLabel="Ask Coach for routine"
                          onPress={() => router.push("/coach" as Href)}
                        />
                      </View>
                    }
                  />
                </Card>
              ) : (
                data.activeAndPlanned.map((item) => (
                  <PlannedWorkoutCard
                    key={item.workout.id}
                    item={item}
                    isBusy={busyWorkoutId === item.workout.id}
                    onOpen={() => void handleStartOrContinue(item)}
                    onEdit={() => handleEditWorkout(item)}
                    onDelete={() => handleConfirmDelete(item)}
                    onPressExercise={(name) => setProgressionExerciseName(name)}
                  />
                ))
              )}
            </View>
          ) : null}

          {showHistory ? (
            <View style={styles.section}>
              <SectionHeader title="History" />

              <View style={styles.filterRow}>
                {(["all", "strength", "running"] as const).map((filter) => {
                  const label =
                    filter === "all"
                      ? "All activities"
                      : filter === "strength"
                        ? "Strength"
                        : "Running";
                  return (
                    <Chip
                      key={filter}
                      label={label}
                      accessibilityLabel={label}
                      selected={historyFilter === filter}
                      onPress={() => setHistoryFilter(filter)}
                    />
                  );
                })}
              </View>
              {params.runSaved ? (
                <Notice tone="success" message="Run saved" />
              ) : null}
              {historyFilter !== "strength" && data.runWeek ? (
                <RunningWeek
                  runs={data.weeklyRuns ?? []}
                  unit={unitSystem === "imperial" ? "mi" : "km"}
                  from={data.runWeek.from}
                  to={data.runWeek.to}
                  incomplete={data.runWeek.incomplete}
                />
              ) : null}
              {history.length === 0 && !loading ? (
                <Card>
                  <EmptyState
                    icon={historyFilter === "running" ? "run" : "history"}
                    title={
                      historyFilter === "running"
                        ? "Your runs will appear here"
                        : "No completed workouts yet"
                    }
                    message={
                      historyFilter === "running"
                        ? "Use Log run to add a completed run. Duration is enough when distance is unknown."
                        : "Completed sessions will appear here."
                    }
                  />
                </Card>
              ) : (
                history.map((entry) =>
                  entry.kind === "run" ? (
                    <RunCard
                      key={entry.run.id}
                      run={entry.run}
                      unit={unitSystem === "imperial" ? "mi" : "km"}
                    />
                  ) : (
                    (() => {
                      const item = entry.item;
                      return (
                        <CompletedWorkoutCard
                          key={item.workout.id}
                          item={item}
                          unitSystem={unitSystem}
                          isBusy={busyWorkoutId === item.workout.id}
                          onOpen={() => handleOpenWorkout(item.workout.id)}
                          onShare={
                            community.isEnrolled
                              ? () => setSharingWorkoutId(item.workout.id)
                              : undefined
                          }
                          onEdit={() => handleEditWorkout(item)}
                          onDelete={() => handleConfirmDelete(item)}
                          onPressExercise={(name) =>
                            setProgressionExerciseName(name)
                          }
                        />
                      );
                    })()
                  ),
                )
              )}
              {historyFilter !== "strength" && data.runsNextCursor ? (
                <Button
                  label={loadingMoreRuns ? "Loading runs…" : "Load more runs"}
                  variant="secondary"
                  block
                  disabled={loadingMoreRuns}
                  onPress={() => void loadMoreRuns()}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      {ownsScreenState && sharingWorkoutId && (
        <ShareWorkoutModal
          key={`${session?.user.id}:${sharingWorkoutId}`}
          visible
          workoutId={sharingWorkoutId}
          onDismiss={() => setSharingWorkoutId(null)}
        />
      )}
      <ExerciseLibraryModal
        key={`library:${owner}`}
        visible={ownsScreenState && libraryVisible}
        onClose={() => setLibraryVisible(false)}
      />

      <WorkoutEditorModal
        key={`editor:${owner}`}
        visible={ownsScreenState && editorVisible}
        onClose={() => setEditorVisible(false)}
        workoutToEdit={ownsScreenState ? editingWorkout : null}
        onSaved={handleSavedWorkout}
      />

      {ownsScreenState && progressionExerciseName !== null ? (
        <ExerciseProgressionModal
          key={`progression:${owner}`}
          visible={progressionExerciseName !== null}
          onClose={() => setProgressionExerciseName(null)}
          exerciseName={progressionExerciseName}
        />
      ) : null}
    </ThemedView>
  );
}

/** Display-only: "10.000 kg" → "10 kg", "62.50 kg" → "62.5 kg". */
export function formatTargetLoad(load: string): string {
  return load.replace(/(\d+)\.(\d*?)0+(?=\D|$)/g, (_, whole, fraction) =>
    fraction ? `${whole}.${fraction}` : whole,
  );
}

function PlannedWorkoutCard(props: {
  readonly item: ProcessedWorkout;
  readonly isBusy: boolean;
  readonly onOpen: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onPressExercise?: (exerciseName: string) => void;
}) {
  const { item, isBusy, onOpen, onEdit, onDelete, onPressExercise } = props;
  const isStarted = item.status === "in_progress";
  const workoutContext = useOptionalActiveWorkout();
  const durationText = isStarted
    ? formatStopwatch(
        workoutContext?.activeWorkout?.id === item.workout.id
          ? workoutContext.elapsedSeconds
          : computeElapsedSeconds(item.workout.startedAt),
      )
    : "";
  const exerciseCount = item.plannedExercises.length;
  const metadata = [
    exerciseCount > 0
      ? `${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}`
      : null,
    isStarted ? `${durationText} · ${item.completedSetCount} sets` : null,
  ].filter(Boolean);
  const isOneTime = item.workout.details.sessionMode === "one_time";

  return (
    <Card>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleBlock}>
          <ThemedText type="headline">{item.workout.name}</ThemedText>
          {metadata.length > 0 ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {metadata.join(" · ")}
            </ThemedText>
          ) : null}
        </View>
        <Chip
          label={isStarted ? "In progress" : "Ready"}
          tone={isStarted ? "warning" : "primary"}
        />
      </View>

      {exerciseCount > 0 ? (
        <View style={styles.exerciseBlock}>
          <ThemedText type="footnote" themeColor="textSecondary">
            {isOneTime ? "Exercises" : "Exercises · tap for progress"}
          </ThemedText>
          <View style={styles.exerciseChipsGrid}>
            {item.plannedExercises.map((ex, index) => (
              <Chip
                key={`${ex.name}-${index}`}
                icon="chart"
                label={`${ex.name}${
                  isOneTime
                    ? ""
                    : ex.targetSets
                      ? ` (${ex.targetSets} ${ex.targetSets === 1 ? "set" : "sets"}${ex.targetLoad ? ` · ${formatTargetLoad(ex.targetLoad)}` : ""})`
                      : ex.targetLoad
                        ? ` (${formatTargetLoad(ex.targetLoad)})`
                        : ""
                }`}
                accessibilityLabel={`View progress for ${ex.name}`}
                onPress={() => onPressExercise?.(ex.name)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.cardActionsRow}>
        <Button
          label={isBusy ? "Starting…" : isStarted ? "Continue" : "Start"}
          variant="tinted"
          size="small"
          icon={isStarted ? "dumbbell" : undefined}
          accessibilityLabel={`Open ${item.workout.name}`}
          disabled={isBusy}
          onPress={onOpen}
        />
        <Button
          label="Edit"
          variant="secondary"
          size="small"
          accessibilityLabel={`Edit ${item.workout.name}`}
          onPress={onEdit}
        />
        <View style={styles.flexSpacer} />
        <IconButton
          icon="trash"
          variant="plain"
          accessibilityLabel={`Delete ${item.workout.name}`}
          onPress={onDelete}
        />
      </View>
    </Card>
  );
}

function CompletedWorkoutCard(props: {
  readonly onShare?: () => void;
  readonly item: ProcessedWorkout;
  readonly unitSystem: "metric" | "imperial";
  readonly isBusy: boolean;
  readonly onOpen: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onPressExercise?: (exerciseName: string) => void;
}) {
  const { item, unitSystem, onOpen, onEdit, onDelete, onPressExercise } = props;
  const volumeDisplay =
    unitSystem === "imperial"
      ? `${Math.round(item.totalVolumeKg * 2.20462)} lb`
      : `${Math.round(item.totalVolumeKg)} kg`;
  const metadata = [
    item.displayDate,
    item.durationMinutes ? `${item.durationMinutes} min` : null,
  ].filter(Boolean);
  const stats = [
    `${item.completedSetCount} sets`,
    item.totalVolumeKg > 0 ? `${volumeDisplay} volume` : null,
  ].filter(Boolean);

  return (
    <Card>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleBlock}>
          <ThemedText type="headline">{item.workout.name}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {metadata.join(" · ")}
          </ThemedText>
        </View>
        <Chip label="Done" icon="check" tone="primary" />
      </View>

      <ThemedText type="small">{stats.join(" · ")}</ThemedText>

      {item.exerciseSummaries.length > 0 ? (
        <View style={styles.completedExercisesList}>
          {item.exerciseSummaries.map((ex) => (
            <Pressable
              key={ex.exerciseId}
              accessibilityRole="button"
              accessibilityLabel={`View progress for ${ex.exerciseName}`}
              onPress={() => onPressExercise?.(ex.exerciseName)}
              style={styles.completedExerciseRow}
            >
              <View style={styles.completedExName}>
                <ThemedText type="small">{ex.exerciseName}</ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {ex.setCount} sets
                  {ex.topLoadKg !== null
                    ? ` · max ${unitSystem === "imperial" ? `${Math.round(ex.topLoadKg * 2.20462)}lb` : `${ex.topLoadKg}kg`}`
                    : ""}
                </ThemedText>
              </View>
              <Icon name="chart" size={15} color="textTertiary" />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.cardActionsRow}>
        <Button
          label="View & edit sets"
          variant="tinted"
          size="small"
          accessibilityLabel={`View ${item.workout.name}`}
          onPress={onOpen}
        />
        <Button
          label="Edit details"
          variant="secondary"
          size="small"
          accessibilityLabel={`Edit details of ${item.workout.name}`}
          onPress={onEdit}
        />
        <View style={styles.flexSpacer} />
        {props.onShare ? (
          <IconButton
            icon="share"
            variant="plain"
            accessibilityLabel="Review sharing / unpublish"
            onPress={props.onShare}
          />
        ) : null}
        <IconButton
          icon="trash"
          variant="plain"
          accessibilityLabel={`Delete ${item.workout.name}`}
          onPress={onDelete}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: PageGutter,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: "100%",
    alignSelf: "center",
  },
  primaryBlock: {
    gap: Spacing.two,
  },
  centerText: {
    textAlign: "center",
  },
  section: {
    gap: Spacing.three,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  emptyActions: {
    alignItems: "center",
    gap: Spacing.one,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  cardTitleBlock: {
    flex: 1,
    flexBasis: 160,
    gap: Spacing.half,
  },
  exerciseBlock: {
    gap: Spacing.one,
  },
  exerciseChipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  completedExercisesList: {
    gap: Spacing.one,
  },
  completedExerciseRow: {
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  completedExName: {
    flex: 1,
    gap: Spacing.half,
  },
  cardActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  flexSpacer: {
    flexGrow: 1,
  },
});
