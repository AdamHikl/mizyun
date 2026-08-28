import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useCallback, useEffect, useState } from "react";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import {
  displayWeightToKilograms,
  kilogramsToDisplayWeight,
  weightUnitLabel,
} from "@/lib/weight-units";

import {
  fetchExerciseProgression,
  updateExerciseTargetLoad,
  type ExerciseProgressionSummary,
  type ExerciseSessionProgression,
} from "./exercise-progression-data";

interface ExerciseProgressionModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly exerciseId?: string | null;
  readonly exerciseName: string;
  readonly movementPattern?: string;
  readonly category?: string;
  readonly onSelectForWorkout?: (exerciseName: string) => void;
}

export function ExerciseProgressionModal({
  visible,
  onClose,
  exerciseId,
  exerciseName,
  movementPattern,
  category,
  onSelectForWorkout,
}: ExerciseProgressionModalProps) {
  const { profile } = useAuth();
  const unitSystem = profile?.unitSystem ?? "metric";
  const unit = weightUnitLabel(unitSystem);
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [progression, setProgression] =
    useState<ExerciseProgressionSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Target Load edit mode
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [targetLoadInput, setTargetLoadInput] = useState("");
  const [targetRepsInput, setTargetRepsInput] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);

  const loadData = useCallback(async () => {
    if (!exerciseName.trim()) return;
    setLoading(true);
    setErrorMessage(null);
    const result = await fetchExerciseProgression(
      { exerciseId: exerciseId ?? undefined, exerciseName },
      unitSystem,
    );
    if (result.progression) {
      setProgression(result.progression);
      if (result.progression.currentTargetLoadKg !== null) {
        setTargetLoadInput(
          String(
            kilogramsToDisplayWeight(
              result.progression.currentTargetLoadKg,
              unitSystem,
            ),
          ),
        );
      }
      if (result.progression.currentTargetReps) {
        setTargetRepsInput(result.progression.currentTargetReps);
      }
    } else {
      setErrorMessage(result.message);
    }
    setLoading(false);
  }, [exerciseId, exerciseName, unitSystem]);

  useEffect(() => {
    if (visible) {
      setIsEditingTarget(false);
      void loadData();
    }
  }, [visible, loadData]);

  const handleSaveTargetLoad = useCallback(async () => {
    const rawNum = Number.parseFloat(targetLoadInput.trim());
    if (Number.isNaN(rawNum) || rawNum <= 0) {
      setErrorMessage("Enter a valid target weight.");
      return;
    }
    setSavingTarget(true);
    setErrorMessage(null);
    const loadKg = displayWeightToKilograms(rawNum, unitSystem);
    const result = await updateExerciseTargetLoad(
      exerciseName,
      loadKg,
      targetRepsInput.trim() || undefined,
      progression?.exerciseId ?? exerciseId,
    );
    setSavingTarget(false);
    if (result.ok) {
      setIsEditingTarget(false);
      await loadData();
    } else {
      setErrorMessage(result.message ?? "Could not update target load.");
    }
  }, [
    exerciseId,
    exerciseName,
    loadData,
    progression?.exerciseId,
    targetLoadInput,
    targetRepsInput,
    unitSystem,
  ]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ThemedView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <View style={styles.headerTitleBlock}>
              <ThemedText type="subtitle">{exerciseName}</ThemedText>
              <View style={styles.badgesRow}>
                {movementPattern ? (
                  <View style={styles.badge}>
                    <ThemedText type="small" style={styles.badgeText}>
                      {movementPattern.replace("_", " ")}
                    </ThemedText>
                  </View>
                ) : null}
                {category ? (
                  <View style={styles.badgeSecondary}>
                    <ThemedText type="small" style={styles.badgeSecondaryText}>
                      {category}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close modal"
              onPress={onClose}
              style={styles.closeButton}
            >
              <ThemedText type="smallBold" themeColor="primary">
                Done
              </ThemedText>
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Loading progression & load history…
              </ThemedText>
            </View>
          ) : (
            <>
              {errorMessage ? (
                <View style={styles.errorBanner} accessibilityRole="alert">
                  <ThemedText style={styles.errorText}>
                    {errorMessage}
                  </ThemedText>
                </View>
              ) : null}

              {/* 1. Target Load Card */}
              <ThemedView type="backgroundElement" style={styles.targetCard}>
                <View style={styles.cardHeaderRow}>
                  <View>
                    <ThemedText type="smallBold" style={styles.cardLabel}>
                      TARGET LOAD TRACKER
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Your current target weight and rep goal
                    </ThemedText>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      isEditingTarget
                        ? "Cancel editing target"
                        : "Edit target load"
                    }
                    onPress={() => {
                      setIsEditingTarget(!isEditingTarget);
                      setErrorMessage(null);
                    }}
                    style={styles.editTargetButton}
                  >
                    <ThemedText type="smallBold" style={styles.editTargetText}>
                      {isEditingTarget ? "Cancel" : "✏️ Set Target"}
                    </ThemedText>
                  </Pressable>
                </View>

                {isEditingTarget ? (
                  <View style={styles.targetEditBlock}>
                    <View style={styles.targetInputRow}>
                      <View style={styles.targetInputField}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Target Load ({unit})
                        </ThemedText>
                        <TextInput
                          style={[styles.input, { color: theme.text }]}
                          placeholder={`e.g. 85`}
                          placeholderTextColor="#8A8D91"
                          value={targetLoadInput}
                          onChangeText={setTargetLoadInput}
                          keyboardType="decimal-pad"
                          autoFocus
                        />
                      </View>

                      <View style={styles.targetInputField}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Target Reps (opt)
                        </ThemedText>
                        <TextInput
                          style={[styles.input, { color: theme.text }]}
                          placeholder="e.g. 8-10"
                          placeholderTextColor="#8A8D91"
                          value={targetRepsInput}
                          onChangeText={setTargetRepsInput}
                        />
                      </View>
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Save target load"
                      disabled={savingTarget}
                      onPress={handleSaveTargetLoad}
                      style={styles.saveTargetButton}
                    >
                      <ThemedText
                        type="smallBold"
                        style={styles.saveTargetText}
                      >
                        {savingTarget ? "Saving…" : "Save Target Load"}
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.targetDisplayBlock}>
                    <View style={styles.targetMainRow}>
                      <ThemedText type="title" style={styles.targetLoadNumber}>
                        {progression?.currentTargetLoadKg !== null &&
                        progression?.currentTargetLoadKg !== undefined
                          ? `${kilogramsToDisplayWeight(progression.currentTargetLoadKg, unitSystem)} ${unit}`
                          : "No target set"}
                      </ThemedText>
                      {progression?.currentTargetReps ? (
                        <View style={styles.repsBadge}>
                          <ThemedText
                            type="smallBold"
                            style={styles.repsBadgeText}
                          >
                            {progression.currentTargetReps} reps
                          </ThemedText>
                        </View>
                      ) : null}
                    </View>

                    {/* Comparison Status */}
                    {progression?.currentTargetLoadKg !== null &&
                    progression?.currentTargetLoadKg !== undefined ? (
                      <View style={styles.targetStatusBox}>
                        {progression.allTimeBestLoadKg !== null &&
                        progression.allTimeBestLoadKg >=
                          progression.currentTargetLoadKg ? (
                          <ThemedText
                            type="smallBold"
                            style={styles.targetAchievedText}
                          >
                            🎯 Target achieved! Current PR:{" "}
                            {progression.allTimeBestLoadDisplay}
                          </ThemedText>
                        ) : progression.allTimeBestLoadKg !== null ? (
                          <ThemedText type="small" themeColor="textSecondary">
                            📈 Best load is {progression.allTimeBestLoadDisplay}{" "}
                            (
                            {kilogramsToDisplayWeight(
                              progression.currentTargetLoadKg -
                                progression.allTimeBestLoadKg,
                              unitSystem,
                            )}{" "}
                            {unit} to goal)
                          </ThemedText>
                        ) : (
                          <ThemedText type="small" themeColor="textSecondary">
                            🎯 Target configured for upcoming workouts
                          </ThemedText>
                        )}
                      </View>
                    ) : null}
                  </View>
                )}
              </ThemedView>

              {/* 2. Key Performance Metrics Grid */}
              <View style={styles.statsGrid}>
                <ThemedView
                  type="backgroundElement"
                  style={styles.statMetricCard}
                >
                  <ThemedText type="small" themeColor="textSecondary">
                    🏆 All-Time PR
                  </ThemedText>
                  <ThemedText type="subtitle">
                    {progression?.allTimeBestLoadDisplay ?? "—"}
                  </ThemedText>
                </ThemedView>

                <ThemedView
                  type="backgroundElement"
                  style={styles.statMetricCard}
                >
                  <ThemedText type="small" themeColor="textSecondary">
                    ⚡ Estimated 1RM
                  </ThemedText>
                  <ThemedText type="subtitle">
                    {progression?.allTimeBest1RMDisplay ?? "—"}
                  </ThemedText>
                </ThemedView>

                <ThemedView
                  type="backgroundElement"
                  style={styles.statMetricCard}
                >
                  <ThemedText type="small" themeColor="textSecondary">
                    📊 Logged Sessions
                  </ThemedText>
                  <ThemedText type="subtitle">
                    {progression?.totalSessionsCount ?? 0}
                  </ThemedText>
                </ThemedView>

                <ThemedView
                  type="backgroundElement"
                  style={styles.statMetricCard}
                >
                  <ThemedText type="small" themeColor="textSecondary">
                    🏋️ Total Volume
                  </ThemedText>
                  <ThemedText type="subtitle">
                    {progression?.totalVolumeDisplay ?? "—"}
                  </ThemedText>
                </ThemedView>
              </View>

              {/* 3. Load Progression Visual Chart */}
              {progression && progression.sessionsChronological.length >= 2 ? (
                <ThemedView
                  type="backgroundElement"
                  style={styles.progressionChartCard}
                >
                  <View style={styles.cardHeaderRow}>
                    <ThemedText type="smallBold" style={styles.cardLabel}>
                      LOAD PROGRESSION OVER TIME
                    </ThemedText>
                    {progression.loadDeltaKg !== null && (
                      <ThemedText
                        type="smallBold"
                        style={
                          progression.loadDeltaKg >= 0
                            ? styles.positiveDelta
                            : styles.negativeDelta
                        }
                      >
                        {progression.loadDeltaKg >= 0 ? "▲ +" : "▼ "}
                        {kilogramsToDisplayWeight(
                          Math.abs(progression.loadDeltaKg),
                          unitSystem,
                        )}{" "}
                        {unit} ({progression.loadDeltaPercent}%)
                      </ThemedText>
                    )}
                  </View>

                  <ProgressionChart
                    sessions={progression.sessionsChronological}
                    targetLoadKg={progression.currentTargetLoadKg}
                    unitSystem={unitSystem}
                  />
                </ThemedView>
              ) : null}

              {/* 4. Session History List */}
              <View style={styles.historySection}>
                <ThemedText type="smallBold" style={styles.cardLabel}>
                  SESSION HISTORY ({progression?.totalSessionsCount ?? 0})
                </ThemedText>

                {!progression ||
                progression.sessionsNewestFirst.length === 0 ? (
                  <ThemedView
                    type="backgroundElement"
                    style={styles.emptyHistoryCard}
                  >
                    <ThemedText type="smallBold">No logged sets yet</ThemedText>
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.emptyHistoryDesc}
                    >
                      Sets logged for this exercise during workout sessions will
                      appear here with load, reps, and volume progression.
                    </ThemedText>
                  </ThemedView>
                ) : (
                  progression.sessionsNewestFirst.map((session, index) => (
                    <SessionProgressionCard
                      key={`${session.workoutId}-${index}`}
                      session={session}
                      unitSystem={unitSystem}
                    />
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

function ProgressionChart(props: {
  readonly sessions: ReadonlyArray<ExerciseSessionProgression>;
  readonly targetLoadKg: number | null;
  readonly unitSystem: "metric" | "imperial";
}) {
  const { sessions, unitSystem } = props;
  const recentSessions = sessions.slice(-10);
  const values = recentSessions
    .map((s) => s.peakLoadKg)
    .filter((v): v is number => v !== null && v > 0);

  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 5);

  return (
    <View style={styles.chartContainer}>
      <View style={styles.chartBarsRow}>
        {recentSessions.map((s, idx) => {
          const load = s.peakLoadKg ?? min;
          const heightPercent = Math.max(
            15,
            Math.min(100, ((load - min) / span) * 80 + 20),
          );
          const isTargetExceeded = s.targetStatus === "exceeded_target";
          const isTargetHit = s.targetStatus === "hit_target";

          return (
            <View key={`${s.workoutId}-${idx}`} style={styles.chartBarCol}>
              <ThemedText style={styles.chartBarValue}>
                {kilogramsToDisplayWeight(load, unitSystem)}
              </ThemedText>
              <View style={styles.chartBarTrack}>
                <View
                  style={[
                    styles.chartBarFill,
                    { height: `${heightPercent}%` },
                    isTargetExceeded && styles.chartBarExceeded,
                    isTargetHit && styles.chartBarHit,
                  ]}
                />
              </View>
              <ThemedText style={styles.chartBarLabel} numberOfLines={1}>
                {s.displayDate.split(",")[0]}
              </ThemedText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function SessionProgressionCard(props: {
  readonly session: ExerciseSessionProgression;
  readonly unitSystem: "metric" | "imperial";
}) {
  const { session, unitSystem } = props;
  const unit = weightUnitLabel(unitSystem);

  return (
    <ThemedView type="backgroundElement" style={styles.sessionCard}>
      <View style={styles.sessionCardHeader}>
        <View style={styles.sessionTitleBlock}>
          <ThemedText type="smallBold">{session.workoutName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {session.displayDate} · {session.sets.length} sets
          </ThemedText>
        </View>

        {session.targetStatus === "exceeded_target" ? (
          <View style={styles.targetBadgeExceeded}>
            <ThemedText type="small" style={styles.targetBadgeExceededText}>
              ★ Exceeded Target
            </ThemedText>
          </View>
        ) : session.targetStatus === "hit_target" ? (
          <View style={styles.targetBadgeHit}>
            <ThemedText type="small" style={styles.targetBadgeHitText}>
              ✓ Hit Target
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.sessionStatsRow}>
        <View style={styles.sessionStatPill}>
          <ThemedText type="small" themeColor="textSecondary">
            Peak:{" "}
          </ThemedText>
          <ThemedText type="smallBold">{session.peakLoadDisplay}</ThemedText>
        </View>
        <View style={styles.sessionStatPill}>
          <ThemedText type="small" themeColor="textSecondary">
            1RM:{" "}
          </ThemedText>
          <ThemedText type="smallBold">
            {session.estimated1RMDisplay}
          </ThemedText>
        </View>
        <View style={styles.sessionStatPill}>
          <ThemedText type="small" themeColor="textSecondary">
            Vol:{" "}
          </ThemedText>
          <ThemedText type="smallBold">{session.totalVolumeDisplay}</ThemedText>
        </View>
      </View>

      {/* Sets detail breakdown */}
      <View style={styles.sessionSetsList}>
        {session.sets.map((set) => (
          <View key={set.id} style={styles.sessionSetRow}>
            <ThemedText type="small" style={styles.setSequenceText}>
              Set {set.sequence}
            </ThemedText>
            <ThemedText type="small" style={styles.setPerformanceText}>
              {set.loadKg !== null
                ? `${kilogramsToDisplayWeight(set.loadKg, unitSystem)} ${unit}`
                : "Bodyweight"}
              {set.repetitions !== null ? ` × ${set.repetitions} reps` : ""}
              {set.perceivedExertion !== null
                ? ` (RPE ${set.perceivedExertion})`
                : ""}
            </ThemedText>
          </View>
        ))}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#8A8D91",
  },
  headerTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerTitleBlock: {
    flex: 1,
    gap: Spacing.one,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  badge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    color: "#10B981",
    fontWeight: "600",
    textTransform: "capitalize",
  },
  badgeSecondary: {
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeSecondaryText: {
    fontSize: 11,
    textTransform: "capitalize",
  },
  closeButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.four,
    paddingBottom: Spacing.six * 2,
  },
  loadingContainer: {
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  errorBanner: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderColor: "#EF4444",
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
  },
  errorText: {
    color: "#EF4444",
    fontSize: 13,
  },
  targetCard: {
    padding: Spacing.four,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    backgroundColor: "rgba(16, 185, 129, 0.06)",
    gap: Spacing.three,
  },
  cardLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    color: "#64748B",
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  editTargetButton: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: 8,
  },
  editTargetText: {
    color: "#10B981",
    fontSize: 12,
  },
  targetDisplayBlock: {
    gap: Spacing.two,
  },
  targetMainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  targetLoadNumber: {
    fontSize: 26,
  },
  repsBadge: {
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  repsBadgeText: {
    fontSize: 12,
  },
  targetStatusBox: {
    marginTop: 2,
  },
  targetAchievedText: {
    color: "#10B981",
    fontSize: 13,
  },
  targetEditBlock: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  targetInputRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  targetInputField: {
    flex: 1,
    gap: 4,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 15,
  },
  saveTargetButton: {
    backgroundColor: "#10B981",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  saveTargetText: {
    color: "#ffffff",
    fontSize: 13,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  statMetricCard: {
    flex: 1,
    minWidth: "47%",
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    gap: 4,
  },
  progressionChartCard: {
    padding: Spacing.four,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    gap: Spacing.three,
  },
  positiveDelta: {
    color: "#10B981",
    fontSize: 12,
  },
  negativeDelta: {
    color: "#EF4444",
    fontSize: 12,
  },
  chartContainer: {
    height: 120,
    marginTop: Spacing.two,
  },
  chartBarsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  chartBarCol: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    height: "100%",
    justifyContent: "flex-end",
  },
  chartBarValue: {
    fontSize: 10,
    color: "#8A8D91",
  },
  chartBarTrack: {
    width: "100%",
    height: 75,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    borderRadius: 4,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  chartBarFill: {
    width: "100%",
    backgroundColor: "#18633d",
    borderRadius: 4,
  },
  chartBarHit: {
    backgroundColor: "#10B981",
  },
  chartBarExceeded: {
    backgroundColor: "#F59E0B",
  },
  chartBarLabel: {
    fontSize: 9,
    color: "#8A8D91",
  },
  historySection: {
    gap: Spacing.two,
  },
  emptyHistoryCard: {
    padding: Spacing.four,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    gap: Spacing.one,
  },
  emptyHistoryDesc: {
    lineHeight: 18,
  },
  sessionCard: {
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    gap: Spacing.two,
  },
  sessionCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  sessionTitleBlock: {
    flex: 1,
    gap: 2,
  },
  targetBadgeHit: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  targetBadgeHitText: {
    color: "#10B981",
    fontSize: 11,
    fontWeight: "600",
  },
  targetBadgeExceeded: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  targetBadgeExceededText: {
    color: "#F59E0B",
    fontSize: 11,
    fontWeight: "600",
  },
  sessionStatsRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingVertical: 2,
  },
  sessionStatPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sessionSetsList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(148, 163, 184, 0.15)",
    paddingTop: 6,
    gap: 4,
  },
  sessionSetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  setSequenceText: {
    color: "#8A8D91",
    fontSize: 12,
  },
  setPerformanceText: {
    fontSize: 12,
    fontWeight: "500",
  },
});
