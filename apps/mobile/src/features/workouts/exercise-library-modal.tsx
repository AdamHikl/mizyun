import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  EXERCISE_CATALOG,
  searchExerciseCatalog,
  type CatalogExercise,
  type MovementPattern,
} from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ExerciseProgressionModal } from "./exercise-progression-modal";

interface ExerciseLibraryModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly errorMessage?: string | null;
  readonly onSelectExercise?: (exercise: CatalogExercise) => void;
  readonly onSelectExercises?: (
    exercises: readonly CatalogExercise[],
  ) => Promise<boolean> | boolean;
}

const PAGE_SIZE = 60;

const MOVEMENT_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly value: MovementPattern | "all";
}> = [
  { label: "All", value: "all" },
  { label: "Knee Dominant", value: "knee_dominant" },
  { label: "Hip Hinge", value: "hip_hinge" },
  { label: "Horizontal Push", value: "horizontal_push" },
  { label: "Horizontal Pull", value: "horizontal_pull" },
  { label: "Vertical Push", value: "vertical_push" },
  { label: "Vertical Pull", value: "vertical_pull" },
  { label: "Core", value: "core" },
  { label: "Aerobic", value: "aerobic" },
  { label: "Mobility", value: "mobility" },
];

export function ExerciseLibraryModal({
  visible,
  onClose,
  onSelectExercise,
  onSelectExercises,
  errorMessage,
}: ExerciseLibraryModalProps) {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedPattern, setSelectedPattern] = useState<
    MovementPattern | "all"
  >("all");
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(
    null,
  );
  const [progressionExercise, setProgressionExercise] =
    useState<CatalogExercise | null>(null);

  const [selections, setSelections] = useState<CatalogExercise[]>([]);
  const [adding, setAdding] = useState(false);
  const additionInFlight = useRef(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) {
      setSelections([]);
      setSelectionError(null);
    }
  }, [visible]);
  const selectExercise = (exercise: CatalogExercise) => {
    if (additionInFlight.current) return;
    if (onSelectExercises) {
      setSelections((current) =>
        current.some((item) => item.id === exercise.id)
          ? current.filter((item) => item.id !== exercise.id)
          : [...current, exercise],
      );
    } else {
      onSelectExercise?.(exercise);
      onClose();
    }
  };
  const addSelections = async () => {
    if (
      !onSelectExercises ||
      additionInFlight.current ||
      selections.length === 0
    )
      return;
    additionInFlight.current = true;
    setAdding(true);
    setSelectionError(null);
    try {
      if (await onSelectExercises(selections)) {
        setSelections([]);
        onClose();
      } else {
        setSelectionError("Could not add all selected exercises. Try again.");
      }
    } catch {
      setSelectionError("Could not add selected exercises. Try again.");
    } finally {
      additionInFlight.current = false;
      setAdding(false);
    }
  };

  const filteredExercises = useMemo(() => {
    return searchExerciseCatalog({
      query: searchQuery.trim() || undefined,
      movementPattern: selectedPattern === "all" ? undefined : selectedPattern,
      limit: EXERCISE_CATALOG.length,
    });
  }, [searchQuery, selectedPattern]);
  const visibleExercises = filteredExercises.slice(0, visibleCount);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent={true}
      onRequestClose={() => {
        if (!additionInFlight.current) onClose();
      }}
    >
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <ThemedText type="subtitle">Exercise Library</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close library"
                onPress={() => {
                  if (!additionInFlight.current) onClose();
                }}
                disabled={adding}
                accessibilityState={{ disabled: adding }}
                style={styles.closeButton}
              >
                <ThemedText type="smallBold" themeColor="primary">
                  Done
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Browse {EXERCISE_CATALOG.length} exercises with step-by-step
              instructions and form tips.
            </ThemedText>

            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder="Search exercises by name, muscle, equipment…"
              accessibilityLabel="Search exercise library"
              placeholderTextColor="#8A8D91"
              value={searchQuery}
              onChangeText={(query) => {
                setSearchQuery(query);
                setVisibleCount(PAGE_SIZE);
                setExpandedExerciseId(null);
              }}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.patternChips}
            >
              {MOVEMENT_PATTERNS.map((pattern) => {
                const isSelected = selectedPattern === pattern.value;
                return (
                  <Pressable
                    key={pattern.value}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter ${pattern.label}`}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      setSelectedPattern(pattern.value);
                      setVisibleCount(PAGE_SIZE);
                      setExpandedExerciseId(null);
                    }}
                    style={[
                      styles.patternChip,
                      isSelected && styles.patternChipSelected,
                    ]}
                  >
                    <ThemedText
                      type="smallBold"
                      style={[
                        styles.patternChipText,
                        isSelected && styles.patternChipTextSelected,
                      ]}
                    >
                      {pattern.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <ScrollView
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <ThemedText type="small" themeColor="textSecondary">
              Showing {visibleExercises.length} of {filteredExercises.length}{" "}
              exercises
            </ThemedText>

            {filteredExercises.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No exercises match. Try another name, muscle or equipment, or
                select All movement patterns.
              </ThemedText>
            ) : null}

            {visibleExercises.map((exercise) => {
              const isExpanded = expandedExerciseId === exercise.id;
              return (
                <ThemedView
                  key={exercise.id}
                  type="backgroundElement"
                  style={styles.exerciseCard}
                >
                  <View style={styles.exerciseCardHeader}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Toggle ${exercise.name}`}
                      accessibilityState={{ expanded: isExpanded }}
                      onPress={() =>
                        setExpandedExerciseId(isExpanded ? null : exercise.id)
                      }
                      style={styles.exerciseDetailsButton}
                    >
                      <View style={styles.exerciseMainInfo}>
                        <ThemedText type="smallBold">
                          {exercise.name}
                        </ThemedText>
                        <View style={styles.badgesRow}>
                          <View style={styles.badge}>
                            <ThemedText type="small" style={styles.badgeText}>
                              {exercise.movementPattern.replaceAll("_", " ")}
                            </ThemedText>
                          </View>
                          {exercise.category ? (
                            <View style={styles.badgeSecondary}>
                              <ThemedText
                                type="small"
                                style={styles.badgeSecondaryText}
                              >
                                {exercise.category}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <ThemedText themeColor="textSecondary">
                        {isExpanded ? "▲" : "▼"}
                      </ThemedText>
                    </Pressable>
                    <View style={styles.headerRightActions}>
                      {onSelectExercise || onSelectExercises ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Quick select ${exercise.name}`}
                          onPress={() => selectExercise(exercise)}
                          disabled={adding}
                          accessibilityState={{
                            disabled: adding,
                            selected: selections.some(
                              (item) => item.id === exercise.id,
                            ),
                          }}
                          style={styles.quickSelectButton}
                        >
                          <ThemedText
                            type="smallBold"
                            style={styles.quickSelectButtonText}
                          >
                            {selections.some((item) => item.id === exercise.id)
                              ? "✓ Selected"
                              : "＋ Add"}
                          </ThemedText>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>

                  {isExpanded ? (
                    <View style={styles.expandedContent}>
                      {exercise.description ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {exercise.description}
                        </ThemedText>
                      ) : null}
                      {exercise.primaryMuscles.length > 0 ? (
                        <ThemedText type="small">
                          <ThemedText type="smallBold">Muscles: </ThemedText>
                          {exercise.primaryMuscles.join(", ")}
                          {exercise.secondaryMuscles.length > 0
                            ? ` (secondary: ${exercise.secondaryMuscles.join(", ")})`
                            : ""}
                        </ThemedText>
                      ) : null}

                      {(exercise.requiredEquipment ?? exercise.equipment)
                        .length > 0 ? (
                        <ThemedText type="small">
                          <ThemedText type="smallBold">Equipment: </ThemedText>
                          {(exercise.requiredEquipment ?? exercise.equipment)
                            .map((e) => e.replaceAll("_", " "))
                            .join(", ")}
                        </ThemedText>
                      ) : null}

                      {exercise.instructions.length > 0 ? (
                        <View style={styles.instructionsBox}>
                          <ThemedText type="smallBold">
                            How to perform
                          </ThemedText>
                          {exercise.instructions.map((step, index) => (
                            <ThemedText
                              key={`${exercise.id}-step-${index}`}
                              type="small"
                              themeColor="textSecondary"
                              style={styles.instructionsText}
                            >
                              {`${index + 1}. ${step}`}
                            </ThemedText>
                          ))}
                        </View>
                      ) : null}

                      {exercise.tips && exercise.tips.length > 0 ? (
                        <View style={styles.instructionsBox}>
                          <ThemedText type="smallBold">Form tips</ThemedText>
                          {exercise.tips.map((tip, index) => (
                            <ThemedText
                              key={`${exercise.id}-tip-${index}`}
                              type="small"
                              themeColor="textSecondary"
                              style={styles.instructionsText}
                            >
                              {`• ${tip}`}
                            </ThemedText>
                          ))}
                        </View>
                      ) : null}

                      {exercise.commonMistakes &&
                      exercise.commonMistakes.length > 0 ? (
                        <View style={styles.instructionsBox}>
                          <ThemedText type="smallBold">
                            Common mistakes
                          </ThemedText>
                          {exercise.commonMistakes.map((mistake, index) => (
                            <ThemedText
                              key={`${exercise.id}-mistake-${index}`}
                              type="small"
                              themeColor="textSecondary"
                              style={styles.instructionsText}
                            >
                              {`• ${mistake}`}
                            </ThemedText>
                          ))}
                        </View>
                      ) : null}

                      {/* Progression & Target Load Button */}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Track load progress for ${exercise.name}`}
                        onPress={() => setProgressionExercise(exercise)}
                        style={styles.progressionButton}
                      >
                        <ThemedText
                          type="smallBold"
                          style={styles.progressionButtonText}
                        >
                          📈 Track Target Load & Progress →
                        </ThemedText>
                      </Pressable>

                      {onSelectExercise || onSelectExercises ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Select ${exercise.name}`}
                          onPress={() => selectExercise(exercise)}
                          disabled={adding}
                          accessibilityState={{
                            disabled: adding,
                            selected: selections.some(
                              (item) => item.id === exercise.id,
                            ),
                          }}
                          style={styles.selectExerciseButton}
                        >
                          <ThemedText
                            type="smallBold"
                            style={styles.selectExerciseText}
                          >
                            {selections.some((item) => item.id === exercise.id)
                              ? "Remove selection"
                              : "Select Exercise"}
                          </ThemedText>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </ThemedView>
              );
            })}

            {visibleExercises.length < filteredExercises.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Load more exercises"
                onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
                style={styles.selectExerciseButton}
              >
                <ThemedText type="smallBold" style={styles.selectExerciseText}>
                  Load more exercises
                </ThemedText>
              </Pressable>
            ) : null}
          </ScrollView>
          {onSelectExercises ? (
            <View style={styles.header}>
              {selectionError || errorMessage ? (
                <ThemedText type="small" accessibilityRole="alert">
                  {errorMessage ?? selectionError}
                </ThemedText>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${selections.length} exercises`}
                accessibilityState={{
                  disabled: adding || selections.length === 0,
                  busy: adding,
                }}
                disabled={adding || selections.length === 0}
                onPress={() => void addSelections()}
                style={styles.selectExerciseButton}
              >
                <ThemedText type="smallBold" style={styles.selectExerciseText}>
                  {adding ? "Adding…" : `Add ${selections.length} exercises`}
                </ThemedText>
              </Pressable>
            </View>
          ) : null}
        </SafeAreaView>
      </ThemedView>

      {progressionExercise !== null ? (
        <ExerciseProgressionModal
          visible={progressionExercise !== null}
          onClose={() => setProgressionExercise(null)}
          exerciseName={progressionExercise.name}
          movementPattern={progressionExercise.movementPattern}
          category={progressionExercise.category}
        />
      ) : null}
    </Modal>
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
    padding: Spacing.three,
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#8A8D91",
  },
  headerTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  closeButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    marginTop: Spacing.one,
  },
  patternChips: {
    gap: Spacing.one,
    paddingVertical: Spacing.one,
  },
  patternChip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
  },
  patternChipSelected: {
    backgroundColor: "#18633d",
    borderColor: "#18633d",
  },
  patternChipText: {
    fontSize: 12,
  },
  patternChipTextSelected: {
    color: "#ffffff",
  },
  listContent: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  exerciseCard: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(138, 141, 145, 0.3)",
    overflow: "hidden",
  },
  exerciseCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.three,
  },
  exerciseDetailsButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingRight: Spacing.one,
  },
  exerciseMainInfo: {
    flex: 1,
    gap: 4,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
    marginTop: 2,
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
    backgroundColor: "rgba(138, 141, 145, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeSecondaryText: {
    fontSize: 11,
    textTransform: "capitalize",
  },
  expandedContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(138, 141, 145, 0.2)",
    paddingTop: Spacing.two,
  },
  instructionsBox: {
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.03)",
    padding: Spacing.two,
    borderRadius: Spacing.one,
  },
  instructionsText: {
    lineHeight: 18,
  },
  selectExerciseButton: {
    minHeight: 48,
    justifyContent: "center",
    maxWidth: "100%",
    backgroundColor: "#18633d",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: "center",
    marginTop: Spacing.one,
  },
  selectExerciseText: {
    flexShrink: 1,
    textAlign: "center",
    color: "#ffffff",
  },
  progressionButton: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: "center",
    marginTop: Spacing.one,
  },
  progressionButtonText: {
    color: "#10B981",
    fontSize: 13,
  },
  headerRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  quickSelectButton: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  quickSelectButtonText: {
    fontSize: 12,
    color: "#10B981",
  },
});
