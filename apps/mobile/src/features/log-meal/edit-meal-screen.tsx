import { MealVisual } from "./meal-visual";
import { useMealVisualCapability } from "./meal-visual-capability";
import { ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  foodDraftCandidateSchema,
  type FoodDraftCandidate,
  type FoodEntry,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  BottomTabInset,
  MaxContentWidth,
  PageGutter,
  Spacing,
} from "@/constants/theme";
import {
  Button,
  Card,
  Chip,
  FormField,
  FormStatus,
  FormTextInput,
  Icon,
} from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";
import { apiClient } from "@/composition/api-client";
import {
  useAiConsentController,
  type PendingAiAction,
} from "@/features/coach/ai-consent-controller";
import { AiConsentModal } from "@/features/coach/ai-consent-modal";

import { refineMealDraftWith, type LogMealForm } from "./log-meal-data";
import {
  createOperationId,
  mealDraftFromCurrentForm,
  mealDraftForAdvancedAccess,
  mergeMealDraftIntoForm,
  mealFormStringsFromEntry,
  parseOptionalNutritionNumber,
  advancedNutrientsFromForm,
  ADVANCED_NUTRIENT_FIELDS,
  type MealFormStrings,
} from "./meal-form";
import { fetchFoodEntry, updateFoodEntry } from "./meal-lifecycle-data";
import {
  extractGramsFromName,
  getEntryGrams,
  getEntryMealGroup,
  scaleNutrition,
  updateGramsInName,
  withMealGrams,
  withMealGroup,
} from "./meal-scale";
import {
  AdvancedNutrientFields,
  useAdvancedNutritionCapability,
} from "./advanced-nutrition";

const EMPTY_FORM: MealFormStrings = {
  name: "",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
  fibre: "",
  saturatedFat: "",
  totalSugars: "",
  sodium: "",
  cholesterol: "",
};

const MEAL_GROUP_PRESETS = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;

const extractCalculationText = (entry: FoodEntry): string | null => {
  if (!entry.details || typeof entry.details !== "object") return null;
  const d = entry.details as Record<string, unknown>;
  if (
    typeof d.calculationText === "string" &&
    d.calculationText.trim().length > 0
  ) {
    return d.calculationText.trim();
  }
  if (
    typeof d.aiCalculation === "string" &&
    d.aiCalculation.trim().length > 0
  ) {
    return d.aiCalculation.trim();
  }
  if (d.aiDraft && typeof d.aiDraft === "object") {
    const aiDraft = d.aiDraft as Record<string, unknown>;
    if (
      typeof aiDraft.calculation === "string" &&
      aiDraft.calculation.trim().length > 0
    ) {
      return aiDraft.calculation.trim();
    }
  }
  return null;
};

const extractAiDraft = (entry: FoodEntry): FoodDraftCandidate | null => {
  if (!entry.details || typeof entry.details !== "object") return null;
  const d = entry.details as Record<string, unknown>;
  if (d.aiDraft && typeof d.aiDraft === "object") {
    const parsed = foodDraftCandidateSchema.safeParse(d.aiDraft);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return null;
};

const isMealFormStrings = (value: unknown): value is MealFormStrings =>
  typeof value === "object" &&
  value !== null &&
  ["name", "calories", "protein", "carbs", "fat"].every(
    (field) =>
      field in value &&
      typeof (value as Record<string, unknown>)[field] === "string",
  ) &&
  ADVANCED_NUTRIENT_FIELDS.every(
    (field) =>
      (value as Record<string, unknown>)[field] === undefined ||
      typeof (value as Record<string, unknown>)[field] === "string",
  );

interface NutritionBaseline {
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
  readonly fibreG?: number | null;
  readonly saturatedFatG?: number | null;
  readonly totalSugarsG?: number | null;
  readonly sodiumMg?: number | null;
  readonly cholesterolMg?: number | null;
  readonly grams: number;
}

export function EditMealScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const entryId = typeof params.id === "string" ? params.id : null;
  const { session, profile, refreshProfile } = useAuth();
  const userId = session?.user.id ?? null;
  const mealVisualCapability = useMealVisualCapability(
    userId,
    session?.accessToken,
  );
  const advancedCapability = useAdvancedNutritionCapability(
    userId,
    session?.accessToken,
  );
  const [entry, setEntry] = useState<FoodEntry | null>(null);
  const [form, setForm] = useState<MealFormStrings>(EMPTY_FORM);
  const [grams, setGrams] = useState("");
  const [mealGroupName, setMealGroupName] = useState("");
  const [mealGroupId, setMealGroupId] = useState<string | null>(null);
  const [customGroupActive, setCustomGroupActive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [calculationText, setCalculationText] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<FoodDraftCandidate | null>(null);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineMessage, setRefineMessage] = useState<string | null>(null);
  const draftKind = entryId === null ? null : (`meal-edit-${entryId}` as const);

  const baselineRef = useRef<NutritionBaseline | null>(null);
  const editVersion = useRef(0);
  const aiRequestInFlight = useRef(false);
  const saveInFlight = useRef(false);

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
      const loadedEntry = entryResult.entry;
      setEntry(loadedEntry);
      setForm(draft ?? mealFormStringsFromEntry(loadedEntry));

      const detectedCalc = extractCalculationText(loadedEntry);
      setCalculationText(detectedCalc);
      const detectedDraft = extractAiDraft(loadedEntry);
      setAiDraft(detectedDraft);

      const detectedGrams = getEntryGrams(loadedEntry);
      if (detectedGrams !== null && detectedGrams > 0) {
        setGrams(String(detectedGrams));
        baselineRef.current = {
          caloriesKcal: loadedEntry.caloriesKcal,
          proteinG: loadedEntry.proteinG,
          carbohydrateG: loadedEntry.carbohydrateG,
          fatG: loadedEntry.fatG,
          fibreG: loadedEntry.fibreG,
          saturatedFatG: loadedEntry.saturatedFatG,
          totalSugarsG: loadedEntry.totalSugarsG,
          sodiumMg: loadedEntry.sodiumMg,
          cholesterolMg: loadedEntry.cholesterolMg,
          grams: detectedGrams,
        };
      } else {
        setGrams("");
      }

      const currentGroup = getEntryMealGroup(loadedEntry);
      if (currentGroup !== null) {
        setMealGroupName(currentGroup.name);
        setMealGroupId(currentGroup.id);
        setCustomGroupActive(
          !MEAL_GROUP_PRESETS.includes(
            currentGroup.name as (typeof MEAL_GROUP_PRESETS)[number],
          ),
        );
      } else {
        setMealGroupName("");
        setMealGroupId(null);
        setCustomGroupActive(false);
      }

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
      editVersion.current += 1;
      setForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const handleGramsChange = useCallback(
    (newGramsRaw: string): void => {
      editVersion.current += 1;
      setGrams(newGramsRaw);
      const parsedGrams = Number(newGramsRaw.trim().replace(",", "."));
      if (!Number.isFinite(parsedGrams) || parsedGrams <= 0) return;

      // If no baseline established, establish from current form inputs
      if (baselineRef.current === null || baselineRef.current.grams <= 0) {
        const cal = parseOptionalNutritionNumber(form.calories);
        const p = parseOptionalNutritionNumber(form.protein);
        const c = parseOptionalNutritionNumber(form.carbs);
        const f = parseOptionalNutritionNumber(form.fat);
        baselineRef.current = {
          caloriesKcal: cal.ok ? cal.value : null,
          proteinG: p.ok ? p.value : null,
          carbohydrateG: c.ok ? c.value : null,
          fatG: f.ok ? f.value : null,
          ...advancedNutrientsFromForm(form),
          grams: parsedGrams,
        };
        return;
      }

      const scaled = scaleNutrition(baselineRef.current, parsedGrams);
      setForm((current) => {
        const updatedName =
          extractGramsFromName(current.name) !== null
            ? updateGramsInName(current.name, parsedGrams)
            : current.name;
        return {
          ...current,
          name: updatedName,
          calories:
            scaled.caloriesKcal === null ? "" : String(scaled.caloriesKcal),
          protein: scaled.proteinG === null ? "" : String(scaled.proteinG),
          carbs:
            scaled.carbohydrateG === null ? "" : String(scaled.carbohydrateG),
          fat: scaled.fatG === null ? "" : String(scaled.fatG),
          fibre: scaled.fibreG == null ? "" : String(scaled.fibreG),
          saturatedFat:
            scaled.saturatedFatG == null ? "" : String(scaled.saturatedFatG),
          totalSugars:
            scaled.totalSugarsG == null ? "" : String(scaled.totalSugarsG),
          sodium: scaled.sodiumMg == null ? "" : String(scaled.sodiumMg),
          cholesterol:
            scaled.cholesterolMg == null ? "" : String(scaled.cholesterolMg),
        };
      });
    },
    [form],
  );

  const adjustGramsDelta = useCallback(
    (delta: number): void => {
      const current = Number(grams.trim().replace(",", "."));
      const base = Number.isFinite(current) && current > 0 ? current : 100;
      const next = Math.max(5, Math.round(base + delta));
      handleGramsChange(String(next));
    },
    [grams, handleGramsChange],
  );

  const scaleGramsMultiplier = useCallback(
    (mult: number): void => {
      const parsedCurrent = Number(grams.trim().replace(",", "."));
      const baseGrams =
        baselineRef.current?.grams ??
        (Number.isFinite(parsedCurrent) && parsedCurrent > 0
          ? parsedCurrent
          : 100);
      const next = Math.max(5, Math.round(baseGrams * mult));
      handleGramsChange(String(next));
    },
    [grams, handleGramsChange],
  );

  const executeRefineDraft = useCallback(
    async (instruction: string) => {
      const trimmed = instruction.trim();
      if (
        trimmed.length < 2 ||
        entry === null ||
        aiRequestInFlight.current ||
        saveInFlight.current ||
        refining ||
        submitting
      ) {
        return;
      }
      aiRequestInFlight.current = true;
      const requestEditVersion = editVersion.current;
      setRefining(true);
      setRefineMessage(null);
      setMessage(null);

      try {
        const advancedEnabledForInput = await advancedCapability.refresh();
        if (editVersion.current !== requestEditVersion) {
          setRefineMessage(
            "Your meal changed while preparing AI. Refine again to use your latest edits.",
          );
          return;
        }
        const originalCandidate: FoodDraftCandidate = aiDraft ?? {
          name: entry.name,
          portionWeightG: getEntryGrams(entry),
          caloriesKcal: entry.caloriesKcal,
          proteinG: entry.proteinG,
          carbohydrateG: entry.carbohydrateG,
          fatG: entry.fatG,
          calorieRangeKcal: null,
          proteinRangeG: null,
          carbohydrateRangeG: null,
          fatRangeG: null,
          confidence: 0.85,
          warnings: [],
          assumptions: [],
          calculation: calculationText,
          provenance: {
            inputKind: "text",
            provider: "logged-meal",
            model: "logged-refine",
            promptVersion: "refine-logged-v1",
          },
        };
        const baseCandidate = mealDraftFromCurrentForm(
          originalCandidate,
          form,
          grams,
          advancedEnabledForInput,
        );
        if (baseCandidate === null) {
          setRefineMessage(
            "Check the nutrient values and portion weight before refining.",
          );
          return;
        }

        const result = await refineMealDraftWith(
          apiClient,
          baseCandidate,
          trimmed,
        );
        if (!result.ok) {
          setRefineMessage(result.message);
          return;
        }
        const advancedEnabled = await advancedCapability.refresh();
        if (editVersion.current !== requestEditVersion) {
          setRefineMessage(
            "Your meal changed while AI was estimating. Your edits are kept; refine again to use them.",
          );
          return;
        }
        const updatedCandidate = mealDraftForAdvancedAccess(
          result.draft,
          advancedEnabled,
        );
        const nextForm = mergeMealDraftIntoForm(
          form,
          updatedCandidate,
          advancedEnabled,
        );
        setForm({ ...nextForm, name: nextForm.name || form.name });
        setAiDraft(updatedCandidate);
        if (updatedCandidate.calculation) {
          setCalculationText(updatedCandidate.calculation);
        }
        setRefineInstruction("");
        setRefineMessage(
          "Meal adjusted by AI. Estimates are uncertain; review and save below.",
        );

        const detectedGrams =
          updatedCandidate.portionWeightG ??
          (updatedCandidate.name
            ? extractGramsFromName(updatedCandidate.name)
            : null);
        if (detectedGrams !== null && detectedGrams > 0) {
          setGrams(String(detectedGrams));
        }

        if (
          (detectedGrams !== null && detectedGrams > 0) ||
          (baselineRef.current !== null && baselineRef.current.grams > 0)
        ) {
          const nextGrams =
            detectedGrams !== null && detectedGrams > 0
              ? detectedGrams
              : baselineRef.current!.grams;
          baselineRef.current = {
            caloriesKcal: updatedCandidate.caloriesKcal,
            proteinG: updatedCandidate.proteinG,
            carbohydrateG: updatedCandidate.carbohydrateG,
            fatG: updatedCandidate.fatG,
            ...advancedNutrientsFromForm(nextForm),
            grams: nextGrams,
          };
        }
      } catch {
        setRefineMessage("Failed to refine meal with AI. Please try again.");
      } finally {
        setRefining(false);
        aiRequestInFlight.current = false;
      }
    },
    [
      advancedCapability.refresh,
      aiDraft,
      calculationText,
      entry,
      form,
      grams,
      refining,
      submitting,
    ],
  );

  const executeAiAction = useCallback(
    async (action: PendingAiAction) => {
      if (action.kind === "meal_refine_draft") {
        await executeRefineDraft(action.instruction);
      }
    },
    [executeRefineDraft],
  );

  const {
    isModalVisible: aiConsentModalVisible,
    confirmConsent,
    declineConsent,
    requestAction,
    isSaving: isAiConsentSaving,
    error: aiConsentError,
  } = useAiConsentController({
    userId,
    apiClient,
    onExecuteAction: executeAiAction,
  });

  const onRefinePress = useCallback(async () => {
    const trimmed = refineInstruction.trim();
    if (trimmed.length < 2 || refining || submitting) return;
    await requestAction({
      kind: "meal_refine_draft",
      instruction: trimmed,
    });
  }, [refineInstruction, refining, requestAction, submitting]);

  const save = useCallback(async (): Promise<void> => {
    if (
      entry === null ||
      entryId === null ||
      aiRequestInFlight.current ||
      saveInFlight.current ||
      submitting
    )
      return;
    saveInFlight.current = true;
    setSubmitting(true);
    try {
      setMessage(null);
      const calories = parseOptionalNutritionNumber(form.calories);
      const protein = parseOptionalNutritionNumber(form.protein);
      const carbs = parseOptionalNutritionNumber(form.carbs);
      const fat = parseOptionalNutritionNumber(form.fat);
      const advancedValues = advancedNutrientsFromForm(form);
      if (!calories.ok || !protein.ok || !carbs.ok || !fat.ok) {
        setMessage("Calories and macros must be positive numbers or blank.");
        return;
      }
      if (advancedValues === null) {
        setMessage("More nutrient values must be positive numbers or blank.");
        return;
      }
      const advancedChanged =
        advancedValues !== null &&
        (advancedValues.fibreG !== (entry.fibreG ?? null) ||
          advancedValues.saturatedFatG !== (entry.saturatedFatG ?? null) ||
          advancedValues.totalSugarsG !== (entry.totalSugarsG ?? null) ||
          advancedValues.sodiumMg !== (entry.sodiumMg ?? null) ||
          advancedValues.cholesterolMg !== (entry.cholesterolMg ?? null));
      if (advancedChanged && !(await advancedCapability.refresh())) {
        const fillsMissing =
          advancedValues !== null &&
          ((entry.fibreG == null && advancedValues.fibreG !== null) ||
            (entry.saturatedFatG == null &&
              advancedValues.saturatedFatG !== null) ||
            (entry.totalSugarsG == null &&
              advancedValues.totalSugarsG !== null) ||
            (entry.sodiumMg == null && advancedValues.sodiumMg !== null) ||
            (entry.cholesterolMg == null &&
              advancedValues.cholesterolMg !== null));
        if (fillsMissing) {
          setMessage(
            "An active Pro grant is required to add new nutrient values. Existing values can still be corrected or cleared.",
          );
          return;
        }
      }

      let nextDetails = (entry.details ?? {}) as Record<string, unknown>;
      const parsedGrams = Number(grams.trim().replace(",", "."));
      if (Number.isFinite(parsedGrams) && parsedGrams > 0) {
        nextDetails = withMealGrams(nextDetails, parsedGrams);
      } else {
        nextDetails = withMealGrams(nextDetails, null);
      }

      const trimmedGroup = mealGroupName.trim();
      if (trimmedGroup.length > 0) {
        nextDetails = withMealGroup(nextDetails, {
          id: mealGroupId ?? createOperationId(),
          name: trimmedGroup,
        });
      } else {
        nextDetails = withMealGroup(nextDetails, null);
      }

      if (calculationText !== null || aiDraft !== null) {
        const currentDraftObj =
          aiDraft ??
          (nextDetails && typeof nextDetails === "object"
            ? (nextDetails as Record<string, unknown>).aiDraft
            : undefined);
        const updatedAiDraft =
          currentDraftObj && typeof currentDraftObj === "object"
            ? {
                ...(currentDraftObj as Record<string, unknown>),
                ...(calculationText ? { calculation: calculationText } : {}),
                userConfirmed: true,
              }
            : undefined;

        nextDetails = {
          ...nextDetails,
          ...(calculationText ? { calculationText } : {}),
          ...(updatedAiDraft ? { aiDraft: updatedAiDraft } : {}),
        };
      }

      const patch: LogMealForm = {
        name: form.name,
        consumedAt: entry.consumedAt,
        caloriesKcal: calories.value,
        proteinG: protein.value,
        carbohydrateG: carbs.value,
        fatG: fat.value,
        ...(advancedChanged && advancedValues !== null ? advancedValues : {}),
        details: nextDetails,
      };
      const result = await updateFoodEntry(entryId, patch);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      if (userId !== null && draftKind !== null) {
        await clearLoggingDraft(userId, draftKind);
      }
      router.back();
    } finally {
      saveInFlight.current = false;
      setSubmitting(false);
    }
  }, [
    aiDraft,
    advancedCapability,
    calculationText,
    draftKind,
    entry,
    entryId,
    form,
    grams,
    mealGroupId,
    mealGroupName,
    userId,
    submitting,
  ]);

  const refineBlocked =
    refineInstruction.trim().length < 2 || refining || submitting;

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Edit meal" }} />
      <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {!loaded ? (
            <ThemedText type="small" themeColor="textSecondary">
              Loading meal…
            </ThemedText>
          ) : null}

          {entry !== null ? (
            <>
              <MealVisual
                entryId={entry.id}
                name={entry.name}
                // Editing needs the server: no offline-grace icons here.
                enabled={
                  mealVisualCapability.enabled && !mealVisualCapability.offline
                }
                hasPhoto={Boolean(entry.photoAssetId)}
                photoAssetId={entry.photoAssetId}
                editable
              />
              <Card>
                <Field
                  label="Name"
                  value={form.name}
                  onChangeText={(value) => patchForm("name", value)}
                  autoFocus
                />
                <Field
                  label="Calories (kcal)"
                  value={form.calories}
                  onChangeText={(value) => patchForm("calories", value)}
                  keyboardType="numeric"
                />
                <View style={styles.macroRow}>
                  <View style={styles.macroField}>
                    <Field
                      label="Protein (g)"
                      value={form.protein}
                      onChangeText={(value) => patchForm("protein", value)}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.macroField}>
                    <Field
                      label="Carbs (g)"
                      value={form.carbs}
                      onChangeText={(value) => patchForm("carbs", value)}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.macroField}>
                    <Field
                      label="Fat (g)"
                      value={form.fat}
                      onChangeText={(value) => patchForm("fat", value)}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </Card>

              {/* Portion weight / grams */}
              <Card>
                <View style={styles.cardHeader}>
                  <ThemedText type="headline">
                    Portion weight (grams)
                  </ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Updates calories & macros dynamically
                  </ThemedText>
                </View>
                <View style={styles.inputRow}>
                  <FormTextInput
                    accessibilityLabel="Portion weight in grams"
                    keyboardType="numeric"
                    placeholder="e.g. 150"
                    style={styles.flex}
                    value={grams}
                    onChangeText={handleGramsChange}
                  />
                  <ThemedText type="headline" themeColor="textSecondary">
                    g
                  </ThemedText>
                </View>
                <View style={styles.chipsRow}>
                  <ChipButton
                    label="-50g"
                    onPress={() => adjustGramsDelta(-50)}
                  />
                  <ChipButton
                    label="-10g"
                    onPress={() => adjustGramsDelta(-10)}
                  />
                  <ChipButton
                    label="+10g"
                    onPress={() => adjustGramsDelta(10)}
                  />
                  <ChipButton
                    label="+50g"
                    onPress={() => adjustGramsDelta(50)}
                  />
                  <ChipButton
                    label="0.5x"
                    onPress={() => scaleGramsMultiplier(0.5)}
                  />
                  <ChipButton
                    label="1.5x"
                    onPress={() => scaleGramsMultiplier(1.5)}
                  />
                  <ChipButton
                    label="2x"
                    onPress={() => scaleGramsMultiplier(2)}
                  />
                </View>
              </Card>

              <AdvancedNutrientFields
                form={form}
                enabled={advancedCapability.enabled}
                editableWhenFree={[
                  ...(entry.fibreG == null ? [] : ["fibre" as const]),
                  ...(entry.saturatedFatG == null
                    ? []
                    : ["saturatedFat" as const]),
                  ...(entry.totalSugarsG == null
                    ? []
                    : ["totalSugars" as const]),
                  ...(entry.sodiumMg == null ? [] : ["sodium" as const]),
                  ...(entry.cholesterolMg == null
                    ? []
                    : ["cholesterol" as const]),
                ]}
                onChange={patchForm}
              />

              {/* AI meal calculation breakdown */}
              {calculationText !== null ? (
                <Card>
                  <View style={styles.titleRow}>
                    <Icon name="sparkles" size={16} color="primary" />
                    <ThemedText type="headline" style={styles.flex}>
                      AI meal calculation
                    </ThemedText>
                    {aiDraft?.confidence !== undefined ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {Math.round(aiDraft.confidence * 100)}% confidence
                      </ThemedText>
                    ) : null}
                  </View>
                  <ThemedText type="small" selectable>
                    {calculationText}
                  </ThemedText>
                  {aiDraft?.assumptions && aiDraft.assumptions.length > 0 ? (
                    <View style={styles.assumptionsList}>
                      {aiDraft.assumptions.map((item, index) => (
                        <ThemedText
                          key={index}
                          type="footnote"
                          themeColor="textSecondary"
                        >
                          • {item}
                        </ThemedText>
                      ))}
                    </View>
                  ) : null}
                </Card>
              ) : null}

              {/* Refine with AI */}
              <Card>
                <View style={styles.cardHeader}>
                  <View style={styles.titleRow}>
                    <Icon name="sparkles" size={16} color="primary" />
                    <ThemedText type="headline">Refine with AI</ThemedText>
                  </View>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Adjust ingredients or ask to estimate missing nutrients.
                    Review estimates before saving.
                  </ThemedText>
                </View>
                <View style={styles.inputRow}>
                  <FormTextInput
                    accessibilityLabel="AI refine instruction"
                    placeholder="e.g. estimate fibre, sugars and sodium…"
                    style={styles.flex}
                    value={refineInstruction}
                    onChangeText={setRefineInstruction}
                    editable={!refining && !submitting}
                  />
                  <Button
                    label={refining ? "Refining…" : "Refine"}
                    variant="tinted"
                    size="small"
                    accessibilityLabel="Refine meal with AI"
                    accessibilityState={{
                      disabled: refineBlocked,
                      busy: refining,
                    }}
                    disabled={refineBlocked}
                    onPress={() => void onRefinePress()}
                  />
                </View>
                {refineMessage !== null ? (
                  <FormStatus tone="neutral">{refineMessage}</FormStatus>
                ) : null}
              </Card>

              {/* Meal group */}
              <Card>
                <View style={styles.cardHeader}>
                  <ThemedText type="headline">Meal group</ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Group individual items into a bigger meal
                  </ThemedText>
                </View>
                <View style={styles.chipsRow}>
                  <Chip
                    label="None"
                    accessibilityLabel="No meal group"
                    selected={mealGroupName === ""}
                    onPress={() => {
                      setMealGroupName("");
                      setMealGroupId(null);
                      setCustomGroupActive(false);
                    }}
                  />
                  {MEAL_GROUP_PRESETS.map((preset) => (
                    <Chip
                      key={preset}
                      label={preset}
                      accessibilityLabel={`Assign to ${preset}`}
                      selected={
                        mealGroupName.toLowerCase() === preset.toLowerCase()
                      }
                      onPress={() => {
                        setMealGroupName(preset);
                        setCustomGroupActive(false);
                      }}
                    />
                  ))}
                  <Chip
                    label="Custom…"
                    accessibilityLabel="Custom meal group name"
                    selected={customGroupActive}
                    onPress={() => setCustomGroupActive(true)}
                  />
                </View>
                {customGroupActive ? (
                  <FormTextInput
                    accessibilityLabel="Custom meal group name"
                    placeholder="e.g. Post-workout meal"
                    value={mealGroupName}
                    onChangeText={setMealGroupName}
                  />
                ) : null}
              </Card>
            </>
          ) : null}

          {message !== null ? (
            <FormStatus tone="error">{message}</FormStatus>
          ) : null}

          {entry !== null ? (
            <Button
              label={submitting ? "Saving…" : "Save changes"}
              variant="primary"
              block
              accessibilityLabel="Save meal changes"
              accessibilityState={{
                disabled: submitting || refining,
                busy: submitting,
              }}
              disabled={submitting || refining}
              onPress={() => void save()}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <AiConsentModal
        visible={aiConsentModalVisible}
        isSaving={isAiConsentSaving}
        error={aiConsentError}
        currentBirthYear={profile?.birthYear ?? null}
        onConsent={async (birthYear) => {
          await confirmConsent(birthYear);
          if (birthYear !== undefined) void refreshProfile();
        }}
        onDecline={() => {
          declineConsent();
          setRefineMessage(
            "Refining meals with AI requires consent to third-party AI processing and adult eligibility.",
          );
        }}
      />
    </ThemedView>
  );
}

function ChipButton(props: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return <Chip label={props.label} onPress={props.onPress} />;
}

function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly keyboardType?: "default" | "numeric";
  readonly autoFocus?: boolean;
}) {
  return (
    <FormField label={props.label}>
      <FormTextInput
        accessibilityLabel={props.label}
        autoFocus={props.autoFocus === true}
        keyboardType={props.keyboardType ?? "default"}
        onChangeText={props.onChangeText}
        value={props.value}
      />
    </FormField>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.three,
  },
  flex: { flex: 1 },
  cardHeader: { gap: Spacing.one },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  macroRow: { flexDirection: "row", gap: Spacing.two },
  macroField: { flex: 1 },
  assumptionsList: { gap: Spacing.half },
});
