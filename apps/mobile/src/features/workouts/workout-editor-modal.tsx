import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { readWorkoutLifecycle, type CatalogExercise } from "@mizyun/core";
import type { Workout } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
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
import { SET_TYPE_OPTIONS, SetTypeModal } from "./set-type-modal";
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
    (exercises: readonly CatalogExercise[]) => {
      const newItems: PlannedExerciseItem[] = exercises.map((exercise) => ({
        name: exercise.name,
        catalogId: exercise.id,
        movementPattern: exercise.movementPattern,
        targetSets: 3,
        targetReps: "8-12",
        restSeconds: defaultRestSeconds,
      }));
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
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              onPress={onClose}
              style={styles.headerButton}
            >
              <ThemedText type="small" themeColor="textSecondary">
                Cancel
              </ThemedText>
            </Pressable>

            <ThemedText type="smallBold" style={styles.headerTitle}>
              {isEditing ? "Edit Workout Routine" : "Create Workout Routine"}
            </ThemedText>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save workout"
              disabled={busy}
              onPress={() => void handleSave(false)}
              style={[styles.headerButton, busy && styles.disabled]}
            >
              <ThemedText type="smallBold" style={styles.saveHeaderText}>
                {busy ? "Saving…" : "Save"}
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            {errorMessage ? (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
              </View>
            ) : null}

            {/* Workout Metadata Section */}
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={styles.cardLabel}>
                WORKOUT DETAILS
              </ThemedText>

              <View style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary">
                  Workout Name
                </ThemedText>
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="e.g. Push Day A, Upper Body Hypertrophy"
                  placeholderTextColor="#8A8D91"
                  value={name}
                  onChangeText={setName}
                  autoFocus={!isEditing}
                />
              </View>

              <View style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary">
                  Notes / Instructions (optional)
                </ThemedText>
                <TextInput
                  style={[
                    styles.input,
                    styles.multilineInput,
                    { color: theme.text },
                  ]}
                  placeholder="e.g. Focus on progressive overload, 2 min rest between heavy sets"
                  placeholderTextColor="#8A8D91"
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={3}
                />
              </View>
            </ThemedView>

            {/* Planned Exercises Section */}
            <ThemedView type="backgroundElement" style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View>
                  <ThemedText type="smallBold" style={styles.cardLabel}>
                    PLANNED EXERCISES ({plannedExercises.length})
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Add and configure the exercises for this routine.
                  </ThemedText>
                </View>
              </View>

              {plannedExercises.length === 0 ? (
                <View style={styles.emptyExercisesBlock}>
                  <ThemedText type="small" themeColor="textSecondary">
                    No exercises added yet. Pick from the exercise library or
                    type a custom exercise name below.
                  </ThemedText>
                </View>
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

              {/* Add Exercise Actions */}
              {customInputVisible ? (
                <View style={styles.customAddBlock}>
                  <TextInput
                    style={[styles.input, { color: theme.text }]}
                    placeholder="Enter custom exercise name…"
                    placeholderTextColor="#8A8D91"
                    value={customName}
                    onChangeText={setCustomName}
                    autoFocus
                  />
                  <View style={styles.customAddActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add custom exercise"
                      onPress={handleAddCustomExercise}
                      style={styles.confirmCustomButton}
                    >
                      <ThemedText
                        type="smallBold"
                        style={styles.confirmCustomText}
                      >
                        Add
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cancel custom exercise"
                      onPress={() => {
                        setCustomInputVisible(false);
                        setCustomName("");
                      }}
                      style={styles.cancelCustomButton}
                    >
                      <ThemedText type="small" themeColor="textSecondary">
                        Cancel
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.addButtonsRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Browse exercise library"
                    onPress={() => setLibraryVisible(true)}
                    style={styles.addLibraryButton}
                  >
                    <ThemedText type="smallBold" style={styles.addLibraryText}>
                      📚 Add from Library
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add custom exercise name"
                    onPress={() => setCustomInputVisible(true)}
                    style={styles.addCustomButton}
                  >
                    <ThemedText type="smallBold" style={styles.addCustomText}>
                      ＋ Custom Name
                    </ThemedText>
                  </Pressable>
                </View>
              )}
            </ThemedView>

            {/* Primary Bottom Actions */}
            <View style={styles.bottomActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save and start workout session"
                disabled={busy}
                onPress={() => void handleSave(true)}
                style={({ pressed }) => [
                  styles.saveAndStartButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <ThemedText type="smallBold" style={styles.saveAndStartText}>
                  {busy ? "Saving…" : "Save & Start Session →"}
                </ThemedText>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save workout routine"
                disabled={busy}
                onPress={() => void handleSave(false)}
                style={({ pressed }) => [
                  styles.saveRoutineButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <ThemedText type="smallBold" style={styles.saveRoutineText}>
                  {isEditing ? "Save Changes" : "Save as Routine"}
                </ThemedText>
              </Pressable>
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

  return (
    <View style={styles.exerciseRowCard}>
      {/* Top row: Name, Reorder, and Delete */}
      <View style={styles.exerciseRowTop}>
        <View style={styles.exerciseNameBlock}>
          <ThemedText type="smallBold" style={styles.exerciseNameText}>
            {index + 1}. {item.name}
          </ThemedText>
          {item.movementPattern ? (
            <View style={styles.patternBadge}>
              <ThemedText type="small" style={styles.patternBadgeText}>
                {item.movementPattern.replace("_", " ")}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <View style={styles.exerciseRowControls}>
          {index > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.name} up`}
              onPress={onMoveUp}
              style={styles.reorderBtn}
            >
              <ThemedText style={styles.reorderBtnText}>↑</ThemedText>
            </Pressable>
          ) : null}

          {index < total - 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.name} down`}
              onPress={onMoveDown}
              style={styles.reorderBtn}
            >
              <ThemedText style={styles.reorderBtnText}>↓</ThemedText>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name}`}
            onPress={onRemove}
            style={styles.removeExerciseBtn}
          >
            <ThemedText style={styles.removeExerciseText}>✕</ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Target Parameters: Sets stepper, Reps, Load, Rest */}
      <View style={styles.paramsGrid}>
        {/* Sets Stepper */}
        <View style={styles.paramBox}>
          <ThemedText type="small" themeColor="textSecondary">
            Sets
          </ThemedText>
          <View style={styles.stepperRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease sets"
              onPress={() => updateSetCount(Math.max(1, currentSets - 1))}
              style={styles.stepperBtn}
            >
              <ThemedText type="smallBold">−</ThemedText>
            </Pressable>
            <ThemedText type="smallBold" style={styles.stepperVal}>
              {currentSets}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase sets"
              onPress={() => updateSetCount(Math.min(20, currentSets + 1))}
              style={styles.stepperBtn}
            >
              <ThemedText type="smallBold">＋</ThemedText>
            </Pressable>
          </View>
        </View>

        {/* Reps */}
        <View style={styles.paramBox}>
          <ThemedText type="small" themeColor="textSecondary">
            Target Reps
          </ThemedText>
          <TextInput
            style={[styles.paramInput, { color: inputColor }]}
            value={item.targetReps ?? ""}
            onChangeText={(targetReps) => onUpdate({ targetReps })}
            placeholder="8-12"
            placeholderTextColor="#8A8D91"
          />
        </View>

        {/* Target Load */}
        <View style={styles.paramBox}>
          <ThemedText type="small" themeColor="textSecondary">
            Target Load (opt)
          </ThemedText>
          <TextInput
            style={[styles.paramInput, { color: inputColor }]}
            value={item.targetLoad ?? ""}
            onChangeText={(targetLoad) => onUpdate({ targetLoad })}
            placeholder="e.g. 80 kg"
            placeholderTextColor="#8A8D91"
          />
        </View>

        {/* Notes */}
        <View style={styles.paramBoxFull}>
          <ThemedText type="small" themeColor="textSecondary">
            Exercise Note (opt)
          </ThemedText>
          <TextInput
            style={[styles.paramInput, { color: inputColor }]}
            value={item.notes ?? ""}
            onChangeText={(notes) => onUpdate({ notes })}
            placeholder="e.g. 90s rest, tempo 3-0-1-0"
            placeholderTextColor="#8A8D91"
          />
        </View>
      </View>
      <View style={styles.plannedSetTypes}>
        <ThemedText type="small" themeColor="textSecondary">
          Set types
        </ThemedText>
        <View style={styles.plannedSetTypeControls}>
          {setTypes.map((type, setIndex) => {
            const option = SET_TYPE_OPTIONS.find(
              (option) => option.type === type,
            )!;
            const label = option.label.replace(/ Set$/, "");
            return (
              <Pressable
                key={setIndex}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, planned set ${setIndex + 1} type: ${label}`}
                accessibilityHint="Choose the type for this set when starting the routine."
                onPress={() => setSelectedSetIndex(setIndex)}
                style={[
                  styles.plannedSetTypeButton,
                  { backgroundColor: option.badgeBg },
                ]}
              >
                <ThemedText
                  type="small"
                  style={
                    type === "normal" ? undefined : { color: option.badgeColor }
                  }
                >
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
    </View>
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
    borderRadius: 8,
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
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#8A8D91",
  },
  headerTitle: {
    fontSize: 16,
  },
  headerButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  saveHeaderText: {
    color: "#10B981",
    fontSize: 15,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.four,
    paddingBottom: Spacing.six * 2,
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
  card: {
    padding: Spacing.four,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
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
  field: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  emptyExercisesBlock: {
    paddingVertical: Spacing.two,
  },
  exercisesList: {
    gap: Spacing.three,
  },
  exerciseRowCard: {
    backgroundColor: "rgba(148, 163, 184, 0.06)",
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
    gap: Spacing.two,
  },
  exerciseRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  exerciseNameBlock: {
    flex: 1,
    gap: 4,
  },
  exerciseNameText: {
    fontSize: 14,
  },
  patternBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  patternBadgeText: {
    fontSize: 10,
    color: "#10B981",
    fontWeight: "600",
    textTransform: "capitalize",
  },
  exerciseRowControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  reorderBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    borderRadius: 6,
  },
  reorderBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  removeExerciseBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderRadius: 6,
  },
  removeExerciseText: {
    fontSize: 12,
    color: "#EF4444",
    fontWeight: "700",
  },
  paramsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: 4,
  },
  paramBox: {
    flex: 1,
    minWidth: 90,
    gap: 4,
  },
  paramBoxFull: {
    width: "100%",
    gap: 4,
  },
  paramInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: 8,
    height: 33,
  },
  stepperBtn: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperVal: {
    flex: 1,
    textAlign: "center",
    fontSize: 13,
  },
  addButtonsRow: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  addLibraryButton: {
    flex: 1,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  addLibraryText: {
    color: "#10B981",
    fontSize: 13,
  },
  addCustomButton: {
    paddingHorizontal: Spacing.three,
    backgroundColor: "rgba(148, 163, 184, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  addCustomText: {
    fontSize: 13,
  },
  customAddBlock: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  customAddActions: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  confirmCustomButton: {
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    borderRadius: 8,
  },
  confirmCustomText: {
    color: "#ffffff",
    fontSize: 12,
  },
  cancelCustomButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    justifyContent: "center",
  },
  bottomActions: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  saveAndStartButton: {
    backgroundColor: "#10B981",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  saveAndStartText: {
    color: "#ffffff",
    fontSize: 15,
  },
  saveRoutineButton: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  saveRoutineText: {
    fontSize: 14,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
