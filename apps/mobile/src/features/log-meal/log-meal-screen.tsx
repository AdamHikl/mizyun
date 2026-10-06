import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoggingFlowMeasurement } from "@/features/analytics/flow-measurement";
import {
  aiUsageResponseSchema,
  type AiUsageResponse,
  type FoodDraftCandidate,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
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
  createOperationId,
  parseMealDate,
  mealTimestampForDate,
  mealTimestampMatchesDate,
  isRecoverableMealDraft,
  isStaleMealTimestamp,
  mealFormStringsFromDraft,
  mealFormStringsFromEntry,
  mealDraftFromCurrentForm,
  mealDraftForAdvancedAccess,
  mergeMealDraftIntoForm,
  mealNutritionForSubmission,
  portionGramsStringFromDraft,
  upgradeLegacyMealDraft,
  sameAdvancedNutrients,
  needsFreshAdvancedGrant,
  type MealFormStrings,
  type NutritionEntryBasis,
} from "./meal-form";
import {
  AdvancedNutrientFields,
  useAdvancedNutritionCapability,
} from "./advanced-nutrition";
import { normalizeMealPhoto } from "./meal-photo";
import { fetchFoodHistory } from "./meal-lifecycle-data";
import { getEntryGrams } from "./meal-scale";
import {
  loadFirstMealReminders,
  reconcileFirstMealReminders,
} from "./first-meal-reminders";
import { reconcileEveningReminders } from "./evening-catch-up-reminders";
import { FirstMealRoutineModal } from "./first-meal-routine-modal";
import type { FoodEntry } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import {
  useAiConsentController,
  type PendingAiAction,
} from "@/features/coach/ai-consent-controller";
import { AiConsentModal } from "@/features/coach/ai-consent-modal";

const draftEvidenceLines = (
  draft: import("@mizyun/contracts").FoodDraftCandidate,
): readonly string[] => {
  const ranges = [
    draft.portionWeightG != null
      ? `Estimated portion weight: ${draft.portionWeightG} g`
      : null,
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
  const { session, profile, refreshProfile } = useAuth();
  const theme = useTheme();
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const requestedDate = parseMealDate(params.date);
  const invalidRequestedDate =
    params.date !== undefined &&
    (!requestedDate ||
      (new Date(mealTimestampForDate(requestedDate)).toDateString() !==
        new Date().toDateString() &&
        new Date(mealTimestampForDate(requestedDate)).getTime() > Date.now()));
  const [mealDate, setMealDate] = useState<string | null>(requestedDate);
  const [recoveredDifferentDay, setRecoveredDifferentDay] = useState(false);
  const invalidMealDate =
    invalidRequestedDate ||
    Boolean(
      mealDate &&
      new Date(mealTimestampForDate(mealDate)).getTime() > Date.now(),
    );
  const [name, setName] = useState("");
  const [portionGrams, setPortionGrams] = useState("");
  const [nutritionBasis, setNutritionBasis] =
    useState<NutritionEntryBasis>("total");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [advanced, setAdvanced] = useState<MealFormStrings>({
    name: "",
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formScrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (error !== null) {
      Keyboard.dismiss();
      formScrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [error]);
  const [draftLoaded, setDraftLoaded] = useState(false);
  // VISION-001 — photo-to-draft state. `attachedPhoto` holds the
  // user's selected or captured image before submission. `snapping` is true
  // while the photo is uploading and the configured vision provider is being
  // consulted. The form pre-fills with the candidate's name, portion weight,
  // calories, and macros;
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
  const [aiUsage, setAiUsage] = useState<AiUsageResponse | null>(null);
  const [recentMeals, setRecentMeals] = useState<ReadonlyArray<FoodEntry>>([]);
  const [showRoutineModal, setShowRoutineModal] = useState(false);
  const hadFailure = useRef(false);
  const userId = session?.user.id ?? null;
  const measurement = useLoggingFlowMeasurement("meal", userId);
  const advancedCapability = useAdvancedNutritionCapability(userId);

  useEffect(() => {
    let active = true;
    void fetchFoodHistory({ limit: 10 }).then((res) => {
      if (!active) return;
      if (res.entries.length > 0) {
        setRecentMeals(res.entries);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const uniqueRecentMeals = useMemo(() => {
    const seen = new Set<string>();
    const list: FoodEntry[] = [];
    for (const meal of recentMeals) {
      const key = meal.name.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(meal);
      }
      if (list.length >= 4) break;
    }
    return list;
  }, [recentMeals]);

  const onSelectRecentMeal = useCallback(
    (meal: FoodEntry) => {
      measurement.current?.tap();
      setNutritionBasis("total");
      setAiDraft(null);
      setDraftWarnings([]);
      setSourceProposalId(null);
      setName(meal.name);
      setCalories(meal.caloriesKcal != null ? String(meal.caloriesKcal) : "");
      setProtein(meal.proteinG != null ? String(meal.proteinG) : "");
      setCarbs(meal.carbohydrateG != null ? String(meal.carbohydrateG) : "");
      setFat(meal.fatG != null ? String(meal.fatG) : "");
      setAdvanced(
        advancedCapability.enabled
          ? mealFormStringsFromEntry(meal)
          : { name: "", calories: "", protein: "", carbs: "", fat: "" },
      );
      const grams = getEntryGrams(meal);
      setPortionGrams(grams == null ? "" : String(grams));
    },
    [advancedCapability.enabled],
  );

  const loadAiUsage = useCallback(async () => {
    try {
      const res = await apiClient.request<AiUsageResponse>({
        method: "GET",
        path: "/v1/ai/usage",
        schema: aiUsageResponseSchema,
      });
      if (res.ok) {
        setAiUsage(res.value);
      }
    } catch {
      // Best-effort quota fetch
    }
  }, []);

  useEffect(() => {
    void loadAiUsage();
  }, [loadAiUsage]);

  const [clientOperationId, setClientOperationId] = useState<string | null>(
    null,
  );
  const [consumedAt, setConsumedAt] = useState<string | null>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const isCompletedRef = useRef<boolean>(false);
  const submittedOperationRef = useRef<LogMealForm | null>(null);

  useEffect(() => {
    if (userId === null) return;
    let active = true;
    void loadLoggingDraft(userId, "meal", isRecoverableMealDraft).then(
      (draft) => {
        if (!active) return;
        if (draft !== null) {
          const upgraded = upgradeLegacyMealDraft(draft);
          setClientOperationId(upgraded.clientOperationId);
          setConsumedAt(upgraded.consumedAt);
          // Recovery keeps its original operation/day; Clear explicitly starts
          // a new meal on the requested date without moving a pending draft.
          setMealDate(upgraded.mealDate ?? null);
          setRecoveredDifferentDay(
            Boolean(
              requestedDate &&
              !mealTimestampMatchesDate(upgraded.consumedAt, requestedDate),
            ),
          );
          setNutritionBasis(upgraded.nutritionBasis ?? "total");
          setName(upgraded.name);
          setPortionGrams(
            upgraded.portionGrams ??
              portionGramsStringFromDraft(upgraded.aiDraft ?? {}),
          );
          setCalories(upgraded.calories);
          setProtein(upgraded.protein);
          setCarbs(upgraded.carbs);
          setFat(upgraded.fat);
          setAdvanced(upgraded);
          setMealDescription(upgraded.description ?? "");
          setAiDraft(upgraded.aiDraft ?? null);
          setSourceProposalId(upgraded.sourceProposalId ?? null);
          setRefineInstruction(upgraded.refineInstruction ?? "");
          if (upgraded.attachedPhotoUri) {
            setAttachedPhoto({ uri: upgraded.attachedPhotoUri });
          }
          setDraftWarnings(
            upgraded.aiDraft === undefined
              ? []
              : draftEvidenceLines(upgraded.aiDraft),
          );
        } else {
          setClientOperationId(createOperationId());
          setConsumedAt(
            requestedDate
              ? mealTimestampForDate(requestedDate)
              : new Date().toISOString(),
          );
        }
        setDraftLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, [userId, requestedDate]);

  useEffect(() => {
    if (
      !draftLoaded ||
      invalidMealDate ||
      userId === null ||
      isCompletedRef.current ||
      isSubmittingRef.current
    )
      return;
    void saveLoggingDraft(userId, "meal", {
      name,
      portionGrams,
      nutritionBasis,
      calories,
      protein,
      carbs,
      fat,
      fibre: advanced.fibre,
      saturatedFat: advanced.saturatedFat,
      totalSugars: advanced.totalSugars,
      sodium: advanced.sodium,
      cholesterol: advanced.cholesterol,
      clientOperationId: clientOperationId ?? undefined,
      consumedAt: consumedAt ?? undefined,
      mealDate: mealDate ?? undefined,
      submissionVersion: 1,
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
    clientOperationId,
    consumedAt,
    mealDate,
    draftLoaded,
    invalidMealDate,
    fat,
    advanced,
    mealDescription,
    name,
    portionGrams,
    nutritionBasis,
    protein,
    refineInstruction,
    sourceProposalId,
    userId,
  ]);

  const onSubmit = useCallback(async () => {
    const attempt = measurement.current;
    if (!draftLoaded || isSubmittingRef.current || isCompletedRef.current)
      return;
    isSubmittingRef.current = true;
    setSubmitting(true);
    Keyboard.dismiss();
    formScrollRef.current?.scrollTo({ y: 0, animated: true });

    attempt?.tap();
    if (hadFailure.current) attempt?.retry();
    setError(null);
    if (recoveredDifferentDay) {
      isSubmittingRef.current = false;
      setSubmitting(false);
      setError(
        "Your recovered draft belongs to another day. Use Clear to start on the selected day, or return and finish the original draft first.",
      );
      return;
    }
    if (invalidMealDate) {
      isSubmittingRef.current = false;
      setSubmitting(false);
      setError("Choose a valid day up to today from Meals.");
      return;
    }
    const resolved = mealNutritionForSubmission(
      { ...advanced, name, calories, protein, carbs, fat },
      nutritionBasis,
      portionGrams,
    );
    const hasAdvancedInput = [
      advanced.fibre,
      advanced.saturatedFat,
      advanced.totalSugars,
      advanced.sodium,
      advanced.cholesterol,
    ].some((value) => (value ?? "").trim().length > 0);
    if (!resolved.ok) {
      isSubmittingRef.current = false;
      setSubmitting(false);
      hadFailure.current = true;
      attempt?.fail("validation", "invalid_input", false);
      setError(resolved.message);
      return;
    }
    const nutrition = resolved.nutrition;
    const parsedAdvanced = {
      fibreG: nutrition.fibreG,
      saturatedFatG: nutrition.saturatedFatG,
      totalSugarsG: nutrition.totalSugarsG,
      sodiumMg: nutrition.sodiumMg,
      cholesterolMg: nutrition.cholesterolMg,
    };
    const prev = submittedOperationRef.current;
    const isRetryCandidate = prev !== null && hadFailure.current;

    const fixedConsumedAt = isRetryCandidate
      ? prev.consumedAt
      : mealDate
        ? mealTimestampMatchesDate(consumedAt, mealDate)
          ? consumedAt!
          : mealTimestampForDate(mealDate)
        : consumedAt && !isStaleMealTimestamp(consumedAt)
          ? consumedAt
          : new Date().toISOString();
    if (consumedAt !== fixedConsumedAt) setConsumedAt(fixedConsumedAt);

    // Check if current form is an exact retry of the previously submitted operation
    const isRetryOfPrev =
      prev !== null &&
      prev.name.trim() === name.trim() &&
      (typeof prev.details?.grams === "number" ? prev.details.grams : null) ===
        resolved.grams &&
      prev.caloriesKcal === nutrition.caloriesKcal &&
      prev.proteinG === nutrition.proteinG &&
      prev.carbohydrateG === nutrition.carbohydrateG &&
      prev.fatG === nutrition.fatG &&
      parsedAdvanced !== null &&
      sameAdvancedNutrients(prev, parsedAdvanced) &&
      prev.consumedAt === fixedConsumedAt;

    // A retryable failure may represent a committed request whose response was
    // lost. Do not turn an edited form into a second authoritative meal until
    // the original operation is reconciled.
    if (prev !== null && !isRetryOfPrev && hadFailure.current) {
      isSubmittingRef.current = false;
      setSubmitting(false);
      attempt?.fail("submit", "unexpected", true);
      setError(
        "This meal may already have been saved. Retry the submitted values first, or start a new meal entry after confirming the original result.",
      );
      return;
    }

    if (
      needsFreshAdvancedGrant(hasAdvancedInput, isRetryOfPrev) &&
      !(await advancedCapability.refresh())
    ) {
      isSubmittingRef.current = false;
      setSubmitting(false);
      setError(
        "More nutrient values require an active Pro grant. Your draft is saved; restore access or clear those values before submitting.",
      );
      return;
    }

    let opId: string;
    if (isRetryOfPrev && prev !== null && prev.clientOperationId) {
      // Re-use exact operation ID for immutable retry
      opId = prev.clientOperationId;
    } else {
      // If previously submitted form differed or no previous attempt, ensure a fresh operation ID
      opId =
        prev !== null && prev.clientOperationId
          ? createOperationId()
          : (clientOperationId ?? createOperationId());
      if (clientOperationId !== opId) {
        setClientOperationId(opId);
      }
    }

    // Await durable draft persistence before submitting (Requirement 2)
    if (userId !== null) {
      const persisted = await saveLoggingDraft(userId, "meal", {
        name,
        portionGrams,
        nutritionBasis,
        calories,
        protein,
        carbs,
        fat,
        fibre: advanced.fibre,
        saturatedFat: advanced.saturatedFat,
        totalSugars: advanced.totalSugars,
        sodium: advanced.sodium,
        cholesterol: advanced.cholesterol,
        clientOperationId: opId,
        consumedAt: fixedConsumedAt,
        mealDate: mealDate ?? undefined,
        submissionVersion: 1,
        description: mealDescription,
        ...(aiDraft === null ? {} : { aiDraft }),
        ...(sourceProposalId === null ? {} : { sourceProposalId }),
        ...(refineInstruction.trim().length > 0 ? { refineInstruction } : {}),
        ...(attachedPhoto !== null
          ? { attachedPhotoUri: attachedPhoto.uri }
          : {}),
      });
      if (!persisted) {
        isSubmittingRef.current = false;
        setSubmitting(false);
        hadFailure.current = true;
        attempt?.fail("submit", "unexpected", true);
        setError(
          "Could not save meal draft to device storage before sending. Please check device storage and try again.",
        );
        return;
      }
    }

    const calculation =
      aiDraft?.calculation ??
      (aiDraft !== null && draftEvidenceLines(aiDraft).length > 0
        ? draftEvidenceLines(aiDraft).join("\n")
        : null);

    const details: Record<string, unknown> = {
      ...(resolved.grams === null ? {} : { grams: resolved.grams }),
      ...(aiDraft === null
        ? {}
        : {
            aiDraft: {
              ...aiDraft,
              ...(calculation ? { calculation } : {}),
              userConfirmed: true,
              ...(sourceProposalId === null ? {} : { sourceProposalId }),
            },
            ...(calculation ? { calculationText: calculation } : {}),
          }),
      ...(mealDescription.trim().length > 0
        ? { mealDescription: mealDescription.trim() }
        : {}),
    };

    const form: LogMealForm =
      isRetryOfPrev && prev !== null
        ? prev
        : {
            clientOperationId: opId,
            name,
            caloriesKcal: nutrition.caloriesKcal,
            proteinG: nutrition.proteinG,
            carbohydrateG: nutrition.carbohydrateG,
            fatG: nutrition.fatG,
            ...(hasAdvancedInput && parsedAdvanced !== null
              ? parsedAdvanced
              : {}),
            consumedAt: fixedConsumedAt,
            ...(Object.keys(details).length === 0 ? {} : { details }),
          };
    submittedOperationRef.current = form;

    const result = await submitLogMeal(form);
    if (result.ok) {
      isCompletedRef.current = true;
      submittedOperationRef.current = null;
      attempt?.complete();
      if (userId !== null) {
        await clearLoggingDraft(userId, "meal");
        const mealDate = fixedConsumedAt
          ? new Date(fixedConsumedAt)
          : new Date();
        const isToday = mealDate.toDateString() === new Date().toDateString();
        if (isToday) {
          await reconcileFirstMealReminders(userId, { todayLogged: true });
        }
        const hasMealAfter6Pm = isToday && mealDate.getHours() >= 18;
        if (hasMealAfter6Pm) {
          void reconcileEveningReminders(userId, { hasMealAfter6Pm: true });
        }
        const reminderSettings = await loadFirstMealReminders(userId);
        if (
          isToday &&
          !reminderSettings.enabled &&
          !reminderSettings.promptDismissed
        ) {
          setShowRoutineModal(true);
          return;
        }
      }
      router.back();
      return;
    }
    isSubmittingRef.current = false;
    setSubmitting(false);
    hadFailure.current = true;
    const reason = classifyAnalyticsFailure(result.message);
    attempt?.fail(
      reason === "invalid_input" ? "validation" : "submit",
      reason,
      isRetryableAnalyticsFailure(reason),
    );
    setError(result.message);
  }, [
    aiDraft,
    calories,
    carbs,
    clientOperationId,
    consumedAt,
    mealDate,
    invalidMealDate,
    recoveredDifferentDay,
    fat,
    advanced,
    advancedCapability,
    mealDescription,
    name,
    portionGrams,
    nutritionBasis,
    protein,
    refineInstruction,
    sourceProposalId,
    userId,
    attachedPhoto,
  ]);

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

  const executeProcessPhoto = useCallback(
    async (photoUri?: string) => {
      const attempt = measurement.current;
      const photoSource =
        attachedPhoto ?? (photoUri ? { uri: photoUri } : null);
      if (photoSource === null) return;
      attempt?.tap();
      if (hadFailure.current) attempt?.retry();
      setSnapping(true);
      setError(null);
      setDraftWarnings([]);
      try {
        const hint = mealDescription.trim();
        const photo = await normalizeMealPhoto(photoSource);
        const draft = await snapMealPhoto(
          photo,
          "image/jpeg",
          hint.length > 0 ? hint : undefined,
        );
        if (!draft.ok) {
          hadFailure.current = true;
          attempt?.fail("upload", "unexpected", true);
          setError(draft.message);
          return;
        }
        const advancedEnabled = await advancedCapability.refresh();
        const strings = mealFormStringsFromDraft(draft.draft);
        setNutritionBasis("total");
        setName(strings.name);
        setPortionGrams(portionGramsStringFromDraft(draft.draft));
        setCalories(strings.calories);
        setProtein(strings.protein);
        setCarbs(strings.carbs);
        setFat(strings.fat);
        setAdvanced((current) =>
          mergeMealDraftIntoForm(
            current,
            draft.draft,
            advancedEnabled,
            "replace",
          ),
        );
        setDraftWarnings(draftEvidenceLines(draft.draft));
        setAiDraft(mealDraftForAdvancedAccess(draft.draft, advancedEnabled));
        setSourceProposalId(null);

        void loadAiUsage();
      } catch (cause) {
        hadFailure.current = true;
        attempt?.fail("upload", "unexpected", true);
        setError(
          cause instanceof Error
            ? `Couldn't read the photo: ${cause.message}`
            : "Couldn't read the photo.",
        );
      } finally {
        setSnapping(false);
      }
    },
    [advancedCapability.refresh, attachedPhoto, loadAiUsage, mealDescription],
  );

  const executeTextDraft = useCallback(
    async (description: string) => {
      const attempt = measurement.current;
      if (description.trim().length < 2) return;
      attempt?.tap();
      if (hadFailure.current) attempt?.retry();
      setSnapping(true);
      setError(null);
      setDraftWarnings([]);
      try {
        const result = await draftMealFromText(
          description,
          profile?.coachingPreferences?.countryCode ?? null,
        );
        if (!result.ok) {
          hadFailure.current = true;
          attempt?.fail("submit", "unexpected", true);
          setError(result.message);
          return;
        }
        const advancedEnabled = await advancedCapability.refresh();
        const strings = mealFormStringsFromDraft(result.draft);
        setNutritionBasis("total");
        setName(strings.name);
        setPortionGrams(portionGramsStringFromDraft(result.draft));
        setCalories(strings.calories);
        setProtein(strings.protein);
        setCarbs(strings.carbs);
        setFat(strings.fat);
        setAdvanced((current) =>
          mergeMealDraftIntoForm(
            current,
            result.draft,
            advancedEnabled,
            "replace",
          ),
        );
        setDraftWarnings(draftEvidenceLines(result.draft));
        setAiDraft(mealDraftForAdvancedAccess(result.draft, advancedEnabled));
        setSourceProposalId(null);

        void loadAiUsage();
      } catch {
        hadFailure.current = true;
        attempt?.fail("submit", "unexpected", true);
        setError("Couldn't generate a draft from the description.");
      } finally {
        setSnapping(false);
      }
    },
    [
      advancedCapability.refresh,
      loadAiUsage,
      profile?.coachingPreferences?.countryCode,
    ],
  );

  const executeRefineDraft = useCallback(
    async (instruction: string) => {
      const attempt = measurement.current;
      if (
        instruction.trim().length < 2 ||
        aiDraft === null ||
        refining ||
        submitting
      ) {
        return;
      }
      setRefining(true);
      setError(null);
      try {
        const advancedEnabledForInput = await advancedCapability.refresh();
        const currentDraft = mealDraftFromCurrentForm(
          aiDraft,
          { ...advanced, name, calories, protein, carbs, fat },
          portionGrams,
          advancedEnabledForInput,
        );
        if (currentDraft === null) {
          setError(
            "Check the nutrient values and portion weight before refining.",
          );
          return;
        }
        const result = await refineMealDraft(currentDraft, instruction);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const advancedEnabled = await advancedCapability.refresh();
        const strings = mealFormStringsFromDraft(result.draft);
        setNutritionBasis("total");
        setName(strings.name);
        setPortionGrams(portionGramsStringFromDraft(result.draft));
        setCalories(strings.calories);
        setProtein(strings.protein);
        setCarbs(strings.carbs);
        setFat(strings.fat);
        setAdvanced((current) =>
          mergeMealDraftIntoForm(current, result.draft, advancedEnabled),
        );
        setDraftWarnings(draftEvidenceLines(result.draft));
        setAiDraft(mealDraftForAdvancedAccess(result.draft, advancedEnabled));
        void loadAiUsage();
      } finally {
        setRefining(false);
      }
    },
    [
      advanced,
      advancedCapability.refresh,
      aiDraft,
      calories,
      carbs,
      fat,
      loadAiUsage,
      name,
      portionGrams,
      protein,
      refining,
      submitting,
    ],
  );

  const executeAiAction = useCallback(
    async (action: PendingAiAction) => {
      if (action.kind === "meal_photo_draft") {
        await executeProcessPhoto(action.photoUri);
      } else if (action.kind === "meal_text_draft") {
        await executeTextDraft(action.text);
      } else if (action.kind === "meal_refine_draft") {
        await executeRefineDraft(action.instruction);
      }
    },
    [executeProcessPhoto, executeTextDraft, executeRefineDraft],
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

  const onProcessPhoto = useCallback(async () => {
    if (attachedPhoto === null) return;
    await requestAction({
      kind: "meal_photo_draft",
      photoUri: attachedPhoto.uri,
    });
  }, [attachedPhoto, requestAction]);

  const onTextDraft = useCallback(async () => {
    const text = mealDescription.trim();
    if (text.length < 2) return;
    await requestAction({
      kind: "meal_text_draft",
      text,
    });
  }, [mealDescription, requestAction]);

  const onRefineDraft = useCallback(async () => {
    const instruction = refineInstruction.trim();
    if (instruction.length < 2 || aiDraft === null || refining || submitting) {
      return;
    }
    await requestAction({
      kind: "meal_refine_draft",
      instruction,
    });
  }, [aiDraft, refining, submitting, refineInstruction, requestAction]);

  const hasContent =
    recoveredDifferentDay ||
    name.trim().length > 0 ||
    portionGrams.trim().length > 0 ||
    calories.trim().length > 0 ||
    protein.trim().length > 0 ||
    carbs.trim().length > 0 ||
    fat.trim().length > 0 ||
    mealDescription.trim().length > 0 ||
    attachedPhoto !== null ||
    aiDraft !== null ||
    refineInstruction.trim().length > 0;

  const onClear = useCallback(async () => {
    setName("");
    setPortionGrams("");
    setNutritionBasis("total");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setAdvanced({ name: "", calories: "", protein: "", carbs: "", fat: "" });
    setMealDescription("");
    setAttachedPhoto(null);
    setDraftWarnings([]);
    setAiDraft(null);
    setSourceProposalId(null);
    setRefineInstruction("");
    setError(null);
    submittedOperationRef.current = null;
    setClientOperationId(createOperationId());
    setMealDate(requestedDate);
    setRecoveredDifferentDay(false);
    hadFailure.current = false;
    setConsumedAt(
      requestedDate
        ? mealTimestampForDate(requestedDate)
        : new Date().toISOString(),
    );
    if (userId !== null) {
      await clearLoggingDraft(userId, "meal");
    }
  }, [userId, requestedDate]);

  const per100g = nutritionBasis === "per100g";
  const servingPreview = per100g
    ? mealNutritionForSubmission(
        { ...advanced, name, calories, protein, carbs, fat },
        nutritionBasis,
        portionGrams,
      )
    : null;

  const calorieHint =
    calories.trim().length > 0 ? "calories recorded" : "calories optional";

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen
        options={{
          title: "Log a meal",
          headerLeft: () => (
            <Pressable
              testID="close-meal-header-button"
              accessibilityRole="button"
              accessibilityLabel="Close meal entry"
              accessibilityHint="Keeps your meal draft for later."
              disabled={!draftLoaded || submitting || snapping || refining}
              accessibilityState={{
                disabled: !draftLoaded || submitting || snapping || refining,
              }}
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.headerSaveButton,
                pressed && styles.snapPressed,
              ]}
            >
              <ThemedText type="smallBold">Close</ThemedText>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              testID="save-meal-header-button"
              accessibilityRole="button"
              accessibilityLabel="Save meal"
              disabled={!draftLoaded || submitting || snapping || refining}
              accessibilityState={{
                disabled: !draftLoaded || submitting || snapping || refining,
                busy: submitting,
              }}
              onPress={() => {
                void onSubmit();
              }}
              style={({ pressed }) => [
                styles.headerSaveButton,
                pressed && styles.snapPressed,
              ]}
            >
              <ThemedText type="smallBold">
                {submitting ? "Saving…" : "Save"}
              </ThemedText>
            </Pressable>
          ),
        }}
      />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          ref={formScrollRef}
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {params.date !== undefined || mealDate !== null ? (
            <ThemedText testID="meal-selected-date" type="smallBold">
              {invalidMealDate
                ? "Invalid meal date. Return to Meals and choose a day."
                : `Logging for ${new Date(consumedAt ?? mealTimestampForDate(mealDate ?? requestedDate!)).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`}
            </ThemedText>
          ) : null}
          {recoveredDifferentDay ? (
            <ThemedText type="small" themeColor="textSecondary">
              Recovered your existing draft on its original day. Use Clear to
              start a meal on the selected day, or go back and finish this draft
              first.
            </ThemedText>
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

          <ThemedText type="subtitle">What did you eat?</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            Choose a recent meal or enter a name. Nutrition values are optional.
          </ThemedText>

          {uniqueRecentMeals.length > 0 ? (
            <View style={styles.recentMealsContainer}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Quick meal reuse
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentMealsScroll}
              >
                {uniqueRecentMeals.map((meal: FoodEntry) => (
                  <Pressable
                    key={meal.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Reuse meal ${meal.name}`}
                    disabled={snapping || refining || submitting}
                    onPress={() => onSelectRecentMeal(meal)}
                    style={({ pressed }) => [
                      styles.recentMealChip,
                      pressed && styles.snapPressed,
                      {
                        borderColor: theme.border,
                        backgroundColor:
                          theme.background === "#F8FAF9"
                            ? "#FFFFFF"
                            : "rgba(255, 255, 255, 0.05)",
                      },
                    ]}
                  >
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {meal.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {meal.caloriesKcal != null
                        ? `${meal.caloriesKcal} kcal`
                        : "—"}
                      {meal.proteinG != null ? ` · ${meal.proteinG}P` : ""}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Field
            testID="meal-name-input"
            label="Meal name (required)"
            value={name}
            onChangeText={setName}
            onFocus={() => measurement.current?.tap()}
            placeholder="e.g. Toast with butter"
            autoFocus
            inputColor={theme.text}
            editable={!snapping && !refining && !submitting}
          />

          <ThemedText type="smallBold">Estimate nutrition with AI</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            Optional: describe your meal or attach a photo. Your description and
            photo are sent together for an estimate. Review before saving.
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
                disabled={snapping || submitting || refining}
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
              accessibilityHint="Send the attached photo and your description to Mizyun to generate a meal draft with estimated portion weight, calories, and macros."
              disabled={snapping || submitting || refining}
              accessibilityState={{
                busy: snapping,
                disabled: snapping || submitting || refining,
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
                  accessibilityLabel="Draft from description"
                  disabled={snapping || submitting || refining}
                  accessibilityState={{
                    busy: snapping,
                    disabled: snapping || submitting || refining,
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
                  disabled={snapping || submitting || refining}
                  accessibilityState={{
                    disabled: snapping || submitting || refining,
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
                  disabled={snapping || submitting || refining}
                  accessibilityState={{
                    disabled: snapping || submitting || refining,
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

              {aiUsage !== null ? (
                <View style={styles.quotaBadgeRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    📷 {aiUsage.photos.draftsRemaining} of{" "}
                    {aiUsage.photos.dailyLimit} photo scans left today
                    {aiUsage.planTier === "free" ? " (Free)" : " (Pro)"}
                  </ThemedText>
                </View>
              ) : null}
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

          {aiDraft === null ? (
            <View style={styles.field}>
              <ThemedText type="small" themeColor="textSecondary">
                Nutrition values
              </ThemedText>
              <View style={styles.basisRow}>
                {(
                  [
                    ["total", "For this portion"],
                    ["per100g", "Per 100 g"],
                  ] as const
                ).map(([basis, label]) => (
                  <Pressable
                    key={basis}
                    testID={`meal-basis-${basis}`}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityHint={
                      basis === "per100g"
                        ? "Enter food label values per 100 grams and a food weight to calculate totals."
                        : "Enter the totals for the portion you ate."
                    }
                    accessibilityState={{
                      selected: nutritionBasis === basis,
                      disabled:
                        submitting || snapping || refining || !draftLoaded,
                    }}
                    disabled={
                      submitting || snapping || refining || !draftLoaded
                    }
                    onPress={() => {
                      measurement.current?.tap();
                      setNutritionBasis(basis);
                    }}
                    style={[
                      styles.basisButton,
                      {
                        borderColor:
                          nutritionBasis === basis ? theme.text : theme.border,
                      },
                    ]}
                  >
                    <ThemedText type="smallBold">{label}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {per100g
                  ? "Enter all nutrient values per 100 g from the food label. Totals = label values × food weight ÷ 100."
                  : "Enter the nutrition totals for the portion you ate."}
              </ThemedText>
            </View>
          ) : null}

          <Field
            testID="meal-portion-weight-input"
            label={per100g ? "Food weight (g)" : "Portion weight (g)"}
            value={portionGrams}
            onChangeText={setPortionGrams}
            onFocus={() => measurement.current?.tap()}
            placeholder="e.g. 320"
            keyboardType="decimal-pad"
            helperText={
              per100g
                ? "required for values per 100 g"
                : aiDraft?.portionWeightG != null
                  ? "AI estimate — review before saving"
                  : "optional"
            }
            inputColor={theme.text}
            editable={!snapping && !refining && !submitting}
          />

          <Field
            testID="meal-calories-input"
            label={per100g ? "Calories (kcal / 100 g)" : "Calories (kcal)"}
            value={calories}
            onChangeText={setCalories}
            onFocus={() => measurement.current?.tap()}
            placeholder="0"
            keyboardType="decimal-pad"
            helperText={calorieHint}
            inputColor={theme.text}
            editable={!snapping && !refining && !submitting}
          />

          <View style={styles.macroRow}>
            <View style={styles.macroField}>
              <Field
                testID="meal-protein-input"
                label={per100g ? "Protein (g / 100 g)" : "Protein (g)"}
                value={protein}
                onChangeText={setProtein}
                onFocus={() => measurement.current?.tap()}
                placeholder="0"
                keyboardType="decimal-pad"
                inputColor={theme.text}
                editable={!snapping && !refining && !submitting}
              />
            </View>
            <View style={styles.macroField}>
              <Field
                testID="meal-carbs-input"
                label={per100g ? "Carbs (g / 100 g)" : "Carbs (g)"}
                value={carbs}
                onChangeText={setCarbs}
                onFocus={() => measurement.current?.tap()}
                placeholder="0"
                keyboardType="decimal-pad"
                inputColor={theme.text}
                editable={!snapping && !refining && !submitting}
              />
            </View>
            <View style={styles.macroField}>
              <Field
                testID="meal-fat-input"
                label={per100g ? "Fat (g / 100 g)" : "Fat (g)"}
                value={fat}
                onChangeText={setFat}
                onFocus={() => measurement.current?.tap()}
                placeholder="0"
                keyboardType="decimal-pad"
                inputColor={theme.text}
                editable={!snapping && !refining && !submitting}
              />
            </View>
          </View>

          <AdvancedNutrientFields
            form={advanced}
            per100g={per100g}
            enabled={advancedCapability.enabled}
            editable={!snapping && !refining && !submitting}
            onChange={(field, value) =>
              setAdvanced((current) => ({ ...current, [field]: value }))
            }
          />

          {servingPreview !== null ? (
            <View testID="meal-serving-preview" style={styles.field}>
              <ThemedText type="smallBold">Totals for this portion</ThemedText>
              {servingPreview.ok ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {[
                    ["Calories", servingPreview.nutrition.caloriesKcal, "kcal"],
                    ["Protein", servingPreview.nutrition.proteinG, "g"],
                    ["Carbs", servingPreview.nutrition.carbohydrateG, "g"],
                    ["Fat", servingPreview.nutrition.fatG, "g"],
                    ["Fibre", servingPreview.nutrition.fibreG, "g"],
                    [
                      "Saturated fat",
                      servingPreview.nutrition.saturatedFatG,
                      "g",
                    ],
                    [
                      "Total sugars",
                      servingPreview.nutrition.totalSugarsG,
                      "g",
                    ],
                    ["Sodium", servingPreview.nutrition.sodiumMg, "mg"],
                    [
                      "Cholesterol",
                      servingPreview.nutrition.cholesterolMg,
                      "mg",
                    ],
                  ]
                    .map(
                      ([label, value, unit]) =>
                        `${label}: ${value == null ? "unknown" : `${value} ${unit}`}`,
                    )
                    .join(" · ")}
                </ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  {servingPreview.message}
                </ThemedText>
              )}
            </View>
          ) : null}

          {aiDraft !== null ? (
            <View style={styles.refineBlock}>
              <ThemedText type="small" themeColor="textSecondary">
                Refine with AI
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Tell the AI how to adjust the values above — for example “make
                the chicken 200g instead of 100g”. The form will be re-filled
                with the refined estimate. Review uncertain values before
                saving.
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

          <View style={styles.actionsRow}>
            {hasContent ? (
              <Pressable
                accessibilityRole="button"
                testID="clear-meal-button"
                accessibilityLabel="Clear meal"
                accessibilityHint="Clears all meal fields, photo, and draft"
                disabled={submitting || snapping || refining}
                accessibilityState={{
                  disabled: submitting || snapping || refining,
                }}
                onPress={() => {
                  void onClear();
                }}
                style={({ pressed }) => [
                  styles.clearButton,
                  pressed && styles.snapPressed,
                ]}
              >
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Clear
                </ThemedText>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              testID="submit-meal-button"
              disabled={!draftLoaded || submitting || snapping || refining}
              accessibilityState={{
                disabled: !draftLoaded || submitting || snapping || refining,
                busy: submitting,
              }}
              onPress={() => {
                void onSubmit();
              }}
              style={({ pressed }) => [
                styles.submit,
                hasContent && styles.submitWithClear,
                (pressed || submitting) && styles.submitPressed,
              ]}
            >
              <ThemedText type="smallBold" style={styles.submitText}>
                {submitting ? "Saving…" : "Save meal"}
              </ThemedText>
            </Pressable>
          </View>
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
          setError(
            "AI meal drafting requires consent to third-party AI processing and adult eligibility.",
          );
        }}
      />

      <FirstMealRoutineModal
        visible={showRoutineModal}
        userId={userId ?? ""}
        onDismiss={() => router.back()}
        onSaved={() => router.back()}
      />
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
  readonly keyboardType?: "default" | "decimal-pad";
  readonly inputColor: string;
  readonly editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <TextInput
        testID={props.testID}
        value={props.value}
        editable={props.editable}
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
  basisRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  basisButton: {
    minHeight: 48,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
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
  actionsRow: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
  },
  clearButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: "center",
    justifyContent: "center",
  },
  headerSaveButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  submit: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F1F23",
    borderRadius: Spacing.three,
    padding: Spacing.three,
    alignItems: "center",
    backgroundColor: "#1F1F23",
  },
  submitWithClear: {
    flex: 1,
  },
  submitText: {
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
  quotaBadgeRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.one,
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
  recentMealsContainer: {
    gap: Spacing.one,
  },
  recentMealsScroll: {
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  recentMealChip: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 120,
    gap: 2,
  },
});
