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
  customExerciseTrackingMode,
  searchCustomExercises,
  searchExerciseCatalog,
  type CatalogExercise,
  type MovementPattern,
} from "@mizyun/core";
import type { Exercise } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Chip,
  FormStatus,
  Icon,
  ListGroup,
  SectionHeader,
} from "@/components/ui";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ExerciseProgressionModal } from "./exercise-progression-modal";
import {
  CustomExerciseEditor,
  TRACKING_MODE_LABELS,
} from "./custom-exercise-editor";
import { loadSavedExercises } from "./custom-exercises-data";
import {
  isSavedLibraryExercise,
  type LibraryExercise,
} from "./library-exercise";

interface SavedState {
  readonly exercises: ReadonlyArray<Exercise>;
  readonly truncated: boolean;
}

interface EditorState {
  readonly exercise: Exercise | null;
  readonly initialName: string;
}

interface ExerciseLibraryModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly errorMessage?: string | null;
  readonly onSelectExercise?: (exercise: CatalogExercise) => void;
  /** Receives catalog entries and saved custom exercises in selection order. */
  readonly onSelectExercises?: (
    exercises: readonly LibraryExercise[],
  ) => Promise<boolean> | boolean;
  /** Add each exercise as soon as its Add button is tapped, keeping the library open. */
  readonly addOnTap?: boolean;
  /** Saved exercises already in the open workout; they open read-only. */
  readonly inUseExerciseIds?: readonly string[];
}

const PAGE_SIZE = 60;

const MOVEMENT_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly value: MovementPattern | "all";
}> = [
  { label: "All", value: "all" },
  { label: "Knee dominant", value: "knee_dominant" },
  { label: "Hip hinge", value: "hip_hinge" },
  { label: "Horizontal push", value: "horizontal_push" },
  { label: "Horizontal pull", value: "horizontal_pull" },
  { label: "Vertical push", value: "vertical_push" },
  { label: "Vertical pull", value: "vertical_pull" },
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
  addOnTap = false,
  inUseExerciseIds = [],
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

  const [selections, setSelections] = useState<LibraryExercise[]>([]);
  const [adding, setAdding] = useState(false);
  const additionInFlight = useRef(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedState | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  // Ignores a saved-exercise load that finishes after the library closed
  // or after a local create, edit or delete.
  const savedLoadToken = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const loadSaved = () => {
    const token = ++savedLoadToken.current;
    setSavedError(null);
    void loadSavedExercises().then((result) => {
      if (savedLoadToken.current !== token) return;
      if (result.ok) {
        setSaved({ exercises: result.exercises, truncated: result.truncated });
      } else {
        setSavedError(result.message);
      }
    });
  };
  useEffect(() => {
    if (!visible) {
      setSelections([]);
      setSelectionError(null);
      setAddedIds([]);
      setEditor(null);
      savedLoadToken.current++;
      return;
    }
    loadSaved();
  }, [visible]);
  const addExerciseNow = async (exercise: LibraryExercise) => {
    if (!onSelectExercises || addedIds.includes(exercise.id)) return;
    additionInFlight.current = true;
    setAdding(true);
    setAddingId(exercise.id);
    setSelectionError(null);
    try {
      if (await onSelectExercises([exercise])) {
        setAddedIds((current) => [...current, exercise.id]);
      } else {
        setSelectionError(`Could not add ${exercise.name}. Try again.`);
      }
    } catch {
      setSelectionError(`Could not add ${exercise.name}. Try again.`);
    } finally {
      additionInFlight.current = false;
      setAdding(false);
      setAddingId(null);
    }
  };
  const selectExercise = (exercise: LibraryExercise) => {
    if (additionInFlight.current) return;
    if (onSelectExercises && addOnTap) {
      void addExerciseNow(exercise);
    } else if (onSelectExercises) {
      setSelections((current) =>
        current.some((item) => item.id === exercise.id)
          ? current.filter((item) => item.id !== exercise.id)
          : [...current, exercise],
      );
    } else if (!isSavedLibraryExercise(exercise)) {
      onSelectExercise?.(exercise);
      onClose();
    }
  };
  const handleSaved = (exercise: Exercise, created: boolean) => {
    if (!visibleRef.current) return;
    savedLoadToken.current++;
    setSaved((current) => ({
      truncated: current?.truncated ?? false,
      exercises: [
        ...(current?.exercises ?? []).filter((item) => item.id !== exercise.id),
        exercise,
      ],
    }));
    setEditor(null);
    // A new exercise made from a picker is selected (or added) right away.
    if (created && onSelectExercises) {
      if (addOnTap) void addExerciseNow(exercise);
      else setSelections((current) => [...current, exercise]);
    } else {
      setSelections((current) =>
        current.map((item) => (item.id === exercise.id ? exercise : item)),
      );
    }
  };
  const handleDeleted = (exerciseId: string) => {
    if (!visibleRef.current) return;
    savedLoadToken.current++;
    setSaved((current) =>
      current
        ? {
            ...current,
            exercises: current.exercises.filter(
              (item) => item.id !== exerciseId,
            ),
          }
        : current,
    );
    setSelections((current) =>
      current.filter((item) => item.id !== exerciseId),
    );
    setEditor(null);
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
  const selectionStateOf = (exercise: LibraryExercise) => {
    const isSelected = addOnTap
      ? addedIds.includes(exercise.id)
      : selections.some((item) => item.id === exercise.id);
    return {
      isSelected,
      isAddingThis: addingId === exercise.id,
      selectionLocked: adding || (addOnTap && isSelected),
    };
  };
  const quickSelectButton = (exercise: LibraryExercise) => {
    if (
      !onSelectExercises &&
      (!onSelectExercise || isSavedLibraryExercise(exercise))
    )
      return null;
    const { isSelected, isAddingThis, selectionLocked } =
      selectionStateOf(exercise);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Quick select ${exercise.name}`}
        onPress={() => selectExercise(exercise)}
        disabled={selectionLocked}
        accessibilityState={{
          disabled: selectionLocked,
          selected: isSelected,
          busy: isAddingThis,
        }}
        style={{
          ...styles.quickSelectButton,
          backgroundColor: isSelected ? theme.primary : theme.primaryLight,
        }}
      >
        <Icon
          name={isSelected ? "check" : "add"}
          size={13}
          tintColor={isSelected ? theme.onPrimary : theme.primary}
        />
        <ThemedText
          type="smallBold"
          style={{ color: isSelected ? theme.onPrimary : theme.primary }}
        >
          {isAddingThis
            ? "Adding…"
            : isSelected
              ? addOnTap
                ? "Added"
                : "Selected"
              : "Add"}
        </ThemedText>
      </Pressable>
    );
  };
  const showCustom = selectedPattern === "all";
  // Duplicate checks need the complete saved list, so creating waits for it.
  const canCreate =
    saved !== null && !saved.truncated && savedError === null && !adding;
  const isInWorkout = (exerciseId: string) =>
    inUseExerciseIds.includes(exerciseId) || addedIds.includes(exerciseId);
  const customMatches = useMemo(
    () =>
      showCustom && saved
        ? searchCustomExercises(saved.exercises, searchQuery)
        : [],
    [saved, searchQuery, showCustom],
  );

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
          <View style={[styles.header, { borderBottomColor: theme.separator }]}>
            <View style={styles.headerTitleRow}>
              <ThemedText type="subtitle">Exercise library</ThemedText>
              <Button
                label="Done"
                accessibilityLabel="Close library"
                variant="plain"
                size="small"
                onPress={() => {
                  if (!additionInFlight.current) onClose();
                }}
                disabled={adding}
                accessibilityState={{ disabled: adding }}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Browse {EXERCISE_CATALOG.length} exercises with step-by-step
              instructions and form tips.
            </ThemedText>

            <View
              style={[
                styles.searchField,
                { backgroundColor: theme.backgroundSelected },
              ]}
            >
              <Icon name="search" size={16} color="textTertiary" />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search exercises by name, muscle, equipment…"
                accessibilityLabel="Search exercise library"
                placeholderTextColor={theme.textTertiary}
                value={searchQuery}
                onChangeText={(query) => {
                  setSearchQuery(query);
                  setVisibleCount(PAGE_SIZE);
                  setExpandedExerciseId(null);
                }}
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.patternChips}
            >
              {MOVEMENT_PATTERNS.map((pattern) => (
                <Chip
                  key={pattern.value}
                  label={pattern.label}
                  accessibilityLabel={`Filter ${pattern.label}`}
                  selected={selectedPattern === pattern.value}
                  onPress={() => {
                    setSelectedPattern(pattern.value);
                    setVisibleCount(PAGE_SIZE);
                    setExpandedExerciseId(null);
                  }}
                />
              ))}
            </ScrollView>
          </View>

          <ScrollView
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <Button
              label="Create exercise"
              accessibilityLabel="Create custom exercise"
              accessibilityHint="Adds your own exercise to the library"
              variant="tinted"
              icon="add"
              block
              disabled={!canCreate}
              accessibilityState={{ disabled: !canCreate }}
              onPress={() =>
                setEditor({ exercise: null, initialName: searchQuery })
              }
            />

            {showCustom ? (
              <View style={styles.customSection}>
                <SectionHeader title="My exercises" />
                {savedError ? (
                  <View style={styles.customStatus}>
                    <FormStatus tone="error">{savedError}</FormStatus>
                    <Button
                      label="Retry"
                      accessibilityLabel="Retry loading my exercises"
                      variant="secondary"
                      size="small"
                      onPress={loadSaved}
                    />
                  </View>
                ) : saved === null ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Loading your exercises…
                  </ThemedText>
                ) : customMatches.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {searchQuery.trim()
                      ? "None of your exercises match."
                      : "Exercises you create appear here."}
                  </ThemedText>
                ) : (
                  <ListGroup>
                    {customMatches.map((exercise) => (
                      <View key={exercise.id} style={styles.exerciseCardHeader}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${exercise.name}`}
                          accessibilityHint="Opens name, tracking type and notes"
                          onPress={() =>
                            setEditor({ exercise, initialName: "" })
                          }
                          disabled={adding}
                          accessibilityState={{ disabled: adding }}
                          style={styles.exerciseDetailsButton}
                        >
                          <View style={styles.exerciseMainInfo}>
                            <ThemedText type="default">
                              {exercise.name}
                            </ThemedText>
                            <ThemedText
                              type="footnote"
                              themeColor="textSecondary"
                            >
                              {`Custom · ${TRACKING_MODE_LABELS[customExerciseTrackingMode(exercise)]}`}
                            </ThemedText>
                          </View>
                          <Icon name="edit" size={14} color="textTertiary" />
                        </Pressable>
                        {quickSelectButton(exercise)}
                      </View>
                    ))}
                  </ListGroup>
                )}
                {saved?.truncated ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {
                      "Showing your first 200 saved exercises. Creating is unavailable because new names can't be checked for duplicates."
                    }
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            <ThemedText type="footnote" themeColor="textSecondary">
              Showing {visibleExercises.length} of {filteredExercises.length}{" "}
              exercises
            </ThemedText>

            {filteredExercises.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No exercises match. Try another name, muscle or equipment, or
                select All movement patterns.
              </ThemedText>
            ) : (
              <ListGroup>
                {visibleExercises.map((exercise) => {
                  const isExpanded = expandedExerciseId === exercise.id;
                  const { isSelected, selectionLocked } =
                    selectionStateOf(exercise);
                  const meta = [
                    exercise.movementPattern.replaceAll("_", " "),
                    exercise.category,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <View key={exercise.id}>
                      <View style={styles.exerciseCardHeader}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Toggle ${exercise.name}`}
                          accessibilityState={{ expanded: isExpanded }}
                          onPress={() =>
                            setExpandedExerciseId(
                              isExpanded ? null : exercise.id,
                            )
                          }
                          style={styles.exerciseDetailsButton}
                        >
                          <View style={styles.exerciseMainInfo}>
                            <ThemedText type="default">
                              {exercise.name}
                            </ThemedText>
                            <ThemedText
                              type="footnote"
                              themeColor="textSecondary"
                            >
                              {meta}
                            </ThemedText>
                          </View>
                          <Icon
                            name={isExpanded ? "chevronUp" : "chevronDown"}
                            size={14}
                            color="textTertiary"
                          />
                        </Pressable>
                        {quickSelectButton(exercise)}
                      </View>

                      {isExpanded ? (
                        <View
                          style={[
                            styles.expandedContent,
                            { borderTopColor: theme.separator },
                          ]}
                        >
                          {exercise.description ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              {exercise.description}
                            </ThemedText>
                          ) : null}
                          {exercise.primaryMuscles.length > 0 ? (
                            <ThemedText type="small">
                              <ThemedText type="smallBold">
                                Muscles:{" "}
                              </ThemedText>
                              {exercise.primaryMuscles.join(", ")}
                              {exercise.secondaryMuscles.length > 0
                                ? ` (secondary: ${exercise.secondaryMuscles.join(", ")})`
                                : ""}
                            </ThemedText>
                          ) : null}

                          {(exercise.requiredEquipment ?? exercise.equipment)
                            .length > 0 ? (
                            <ThemedText type="small">
                              <ThemedText type="smallBold">
                                Equipment:{" "}
                              </ThemedText>
                              {(
                                exercise.requiredEquipment ?? exercise.equipment
                              )
                                .map((e) => e.replaceAll("_", " "))
                                .join(", ")}
                            </ThemedText>
                          ) : null}

                          {exercise.instructions.length > 0 ? (
                            <View
                              style={[
                                styles.instructionsBox,
                                { backgroundColor: theme.backgroundSelected },
                              ]}
                            >
                              <ThemedText type="smallBold">
                                How to perform
                              </ThemedText>
                              {exercise.instructions.map((step, index) => (
                                <ThemedText
                                  key={`${exercise.id}-step-${index}`}
                                  type="small"
                                  themeColor="textSecondary"
                                >
                                  {`${index + 1}. ${step}`}
                                </ThemedText>
                              ))}
                            </View>
                          ) : null}

                          {exercise.tips && exercise.tips.length > 0 ? (
                            <View
                              style={[
                                styles.instructionsBox,
                                { backgroundColor: theme.backgroundSelected },
                              ]}
                            >
                              <ThemedText type="smallBold">
                                Form tips
                              </ThemedText>
                              {exercise.tips.map((tip, index) => (
                                <ThemedText
                                  key={`${exercise.id}-tip-${index}`}
                                  type="small"
                                  themeColor="textSecondary"
                                >
                                  {`• ${tip}`}
                                </ThemedText>
                              ))}
                            </View>
                          ) : null}

                          {exercise.commonMistakes &&
                          exercise.commonMistakes.length > 0 ? (
                            <View
                              style={[
                                styles.instructionsBox,
                                { backgroundColor: theme.backgroundSelected },
                              ]}
                            >
                              <ThemedText type="smallBold">
                                Common mistakes
                              </ThemedText>
                              {exercise.commonMistakes.map((mistake, index) => (
                                <ThemedText
                                  key={`${exercise.id}-mistake-${index}`}
                                  type="small"
                                  themeColor="textSecondary"
                                >
                                  {`• ${mistake}`}
                                </ThemedText>
                              ))}
                            </View>
                          ) : null}

                          <Button
                            label="Track target load and progress"
                            accessibilityLabel={`Track load progress for ${exercise.name}`}
                            variant="secondary"
                            icon="chart"
                            block
                            onPress={() => setProgressionExercise(exercise)}
                          />

                          {onSelectExercise || onSelectExercises ? (
                            <Button
                              label={
                                addOnTap
                                  ? isSelected
                                    ? "Added to workout"
                                    : "Add to workout"
                                  : isSelected
                                    ? "Remove selection"
                                    : "Select exercise"
                              }
                              accessibilityLabel={`Select ${exercise.name}`}
                              variant="tinted"
                              block
                              onPress={() => selectExercise(exercise)}
                              disabled={selectionLocked}
                              accessibilityState={{
                                disabled: selectionLocked,
                                selected: isSelected,
                              }}
                            />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </ListGroup>
            )}

            {visibleExercises.length < filteredExercises.length ? (
              <Button
                label="Load more exercises"
                accessibilityLabel="Load more exercises"
                variant="secondary"
                block
                onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
              />
            ) : null}
          </ScrollView>
          {onSelectExercises &&
          (!addOnTap || selectionError || errorMessage) ? (
            <View style={[styles.footer, { borderTopColor: theme.separator }]}>
              {selectionError || errorMessage ? (
                <FormStatus tone="error">
                  {errorMessage ?? selectionError}
                </FormStatus>
              ) : null}
              {addOnTap ? null : (
                <Button
                  label={
                    adding ? "Adding…" : `Add ${selections.length} exercises`
                  }
                  accessibilityLabel={`Add ${selections.length} exercises`}
                  variant="primary"
                  block
                  accessibilityState={{
                    disabled: adding || selections.length === 0,
                    busy: adding,
                  }}
                  disabled={adding || selections.length === 0}
                  onPress={() => void addSelections()}
                />
              )}
            </View>
          ) : null}
        </SafeAreaView>
      </ThemedView>

      {editor !== null ? (
        <CustomExerciseEditor
          visible={editor !== null}
          exercise={editor.exercise}
          initialName={editor.initialName}
          savedExercises={saved?.exercises ?? []}
          inCurrentWorkout={
            editor.exercise !== null && isInWorkout(editor.exercise.id)
          }
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      ) : null}

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
  },
  headerTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: MinTouchTarget,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three - 4,
  },
  searchInput: {
    flex: 1,
    minHeight: MinTouchTarget,
    fontSize: 17,
  },
  patternChips: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  listContent: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  exerciseCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  exerciseDetailsButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  exerciseMainInfo: {
    flex: 1,
    gap: 1,
  },
  expandedContent: {
    marginHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  instructionsBox: {
    gap: Spacing.one,
    padding: Spacing.two,
    borderRadius: Radius.md,
  },
  footer: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  customSection: {
    gap: Spacing.two,
  },
  customStatus: {
    gap: Spacing.two,
    alignItems: "flex-start",
  },
  quickSelectButton: {
    minHeight: 48,
    minWidth: 48,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
});
