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
import { Image } from "expo-image";
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
  refineMealDraft,
  snapMealPhoto,
  submitLogMeal,
  type LogMealForm,
} from "./log-meal-data";
import {
  isRecoverableMealDraft,
  mealFormStringsFromDraft,
  parseOptionalNutritionNumber,
} from "./meal-form";
import { normalizeMealPhoto } from "./meal-photo";

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
  // VISION-001 — photo-to-draft state. `attachedPhoto` holds the
  // user's selected or captured image before submission. `snapping` is true
  // while the photo is uploading and the configured vision provider is being
  // consulted. The form pre-fills with the candidate's name/calories/macros;
  // the user can edit before saving, while `draftWarnings` keeps provider
  // uncertainty visible.
  const [attachedPhoto, setAttachedPhoto] = useState<{
    uri: string;
    width?: number;
    height?: number;
  } | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [mealDescription, setMealDescription] = useState("");
  const [draftWarnings, setDraftWarnings] = useState<readonly string[]>([]);
  const [aiDraft, setAiDraft] = useState<FoodDraftCandidate | null>(null);
  const [sourceProposalId, setSourceProposalId] = useState<string | null>(null);
  // AI-ACT-007 — free-text instruction the user types after the
  // initial draft lands. The "Refine with AI" button is enabled
  // only while an AI draft is loaded; submitting POSTs to
  // /v1/food-entries/draft/refine and patches the form.
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refining, setRefining] = useState(false);
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
          setMealDescription(draft.description ?? "");
          setAiDraft(draft.aiDraft ?? null);
          setSourceProposalId(draft.sourceProposalId ?? null);
          setRefineInstruction(draft.refineInstruction ?? "");
          if (draft.attachedPhotoUri) {
            setAttachedPhoto({ uri: draft.attachedPhotoUri });
          }
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
      description: mealDescription,
      ...(aiDraft === null ? {} : { aiDraft }),
      ...(sourceProposalId === null ? {} : { sourceProposalId }),
      ...(refineInstruction.trim().length > 0 ? { refineInstruction } : {}),
      ...(attachedPhoto !== null
        ? { attachedPhotoUri: attachedPhoto.uri }
        : {}),
    });
  }, [
    aiDraft,
    attachedPhoto,
    calories,
    carbs,
    draftLoaded,
    fat,
    mealDescription,
    name,
    protein,
    refineInstruction,
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

  const onChoosePhoto = useCallback(async () => {
    measurement.current?.tap();
    if (hadFailure.current) measurement.current?.retry();
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to choose a meal photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setAttachedPhoto({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
    });
  }, []);

  const onTakePhoto = useCallback(async () => {
    measurement.current?.tap();
    if (hadFailure.current) measurement.current?.retry();
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera permission is required to take a meal photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setAttachedPhoto({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
    });
  }, []);

  const onRemovePhoto = useCallback(() => {
    setAttachedPhoto(null);
  }, []);

  const onProcessPhoto = useCallback(async () => {
    if (attachedPhoto === null) return;
    measurement.current?.tap();
    if (hadFailure.current) measurement.current?.retry();
    setSnapping(true);
    setError(null);
    setDraftWarnings([]);
    try {
      const hint = mealDescription.trim();
      const photo = await normalizeMealPhoto(attachedPhoto);
      const draft = await snapMealPhoto(
        photo,
        "image/jpeg",
        hint.length > 0 ? hint : undefined,
      );
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
  }, [attachedPhoto, mealDescription]);

  const onTextDraft = useCallback(async () => {
    if (mealDescription.trim().length < 2) return;
    measurement.current?.tap();
    if (hadFailure.current) measurement.current?.retry();
    setSnapping(true);
    setError(null);
    setDraftWarnings([]);
    try {
      const result = await draftMealFromText(mealDescription);
      if (!result.ok) {
        hadFailure.current = true;
        measurement.current?.fail("submit", "unexpected", true);
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
      measurement.current?.complete();
    } catch {
      hadFailure.current = true;
      measurement.current?.fail("submit", "unexpected", true);
      setError("Couldn't generate a draft from the description.");
    } finally {
      setSnapping(false);
    }
  }, [mealDescription]);

  // AI-ACT-007 — refine the current AI draft with a follow-up
  // instruction. The endpoint takes the current draft as
  // context, so the user can type "make the chicken 200g instead
  // of 100g" and the server returns a re-evaluated candidate.
  // On success we patch the form fields + warnings so the user
  // can confirm. The description field is intentionally left
  // intact so the photo flow's `textHint` chain still works.
  const onRefineDraft = useCallback(async () => {
    const instruction = refineInstruction.trim();
    if (instruction.length < 2 || aiDraft === null || refining || submitting) {
      return;
    }
    setRefining(true);
    setError(null);
    try {
      const result = await refineMealDraft(aiDraft, instruction);
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
      // Keep the user's instruction visible so they can chain
      // follow-up refinements (e.g. "now make the rice half").
      measurement.current?.complete();
    } finally {
      setRefining(false);
    }
  }, [refineInstruction, aiDraft, refining, submitting]);

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
            dashboard totals use them when present. You can describe the meal,
            attach a photo, or both — anything you type is sent with the photo
            to help the AI estimate portions and ingredients.
          </ThemedText>

          <TextInput
            testID="meal-description-input"
            accessibilityLabel="Describe meal for AI draft"
            multiline
            maxLength={1_000}
            placeholder="Describe food and portions, e.g. two eggs, toast, and a teaspoon of butter"
            placeholderTextColor="#8A8D91"
            value={mealDescription}
            onChangeText={setMealDescription}
            style={[styles.input, styles.description, { color: theme.text }]}
          />

          {attachedPhoto !== null ? (
            <View style={styles.attachedPhotoCard}>
              <Image
                source={attachedPhoto.uri}
                style={styles.attachedPhotoImage}
                contentFit="cover"
                accessibilityLabel="Attached meal photo"
              />
              <View style={styles.attachedPhotoInfo}>
                <ThemedText type="smallBold">📷 Photo attached</ThemedText>
                <ThemedText themeColor="textSecondary" type="small">
                  Ready to process with your description
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove attached photo"
                disabled={snapping || submitting}
                onPress={onRemovePhoto}
                style={({ pressed }) => [
                  styles.removePhotoButton,
                  pressed && styles.snapPressed,
                ]}
              >
                <ThemedText type="smallBold" themeColor="textSecondary">
                  ✕ Remove
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          {attachedPhoto !== null ? (
            <Pressable
              accessibilityRole="button"
              testID="process-meal-photo-button"
              accessibilityLabel="Process photo with AI"
              accessibilityHint="Send the attached photo and your description to Mizyun to generate a meal draft with estimated calories and macros."
              disabled={snapping || submitting}
              accessibilityState={{
                busy: snapping,
                disabled: snapping || submitting,
              }}
              onPress={() => {
                void onProcessPhoto();
              }}
              style={({ pressed }) => [
                styles.processButton,
                (pressed || snapping) && styles.processButtonPressed,
              ]}
            >
              {snapping ? (
                <ActivityIndicator
                  size="small"
                  color="#FFFFFF"
                  accessibilityLabel="Analysing photo"
                />
              ) : (
                <ThemedText type="smallBold" style={styles.processButtonText}>
                  ✨ Process photo with AI
                </ThemedText>
              )}
            </Pressable>
          ) : (
            <>
              {mealDescription.trim().length >= 2 ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={snapping || submitting}
                  accessibilityState={{
                    busy: snapping,
                    disabled: snapping || submitting,
                  }}
                  onPress={() => void onTextDraft()}
                  style={({ pressed }) => [
                    styles.snap,
                    (pressed || snapping) && styles.snapPressed,
                  ]}
                >
                  {snapping ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.text}
                      accessibilityLabel="Analysing description"
                    />
                  ) : (
                    <ThemedText type="smallBold">
                      ✨ Draft from description
                    </ThemedText>
                  )}
                </Pressable>
              ) : null}

              <View style={styles.photoRow}>
                <Pressable
                  accessibilityRole="button"
                  testID="take-meal-photo-button"
                  accessibilityLabel="Take a meal photo"
                  accessibilityHint="Open the camera to take a meal photo and attach it to this entry."
                  disabled={snapping || submitting}
                  accessibilityState={{
                    disabled: snapping || submitting,
                  }}
                  onPress={() => {
                    void onTakePhoto();
                  }}
                  style={({ pressed }) => [
                    styles.snapButton,
                    pressed && styles.snapPressed,
                  ]}
                >
                  <ThemedText type="smallBold">📸 Take photo</ThemedText>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  testID="snap-meal-button"
                  accessibilityLabel="Choose a meal photo"
                  accessibilityHint="Open the photo library to pick a meal photo and attach it to this entry."
                  disabled={snapping || submitting}
                  accessibilityState={{
                    disabled: snapping || submitting,
                  }}
                  onPress={() => {
                    void onChoosePhoto();
                  }}
                  style={({ pressed }) => [
                    styles.snapButton,
                    pressed && styles.snapPressed,
                  ]}
                >
                  <ThemedText type="smallBold">🖼️ Choose photo</ThemedText>
                </Pressable>
              </View>
            </>
          )}

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

          {aiDraft !== null ? (
            <View style={styles.refineBlock}>
              <ThemedText type="small" themeColor="textSecondary">
                Refine with AI
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Tell the AI how to adjust the values above — for example “make
                the chicken 200g instead of 100g”. The form will be re-filled
                with the refined estimate.
              </ThemedText>
              <TextInput
                testID="meal-refine-input"
                accessibilityLabel="Refine AI meal draft"
                placeholder="Make the chicken 200g instead of 100g"
                placeholderTextColor="#8A8D91"
                multiline
                maxLength={1_000}
                value={refineInstruction}
                onChangeText={setRefineInstruction}
                style={[
                  styles.input,
                  styles.refineInput,
                  { color: theme.text },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                testID="meal-refine-button"
                accessibilityLabel="Refine the AI draft"
                accessibilityHint="Send the current draft and your instruction to Mizyun. The form will be re-filled with the refined estimate."
                disabled={
                  refining ||
                  submitting ||
                  snapping ||
                  refineInstruction.trim().length < 2
                }
                accessibilityState={{
                  busy: refining,
                  disabled:
                    refining ||
                    submitting ||
                    snapping ||
                    refineInstruction.trim().length < 2,
                }}
                onPress={() => {
                  void onRefineDraft();
                }}
                style={({ pressed }) => [
                  styles.refineButton,
                  (pressed || refining) && styles.refinePressed,
                ]}
              >
                {refining ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.text}
                    accessibilityLabel="Refining draft"
                  />
                ) : (
                  <ThemedText type="smallBold">✨ Refine</ThemedText>
                )}
              </Pressable>
            </View>
          ) : null}

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
  photoRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  snapButton: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.one,
  },
  warnings: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.one,
  },
  refineBlock: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  refineInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  refineButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F1F23",
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.two,
  },
  refinePressed: { opacity: 0.65 },
  attachedPhotoCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.three,
    padding: Spacing.two,
    gap: Spacing.three,
  },
  attachedPhotoImage: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
  },
  attachedPhotoInfo: {
    flex: 1,
    gap: 2,
  },
  removePhotoButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  processButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F1F23",
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    backgroundColor: "#1F1F23",
    gap: Spacing.two,
  },
  processButtonPressed: {
    opacity: 0.65,
  },
  processButtonText: {
    color: "#FFFFFF",
  },
});
