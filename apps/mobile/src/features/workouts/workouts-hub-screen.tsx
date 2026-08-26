import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, useFocusEffect, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useState } from "react";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { analyticsClient } from "@/composition/analytics-client";
import { useAuth } from "@/features/auth/auth-context";

import {
  createBlankWorkout,
  deleteWorkout,
  fetchWorkoutsHubData,
  type ProcessedWorkout,
  type WorkoutsHubResult,
} from "./workouts-hub-data";
import { ExerciseLibraryModal } from "./exercise-library-modal";

type WorkoutsTab = "all" | "planned" | "history";

const INITIAL_DATA: WorkoutsHubResult = {
  activeAndPlanned: [],
  completed: [],
  exercises: [],
  message: null,
};

export function WorkoutsHubScreen() {
  const { profile } = useAuth();
  const unitSystem = profile?.unitSystem ?? "metric";
  const [data, setData] = useState<WorkoutsHubResult>(INITIAL_DATA);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<WorkoutsTab>("all");
  const [busyWorkoutId, setBusyWorkoutId] = useState<string | null>(null);
  const [libraryVisible, setLibraryVisible] = useState(false);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    const result = await fetchWorkoutsHubData();
    setData(result);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "workout_history" },
      });
      void loadData();
    }, [loadData]),
  );

  const handleStartBlank = useCallback(async () => {
    setLoading(true);
    const result = await createBlankWorkout();
    setLoading(false);
    if (result.ok && result.workout) {
      router.push({
        pathname: "/log-workout",
        params: { workoutId: result.workout.id },
      });
    } else if (!result.ok) {
      Alert.alert("Could not start workout", result.message);
    }
  }, []);

  const handleOpenWorkout = useCallback((workoutId: string) => {
    router.push({
      pathname: "/log-workout",
      params: { workoutId },
    });
  }, []);

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

  const totalSetsAllTime = data.completed.reduce(
    (sum, w) => sum + w.completedSetCount,
    0,
  );

  const showPlanned = activeTab === "all" || activeTab === "planned";
  const showHistory = activeTab === "all" || activeTab === "history";

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Workouts" }} />
      <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <ThemedText type="subtitle">Your Workouts</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Manage your routines, planned sessions, and completed history.
            </ThemedText>
          </View>

          {/* Quick Action Buttons */}
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start blank workout"
              onPress={handleStartBlank}
              style={styles.primaryActionButton}
            >
              <ThemedText type="smallBold" style={styles.primaryActionText}>
                ＋ New Session
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Plan with AI Coach"
              onPress={() =>
                router.push({
                  pathname: "/coach",
                  params: { prompt: "Can you design a workout plan for me?" },
                })
              }
              style={styles.secondaryActionButton}
            >
              <ThemedText type="smallBold" style={styles.secondaryActionText}>
                💬 Coach Plan
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Browse exercise library"
              onPress={() => setLibraryVisible(true)}
              style={styles.secondaryActionButton}
            >
              <ThemedText type="smallBold" style={styles.secondaryActionText}>
                📚 880+ Catalog
              </ThemedText>
            </Pressable>
          </View>

          {/* Metrics Summary */}
          <ThemedView type="backgroundElement" style={styles.metricsCard}>
            <View style={styles.metricItem}>
              <ThemedText type="subtitle">
                {data.activeAndPlanned.length}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Planned / Active
              </ThemedText>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <ThemedText type="subtitle">{data.completed.length}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Completed
              </ThemedText>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <ThemedText type="subtitle">{totalSetsAllTime}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Total Sets Logged
              </ThemedText>
            </View>
          </ThemedView>

          {/* Tab Filter Chips */}
          <View style={styles.tabsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show all workouts"
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
              accessibilityLabel="Show planned and active workouts"
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
                Active & Planned ({data.activeAndPlanned.length})
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show completed workout history"
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

          {/* Section 1: Active & Planned Sessions */}
          {showPlanned ? (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText type="smallBold">ACTIVE & PLANNED</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {data.activeAndPlanned.length} sessions
                </ThemedText>
              </View>

              {data.activeAndPlanned.length === 0 ? (
                <ThemedView
                  type="backgroundElement"
                  style={styles.emptyStateCard}
                >
                  <ThemedText type="smallBold">
                    No active or planned workouts
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.emptyStateDesc}
                  >
                    Ask the AI Coach to build a personalized multi-day routine,
                    or start a blank custom workout right away.
                  </ThemedText>
                  <View style={styles.emptyActionsRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Ask Coach for routine"
                      onPress={() => router.push("/coach" as Href)}
                      style={styles.emptyActionButton}
                    >
                      <ThemedText
                        type="smallBold"
                        style={styles.emptyActionText}
                      >
                        Ask Coach
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Start custom session"
                      onPress={handleStartBlank}
                      style={styles.emptyActionButtonSecondary}
                    >
                      <ThemedText type="smallBold">Start Custom</ThemedText>
                    </Pressable>
                  </View>
                </ThemedView>
              ) : (
                data.activeAndPlanned.map((item) => (
                  <PlannedWorkoutCard
                    key={item.workout.id}
                    item={item}
                    isBusy={busyWorkoutId === item.workout.id}
                    onOpen={() => handleOpenWorkout(item.workout.id)}
                    onDelete={() => handleConfirmDelete(item)}
                  />
                ))
              )}
            </View>
          ) : null}

          {/* Section 2: Completed History */}
          {showHistory ? (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <ThemedText type="smallBold">COMPLETED HISTORY</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {data.completed.length} logged workouts
                </ThemedText>
              </View>

              {data.completed.length === 0 ? (
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
                    onDelete={() => handleConfirmDelete(item)}
                  />
                ))
              )}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <ExerciseLibraryModal
        visible={libraryVisible}
        onClose={() => setLibraryVisible(false)}
      />
    </ThemedView>
  );
}

function PlannedWorkoutCard(props: {
  readonly item: ProcessedWorkout;
  readonly isBusy: boolean;
  readonly onOpen: () => void;
  readonly onDelete: () => void;
}) {
  const { item, onOpen, onDelete } = props;
  const isStarted = item.status === "in_progress";

  return (
    <ThemedView type="backgroundElement" style={styles.workoutCard}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleBlock}>
          <ThemedText type="smallBold" style={styles.workoutName}>
            {item.workout.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.displayDate}
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
              ? `In Progress (${item.completedSetCount} sets)`
              : "Planned"}
          </ThemedText>
        </View>
      </View>

      {/* Planned Exercises preview */}
      {item.plannedExercises.length > 0 ? (
        <View style={styles.plannedExercisesList}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Planned Routine ({item.plannedExercises.length} exercises):
          </ThemedText>
          <View style={styles.exerciseChipsGrid}>
            {item.plannedExercises.map((ex, index) => (
              <View key={`${ex.name}-${index}`} style={styles.exerciseChip}>
                <ThemedText type="small" style={styles.exerciseChipText}>
                  {ex.name}
                  {ex.targetSets ? ` (${ex.targetSets} sets)` : ""}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Action Buttons */}
      <View style={styles.cardActionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.workout.name}`}
          onPress={onOpen}
          style={styles.startSessionButton}
        >
          <ThemedText type="smallBold" style={styles.startSessionText}>
            {isStarted ? "Continue Session →" : "Start Session →"}
          </ThemedText>
        </Pressable>

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
  readonly item: ProcessedWorkout;
  readonly unitSystem: "metric" | "imperial";
  readonly isBusy: boolean;
  readonly onOpen: () => void;
  readonly onDelete: () => void;
}) {
  const { item, unitSystem, onOpen, onDelete } = props;
  const volumeDisplay =
    unitSystem === "imperial"
      ? `${Math.round(item.totalVolumeKg * 2.20462)} lb`
      : `${Math.round(item.totalVolumeKg)} kg`;

  return (
    <ThemedView type="backgroundElement" style={styles.workoutCard}>
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
            <View key={ex.exerciseId} style={styles.completedExerciseRow}>
              <ThemedText type="small" style={styles.completedExName}>
                {ex.exerciseName}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {ex.setCount} sets
                {ex.topLoadKg !== null
                  ? ` · max ${unitSystem === "imperial" ? `${Math.round(ex.topLoadKg * 2.20462)}lb` : `${ex.topLoadKg}kg`}`
                  : ""}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      {/* Actions */}
      <View style={styles.cardActionsRow}>
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
    padding: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    gap: Spacing.one,
  },
  actionRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  primaryActionButton: {
    flex: 1.2,
    backgroundColor: "#18633d",
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  primaryActionText: {
    color: "#ffffff",
  },
  secondaryActionButton: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  secondaryActionText: {
    fontSize: 13,
  },
  metricsCard: {
    flexDirection: "row",
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(138, 141, 145, 0.3)",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metricItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: "#8A8D91",
  },
  tabsRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  tabChip: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
  },
  tabChipActive: {
    backgroundColor: "#18633d",
    borderColor: "#18633d",
  },
  tabChipText: {
    fontSize: 12,
  },
  tabChipTextActive: {
    color: "#ffffff",
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  emptyStateCard: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(138, 141, 145, 0.3)",
    gap: Spacing.two,
  },
  emptyStateDesc: {
    lineHeight: 18,
  },
  emptyActionsRow: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  emptyActionButton: {
    backgroundColor: "#18633d",
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  emptyActionText: {
    color: "#ffffff",
  },
  emptyActionButtonSecondary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  workoutCard: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(138, 141, 145, 0.3)",
    gap: Spacing.two,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitleBlock: {
    flex: 1,
    gap: 2,
  },
  workoutName: {
    fontSize: 16,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgePlanned: {
    backgroundColor: "rgba(138, 141, 145, 0.15)",
  },
  statusBadgeStarted: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  statusBadgeTextPlanned: {
    color: "#8A8D91",
  },
  statusBadgeTextStarted: {
    color: "#10B981",
  },
  completedBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  completedBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#10B981",
  },
  plannedExercisesList: {
    gap: Spacing.one,
    backgroundColor: "rgba(0,0,0,0.02)",
    padding: Spacing.two,
    borderRadius: Spacing.one,
  },
  exerciseChipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  exerciseChip: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
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
    backgroundColor: "rgba(138, 141, 145, 0.1)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignItems: "center",
  },
  completedExercisesList: {
    gap: 4,
    paddingVertical: 2,
  },
  completedExerciseRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  completedExName: {
    fontWeight: "500",
  },
  cardActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.one,
    paddingTop: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(138, 141, 145, 0.2)",
  },
  startSessionButton: {
    backgroundColor: "#18633d",
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  startSessionText: {
    color: "#ffffff",
  },
  reviewButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  deleteButton: {
    padding: Spacing.one,
  },
});
