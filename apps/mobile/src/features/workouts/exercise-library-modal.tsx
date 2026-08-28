import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useMemo, useState } from "react";
import {
  searchExerciseCatalog,
  type CatalogExercise,
  type MovementPattern,
} from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { ExerciseProgressionModal } from "./exercise-progression-modal";

interface ExerciseLibraryModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSelectExercise?: (exercise: CatalogExercise) => void;
}

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
}: ExerciseLibraryModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPattern, setSelectedPattern] = useState<
    MovementPattern | "all"
  >("all");
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(
    null,
  );
  const [progressionExercise, setProgressionExercise] =
    useState<CatalogExercise | null>(null);

  const filteredExercises = useMemo(() => {
    return searchExerciseCatalog({
      query: searchQuery.trim() || undefined,
      movementPattern: selectedPattern === "all" ? undefined : selectedPattern,
      limit: 60,
    });
  }, [searchQuery, selectedPattern]);

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <ThemedView style={styles.container}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <ThemedText type="subtitle">Exercise Library</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close library"
                onPress={onClose}
                style={styles.closeButton}
              >
                <ThemedText type="smallBold" themeColor="primary">
                  Done
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Browse 880+ science-backed exercises with movement patterns &
              cueing.
            </ThemedText>

            <TextInput
              style={styles.searchInput}
              placeholder="Search exercises by name, muscle, equipment…"
              placeholderTextColor="#8A8D91"
              value={searchQuery}
              onChangeText={setSearchQuery}
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
                    onPress={() => setSelectedPattern(pattern.value)}
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
          >
            <ThemedText type="small" themeColor="textSecondary">
              Showing {filteredExercises.length} exercises
            </ThemedText>

            {filteredExercises.map((exercise) => {
              const isExpanded = expandedExerciseId === exercise.id;
              return (
                <ThemedView
                  key={exercise.id}
                  type="backgroundElement"
                  style={styles.exerciseCard}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Toggle ${exercise.name}`}
                    onPress={() =>
                      setExpandedExerciseId(isExpanded ? null : exercise.id)
                    }
                    style={styles.exerciseCardHeader}
                  >
                    <View style={styles.exerciseMainInfo}>
                      <ThemedText type="smallBold">{exercise.name}</ThemedText>
                      <View style={styles.badgesRow}>
                        <View style={styles.badge}>
                          <ThemedText type="small" style={styles.badgeText}>
                            {exercise.movementPattern.replace("_", " ")}
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
                    <View style={styles.headerRightActions}>
                      {onSelectExercise ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Quick select ${exercise.name}`}
                          onPress={() => {
                            onSelectExercise(exercise);
                            onClose();
                          }}
                          style={styles.quickSelectButton}
                        >
                          <ThemedText
                            type="smallBold"
                            style={styles.quickSelectButtonText}
                          >
                            ＋ Add
                          </ThemedText>
                        </Pressable>
                      ) : null}
                      <ThemedText themeColor="textSecondary">
                        {isExpanded ? "▲" : "▼"}
                      </ThemedText>
                    </View>
                  </Pressable>

                  {isExpanded ? (
                    <View style={styles.expandedContent}>
                      {exercise.primaryMuscles.length > 0 ? (
                        <ThemedText type="small">
                          <ThemedText type="smallBold">Muscles: </ThemedText>
                          {exercise.primaryMuscles.join(", ")}
                          {exercise.secondaryMuscles.length > 0
                            ? ` (secondary: ${exercise.secondaryMuscles.join(", ")})`
                            : ""}
                        </ThemedText>
                      ) : null}

                      {exercise.equipment.length > 0 ? (
                        <ThemedText type="small">
                          <ThemedText type="smallBold">Equipment: </ThemedText>
                          {exercise.equipment
                            .map((e) => e.replace("_", " "))
                            .join(", ")}
                        </ThemedText>
                      ) : null}

                      {exercise.instructions ? (
                        <View style={styles.instructionsBox}>
                          <ThemedText type="smallBold">
                            Instructions:
                          </ThemedText>
                          <ThemedText
                            type="small"
                            themeColor="textSecondary"
                            style={styles.instructionsText}
                          >
                            {exercise.instructions}
                          </ThemedText>
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

                      {onSelectExercise ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Select ${exercise.name}`}
                          onPress={() => {
                            onSelectExercise(exercise);
                            onClose();
                          }}
                          style={styles.selectExerciseButton}
                        >
                          <ThemedText
                            type="smallBold"
                            style={styles.selectExerciseText}
                          >
                            Select Exercise
                          </ThemedText>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </ThemedView>
              );
            })}
          </ScrollView>
        </ThemedView>
      </Modal>

      {progressionExercise !== null ? (
        <ExerciseProgressionModal
          visible={progressionExercise !== null}
          onClose={() => setProgressionExercise(null)}
          exerciseName={progressionExercise.name}
          movementPattern={progressionExercise.movementPattern}
          category={progressionExercise.category}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
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
    backgroundColor: "#18633d",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: "center",
    marginTop: Spacing.one,
  },
  selectExerciseText: {
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
