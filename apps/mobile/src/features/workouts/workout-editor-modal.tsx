import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { readWorkoutLifecycle } from "@mizyun/core";
import type { Workout } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Card,
  Chip,
  FormField,
  FormTextInput,
  IconButton,
  Notice,
  SectionHeader,
} from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

import {
  createCustomWorkout,
  updateWorkoutDetails,
  type PlannedExerciseItem,
  type ProcessedWorkout,
} from "./workouts-hub-data";
import {
  DEFAULT_REST_SECONDS,
  loadWorkoutPreferences,
} from "./workout-preferences";
import { ExerciseLibraryModal } from "./exercise-library-modal";
import {
  isSavedLibraryExercise,
  type LibraryExercise,
} from "./library-exercise";
import {
  SET_TYPE_OPTIONS,
  SetTypeModal,
  setTypeBadgeColors,
} from "./set-type-modal";
import {
  readPlannedSetTypes,
  resizePlannedSetTypes,
} from "./planned-set-types";

interface WorkoutEditorModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly workoutToEdit?: ProcessedWorkout | null;
  readonly onSaved?: (workout: Workout, autoStart: boolean) => void;
}

export function WorkoutEditorModal({
  visible,
  onClose,
  workoutToEdit,
  onSaved,
}: WorkoutEditorModalProps) {
  const theme = useTheme();
  const isEditing = workoutToEdit !== null && workoutToEdit !== undefined;

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [plannedExercises, setPlannedExercises] = useState<
    ReadonlyArray<PlannedExerciseItem>
  >([]);
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [customInputVisible, setCustomInputVisible] = useState(false);
  const [customName, setCustomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [defaultRestSeconds, setDefaultRestSeconds] =
    useState<number>(DEFAULT_REST_SECONDS);

  useEffect(() => {
    let active = true;
    void loadWorkoutPreferences().then((prefs) => {
      if (active) {
        setDefaultRestSeconds(prefs.defaultRestSeconds);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Initialize or reset form when opened or workoutToEdit changes
  useEffect(() => {
    if (!visible) return;

    if (workoutToEdit) {
      setName(workoutToEdit.workout.name);
      setNotes(workoutToEdit.workout.notes ?? "");
      if (workoutToEdit.plannedExercises.length > 0) {
        setPlannedExercises(workoutToEdit.plannedExercises);
      } else if (workoutToEdit.exerciseSummaries.length > 0) {
        // Fallback: populate from previous exercise summaries if planned was empty
        setPlannedExercises(
          workoutToEdit.exerciseSummaries.map((ex) => ({
            name: ex.exerciseName,
            targetSets: ex.setCount || 3,
            targetReps: "8-12",
            targetLoad: ex.topLoadKg ? `${ex.topLoadKg} kg` : undefined,
          })),
        );
      } else {
        setPlannedExercises([]);
      }
    } else {
      setName("");
      setNotes("");
      setPlannedExercises([]);
    }
    setCustomInputVisible(false);
    setCustomName("");
    setErrorMessage(null);
  }, [visible, workoutToEdit]);

  const handleAddCatalogExercise = useCallback(
    (exercises: readonly LibraryExercise[]) => {
      // Custom exercises are planned by name, like the "Custom name" field;
      // the live session matches the saved record by that name.
      const newItems: PlannedExerciseItem[] = exercises.map((exercise) =>
        isSavedLibraryExercise(exercise)
          ? {
              name: exercise.name,
              movementPattern: "custom",
              targetSets: 3,
              targetReps: "8-12",
              restSeconds: defaultRestSeconds,
            }
          : {
              name: exercise.name,
              catalogId: exercise.id,
              movementPattern: exercise.movementPattern,
              targetSets: 3,
              targetReps: "8-12",
              restSeconds: defaultRestSeconds,
            },
      );
      setPlannedExercises((current) => [...current, ...newItems]);
      return true;
    },
    [defaultRestSeconds],
  );

  const handleAddCustomExercise = useCallback(() => {
    const trimmed = customName.trim();
    if (trimmed.length === 0) return;
    const newItem: PlannedExerciseItem = {
      name: trimmed,
      movementPattern: "custom",
      targetSets: 3,
      targetReps: "8-12",
      restSeconds: defaultRestSeconds,
    };
    setPlannedExercises((current) => [...current, newItem]);
    setCustomName("");
    setCustomInputVisible(false);
  }, [customName, defaultRestSeconds]);

  const handleUpdateExercise = useCallback(
    (index: number, patch: Partial<PlannedExerciseItem>) => {
      setPlannedExercises((current) => {
        const next = [...current];
        const existing = next[index];
        if (existing) {
          next[index] = { ...existing, ...patch };
        }
        return next;
      });
    },
    [],
  );

  const handleRemoveExercise = useCallback((index: number) => {
    setPlannedExercises((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleMoveExercise = useCallback(
    (fromIndex: number, toIndex: number) => {
      setPlannedExercises((current) => {
        if (toIndex < 0 || toIndex >= current.length) return current;
        const next = [...current];
        const item = next[fromIndex];
        if (!item) return current;
        next.splice(fromIndex, 1);
        next.splice(toIndex, 0, item);
        return next;
      });
    },
    [],
  );

  const handleSave = useCallback(
    async (autoStart: boolean = false) => {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        setErrorMessage("Please provide a workout name.");
        return;
      }

      setBusy(true);
      setErrorMessage(null);

      if (isEditing && workoutToEdit) {
        const result = await updateWorkoutDetails(workoutToEdit.workout.id, {
          name: trimmedName,
          notes: notes.trim() || null,
          plannedExercises,
          lifecycle:
            readWorkoutLifecycle(workoutToEdit.workout.details) ??
            (workoutToEdit.status === "completed"
              ? { kind: "session" }
              : { kind: "routine" }),
        });

        setBusy(false);
        if (result.ok && result.workout) {
          onSaved?.(result.workout, autoStart);
          onClose();
        } else if (!result.ok) {
          setErrorMessage(result.message);
        }
      } else {
        const result = await createCustomWorkout({
          name: trimmedName,
          notes: notes.trim() || null,
          plannedExercises,
        });

        setBusy(false);
        if (result.ok && result.workout) {
          onSaved?.(result.workout, autoStart);
          onClose();
        } else if (!result.ok) {
          setErrorMessage(result.message);
        }
      }
    },
    [isEditing, name, notes, onClose, onSaved, plannedExercises, workoutToEdit],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <ThemedView style={styles.modalContainer}>
        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <Button
              label="Cancel"
              accessibilityLabel="Cancel editing"
              variant="plain"
              size="small"
              onPress={onClose}
            />

            <ThemedText type="headline" style={styles.headerTitle}>
              {isEditing ? "Edit workout routine" : "Create workout routine"}
            </ThemedText>

            <Button
              label={busy ? "Saving…" : "Save"}
              accessibilityLabel="Save workout"
              variant="plain"
              size="small"
              disabled={busy}
              onPress={() => void handleSave(false)}
            />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            {errorMessage ? (
              <Notice tone="danger" message={errorMessage} />
            ) : null}

            <Card>
              <FormField label="Workout name">
                <FormTextInput
                  placeholder="e.g. Push Day A, Upper Body Hypertrophy"
                  value={name}
                  onChangeText={setName}
                  autoFocus={!isEditing}
                />
              </FormField>

              <FormField label="Notes / instructions (optional)">
                <FormTextInput
                  style={styles.multilineInput}
                  placeholder="e.g. Focus on progressive overload, 2 min rest between heavy sets"
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={3}
                />
              </FormField>
            </Card>

            <View style={styles.section}>
              <SectionHeader
                title={`Planned exercises (${plannedExercises.length})`}
              />
              <ThemedText type="small" themeColor="textSecondary">
                Add and configure the exercises for this routine.
              </ThemedText>
            </View>

            {plannedExercises.length === 0 ? (
              <Card>
                <ThemedText type="small" themeColor="textSecondary">
                  No exercises added yet. Pick from the exercise library or type
                  a custom exercise name below.
                </ThemedText>
              </Card>
            ) : (
              <View style={styles.exercisesList}>
                {plannedExercises.map((exercise, index) => (
                  <PlannedExerciseRow
                    key={`${exercise.name}-${index}`}
                    index={index}
                    total={plannedExercises.length}
                    item={exercise}
                    inputColor={theme.text}
                    onUpdate={(patch) => handleUpdateExercise(index, patch)}
                    onRemove={() => handleRemoveExercise(index)}
                    onMoveUp={() => handleMoveExercise(index, index - 1)}
                    onMoveDown={() => handleMoveExercise(index, index + 1)}
                  />
                ))}
              </View>
            )}

            {customInputVisible ? (
              <Card>
                <FormTextInput
                  placeholder="Enter custom exercise name…"
                  value={customName}
                  onChangeText={setCustomName}
                  autoFocus
                />
                <View style={styles.rowActions}>
                  <Button
                    label="Add"
                    accessibilityLabel="Add custom exercise"
                    variant="tinted"
                    size="small"
                    onPress={handleAddCustomExercise}
                  />
                  <Button
                    label="Cancel"
                    accessibilityLabel="Cancel custom exercise"
                    variant="plain"
                    size="small"
                    onPress={() => {
                      setCustomInputVisible(false);
                      setCustomName("");
                    }}
                  />
                </View>
              </Card>
            ) : (
              <View style={styles.rowActions}>
                <Button
                  label="Add from library"
                  accessibilityLabel="Browse exercise library"
                  variant="tinted"
                  icon="book"
                  style={styles.flexButton}
                  onPress={() => setLibraryVisible(true)}
                />
                <Button
                  label="Custom name"
                  accessibilityLabel="Add custom exercise name"
                  variant="secondary"
                  icon="add"
                  style={styles.flexButton}
                  onPress={() => setCustomInputVisible(true)}
                />
              </View>
            )}

            <View style={styles.bottomActions}>
              <Button
                label={busy ? "Saving…" : "Save and start session"}
                accessibilityLabel="Save and start workout session"
                variant="primary"
                block
                disabled={busy}
                onPress={() => void handleSave(true)}
              />
              <Button
                label={isEditing ? "Save changes" : "Save as routine"}
                accessibilityLabel="Save workout routine"
                variant="secondary"
                block
                disabled={busy}
                onPress={() => void handleSave(false)}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>

      <ExerciseLibraryModal
        visible={libraryVisible}
        onClose={() => setLibraryVisible(false)}
        onSelectExercises={handleAddCatalogExercise}
      />
    </Modal>
  );
}

function PlannedExerciseRow(props: {
  readonly index: number;
  readonly total: number;
  readonly item: PlannedExerciseItem;
  readonly inputColor: string;
  readonly onUpdate: (patch: Partial<PlannedExerciseItem>) => void;
  readonly onRemove: () => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
}) {
  const {
    index,
    total,
    item,
    inputColor,
    onUpdate,
    onRemove,
    onMoveUp,
    onMoveDown,
  } = props;
  const currentSets = item.targetSets ?? 3;
  const setTypes = resizePlannedSetTypes(
    readPlannedSetTypes(item.setTypes),
    currentSets,
  );
  const [selectedSetIndex, setSelectedSetIndex] = useState<number | null>(null);
  const updateSetCount = (targetSets: number) =>
    onUpdate({
      targetSets,
      ...(item.setTypes
        ? { setTypes: resizePlannedSetTypes(setTypes, targetSets) }
        : {}),
    });

  const theme = useTheme();
  const inputStyle = { color: inputColor };

  return (
    <Card>
      <View style={styles.exerciseRowTop}>
        <View style={styles.exerciseNameBlock}>
          <ThemedText type="headline">
            {index + 1}. {item.name}
          </ThemedText>
          {item.movementPattern ? (
            <Chip
              label={item.movementPattern.replace("_", " ")}
              tone="primary"
              style={styles.patternChip}
            />
          ) : null}
        </View>

        <View style={styles.exerciseRowControls}>
          {index > 0 ? (
            <IconButton
              icon="chevronUp"
              accessibilityLabel={`Move ${item.name} up`}
              onPress={onMoveUp}
            />
          ) : null}

          {index < total - 1 ? (
            <IconButton
              icon="chevronDown"
              accessibilityLabel={`Move ${item.name} down`}
              onPress={onMoveDown}
            />
          ) : null}

          <IconButton
            icon="trash"
            accessibilityLabel={`Remove ${item.name}`}
            onPress={onRemove}
          />
        </View>
      </View>

      <View style={styles.paramsGrid}>
        <View style={styles.paramBox}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Sets
          </ThemedText>
          <View
            style={[
              styles.stepperRow,
              { backgroundColor: theme.backgroundSelected },
            ]}
          >
            <IconButton
              icon="minus"
              variant="plain"
              accessibilityLabel="Decrease sets"
              onPress={() => updateSetCount(Math.max(1, currentSets - 1))}
            />
            <ThemedText type="smallBold" style={styles.stepperVal}>
              {currentSets}
            </ThemedText>
            <IconButton
              icon="add"
              variant="plain"
              accessibilityLabel="Increase sets"
              onPress={() => updateSetCount(Math.min(20, currentSets + 1))}
            />
          </View>
        </View>

        <View style={styles.paramBox}>
          <FormField label="Target reps">
            <FormTextInput
              style={inputStyle}
              value={item.targetReps ?? ""}
              onChangeText={(targetReps) => onUpdate({ targetReps })}
              placeholder="8-12"
            />
          </FormField>
        </View>

        <View style={styles.paramBox}>
          <FormField label="Target load (optional)">
            <FormTextInput
              style={inputStyle}
              value={item.targetLoad ?? ""}
              onChangeText={(targetLoad) => onUpdate({ targetLoad })}
              placeholder="e.g. 80 kg"
            />
          </FormField>
        </View>

        <View style={styles.paramBoxFull}>
          <FormField label="Exercise note (optional)">
            <FormTextInput
              style={inputStyle}
              value={item.notes ?? ""}
              onChangeText={(notes) => onUpdate({ notes })}
              placeholder="e.g. 90s rest, tempo 3-0-1-0"
            />
          </FormField>
        </View>
      </View>
      <View style={styles.plannedSetTypes}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Set types
        </ThemedText>
        <View style={styles.plannedSetTypeControls}>
          {setTypes.map((type, setIndex) => {
            const option = SET_TYPE_OPTIONS.find(
              (option) => option.type === type,
            )!;
            const label = option.label.replace(/ Set$/, "");
            const badge = setTypeBadgeColors(theme, option.tone);
            return (
              <Pressable
                key={setIndex}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, planned set ${setIndex + 1} type: ${label}`}
                accessibilityHint="Choose the type for this set when starting the routine."
                onPress={() => setSelectedSetIndex(setIndex)}
                style={[
                  styles.plannedSetTypeButton,
                  { backgroundColor: badge.backgroundColor },
                ]}
              >
                <ThemedText type="small" style={{ color: badge.color }}>
                  {setIndex + 1} · {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>
      {selectedSetIndex !== null ? (
        <SetTypeModal
          visible
          currentType={setTypes[selectedSetIndex] ?? "normal"}
          exerciseName={`${item.name} · Set ${selectedSetIndex + 1}`}
          onSelectType={(type) => {
            const next = [...setTypes];
            next[selectedSetIndex] = type;
            onUpdate({ setTypes: next });
            setSelectedSetIndex(null);
          }}
          onClose={() => setSelectedSetIndex(null)}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  plannedSetTypes: { gap: Spacing.one },
  plannedSetTypeControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  plannedSetTypeButton: {
    minHeight: 48,
    minWidth: 48,
    maxWidth: "100%",
    flexShrink: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.sm,
  },
  modalContainer: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  headerTitle: {
    flexShrink: 1,
    textAlign: "center",
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  section: {
    gap: Spacing.one,
  },
  multilineInput: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  exercisesList: {
    gap: Spacing.three,
  },
  exerciseRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  exerciseNameBlock: {
    flex: 1,
    gap: Spacing.one,
  },
  patternChip: {
    alignSelf: "flex-start",
  },
  exerciseRowControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  paramsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  paramBox: {
    flex: 1,
    minWidth: 120,
    gap: Spacing.one,
  },
  paramBoxFull: {
    width: "100%",
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: Radius.md,
    minHeight: 44,
    paddingHorizontal: Spacing.one,
  },
  stepperVal: {
    flex: 1,
    textAlign: "center",
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  flexButton: {
    flex: 1,
  },
  bottomActions: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
});
