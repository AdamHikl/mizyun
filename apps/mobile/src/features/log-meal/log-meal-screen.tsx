import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoggingFlowMeasurement } from "@mizyun/observability";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { analyticsClient } from "@/composition/analytics-client";
import {
  classifyAnalyticsFailure,
  isRetryableAnalyticsFailure,
} from "@/features/analytics/classify-failure";
import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";

import { submitLogMeal, type LogMealForm } from "./log-meal-data";
import { parseOptionalNutritionNumber } from "./meal-form";

export function LogMealScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const measurement = useRef<LoggingFlowMeasurement | null>(null);
  const hadFailure = useRef(false);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    measurement.current = new LoggingFlowMeasurement("meal", analyticsClient);
    return () => {
      measurement.current = null;
    };
  }, []);

  useEffect(() => {
    if (userId === null) return;
    let active = true;
    void loadLoggingDraft(userId, "meal", isMealDraft).then((draft) => {
      if (!active) return;
      if (draft !== null) {
        setName(draft.name);
        setCalories(draft.calories);
        setProtein(draft.protein);
        setCarbs(draft.carbs);
        setFat(draft.fat);
      }
      setDraftLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!draftLoaded || userId === null) return;
    void saveLoggingDraft(userId, "meal", {
      name,
      calories,
      protein,
      carbs,
      fat,
    });
  }, [calories, carbs, draftLoaded, fat, name, protein, userId]);

  const onSubmit = useCallback(async () => {
    measurement.current?.tap();
    if (hadFailure.current) measurement.current?.retry();
    setError(null);
    const parsedCalories = parseOptionalNutritionNumber(calories);
    const parsedProtein = parseOptionalNutritionNumber(protein);
    const parsedCarbs = parseOptionalNutritionNumber(carbs);
    const parsedFat = parseOptionalNutritionNumber(fat);
    if (
      !parsedCalories.ok ||
      !parsedProtein.ok ||
      !parsedCarbs.ok ||
      !parsedFat.ok
    ) {
      hadFailure.current = true;
      measurement.current?.fail("validation", "invalid_input", false);
      setError("Calories and macros must be positive numbers or blank.");
      return;
    }
    setSubmitting(true);
    const form: LogMealForm = {
      name,
      caloriesKcal: parsedCalories.value,
      proteinG: parsedProtein.value,
      carbohydrateG: parsedCarbs.value,
      fatG: parsedFat.value,
      consumedAt: null,
    };
    const result = await submitLogMeal(form);
    setSubmitting(false);
    if (result.ok) {
      measurement.current?.complete();
      if (userId !== null) await clearLoggingDraft(userId, "meal");
      router.back();
      return;
    }
    hadFailure.current = true;
    const reason = classifyAnalyticsFailure(result.message);
    measurement.current?.fail(
      reason === "invalid_input" ? "validation" : "submit",
      reason,
      isRetryableAnalyticsFailure(reason),
    );
    setError(result.message);
  }, [name, calories, protein, carbs, fat, userId]);

  const calorieHint =
    calories.trim().length > 0 ? "calories recorded" : "calories optional";

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Log a meal" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="subtitle">What did you eat?</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            Name your meal first; calories and macros are optional but the
            dashboard totals use them when present.
          </ThemedText>

          <Field
            testID="meal-name-input"
            label="Name"
            value={name}
            onChangeText={setName}
            onFocus={() => measurement.current?.tap()}
            placeholder="Toast"
            autoFocus
            inputColor={theme.text}
          />

          <Field
            testID="meal-calories-input"
            label="Calories (kcal)"
            value={calories}
            onChangeText={setCalories}
            onFocus={() => measurement.current?.tap()}
            placeholder="200"
            keyboardType="numeric"
            helperText={calorieHint}
            inputColor={theme.text}
          />

          <View style={styles.macroRow}>
            <View style={styles.macroField}>
              <Field
                testID="meal-protein-input"
                label="Protein (g)"
                value={protein}
                onChangeText={setProtein}
                onFocus={() => measurement.current?.tap()}
                placeholder="5"
                keyboardType="numeric"
                inputColor={theme.text}
              />
            </View>
            <View style={styles.macroField}>
              <Field
                testID="meal-carbs-input"
                label="Carbs (g)"
                value={carbs}
                onChangeText={setCarbs}
                onFocus={() => measurement.current?.tap()}
                placeholder="30"
                keyboardType="numeric"
                inputColor={theme.text}
              />
            </View>
            <View style={styles.macroField}>
              <Field
                testID="meal-fat-input"
                label="Fat (g)"
                value={fat}
                onChangeText={setFat}
                onFocus={() => measurement.current?.tap()}
                placeholder="4"
                keyboardType="numeric"
                inputColor={theme.text}
              />
            </View>
          </View>

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
              {submitting ? "Saving…" : "Save meal"}
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field(props: {
  readonly testID: string;
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly onFocus?: () => void;
  readonly placeholder?: string;
  readonly helperText?: string;
  readonly autoFocus?: boolean;
  readonly keyboardType?: "default" | "numeric";
  readonly inputColor: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <TextInput
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        placeholder={props.placeholder}
        placeholderTextColor="#8A8D91"
        autoFocus={props.autoFocus === true}
        keyboardType={props.keyboardType ?? "default"}
        accessibilityLabel={props.label}
        style={[styles.input, { color: props.inputColor }]}
      />
      {props.helperText !== undefined ? (
        <ThemedText type="small" themeColor="textSecondary">
          {props.helperText}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
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
  macroRow: { flexDirection: "row", gap: Spacing.two },
  macroField: { flex: 1 },
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

interface MealDraft {
  readonly name: string;
  readonly calories: string;
  readonly protein: string;
  readonly carbs: string;
  readonly fat: string;
}

const isMealDraft = (value: unknown): value is MealDraft =>
  typeof value === "object" &&
  value !== null &&
  ["name", "calories", "protein", "carbs", "fat"].every(
    (field) =>
      field in value &&
      typeof (value as Record<string, unknown>)[field] === "string",
  );
