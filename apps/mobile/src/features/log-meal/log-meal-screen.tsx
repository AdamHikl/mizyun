import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoggingFlowMeasurement } from "@mizyun/observability";
import type { FoodDraftCandidate } from "@mizyun/contracts";

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

import {
  draftMealFromText,
  snapMealPhoto,
  submitLogMeal,
  type LogMealForm,
} from "./log-meal-data";
import {
  isRecoverableMealDraft,
  mealFormStringsFromDraft,
  parseOptionalNutritionNumber,
} from "./meal-form";

const MAX_MEAL_IMAGE_EDGE = 2048;

const draftEvidenceLines = (
  draft: import("@mizyun/contracts").FoodDraftCandidate,
): readonly string[] => {
  const ranges = [
    draft.calorieRangeKcal
      ? `Calories: ${draft.calorieRangeKcal.low}–${draft.calorieRangeKcal.high} kcal`
      : null,
    draft.proteinRangeG
      ? `Protein: ${draft.proteinRangeG.low}–${draft.proteinRangeG.high} g`
      : null,
    draft.carbohydrateRangeG
      ? `Carbs: ${draft.carbohydrateRangeG.low}–${draft.carbohydrateRangeG.high} g`
      : null,
    draft.fatRangeG
      ? `Fat: ${draft.fatRangeG.low}–${draft.fatRangeG.high} g`
      : null,
  ].filter((line): line is string => line !== null);
  return [
    `AI confidence: ${Math.round(draft.confidence * 100)}%`,
    ...ranges,
    ...draft.assumptions.map((item) => `Assumption: ${item}`),
    ...draft.warnings,
    `Source: ${draft.provenance.inputKind} estimate · ${draft.provenance.provider} · ${draft.provenance.promptVersion}`,
  ];
};

const normalizeMealPhoto = async (
  asset: ImagePicker.ImagePickerAsset,
): Promise<File> => {
  const context = ImageManipulator.manipulate(asset.uri);
  const longestEdge = Math.max(asset.width, asset.height);
  if (longestEdge > MAX_MEAL_IMAGE_EDGE) {
    if (asset.width >= asset.height) {
      context.resize({ width: MAX_MEAL_IMAGE_EDGE, height: null });
    } else {
      context.resize({ width: null, height: MAX_MEAL_IMAGE_EDGE });
    }
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: 0.82,
    format: SaveFormat.JPEG,
  });
  const file = new File(saved.uri);
  if (!file.exists || file.size <= 0) {
    throw new Error("The selected photo could not be read.");
  }
  return file;
};

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
  // VISION-001 — photo-to-draft state. `snapping` is true while
  // the photo is uploading and the configured vision provider is being
  // consulted. The form pre-fills with the candidate's name/calories/macros;
  // the user can edit before saving, while `draftWarnings` keeps provider
  // uncertainty visible.
  const [snapping, setSnapping] = useState(false);
  const [mealDescription, setMealDescription] = useState("");
  const [draftWarnings, setDraftWarnings] = useState<readonly string[]>([]);
  const [aiDraft, setAiDraft] = useState<FoodDraftCandidate | null>(null);
  const [sourceProposalId, setSourceProposalId] = useState<string | null>(null);
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
    void loadLoggingDraft(userId, "meal", isRecoverableMealDraft).then(
      (draft) => {
        if (!active) return;
        if (draft !== null) {
          setName(draft.name);
          setCalories(draft.calories);
          setProtein(draft.protein);
          setCarbs(draft.carbs);
          setFat(draft.fat);
          setAiDraft(draft.aiDraft ?? null);
          setSourceProposalId(draft.sourceProposalId ?? null);
          setDraftWarnings(
            draft.aiDraft === undefined
              ? []
              : draftEvidenceLines(draft.aiDraft),
          );
        }
        setDraftLoaded(true);
      },
    );
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
      ...(aiDraft === null ? {} : { aiDraft }),
      ...(sourceProposalId === null ? {} : { sourceProposalId }),
    });
  }, [
    aiDraft,
    calories,
    carbs,
    draftLoaded,
    fat,
    name,
    protein,
    sourceProposalId,
    userId,
  ]);

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
      ...(aiDraft === null
        ? {}
        : {
            details: {
              aiDraft: {
                ...aiDraft,
                userConfirmed: true,
                ...(sourceProposalId === null ? {} : { sourceProposalId }),
              },
            },
          }),
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
  }, [name, calories, protein, carbs, fat, userId, aiDraft, sourceProposalId]);

  // VISION-001 — launch the image picker, normalize the selected image to a
  // bounded JPEG, then post the transient bytes to
  // /v1/food-entries/draft. The candidate's name/calories/macros
  // pre-fill the form; the user can edit before saving. The
  // model's free-text warnings are shown inline so the user
  // knows when the AI is uncertain.
  const onSnap = useCallback(async () => {
    measurement.current?.tap();
    if (hadFailure.current) measurement.current?.retry();
    setError(null);
    setDraftWarnings([]);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to choose a meal photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset === undefined) return;
    setSnapping(true);
    try {
      const photo = await normalizeMealPhoto(asset);
      const draft = await snapMealPhoto(photo, "image/jpeg");
      if (!draft.ok) {
        hadFailure.current = true;
        measurement.current?.fail("upload", "unexpected", true);
        setError(draft.message);
        return;
      }
      const strings = mealFormStringsFromDraft(draft.draft);
      setName(strings.name);
      setCalories(strings.calories);
      setProtein(strings.protein);
      setCarbs(strings.carbs);
      setFat(strings.fat);
      setDraftWarnings(draftEvidenceLines(draft.draft));
      setAiDraft(draft.draft);
      setSourceProposalId(null);
      measurement.current?.complete();
    } catch (cause) {
      hadFailure.current = true;
      measurement.current?.fail("upload", "unexpected", true);
      setError(
        cause instanceof Error
          ? `Couldn't read the photo: ${cause.message}`
          : "Couldn't read the photo.",
      );
    } finally {
      setSnapping(false);
    }
  }, [userId]);

  const onTextDraft = useCallback(async () => {
    if (mealDescription.trim().length < 2) return;
    setSnapping(true);
    setError(null);
    setDraftWarnings([]);
    try {
      const result = await draftMealFromText(mealDescription);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const strings = mealFormStringsFromDraft(result.draft);
      setName(strings.name);
      setCalories(strings.calories);
      setProtein(strings.protein);
      setCarbs(strings.carbs);
      setFat(strings.fat);
      setDraftWarnings(draftEvidenceLines(result.draft));
      setAiDraft(result.draft);
      setSourceProposalId(null);
    } finally {
      setSnapping(false);
    }
  }, [mealDescription]);

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

          <TextInput
            accessibilityLabel="Describe meal for AI draft"
            multiline
            maxLength={1_000}
            placeholder="Describe food and portions, e.g. two eggs, toast, and a teaspoon of butter"
            placeholderTextColor="#8A8D91"
            value={mealDescription}
            onChangeText={setMealDescription}
            style={[styles.input, styles.description, { color: theme.text }]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={
              snapping || submitting || mealDescription.trim().length < 2
            }
            accessibilityState={{
              busy: snapping,
              disabled:
                snapping || submitting || mealDescription.trim().length < 2,
            }}
            onPress={() => void onTextDraft()}
            style={({ pressed }) => [
              styles.snap,
              (pressed || snapping) && styles.snapPressed,
            ]}
          >
            <ThemedText type="smallBold">✨ Draft from description</ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            testID="snap-meal-button"
            accessibilityLabel="Choose a meal photo"
            accessibilityHint="Open the photo library, pick a meal photo, and let Mizyun suggest a draft with calories and macros."
            disabled={snapping || submitting}
            accessibilityState={{
              busy: snapping,
              disabled: snapping || submitting,
            }}
            onPress={() => {
              void onSnap();
            }}
            style={({ pressed }) => [
              styles.snap,
              (pressed || snapping) && styles.snapPressed,
            ]}
          >
            {snapping ? (
              <ActivityIndicator
                size="small"
                color={theme.text}
                accessibilityLabel="Analysing photo"
              />
            ) : (
              <ThemedText type="smallBold">📷 Choose a meal photo</ThemedText>
            )}
          </Pressable>

          {draftWarnings.length > 0 ? (
            <ThemedView
              type="backgroundElement"
              style={styles.warnings}
              accessibilityRole="alert"
            >
              {draftWarnings.map((warning) => (
                <ThemedText
                  key={warning}
                  type="small"
                  themeColor="textSecondary"
                  style={{ marginVertical: 1 }}
                >
                  {warning}
                </ThemedText>
              ))}
            </ThemedView>
          ) : null}

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
  description: { minHeight: 76, textAlignVertical: "top" },
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
  snap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.two,
  },
  snapPressed: { opacity: 0.65 },
  warnings: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.one,
  },
});
