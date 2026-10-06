import {
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router, Stack, useFocusEffect, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Workout } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TabHeader, useTabHeaderLayout } from "@/components/tab-header";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
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
  startRoutineSession,
  type ProcessedWorkout,
  type WorkoutsHubResult,
} from "./workouts-hub-data";
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
  const workoutContext = useOptionalActiveWorkout();
  const { headerHeight, onHeaderLayout } = useTabHeaderLayout();
  const { profile, session } = useAuth();
  const community = useCommunityProfile({
    principalKey: session?.user.id ?? null,
    birthYear: profile?.birthYear,
  });
  const [sharingWorkoutId, setSharingWorkoutId] = useState<string | null>(null);
  const unitSystem = profile?.unitSystem ?? "metric";
  const [data, setData] = useState<WorkoutsHubResult>(INITIAL_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const principal = session?.user.id ?? "";
  const owner = `${principal}:${session?.accessToken ?? ""}`;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const requestId = useRef(0);
  const loaded = useRef<{ version: string; at: number } | null>(null);
  useEffect(() => {
    requestId.current++;
    loaded.current = null;
    setData(INITIAL_DATA);
    setLoading(true);
  }, [owner]);
  const [activeTab, setActiveTab] = useState<WorkoutsTab>("all");
  const [busyWorkoutId, setBusyWorkoutId] = useState<string | null>(null);
  const startingRoutineIds = useRef(new Set<string>());
  const routineOperationIds = useRef(new Map<string, string>());
  const blankOperationId = useRef<{ owner: string; id: string } | null>(null);
  const startingBlank = useRef(false);
  const [startingOneTime, setStartingOneTime] = useState(false);
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
    if (!loaded.current) setLoading(true);
    const result = await fetchWorkoutsHubData();
    if (owner !== currentOwner.current || id !== requestId.current) return;
    setData((current) =>
      result.message !== null &&
      (current.activeAndPlanned.length > 0 || current.completed.length > 0)
        ? { ...current, message: result.message }
        : result,
    );
    setLoading(false);
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
      return () => subscription.remove();
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
    if (startingRoutineIds.current.has(workout.id)) return;
    startingRoutineIds.current.add(workout.id);
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
    if (startingBlank.current) return;
    startingBlank.current = true;
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
      startingBlank.current = false;
      setStartingOneTime(false);
    }
  }, [owner, principal, workoutContext?.activeWorkout]);

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

  const showPlanned = activeTab === "all" || activeTab === "planned";
  const showHistory = activeTab === "all" || activeTab === "history";

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Workouts" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <TabHeader onLayout={onHeaderLayout} />
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
            { paddingTop: headerHeight + Spacing.four },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Header */}
          <View style={styles.header}>
            <ThemedText type="subtitle">Workouts</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Start a session or choose a saved routine.
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              workoutContext?.activeWorkout
                ? "Resume workout"
                : "Start one-time workout"
            }
            accessibilityState={{
              disabled: startingOneTime,
              busy: startingOneTime,
            }}
            disabled={startingOneTime}
            onPress={handleStartBlank}
            style={({ pressed }) => [
              styles.createRoutineHeroCard,
              pressed && styles.pressed,
              startingOneTime && styles.disabled,
            ]}
          >
            <View style={styles.createRoutineIconContainer}>
              <ThemedText style={styles.createRoutineIcon}>🏋️</ThemedText>
            </View>
            <View style={styles.createRoutineBody}>
              <ThemedText type="smallBold">
                {workoutContext?.activeWorkout
                  ? "Resume Workout"
                  : startingOneTime
                    ? "Starting…"
                    : "Start One-time Workout"}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {workoutContext?.activeWorkout
                  ? "Continue your active workout."
                  : "Add exercises, weights and sets as you go."}
              </ThemedText>
            </View>
            <ThemedText style={styles.libraryArrow}>→</ThemedText>
          </Pressable>

          {/* Secondary actions */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create custom workout routine"
            onPress={handleCreateRoutine}
            style={({ pressed }) => [
              styles.secondaryAction,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.createRoutineBody}>
              <ThemedText type="smallBold">Create Routine</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Plan exercises and target sets for later.
              </ThemedText>
            </View>
            <ThemedText style={styles.libraryArrow}>＋</ThemedText>
          </Pressable>

          {/* Exercise Library Shortcut */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Browse exercise library"
            onPress={() => setLibraryVisible(true)}
            style={({ pressed }) => [
              styles.secondaryAction,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.createRoutineBody}>
              <ThemedText type="smallBold">Exercise Library</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Browse exercises, instructions and muscle groups.
              </ThemedText>
            </View>
            <ThemedText style={styles.libraryArrow}>→</ThemedText>
          </Pressable>

          {/* 3. Tab Filter Chips */}
          <View style={styles.tabsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show all workouts"
              accessibilityState={{ selected: activeTab === "all" }}
              onPress={() => setActiveTab("all")}
              style={[
                styles.tabChip,
                activeTab === "all" && styles.tabChipActive,
              ]}
            >
              <ThemedText
                type="smallBold"
                style={[
                  styles.tabChipText,
                  activeTab === "all" && styles.tabChipTextActive,
                ]}
              >
                All ({data.activeAndPlanned.length + data.completed.length})
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show available routines"
              accessibilityState={{ selected: activeTab === "planned" }}
              onPress={() => setActiveTab("planned")}
              style={[
                styles.tabChip,
                activeTab === "planned" && styles.tabChipActive,
              ]}
            >
              <ThemedText
                type="smallBold"
                style={[
                  styles.tabChipText,
                  activeTab === "planned" && styles.tabChipTextActive,
                ]}
              >
                Routines ({data.activeAndPlanned.length})
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show completed workout history"
              accessibilityState={{ selected: activeTab === "history" }}
              onPress={() => setActiveTab("history")}
              style={[
                styles.tabChip,
                activeTab === "history" && styles.tabChipActive,
              ]}
            >
              <ThemedText
                type="smallBold"
                style={[
                  styles.tabChipText,
                  activeTab === "history" && styles.tabChipTextActive,
                ]}
              >
                History ({data.completed.length})
              </ThemedText>
            </Pressable>
          </View>

          {loading ? (
            <ThemedText type="small" themeColor="textSecondary">
              Loading workouts…
            </ThemedText>
          ) : null}

          {/* Section 1: Available Routines & Sessions */}
          {showPlanned ? (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  ROUTINES & ACTIVE WORKOUTS
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {data.activeAndPlanned.length}{" "}
                  {data.activeAndPlanned.length === 1 ? "workout" : "workouts"}
                </ThemedText>
              </View>

              {data.activeAndPlanned.length === 0 && !loading ? (
                <ThemedView
                  type="backgroundElement"
                  style={styles.emptyStateCard}
                >
                  <ThemedText type="smallBold">
                    No available routines
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.emptyStateDesc}
                  >
                    Create a custom workout routine or ask the AI Coach to build
                    a personalized multi-day plan.
                  </ThemedText>
                  <View style={styles.emptyActionsRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Create custom routine"
                      onPress={handleCreateRoutine}
                      style={styles.emptyActionButton}
                    >
                      <ThemedText
                        type="smallBold"
                        style={styles.emptyActionText}
                      >
                        ＋ Create Routine
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Ask Coach for routine"
                      onPress={() => router.push("/coach" as Href)}
                      style={styles.emptyActionButtonSecondary}
                    >
                      <ThemedText type="smallBold">Ask Coach →</ThemedText>
                    </Pressable>
                  </View>
                </ThemedView>
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

          {/* Section 2: Completed History */}
          {showHistory ? (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  COMPLETED HISTORY
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {data.completed.length}{" "}
                  {data.completed.length === 1
                    ? "logged workout"
                    : "logged workouts"}
                </ThemedText>
              </View>

              {data.completed.length === 0 && !loading ? (
                <ThemedView
                  type="backgroundElement"
                  style={styles.emptyStateCard}
                >
                  <ThemedText type="smallBold">
                    No completed workouts yet
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.emptyStateDesc}
                  >
                    Completed training sessions with logged sets, volume, and
                    duration will be archived here.
                  </ThemedText>
                </ThemedView>
              ) : (
                data.completed.map((item) => (
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
                    onPressExercise={(name) => setProgressionExerciseName(name)}
                  />
                ))
              )}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      {sharingWorkoutId && (
        <ShareWorkoutModal
          key={`${session?.user.id}:${sharingWorkoutId}`}
          visible
          workoutId={sharingWorkoutId}
          onDismiss={() => setSharingWorkoutId(null)}
        />
      )}
      <ExerciseLibraryModal
        visible={libraryVisible}
        onClose={() => setLibraryVisible(false)}
      />

      <WorkoutEditorModal
        visible={editorVisible}
        onClose={() => setEditorVisible(false)}
        workoutToEdit={editingWorkout}
        onSaved={handleSavedWorkout}
      />

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

  return (
    <ThemedView type="backgroundElement" style={styles.routineCard}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleBlock}>
          <ThemedText type="smallBold" style={styles.workoutName}>
            {item.workout.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.plannedExercises.length > 0
              ? `${item.plannedExercises.length} exercises · Available routine`
              : isStarted
                ? `In progress · ⏱️ ${durationText} · ${item.completedSetCount} sets`
                : "Available routine"}
          </ThemedText>
        </View>

        <View
          style={[
            styles.statusBadge,
            isStarted ? styles.statusBadgeStarted : styles.statusBadgePlanned,
          ]}
        >
          <ThemedText
            type="small"
            style={[
              styles.statusBadgeText,
              isStarted
                ? styles.statusBadgeTextStarted
                : styles.statusBadgeTextPlanned,
            ]}
          >
            {isStarted
              ? `⏱️ ${durationText} (${item.completedSetCount} sets)`
              : "Ready"}
          </ThemedText>
        </View>
      </View>

      {/* Planned Exercises preview */}
      {item.plannedExercises.length > 0 ? (
        <View style={styles.plannedExercisesList}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {item.workout.details.sessionMode === "one_time"
              ? "Exercises added in this workout:"
              : "Suggested exercises (tap to track progress):"}
          </ThemedText>
          <View style={styles.exerciseChipsGrid}>
            {item.plannedExercises.map((ex, index) => (
              <Pressable
                key={`${ex.name}-${index}`}
                accessibilityRole="button"
                accessibilityLabel={`View progress for ${ex.name}`}
                onPress={() => onPressExercise?.(ex.name)}
                style={styles.exerciseChip}
              >
                <ThemedText type="small" style={styles.exerciseChipText}>
                  {ex.name}
                  {item.workout.details.sessionMode === "one_time"
                    ? ""
                    : ex.targetSets
                      ? ` (${ex.targetSets} sets${ex.targetLoad ? ` · ${ex.targetLoad}` : ""})`
                      : ex.targetLoad
                        ? ` (${ex.targetLoad})`
                        : ""}{" "}
                  📈
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Action Buttons */}
      <View style={styles.cardActionsRow}>
        <View style={styles.cardActionsLeft}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.workout.name}`}
            disabled={isBusy}
            onPress={onOpen}
            style={[styles.startSessionButton, isBusy && styles.disabled]}
          >
            <ThemedText type="smallBold" style={styles.startSessionText}>
              {isBusy
                ? "Starting…"
                : isStarted
                  ? "Continue Session →"
                  : "Start Session →"}
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.workout.name}`}
            onPress={onEdit}
            style={styles.editRoutineButton}
          >
            <ThemedText type="smallBold">Edit Routine</ThemedText>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${item.workout.name}`}
          onPress={onDelete}
          style={styles.deleteButton}
        >
          <ThemedText type="small" themeColor="textSecondary">
            Delete
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
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

  return (
    <ThemedView type="backgroundElement" style={styles.historyCard}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleBlock}>
          <ThemedText type="smallBold" style={styles.workoutName}>
            {item.workout.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.displayDate}
            {item.durationMinutes ? ` · ${item.durationMinutes} min` : ""}
          </ThemedText>
        </View>

        <View style={styles.completedBadge}>
          <ThemedText type="small" style={styles.completedBadgeText}>
            ✓ Done
          </ThemedText>
        </View>
      </View>

      {/* Volume & Stats */}
      <View style={styles.statsSummaryRow}>
        <View style={styles.statPill}>
          <ThemedText type="smallBold">{item.completedSetCount}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {" "}
            sets
          </ThemedText>
        </View>
        {item.totalVolumeKg > 0 ? (
          <View style={styles.statPill}>
            <ThemedText type="smallBold">{volumeDisplay}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {" "}
              vol
            </ThemedText>
          </View>
        ) : null}
      </View>

      {/* Exercises Logged Summary */}
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
              <ThemedText
                type="small"
                style={styles.completedExName}
                numberOfLines={1}
              >
                {ex.exerciseName} 📈
              </ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.completedExStats}
              >
                {ex.setCount} sets
                {ex.topLoadKg !== null
                  ? ` · max ${unitSystem === "imperial" ? `${Math.round(ex.topLoadKg * 2.20462)}lb` : `${ex.topLoadKg}kg`}`
                  : ""}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {props.onShare && (
        <Pressable
          onPress={props.onShare}
          accessibilityRole="button"
          style={styles.reviewButton}
        >
          <ThemedText type="smallBold">Review sharing / unpublish</ThemedText>
        </Pressable>
      )}
      {/* Actions */}
      <View style={styles.cardActionsRow}>
        <View style={styles.cardActionsLeft}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${item.workout.name}`}
            onPress={onOpen}
            style={styles.reviewButton}
          >
            <ThemedText type="smallBold">View & Edit Sets</ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit details of ${item.workout.name}`}
            onPress={onEdit}
            style={styles.editDetailsButton}
          >
            <ThemedText type="smallBold">Edit Details</ThemedText>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${item.workout.name}`}
          onPress={onDelete}
          style={styles.deleteButton}
        >
          <ThemedText type="small" themeColor="textSecondary">
            Delete
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
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
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    gap: Spacing.one,
  },
  createRoutineHeroCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  createRoutineIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  createRoutineIcon: {
    fontSize: 20,
  },
  createRoutineBody: {
    flex: 1,
    gap: 2,
  },
  secondaryAction: {
    width: "100%",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    backgroundColor: "rgba(148, 163, 184, 0.05)",
  },
  libraryArrow: {
    fontSize: 16,
    color: "#8A8D91",
    fontWeight: "700",
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    color: "#64748B",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tabsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  tabChip: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 7,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    backgroundColor: "rgba(148, 163, 184, 0.05)",
  },
  tabChipActive: {
    backgroundColor: "#10B981",
    borderColor: "#10B981",
  },
  tabChipText: {
    fontSize: 12,
  },
  tabChipTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  emptyStateCard: {
    padding: Spacing.four,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    gap: Spacing.two,
  },
  emptyStateDesc: {
    lineHeight: 19,
  },
  emptyActionsRow: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  emptyActionButton: {
    backgroundColor: "#10B981",
    paddingVertical: 9,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
  },
  emptyActionText: {
    color: "#ffffff",
  },
  emptyActionButtonSecondary: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.25)",
    paddingVertical: 9,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
  },
  routineCard: {
    padding: Spacing.four,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
    gap: Spacing.three,
  },
  historyCard: {
    padding: Spacing.four,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    gap: Spacing.three,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitleBlock: {
    flex: 1,
    gap: 3,
  },
  workoutName: {
    fontSize: 16,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusBadgePlanned: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  statusBadgeStarted: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  statusBadgeTextPlanned: {
    color: "#10B981",
  },
  statusBadgeTextStarted: {
    color: "#F59E0B",
  },
  completedBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  completedBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10B981",
  },
  plannedExercisesList: {
    gap: Spacing.one,
    backgroundColor: "rgba(148, 163, 184, 0.06)",
    padding: Spacing.two,
    borderRadius: 12,
  },
  exerciseChipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  exerciseChip: {
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  exerciseChipText: {
    fontSize: 12,
  },
  statsSummaryRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  statPill: {
    flexDirection: "row",
    backgroundColor: "rgba(148, 163, 184, 0.1)",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: "center",
  },
  completedExercisesList: {
    gap: 5,
    paddingVertical: 2,
  },
  completedExerciseRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.two,
  },
  completedExName: {
    fontWeight: "500",
    flex: 1,
    flexShrink: 1,
  },
  completedExStats: {
    flexShrink: 0,
    textAlign: "right",
  },
  cardActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.half,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.12)",
  },
  cardActionsLeft: {
    flexBasis: 200,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    flexWrap: "wrap",
  },
  startSessionButton: {
    minHeight: 48,
    maxWidth: "100%",
    justifyContent: "center",
    backgroundColor: "#10B981",
    paddingVertical: 8,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
  },
  startSessionText: {
    color: "#ffffff",
  },
  editRoutineButton: {
    minHeight: 48,
    maxWidth: "100%",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.25)",
    paddingVertical: 7,
    paddingHorizontal: Spacing.two,
    borderRadius: 12,
    backgroundColor: "rgba(148, 163, 184, 0.06)",
  },
  reviewButton: {
    minHeight: 48,
    maxWidth: "100%",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.25)",
    paddingVertical: 7,
    paddingHorizontal: Spacing.two,
    borderRadius: 12,
  },
  editDetailsButton: {
    minHeight: 48,
    maxWidth: "100%",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.25)",
    paddingVertical: 7,
    paddingHorizontal: Spacing.two,
    borderRadius: 12,
    backgroundColor: "rgba(148, 163, 184, 0.06)",
  },
  deleteButton: {
    minHeight: 48,
    maxWidth: "100%",
    justifyContent: "center",
    padding: Spacing.one,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.55,
  },
});
