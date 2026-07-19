import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";

import { submitLogWorkout } from "./log-workout-data";

export function LogWorkoutScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (userId === null) return;
    let active = true;
    void loadLoggingDraft(userId, "workout", isWorkoutDraft).then((draft) => {
      if (!active) return;
      if (draft !== null) {
        setName(draft.name);
        setNotes(draft.notes);
      }
      setDraftLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!draftLoaded || userId === null) return;
    void saveLoggingDraft(userId, "workout", { name, notes });
  }, [draftLoaded, name, notes, userId]);

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    const result = await submitLogWorkout({
      name,
      notes: notes.trim().length > 0 ? notes.trim() : null,
      startedAt: new Date().toISOString(),
    });
    setSubmitting(false);
    if (result.ok) {
      if (userId !== null) await clearLoggingDraft(userId, "workout");
      router.back();
      return;
    }
    setError(result.message);
  }, [name, notes, userId]);

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Start a workout" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="subtitle">Name your session.</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            We'll mark it completed now. Sets, duration, and previous
            performance land in a follow-up segment.
          </ThemedText>

          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Leg day"
            autoFocus
            inputColor={theme.text}
          />

          <Field
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Front squat felt strong"
            multiline
            inputColor={theme.text}
          />

          {error !== null ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.errorText}
              accessibilityRole="alert"
            >
              {error}
            </ThemedText>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            accessibilityState={{ disabled: submitting, busy: submitting }}
            onPress={() => {
              void onSubmit();
            }}
            style={({ pressed }) => [
              styles.submit,
              (pressed || submitting) && styles.submitPressed,
            ]}
          >
            <ThemedText type="smallBold">
              {submitting ? "Saving…" : "Save workout"}
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly multiline?: boolean;
  readonly inputColor: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#8A8D91"
        autoFocus={props.autoFocus === true}
        multiline={props.multiline === true}
        accessibilityLabel={props.label}
        style={[
          styles.input,
          { color: props.inputColor },
          props.multiline === true ? styles.inputMultiline : null,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.three,
  },
  field: { gap: Spacing.one },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.two,
    padding: Spacing.three,
    fontSize: 16,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: "top" },
  submit: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F1F23",
    borderRadius: Spacing.three,
    padding: Spacing.three,
    alignItems: "center",
    backgroundColor: "#1F1F23",
    color: "#FFFFFF",
  },
  submitPressed: { opacity: 0.65 },
  errorText: { marginTop: Spacing.one },
});

interface WorkoutDraft {
  readonly name: string;
  readonly notes: string;
}

const isWorkoutDraft = (value: unknown): value is WorkoutDraft =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  "notes" in value &&
  typeof value.notes === "string";
