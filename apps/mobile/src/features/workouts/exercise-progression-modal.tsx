import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Card,
  Chip,
  FormField,
  FormTextInput,
  Icon,
  Notice,
} from "@/components/ui";
import { PageGutter, Radius, Spacing } from "@/constants/theme";
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
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.separator }]}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerTitleBlock}>
                <ThemedText type="subtitle">{exerciseName}</ThemedText>
                <View style={styles.badgesRow}>
                  {movementPattern ? (
                    <Chip
                      label={movementPattern.replace("_", " ")}
                      tone="primary"
                    />
                  ) : null}
                  {category ? <Chip label={category} /> : null}
                </View>
              </View>
              <Button
                label="Done"
                accessibilityLabel="Close modal"
                variant="plain"
                size="small"
                onPress={onClose}
              />
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
                  <Notice tone="danger" message={errorMessage} />
                ) : null}

                {/* 1. Target load card */}
                <Card>
                  <View style={styles.targetHeaderRow}>
                    <View style={styles.targetHeaderCopy}>
                      <ThemedText type="headline">
                        Target load tracker
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Your current target weight and rep goal
                      </ThemedText>
                    </View>
                    <Button
                      label={isEditingTarget ? "Cancel" : "Set target"}
                      accessibilityLabel={
                        isEditingTarget
                          ? "Cancel editing target"
                          : "Edit target load"
                      }
                      variant={isEditingTarget ? "plain" : "tinted"}
                      size="small"
                      icon={isEditingTarget ? undefined : "edit"}
                      onPress={() => {
                        setIsEditingTarget(!isEditingTarget);
                        setErrorMessage(null);
                      }}
                    />
                  </View>

                  {isEditingTarget ? (
                    <View style={styles.targetEditBlock}>
                      <View style={styles.targetInputRow}>
                        <View style={styles.targetInputField}>
                          <FormField label={`Target load (${unit})`}>
                            <FormTextInput
                              placeholder={`e.g. 85`}
                              value={targetLoadInput}
                              onChangeText={setTargetLoadInput}
                              keyboardType="decimal-pad"
                              autoFocus
                            />
                          </FormField>
                        </View>

                        <View style={styles.targetInputField}>
                          <FormField label="Target reps (optional)">
                            <FormTextInput
                              placeholder="e.g. 8-10"
                              value={targetRepsInput}
                              onChangeText={setTargetRepsInput}
                            />
                          </FormField>
                        </View>
                      </View>

                      <Button
                        label={savingTarget ? "Saving…" : "Save target load"}
                        accessibilityLabel="Save target load"
                        variant="primary"
                        block
                        disabled={savingTarget}
                        onPress={handleSaveTargetLoad}
                      />
                    </View>
                  ) : (
                    <View style={styles.targetDisplayBlock}>
                      <View style={styles.targetMainRow}>
                        <ThemedText type="title">
                          {progression?.currentTargetLoadKg !== null &&
                          progression?.currentTargetLoadKg !== undefined
                            ? `${kilogramsToDisplayWeight(progression.currentTargetLoadKg, unitSystem)} ${unit}`
                            : "No target set"}
                        </ThemedText>
                        {progression?.currentTargetReps ? (
                          <Chip
                            label={`${progression.currentTargetReps} reps`}
                          />
                        ) : null}
                      </View>

                      {/* Comparison status */}
                      {progression?.currentTargetLoadKg !== null &&
                      progression?.currentTargetLoadKg !== undefined ? (
                        <View style={styles.targetStatusRow}>
                          {progression.allTimeBestLoadKg !== null &&
                          progression.allTimeBestLoadKg >=
                            progression.currentTargetLoadKg ? (
                            <>
                              <Icon
                                name="checkCircle"
                                size={16}
                                color="primary"
                              />
                              <ThemedText
                                type="smallBold"
                                themeColor="primary"
                                style={styles.statusText}
                              >
                                Target achieved! Current PR:{" "}
                                {progression.allTimeBestLoadDisplay}
                              </ThemedText>
                            </>
                          ) : progression.allTimeBestLoadKg !== null ? (
                            <>
                              <Icon
                                name="chart"
                                size={16}
                                color="textSecondary"
                              />
                              <ThemedText
                                type="small"
                                themeColor="textSecondary"
                                style={styles.statusText}
                              >
                                Best load is{" "}
                                {progression.allTimeBestLoadDisplay} (
                                {kilogramsToDisplayWeight(
                                  progression.currentTargetLoadKg -
                                    progression.allTimeBestLoadKg,
                                  unitSystem,
                                )}{" "}
                                {unit} to goal)
                              </ThemedText>
                            </>
                          ) : (
                            <>
                              <Icon
                                name="target"
                                size={16}
                                color="textSecondary"
                              />
                              <ThemedText
                                type="small"
                                themeColor="textSecondary"
                                style={styles.statusText}
                              >
                                Target configured for upcoming workouts
                              </ThemedText>
                            </>
                          )}
                        </View>
                      ) : null}
                    </View>
                  )}
                </Card>

                {/* 2. Key performance metrics */}
                <View style={styles.statsGrid}>
                  <Card style={styles.statMetricCard}>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      All-time PR
                    </ThemedText>
                    <ThemedText type="subtitle">
                      {progression?.allTimeBestLoadDisplay ?? "—"}
                    </ThemedText>
                  </Card>

                  <Card style={styles.statMetricCard}>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Estimated 1RM
                    </ThemedText>
                    <ThemedText type="subtitle">
                      {progression?.allTimeBest1RMDisplay ?? "—"}
                    </ThemedText>
                  </Card>

                  <Card style={styles.statMetricCard}>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Logged sessions
                    </ThemedText>
                    <ThemedText type="subtitle">
                      {progression?.totalSessionsCount ?? 0}
                    </ThemedText>
                  </Card>

                  <Card style={styles.statMetricCard}>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Total volume
                    </ThemedText>
                    <ThemedText type="subtitle">
                      {progression?.totalVolumeDisplay ?? "—"}
                    </ThemedText>
                  </Card>
                </View>

                {/* 3. Load progression chart */}
                {progression &&
                progression.sessionsChronological.length >= 2 ? (
                  <Card>
                    <View style={styles.cardHeaderRow}>
                      <ThemedText type="headline">
                        Load progression over time
                      </ThemedText>
                      {progression.loadDeltaKg !== null && (
                        <View style={styles.deltaRow}>
                          <Icon
                            name={
                              progression.loadDeltaKg >= 0
                                ? "chevronUp"
                                : "chevronDown"
                            }
                            size={12}
                            color={
                              progression.loadDeltaKg >= 0
                                ? "primary"
                                : "danger"
                            }
                          />
                          <ThemedText
                            type="smallBold"
                            themeColor={
                              progression.loadDeltaKg >= 0
                                ? "primary"
                                : "danger"
                            }
                          >
                            {progression.loadDeltaKg >= 0 ? "+" : ""}
                            {kilogramsToDisplayWeight(
                              Math.abs(progression.loadDeltaKg),
                              unitSystem,
                            )}{" "}
                            {unit} ({progression.loadDeltaPercent}%)
                          </ThemedText>
                        </View>
                      )}
                    </View>

                    <ProgressionChart
                      sessions={progression.sessionsChronological}
                      targetLoadKg={progression.currentTargetLoadKg}
                      unitSystem={unitSystem}
                    />
                  </Card>
                ) : null}

                {/* 4. Session history */}
                <View style={styles.historySection}>
                  <ThemedText type="headline" accessibilityRole="header">
                    Session history ({progression?.totalSessionsCount ?? 0})
                  </ThemedText>

                  {!progression ||
                  progression.sessionsNewestFirst.length === 0 ? (
                    <Card>
                      <ThemedText type="smallBold">
                        No logged sets yet
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Sets logged for this exercise during workout sessions
                        will appear here with load, reps, and volume
                        progression.
                      </ThemedText>
                    </Card>
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
        </SafeAreaView>
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
  const theme = useTheme();
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
          const barColor = isTargetExceeded
            ? theme.warning
            : isTargetHit
              ? theme.primary
              : theme.textTertiary;

          return (
            <View key={`${s.workoutId}-${idx}`} style={styles.chartBarCol}>
              <ThemedText
                type="caption"
                themeColor="textTertiary"
                style={styles.chartBarText}
              >
                {kilogramsToDisplayWeight(load, unitSystem)}
              </ThemedText>
              <View
                style={[
                  styles.chartBarTrack,
                  { backgroundColor: theme.backgroundSelected },
                ]}
              >
                <View
                  style={[
                    styles.chartBarFill,
                    { height: `${heightPercent}%`, backgroundColor: barColor },
                  ]}
                />
              </View>
              <ThemedText
                type="caption"
                themeColor="textTertiary"
                style={styles.chartBarText}
                numberOfLines={1}
              >
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
  const theme = useTheme();
  const unit = weightUnitLabel(unitSystem);
  const pillStyle = [
    styles.sessionStatPill,
    { backgroundColor: theme.backgroundSelected },
  ];

  return (
    <Card>
      <View style={styles.sessionCardHeader}>
        <View style={styles.sessionTitleBlock}>
          <ThemedText type="smallBold">{session.workoutName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {session.displayDate} · {session.sets.length} sets
          </ThemedText>
        </View>

        {session.targetStatus === "exceeded_target" ? (
          <Chip label="Exceeded target" tone="warning" icon="arrowUp" />
        ) : session.targetStatus === "hit_target" ? (
          <Chip label="Hit target" tone="primary" icon="check" />
        ) : null}
      </View>

      <View style={styles.sessionStatsRow}>
        <View style={pillStyle}>
          <ThemedText type="small" themeColor="textSecondary">
            Peak:{" "}
          </ThemedText>
          <ThemedText type="smallBold">{session.peakLoadDisplay}</ThemedText>
        </View>
        <View style={pillStyle}>
          <ThemedText type="small" themeColor="textSecondary">
            1RM:{" "}
          </ThemedText>
          <ThemedText type="smallBold">
            {session.estimated1RMDisplay}
          </ThemedText>
        </View>
        <View style={pillStyle}>
          <ThemedText type="small" themeColor="textSecondary">
            Vol:{" "}
          </ThemedText>
          <ThemedText type="smallBold">{session.totalVolumeDisplay}</ThemedText>
        </View>
      </View>

      {/* Sets detail breakdown */}
      <View
        style={[styles.sessionSetsList, { borderTopColor: theme.separator }]}
      >
        {session.sets.map((set) => (
          <View key={set.id} style={styles.sessionSetRow}>
            <ThemedText type="footnote" themeColor="textSecondary">
              Set {set.sequence}
            </ThemedText>
            <ThemedText type="footnote" style={styles.setPerformanceText}>
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
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: PageGutter,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.two,
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
  content: {
    padding: PageGutter,
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  loadingContainer: {
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.two,
  },
  targetHeaderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  targetHeaderCopy: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 0,
  },
  targetDisplayBlock: {
    gap: Spacing.two,
  },
  targetMainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  targetStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  statusText: {
    flexShrink: 1,
  },
  targetEditBlock: {
    gap: Spacing.three,
  },
  targetInputRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  targetInputField: {
    flex: 1,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  statMetricCard: {
    flex: 1,
    minWidth: "47%",
    gap: Spacing.one,
  },
  deltaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  chartContainer: {
    height: 120,
    marginTop: Spacing.two,
  },
  chartBarsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.two,
  },
  chartBarCol: {
    flex: 1,
    alignItems: "center",
    gap: Spacing.one,
    height: "100%",
    justifyContent: "flex-end",
  },
  chartBarText: {
    fontSize: 10,
  },
  chartBarTrack: {
    width: "100%",
    height: 75,
    borderRadius: Radius.sm / 2,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  chartBarFill: {
    width: "100%",
    borderRadius: Radius.sm / 2,
  },
  historySection: {
    gap: Spacing.two,
  },
  sessionCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  sessionTitleBlock: {
    flex: 1,
    gap: 2,
  },
  sessionStatsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  sessionStatPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.sm,
  },
  sessionSetsList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  sessionSetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  setPerformanceText: {
    flexShrink: 1,
    textAlign: "right",
  },
});
