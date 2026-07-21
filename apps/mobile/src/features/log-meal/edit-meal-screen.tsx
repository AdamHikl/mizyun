import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useState } from "react";
import type { FoodEntry } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";
import { useTheme } from "@/hooks/use-theme";

import type { LogMealForm } from "./log-meal-data";
import {
  mealFormStringsFromEntry,
  parseOptionalNutritionNumber,
  type MealFormStrings,
} from "./meal-form";
import { fetchFoodEntry, updateFoodEntry } from "./meal-lifecycle-data";

const EMPTY_FORM: MealFormStrings = {
  name: "",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
};

const isMealFormStrings = (value: unknown): value is MealFormStrings =>
  typeof value === "object" &&
  value !== null &&
  ["name", "calories", "protein", "carbs", "fat"].every(
    (field) =>
      field in value &&
      typeof (value as Record<string, unknown>)[field] === "string",
  );

export function EditMealScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const entryId = typeof params.id === "string" ? params.id : null;
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const theme = useTheme();
  const [entry, setEntry] = useState<FoodEntry | null>(null);
  const [form, setForm] = useState<MealFormStrings>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const draftKind = entryId === null ? null : (`meal-edit-${entryId}` as const);

  useEffect(() => {
    if (entryId === null || userId === null || draftKind === null) {
      setMessage("This meal link is invalid.");
      setLoaded(true);
      return;
    }
    let active = true;
    void Promise.all([
      fetchFoodEntry(entryId),
      loadLoggingDraft(userId, draftKind, isMealFormStrings),
    ]).then(([entryResult, draft]) => {
      if (!active) return;
      if (!entryResult.ok) {
        setMessage(entryResult.message);
        setLoaded(true);
        return;
      }
      setEntry(entryResult.entry);
      setForm(draft ?? mealFormStringsFromEntry(entryResult.entry));
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [draftKind, entryId, userId]);

  useEffect(() => {
    if (!loaded || entry === null || userId === null || draftKind === null)
      return;
    void saveLoggingDraft(userId, draftKind, form);
  }, [draftKind, entry, form, loaded, userId]);

  const patchForm = useCallback(
    (field: keyof MealFormStrings, value: string): void => {
      setForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const save = useCallback(async (): Promise<void> => {
    if (entry === null || entryId === null) return;
    setMessage(null);
    const calories = parseOptionalNutritionNumber(form.calories);
    const protein = parseOptionalNutritionNumber(form.protein);
    const carbs = parseOptionalNutritionNumber(form.carbs);
    const fat = parseOptionalNutritionNumber(form.fat);
    if (!calories.ok || !protein.ok || !carbs.ok || !fat.ok) {
      setMessage("Calories and macros must be positive numbers or blank.");
      return;
    }
    const patch: LogMealForm = {
      name: form.name,
      consumedAt: entry.consumedAt,
      caloriesKcal: calories.value,
      proteinG: protein.value,
      carbohydrateG: carbs.value,
      fatG: fat.value,
    };
    setSubmitting(true);
    const result = await updateFoodEntry(entryId, patch);
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (userId !== null && draftKind !== null) {
      await clearLoggingDraft(userId, draftKind);
    }
    router.back();
  }, [draftKind, entry, entryId, form, userId]);

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Edit meal" }} />
      <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="subtitle">Edit meal</ThemedText>
          {!loaded ? (
            <ThemedText type="small" themeColor="textSecondary">
              Loading meal…
            </ThemedText>
          ) : null}

          {entry !== null ? (
            <>
              <Field
                label="Name"
                value={form.name}
                onChangeText={(value) => patchForm("name", value)}
                inputColor={theme.text}
                autoFocus
              />
              <Field
                label="Calories (kcal)"
                value={form.calories}
                onChangeText={(value) => patchForm("calories", value)}
                inputColor={theme.text}
                keyboardType="numeric"
              />
              <View style={styles.macroRow}>
                <View style={styles.macroField}>
                  <Field
                    label="Protein (g)"
                    value={form.protein}
                    onChangeText={(value) => patchForm("protein", value)}
                    inputColor={theme.text}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.macroField}>
                  <Field
                    label="Carbs (g)"
                    value={form.carbs}
                    onChangeText={(value) => patchForm("carbs", value)}
                    inputColor={theme.text}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.macroField}>
                  <Field
                    label="Fat (g)"
                    value={form.fat}
                    onChangeText={(value) => patchForm("fat", value)}
                    inputColor={theme.text}
                    keyboardType="numeric"
                  />
                </View>
              </View>
            </>
          ) : null}

          {message !== null ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              accessibilityRole="alert"
            >
              {message}
            </ThemedText>
          ) : null}

          {entry !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save meal changes"
              accessibilityState={{
                disabled: submitting,
                busy: submitting,
              }}
              disabled={submitting}
              onPress={() => void save()}
              style={({ pressed }) => [
                styles.submit,
                (pressed || submitting) && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold">
                {submitting ? "Saving…" : "Save changes"}
              </ThemedText>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly inputColor: string;
  readonly keyboardType?: "default" | "numeric";
  readonly autoFocus?: boolean;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <TextInput
        accessibilityLabel={props.label}
        autoFocus={props.autoFocus === true}
        keyboardType={props.keyboardType ?? "default"}
        onChangeText={props.onChangeText}
        placeholderTextColor="#8A8D91"
        style={[styles.input, { color: props.inputColor }]}
        value={props.value}
      />
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
    minHeight: 48,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1F1F23",
  },
  pressed: { opacity: 0.6 },
});
