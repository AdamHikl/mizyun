import { Alert, Modal, ScrollView, StyleSheet, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  customExerciseTrackingMode,
  validateCustomExerciseDraft,
  type CustomExerciseDraftError,
  type ExerciseTrackingMode,
} from "@mizyun/core";
import type { Exercise } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  ChoiceChip,
  ChoiceGroup,
  FormField,
  FormStatus,
  FormTextInput,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  createCustomExercise,
  deleteCustomExercise,
  loadExerciseUsage,
  updateCustomExercise,
} from "./custom-exercises-data";

export const TRACKING_MODE_LABELS: Readonly<
  Record<ExerciseTrackingMode, string>
> = {
  load_reps: "Weight & reps",
  duration: "Time",
  duration_distance: "Time & distance",
};

const TRACKING_MODES = Object.keys(
  TRACKING_MODE_LABELS,
) as ExerciseTrackingMode[];

type Usage = "checking" | "unused" | "used" | "unknown";

interface CustomExerciseEditorProps {
  readonly visible: boolean;
  /** The exercise to edit, or null to create one. */
  readonly exercise: Exercise | null;
  /** Prefilled name when creating (e.g. the library search text). */
  readonly initialName?: string;
  readonly savedExercises: ReadonlyArray<Exercise>;
  /** The exercise is in the open workout, so it is shown read-only. */
  readonly inCurrentWorkout?: boolean;
  readonly onClose: () => void;
  readonly onSaved: (exercise: Exercise, created: boolean) => void;
  readonly onDeleted: (exerciseId: string) => void;
}

export const draftErrorMessage = (error: CustomExerciseDraftError): string => {
  switch (error.kind) {
    case "name_empty":
      return "Name the exercise.";
    case "name_too_long":
      return `Use ${error.max} characters or fewer for the name.`;
    case "notes_too_long":
      return `Keep notes under ${error.max} characters.`;
    case "invalid_tracking_mode":
      return "Choose how to track this exercise.";
    case "matches_catalog":
      return `“${error.catalogName}” is already in the library. Search for it instead.`;
    case "matches_saved":
      return `You already have an exercise called “${error.name}”.`;
  }
};

export function CustomExerciseEditor({
  visible,
  exercise,
  initialName = "",
  savedExercises,
  inCurrentWorkout = false,
  onClose,
  onSaved,
  onDeleted,
}: CustomExerciseEditorProps) {
  const theme = useTheme();
  const editing = exercise !== null;
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [trackingMode, setTrackingMode] =
    useState<ExerciseTrackingMode>("load_reps");
  const [usage, setUsage] = useState<Usage>("unused");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Ignores a usage check that finishes after the sheet moved on.
  const usageToken = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const token = ++usageToken.current;
    setError(null);
    setName(exercise?.name ?? initialName.trim());
    setNotes(exercise?.instructions ?? "");
    setTrackingMode(
      exercise ? customExerciseTrackingMode(exercise) : "load_reps",
    );
    if (!exercise) {
      setUsage("unused");
      return;
    }
    setUsage("checking");
    void loadExerciseUsage(exercise.id).then((result) => {
      if (usageToken.current !== token) return;
      setUsage(
        !result.ok ? "unknown" : result.hasLoggedSets ? "used" : "unused",
      );
    });
  }, [visible, exercise, initialName]);

  const readOnly = editing && inCurrentWorkout;
  const trackingLocked = editing && (readOnly || usage !== "unused");
  const canDelete = editing && !readOnly && usage === "unused";
  const originalMode = exercise ? customExerciseTrackingMode(exercise) : null;

  const close = () => {
    if (busyRef.current) return;
    usageToken.current++;
    onClose();
  };

  const save = async () => {
    if (busyRef.current || readOnly) return;
    const validation = validateCustomExerciseDraft(
      {
        name,
        notes,
        trackingMode:
          trackingLocked && originalMode ? originalMode : trackingMode,
      },
      savedExercises,
      exercise ?? undefined,
    );
    if (!validation.ok) {
      setError(draftErrorMessage(validation.error));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = exercise
        ? await updateCustomExercise(exercise, validation.value)
        : await createCustomExercise(validation.value);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      usageToken.current++;
      onSaved(result.exercise, !exercise);
    } catch {
      setError("Could not save the exercise. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!exercise || busyRef.current || !canDelete) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteCustomExercise(exercise.id);
      if (!result.ok) {
        if (result.inUse) setUsage("used");
        setError(result.message);
        return;
      }
      usageToken.current++;
      onDeleted(exercise.id);
    } catch {
      setError("Could not delete the exercise. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const confirmRemove = () => {
    if (!exercise || busyRef.current) return;
    Alert.alert(
      `Delete ${exercise.name}?`,
      "It is removed from your library. Routines that list it keep the name, and logging it there creates a new weight-and-reps exercise.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void remove() },
      ],
    );
  };

  const usageNote = !editing
    ? null
    : readOnly
      ? "This exercise is in your open workout. Edit or delete it after you finish."
      : usage === "unused"
        ? null
        : usage === "checking"
          ? "Checking for logged sets…"
          : usage === "used"
            ? "This exercise has logged sets, so its tracking type is fixed and it can't be deleted."
            : "Couldn't check for logged sets, so tracking type and delete are unavailable for now.";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent={true}
      onRequestClose={close}
    >
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
          <View style={[styles.header, { borderBottomColor: theme.separator }]}>
            <Button
              label="Cancel"
              accessibilityLabel="Cancel exercise changes"
              variant="plain"
              size="small"
              disabled={busy}
              onPress={close}
            />
            <ThemedText type="smallBold" accessibilityRole="header">
              {editing ? "Edit exercise" : "New exercise"}
            </ThemedText>
            <Button
              label={busy ? "Saving…" : "Save"}
              accessibilityLabel="Save exercise"
              variant="plain"
              size="small"
              disabled={busy || readOnly}
              accessibilityState={{ disabled: busy || readOnly, busy }}
              onPress={() => void save()}
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <FormField label="Name">
              <FormTextInput
                accessibilityLabel="Exercise name"
                placeholder="e.g. Sled push"
                value={name}
                onChangeText={setName}
                maxLength={120}
                autoFocus={!editing}
                editable={!busy && !readOnly}
                returnKeyType="done"
              />
            </FormField>

            <FormField label="Track with">
              <ChoiceGroup>
                {TRACKING_MODES.map((mode) => (
                  <ChoiceChip
                    key={mode}
                    label={TRACKING_MODE_LABELS[mode]}
                    selected={trackingMode === mode}
                    disabled={busy || trackingLocked}
                    onPress={() => setTrackingMode(mode)}
                  />
                ))}
              </ChoiceGroup>
            </FormField>

            <FormField label="Notes (optional)">
              <FormTextInput
                accessibilityLabel="Exercise notes"
                placeholder="Setup, cues or equipment"
                value={notes}
                onChangeText={setNotes}
                multiline
                maxLength={4000}
                editable={!busy && !readOnly}
                style={styles.notes}
              />
            </FormField>

            {usageNote ? (
              <FormStatus tone="neutral">{usageNote}</FormStatus>
            ) : null}
            {error ? <FormStatus tone="error">{error}</FormStatus> : null}

            {editing ? (
              <Button
                label="Delete exercise"
                accessibilityLabel={`Delete ${exercise.name}`}
                variant="destructive"
                block
                disabled={busy || !canDelete}
                accessibilityState={{ disabled: busy || !canDelete }}
                onPress={confirmRemove}
              />
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  notes: {
    minHeight: 96,
    textAlignVertical: "top",
  },
});
