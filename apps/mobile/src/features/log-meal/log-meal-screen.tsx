import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
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
import {
  BottomTabInset,
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
import {
  Button,
  Card,
  Chip,
  FormStatus,
  FormTextInput,
  Icon,
  IconButton,
  SectionHeader,
} from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import {
  classifyAnalyticsFailure,
  isRetryableAnalyticsFailure,
} from "@/features/analytics/classify-failure";
import {
  clearLoggingDraft,
  loadRequiredLoggingDraft,
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
  isFrozenMealForm,
  mealDraftForReconciliation,
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
  sameMealDetails,
  needsFreshAdvancedGrant,
  type MealFormStrings,
  type NutritionEntryBasis,
} from "./meal-form";
import {
  AdvancedNutrientFields,
  useAdvancedNutritionCapability,
} from "./advanced-nutrition";
import { normalizeMealPhoto } from "./meal-photo";
import {
  mealPhotoRetentionEnabled,
  persistMealPhotoSource,
  keepMealPhotoOnDevice,
  backUpLocalMealPhoto,
  discardOwnedMealPhoto,
} from "./meal-photo-retention";
import { loadPhotoBackupEnabled } from "@/features/private-photos/photo-backup-preference";
import { useMealVisualCapability } from "./meal-visual-capability";
import { rankMealQuickAdd, type MealQuickAddReason } from "@mizyun/core";
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

const QUICK_MEAL_REASON_LABEL: Record<MealQuickAddReason, string> = {
  usual_now: "Usual now",
  frequent: "",
  recent: "",
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
  // VISION-001 — photo-to-draft state. `attachedPhotos` holds the
  // user's selected or captured image before submission. `snapping` is true
  // while the photo is uploading and the configured vision provider is being
  // consulted. The form pre-fills with the candidate's name, portion weight,
  // calories, and macros;
  // the user can edit before saving, while `draftWarnings` keeps provider
  // uncertainty visible.
  const [attachedPhotos, setAttachedPhotos] = useState<
    readonly {
      uri: string;
      width?: number;
      height?: number;
    }[]
  >([]);
  const retainPhotos = mealPhotoRetentionEnabled();
  const [keepPhoto, setKeepPhoto] = useState(true);
  const [selectedPhotoUri, setSelectedPhotoUri] = useState<string | null>(null);
  const [pendingPhotoDrafts, setPendingPhotoDrafts] = useState<
    readonly FoodDraftCandidate[]
  >([]);
  const [snapping, setSnapping] = useState(false);
  const [mealDescription, setMealDescription] = useState("");
  const [draftWarnings, setDraftWarnings] = useState<readonly string[]>([]);
  const healthExportFirstParty = useRef(true);
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
  const mealVisualCapability = useMealVisualCapability(
    userId,
    session?.accessToken,
  );
  // Keeping a photo on this phone is free; only its backup needs Pro (ADR-0079).
  const canKeepMealPhoto = retainPhotos;
  const currentPhotoRetention = useRef(canKeepMealPhoto);
  currentPhotoRetention.current = canKeepMealPhoto;
  const mealOwner = useRef(userId);
  mealOwner.current = userId;
  const photoSelectionGeneration = useRef(0);
  useEffect(
    () => () => {
      photoSelectionGeneration.current++;
      mealOwner.current = null;
      photoOwner.current = "";
    },
    [],
  );
  const photoOwner = useRef("");
  photoOwner.current = `${userId ?? ""}:${session?.accessToken ?? ""}`;
  const measurement = useLoggingFlowMeasurement("meal", userId);
  const advancedCapability = useAdvancedNutritionCapability(
    userId,
    session?.accessToken,
  );

  useEffect(() => {
    let active = true;
    // One bounded page (API maximum 200); the ranker keeps the last 30 days.
    void fetchFoodHistory({ limit: 200 })
      .then((res) => {
        if (!active) return;
        if (res.entries.length > 0) {
          setRecentMeals(res.entries);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const quickMeals = useMemo(() => {
    let timeZone = "UTC";
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      // Keep UTC when the runtime cannot resolve a zone.
    }
    try {
      return rankMealQuickAdd({
        entries: recentMeals,
        referenceAt: new Date(),
        timeZone,
        limit: 6,
      });
    } catch {
      return [];
    }
  }, [recentMeals]);

  const onSelectRecentMeal = useCallback(
    (meal: FoodEntry) => {
      measurement.current?.tap();
      healthExportFirstParty.current = false;
      setNutritionBasis("total");
      setAiDraft(null);
      photoSelectionGeneration.current++;
      if (userId && retainPhotos)
        for (const photo of attachedPhotos)
          discardOwnedMealPhoto(userId, photo.uri);
      setSelectedPhotoUri(null);
      setAttachedPhotos([]);
      setPendingPhotoDrafts([]);
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
    [advancedCapability.enabled, userId, retainPhotos, attachedPhotos],
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
  const preparedMealRef = useRef<LogMealForm | undefined>(undefined);
  const loadedMealScopeRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const recoveryScope = photoOwner.current;
    loadedMealScopeRef.current = null;
    setDraftLoaded(false);
    isSubmittingRef.current = false;
    isCompletedRef.current = false;
    submittedOperationRef.current = null;
    preparedMealRef.current = undefined;
    hadFailure.current = false;
    setName("");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setAdvanced({ name: "", calories: "", protein: "", carbs: "", fat: "" });
    setMealDescription("");
    setAiDraft(null);
    setSourceProposalId(null);
    setRefineInstruction("");
    setPortionGrams("");
    setNutritionBasis("total");
    setError(null);
    setSubmitting(false);
    setMealDate(requestedDate);
    setRecoveredDifferentDay(false);
    setAttachedPhotos([]);
    setPendingPhotoDrafts([]);
    photoSelectionGeneration.current++;
    setKeepPhoto(true);
    setSelectedPhotoUri(null);
    if (userId === null) {
      setClientOperationId(null);
      setConsumedAt(null);
      return;
    }
    void loadRequiredLoggingDraft(userId, "meal", isRecoverableMealDraft)
      .then((draft) => {
        if (!active) return;
        if (draft !== null) {
          const upgraded = upgradeLegacyMealDraft(
            mealDraftForReconciliation(draft),
          );
          preparedMealRef.current = upgraded.preparedMeal;
          submittedOperationRef.current = upgraded.submittedMeal ?? null;
          hadFailure.current = upgraded.submittedMeal !== undefined;
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
          healthExportFirstParty.current = false;
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
          setAttachedPhotos(
            (
              upgraded.attachedPhotoUris ??
              (upgraded.attachedPhotoUri ? [upgraded.attachedPhotoUri] : [])
            ).map((uri) => ({ uri })),
          );
          setPendingPhotoDrafts(upgraded.pendingPhotoDrafts ?? []);
          setKeepPhoto(upgraded.keepPhoto ?? true);
          setSelectedPhotoUri(upgraded.selectedPhotoUri ?? null);
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
        loadedMealScopeRef.current = recoveryScope;
        setDraftLoaded(true);
      })
      .catch(() => {
        if (active)
          setError(
            "Your saved meal operation could not be recovered. Retry opening this screen when device storage is available.",
          );
      });
    return () => {
      active = false;
    };
  }, [userId, session?.accessToken, requestedDate]);

  useEffect(() => {
    if (
      !draftLoaded ||
      loadedMealScopeRef.current !== photoOwner.current ||
      invalidMealDate ||
      userId === null ||
      isCompletedRef.current ||
      isSubmittingRef.current
    )
      return;
    const scope = photoOwner.current;
    void saveLoggingDraft(
      userId,
      "meal",
      {
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
        ...(preparedMealRef.current === undefined
          ? {}
          : { preparedMeal: preparedMealRef.current }),
        description: mealDescription,
        ...(aiDraft === null ? {} : { aiDraft }),
        ...(sourceProposalId === null ? {} : { sourceProposalId }),
        ...(refineInstruction.trim().length > 0 ? { refineInstruction } : {}),
        attachedPhotoUris: attachedPhotos.map((photo) => photo.uri),
        pendingPhotoDrafts,
        keepPhoto,
        selectedPhotoUri,
        ...(submittedOperationRef.current === null
          ? {}
          : {
              submittedMeal: submittedOperationRef.current,
              submissionStatus: "outcome_unknown" as const,
            }),
      },
      undefined,
      {
        isCurrent: () =>
          mealOwner.current === userId && photoOwner.current === scope,
      },
    );
  }, [
    keepPhoto,
    selectedPhotoUri,
    aiDraft,
    attachedPhotos,
    pendingPhotoDrafts,
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
    const owner = mealOwner.current;
    const photoScope = photoOwner.current;
    const photoRetentionCurrent = () =>
      owner === mealOwner.current &&
      photoScope === photoOwner.current &&
      currentPhotoRetention.current;
    const abandonIfOwnerChanged = () => {
      if (owner === mealOwner.current && photoScope === photoOwner.current)
        return false;
      isSubmittingRef.current = false;
      setSubmitting(false);
      return true;
    };
    const attempt = measurement.current;
    if (
      !draftLoaded ||
      loadedMealScopeRef.current !== photoScope ||
      isSubmittingRef.current ||
      isCompletedRef.current
    )
      return;
    isSubmittingRef.current = true;
    setSubmitting(true);
    Keyboard.dismiss();
    formScrollRef.current?.scrollTo({ y: 0, animated: true });

    attempt?.tap();
    if (hadFailure.current) attempt?.retry();
    setError(null);
    if (recoveredDifferentDay && submittedOperationRef.current === null) {
      isSubmittingRef.current = false;
      setSubmitting(false);
      setError(
        "Your recovered draft belongs to another day. Use Clear to start on the selected day, or return and finish the original draft first.",
      );
      return;
    }
    if (
      canKeepMealPhoto &&
      keepPhoto &&
      attachedPhotos.length > 1 &&
      !attachedPhotos.some((photo) => photo.uri === selectedPhotoUri)
    ) {
      isSubmittingRef.current = false;
      setSubmitting(false);
      setError(
        "Choose which photo to keep with this meal, or turn off Keep photo with meal.",
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
      prev.consumedAt === fixedConsumedAt &&
      sameMealDetails(prev.details ?? {}, details);

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

    if (needsFreshAdvancedGrant(hasAdvancedInput, isRetryOfPrev)) {
      const allowed = await advancedCapability.refresh();
      if (abandonIfOwnerChanged()) return;
      if (!allowed) {
        isSubmittingRef.current = false;
        setSubmitting(false);
        setError(
          "More nutrient values require an active Pro grant. Your draft is saved; restore access or clear those values before submitting.",
        );
        return;
      }
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

    const form: LogMealForm =
      isRetryOfPrev && prev !== null
        ? prev
        : {
            clientOperationId: opId,
            name: name.trim(),
            caloriesKcal: nutrition.caloriesKcal,
            proteinG: nutrition.proteinG,
            carbohydrateG: nutrition.carbohydrateG,
            fatG: nutrition.fatG,
            ...(hasAdvancedInput && parsedAdvanced !== null
              ? parsedAdvanced
              : {}),
            healthExportFirstParty:
              healthExportFirstParty.current &&
              aiDraft === null &&
              sourceProposalId === null,
            healthExportTimeBasis: mealDate === null ? "observed" : "date_only",
            consumedAt: fixedConsumedAt,
            ...(Object.keys(details).length === 0 ? {} : { details }),
          };
    if (!isFrozenMealForm(form) || userId === null || owner === null) {
      isSubmittingRef.current = false;
      setSubmitting(false);
      setError(
        "Please double-check the meal values and sign in before saving.",
      );
      return;
    }
    // Await durable draft persistence before submitting (Requirement 2)
    if (userId !== null) {
      const persisted = await saveLoggingDraft(
        userId,
        "meal",
        {
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
          ...(preparedMealRef.current === undefined
            ? {}
            : { preparedMeal: preparedMealRef.current }),
          description: mealDescription,
          ...(aiDraft === null ? {} : { aiDraft }),
          ...(sourceProposalId === null ? {} : { sourceProposalId }),
          ...(refineInstruction.trim().length > 0 ? { refineInstruction } : {}),
          attachedPhotoUris: attachedPhotos.map((photo) => photo.uri),
          pendingPhotoDrafts,
          keepPhoto,
          selectedPhotoUri,
          submittedMeal: form,
          submissionStatus: "outcome_unknown",
        },
        undefined,
        {
          isCurrent: () =>
            owner === mealOwner.current && photoScope === photoOwner.current,
        },
      );
      if (abandonIfOwnerChanged()) return;
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

    if (abandonIfOwnerChanged()) return;
    submittedOperationRef.current = form;

    const result = await submitLogMeal(form, {
      expectedUserId: owner,
      isCurrent: () =>
        owner === mealOwner.current && photoScope === photoOwner.current,
    }).catch(() => ({
      ok: false as const,
      message:
        "The result is unknown. Retry Save with these same values to recover this meal.",
    }));
    if (abandonIfOwnerChanged()) return;
    if (result.ok) {
      const chosen =
        attachedPhotos.find((photo) => photo.uri === selectedPhotoUri) ??
        (attachedPhotos.length === 1 ? attachedPhotos[0] : undefined);
      if (
        retainPhotos &&
        keepPhoto &&
        chosen &&
        owner &&
        photoRetentionCurrent()
      ) {
        // The photo is kept on this phone; a server copy is made only when
        // Back up photos is on and Pro is confirmed (ADR-0079).
        const kept = await keepMealPhotoOnDevice(owner, result.id, chosen.uri);
        if (abandonIfOwnerChanged()) return;
        if (!kept) {
          isSubmittingRef.current = false;
          setSubmitting(false);
          setError(
            "Meal saved. The photo couldn't be kept on this phone. Retry Save to finish attaching the photo.",
          );
          return;
        }
        if (
          (await loadPhotoBackupEnabled(owner)) &&
          photoRetentionCurrent() &&
          (await mealVisualCapability.refresh()) &&
          photoRetentionCurrent()
        )
          // A failed upload is retried by the background backup sync.
          await backUpLocalMealPhoto(owner, result.id, photoRetentionCurrent);
        if (abandonIfOwnerChanged()) return;
      }
      const queued = pendingPhotoDrafts[0];
      if (queued) {
        const advancedEnabled = await advancedCapability.refresh();
        if (abandonIfOwnerChanged()) return;
        const next = mealDraftForAdvancedAccess(queued, advancedEnabled);
        const strings = mealFormStringsFromDraft(next);
        const nextId = createOperationId();
        const remaining = pendingPhotoDrafts.slice(1);
        const nextDraft = {
          ...strings,
          portionGrams: portionGramsStringFromDraft(next),
          nutritionBasis: "total" as const,
          clientOperationId: nextId,
          consumedAt: fixedConsumedAt,
          mealDate: mealDate ?? undefined,
          submissionVersion: 1,
          description: mealDescription,
          aiDraft: next,
          pendingPhotoDrafts: remaining,
          attachedPhotoUris: retainPhotos
            ? attachedPhotos.map((photo) => photo.uri)
            : [],
          keepPhoto,
          selectedPhotoUri: null,
        };
        const persisted =
          userId !== null &&
          (await saveLoggingDraft(userId, "meal", nextDraft, undefined, {
            resolvedOperationId: opId,
            isCurrent: () =>
              owner === mealOwner.current && photoScope === photoOwner.current,
          }));
        if (abandonIfOwnerChanged()) return;
        if (!persisted) {
          isSubmittingRef.current = false;
          setSubmitting(false);
          hadFailure.current = true;
          setError(
            "Meal saved, but the next draft could not be saved on this device. Retry Save to recover the remaining drafts.",
          );
          return;
        }
        submittedOperationRef.current = null;
        preparedMealRef.current = undefined;
        hadFailure.current = false;
        setClientOperationId(nextId);
        setName(strings.name);
        setCalories(strings.calories);
        setProtein(strings.protein);
        setCarbs(strings.carbs);
        setFat(strings.fat);
        setPortionGrams(nextDraft.portionGrams);
        setNutritionBasis("total");
        setAdvanced(strings);
        healthExportFirstParty.current = false;
        setAiDraft(next);
        setDraftWarnings(draftEvidenceLines(next));
        setPendingPhotoDrafts(remaining);
        if (!retainPhotos) setAttachedPhotos([]);
        setSelectedPhotoUri(null);
        setRefineInstruction("");
        setSourceProposalId(null);
        isSubmittingRef.current = false;
        setSubmitting(false);
        setError(null);
        formScrollRef.current?.scrollTo({ y: 0, animated: true });
        return;
      }
      if (userId !== null) {
        const cleared = await clearLoggingDraft(userId, "meal", undefined, {
          resolvedOperationId: opId,
          isCurrent: () =>
            owner === mealOwner.current && photoScope === photoOwner.current,
        });
        if (abandonIfOwnerChanged()) return;
        if (!cleared) {
          isSubmittingRef.current = false;
          setSubmitting(false);
          hadFailure.current = true;
          setError(
            "Meal saved, but completion recovery could not be saved on this device. Retry Save with these values to finish recovery.",
          );
          return;
        }
        isCompletedRef.current = true;
        submittedOperationRef.current = null;
        attempt?.complete();
        if (retainPhotos)
          for (const photo of attachedPhotos)
            discardOwnedMealPhoto(userId, photo.uri);
        const mealDate = fixedConsumedAt
          ? new Date(fixedConsumedAt)
          : new Date();
        const isToday = mealDate.toDateString() === new Date().toDateString();
        if (isToday) {
          await reconcileFirstMealReminders(userId, {
            todayLogged: true,
          }).catch(() => {});
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
    canKeepMealPhoto,
    mealVisualCapability,
    keepPhoto,
    selectedPhotoUri,
    retainPhotos,
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
    attachedPhotos,
    pendingPhotoDrafts,
  ]);

  const addPhotos = useCallback(
    (
      assets: readonly { uri: string; width?: number; height?: number }[],
      limit: number,
    ) => {
      const photos = [
        ...attachedPhotos,
        ...assets.filter(
          (asset) => !attachedPhotos.some((photo) => photo.uri === asset.uri),
        ),
      ];
      if (photos.length > limit) {
        setError(
          limit === 3
            ? "Choose up to three photos per request."
            : "Multiple photos require Pro. Remove photos to continue with one.",
        );
        return;
      }
      const owner = photoOwner.current;
      const generation = ++photoSelectionGeneration.current;
      if (retainPhotos && userId) {
        const copied: string[] = [];
        void Promise.allSettled(
          photos.map(async (photo) => {
            if (attachedPhotos.some((existing) => existing.uri === photo.uri))
              return photo;
            const durable = await persistMealPhotoSource(userId, photo);
            copied.push(durable.uri);
            return durable;
          }),
        ).then((results) => {
          if (
            owner !== photoOwner.current ||
            generation !== photoSelectionGeneration.current ||
            results.some((result) => result.status === "rejected")
          ) {
            for (const uri of copied) discardOwnedMealPhoto(userId, uri);
            if (
              owner === photoOwner.current &&
              generation === photoSelectionGeneration.current
            )
              setError(
                "Could not save the photo on this device. You can still enter and save your meal.",
              );
            return;
          }
          const durable = results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          );
          setAttachedPhotos(durable);
          setSelectedPhotoUri(durable.length === 1 ? durable[0]!.uri : null);
        });
      } else setAttachedPhotos(photos);
    },
    [attachedPhotos, retainPhotos, userId],
  );

  const onChoosePhoto = useCallback(async () => {
    const owner = photoOwner.current;
    const selectionGeneration = photoSelectionGeneration.current;
    setError(null);
    const pro = await advancedCapability.refresh();
    if (
      owner !== photoOwner.current ||
      selectionGeneration !== photoSelectionGeneration.current
    )
      return;
    const limit = pro ? 3 : 1;
    if (attachedPhotos.length >= limit) {
      setError(
        pro
          ? "Remove a photo before adding another."
          : "Multiple photos require Pro.",
      );
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to choose meal photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: false,
      allowsMultipleSelection: pro,
      selectionLimit: limit - attachedPhotos.length,
      orderedSelection: pro,
    });
    if (
      owner !== photoOwner.current ||
      selectionGeneration !== photoSelectionGeneration.current
    )
      return;
    if (!result.canceled && result.assets?.length)
      addPhotos(result.assets, limit);
  }, [advancedCapability.refresh, attachedPhotos, addPhotos]);

  const onTakePhoto = useCallback(async () => {
    const owner = photoOwner.current;
    const selectionGeneration = photoSelectionGeneration.current;
    setError(null);
    const pro = await advancedCapability.refresh();
    if (
      owner !== photoOwner.current ||
      selectionGeneration !== photoSelectionGeneration.current
    )
      return;
    const limit = pro ? 3 : 1;
    if (attachedPhotos.length >= limit) {
      setError(
        pro
          ? "Remove a photo before adding another."
          : "Multiple photos require Pro.",
      );
      return;
    }
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
    if (
      owner !== photoOwner.current ||
      selectionGeneration !== photoSelectionGeneration.current
    )
      return;
    if (!result.canceled && result.assets?.length)
      addPhotos(result.assets, limit);
  }, [advancedCapability.refresh, attachedPhotos, addPhotos]);

  const onRemovePhoto = useCallback(
    (index: number) => {
      photoSelectionGeneration.current++;
      const removed = attachedPhotos[index];
      if (removed && userId && retainPhotos)
        discardOwnedMealPhoto(userId, removed.uri);
      if (removed?.uri === selectedPhotoUri) setSelectedPhotoUri(null);
      setAttachedPhotos((photos) => photos.filter((_, i) => i !== index));
    },
    [attachedPhotos, userId, retainPhotos, selectedPhotoUri],
  );

  const executeProcessPhoto = useCallback(
    async (photoUri?: string) => {
      const owner = photoOwner.current;
      const attempt = measurement.current;
      const photoSources =
        attachedPhotos.length > 0
          ? attachedPhotos
          : photoUri
            ? [{ uri: photoUri }]
            : [];
      if (photoSources.length === 0) return;
      attempt?.tap();
      if (hadFailure.current) attempt?.retry();
      setSnapping(true);
      setError(null);
      setDraftWarnings([]);
      try {
        const hint = mealDescription.trim();
        const pro = await advancedCapability.refresh();
        if (owner !== photoOwner.current) return;
        if (photoSources.length > (pro ? 3 : 1)) {
          setError(
            "Multiple photos require Pro. Remove photos to continue with one.",
          );
          return;
        }
        const photos: Blob[] = [];
        for (const source of photoSources)
          photos.push(await normalizeMealPhoto(source));
        if (owner !== photoOwner.current) return;
        const draft = await snapMealPhoto(
          photos[0]!,
          "image/jpeg",
          hint.length > 0 ? hint : undefined,
          photos
            .slice(1)
            .map((photo) => ({ photo, mimeType: "image/jpeg" as const })),
        );
        if (owner !== photoOwner.current) return;
        if (!draft.ok) {
          hadFailure.current = true;
          attempt?.fail("upload", "unexpected", true);
          setError(draft.message);
          return;
        }
        const advancedEnabled = await advancedCapability.refresh();
        if (owner !== photoOwner.current) return;
        setPendingPhotoDrafts(
          (draft.drafts ?? [draft.draft])
            .slice(1)
            .map((candidate) =>
              mealDraftForAdvancedAccess(candidate, advancedEnabled),
            ),
        );
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
        healthExportFirstParty.current = false;
        setAiDraft(mealDraftForAdvancedAccess(draft.draft, advancedEnabled));
        setSourceProposalId(null);

        void loadAiUsage();
      } catch {
        if (owner !== photoOwner.current) return;
        hadFailure.current = true;
        attempt?.fail("upload", "unexpected", true);
        setError(
          "Couldn't read this photo. Remove it and choose it again, or enter the meal by hand.",
        );
      } finally {
        setSnapping(false);
      }
    },
    [advancedCapability.refresh, attachedPhotos, loadAiUsage, mealDescription],
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
        setPendingPhotoDrafts([]);
        photoSelectionGeneration.current++;
        if (userId && retainPhotos)
          for (const photo of attachedPhotos)
            discardOwnedMealPhoto(userId, photo.uri);
        setSelectedPhotoUri(null);
        setAttachedPhotos([]);
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
        healthExportFirstParty.current = false;
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
      userId,
      retainPhotos,
      attachedPhotos,
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
        healthExportFirstParty.current = false;
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
    if (attachedPhotos.length === 0) return;
    await requestAction({
      kind: "meal_photo_draft",
      photoUri: attachedPhotos[0]!.uri,
    });
  }, [attachedPhotos, requestAction]);

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
    attachedPhotos.length > 0 ||
    aiDraft !== null ||
    refineInstruction.trim().length > 0;

  const onClear = useCallback(async () => {
    if (submittedOperationRef.current !== null) {
      const restored = mealDraftForReconciliation({
        name,
        calories,
        protein,
        carbs,
        fat,
        submittedMeal: submittedOperationRef.current,
      });
      setName(restored.name);
      setCalories(restored.calories);
      setProtein(restored.protein);
      setCarbs(restored.carbs);
      setFat(restored.fat);
      setAdvanced(restored);
      setPortionGrams(restored.portionGrams ?? "");
      setNutritionBasis("total");
      setMealDescription(restored.description ?? "");
      setAiDraft(restored.aiDraft ?? null);
      setSourceProposalId(restored.sourceProposalId ?? null);
      setRefineInstruction("");
      setError(
        "Restored the submitted values. This meal may already be saved. Retry Save to resolve its outcome before clearing or replacing it.",
      );
      return;
    }
    const scope = photoOwner.current;
    const isCurrent = () =>
      mealOwner.current === userId && photoOwner.current === scope;
    if (
      userId !== null &&
      !(await clearLoggingDraft(userId, "meal", undefined, { isCurrent }))
    ) {
      setError(
        "Could not clear the saved meal draft. Reopen it to recover or retry device storage.",
      );
      return;
    }
    if (!isCurrent()) return;
    preparedMealRef.current = undefined;
    healthExportFirstParty.current = true;

    photoSelectionGeneration.current++;
    setName("");
    setPortionGrams("");
    setNutritionBasis("total");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setAdvanced({ name: "", calories: "", protein: "", carbs: "", fat: "" });
    setMealDescription("");
    if (userId && retainPhotos)
      for (const photo of attachedPhotos)
        discardOwnedMealPhoto(userId, photo.uri);
    setSelectedPhotoUri(null);
    setKeepPhoto(true);
    setAttachedPhotos([]);
    setPendingPhotoDrafts([]);
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
  }, [
    userId,
    requestedDate,
    retainPhotos,
    attachedPhotos,
    name,
    calories,
    protein,
    carbs,
    fat,
  ]);

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

  const inputsLocked = snapping || refining || submitting;
  const photoActionsDisabled = snapping || submitting || refining;

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen
        options={{
          title: "Log a meal",
          headerLeft: () => (
            <IconButton
              icon="close"
              testID="close-meal-header-button"
              accessibilityLabel="Close meal entry"
              accessibilityHint="Keeps your meal draft for later."
              disabled={!draftLoaded || submitting || snapping || refining}
              accessibilityState={{
                disabled: !draftLoaded || submitting || snapping || refining,
              }}
              onPress={() => {
                photoSelectionGeneration.current++;
                router.back();
              }}
            />
          ),
          headerRight: () => (
            <Button
              testID="save-meal-header-button"
              variant="plain"
              size="small"
              label={submitting ? "Saving…" : "Save"}
              accessibilityLabel="Save meal"
              disabled={!draftLoaded || submitting || snapping || refining}
              accessibilityState={{
                disabled: !draftLoaded || submitting || snapping || refining,
                busy: submitting,
              }}
              onPress={() => {
                void onSubmit();
              }}
            />
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
          {params.date !== undefined ||
          mealDate !== null ||
          recoveredDifferentDay ||
          error !== null ? (
            <View style={styles.messages}>
              {params.date !== undefined || mealDate !== null ? (
                <ThemedText
                  testID="meal-selected-date"
                  type="smallBold"
                  themeColor={invalidMealDate ? "danger" : "text"}
                >
                  {invalidMealDate
                    ? "Invalid meal date. Return to Meals and choose a day."
                    : `Logging for ${new Date(consumedAt ?? mealTimestampForDate(mealDate ?? requestedDate!)).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`}
                </ThemedText>
              ) : null}
              {recoveredDifferentDay ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Recovered your existing draft on its original day. Use Clear
                  to start a meal on the selected day, or go back and finish
                  this draft first.
                </ThemedText>
              ) : null}
              {error !== null ? (
                <FormStatus tone="error">{error}</FormStatus>
              ) : null}
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionHeader title="What did you eat?" />
            <ThemedText themeColor="textSecondary" type="small">
              Choose a recent meal or enter a name. Nutrition values are
              optional.
            </ThemedText>
            <Card style={styles.cardStack}>
              {quickMeals.length > 0 ? (
                <View style={styles.recentMealsContainer}>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Quick meal reuse
                  </ThemedText>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.recentMealsScroll}
                  >
                    {quickMeals.map(({ entry: meal, reason }) => (
                      <Pressable
                        key={meal.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Reuse meal ${meal.name}${QUICK_MEAL_REASON_LABEL[reason] ? `, ${QUICK_MEAL_REASON_LABEL[reason].toLowerCase()}` : ""}`}
                        disabled={snapping || refining || submitting}
                        onPress={() => onSelectRecentMeal(meal)}
                        style={({ pressed }) => [
                          styles.recentMealChip,
                          { backgroundColor: theme.backgroundSelected },
                          pressed && styles.pressed,
                        ]}
                      >
                        <ThemedText type="smallBold" numberOfLines={1}>
                          {meal.name}
                        </ThemedText>
                        <ThemedText type="footnote" themeColor="textSecondary">
                          {meal.caloriesKcal != null
                            ? `${meal.caloriesKcal} kcal`
                            : "—"}
                          {meal.proteinG != null ? ` · ${meal.proteinG}P` : ""}
                        </ThemedText>
                        {QUICK_MEAL_REASON_LABEL[reason] ? (
                          <ThemedText
                            type="footnote"
                            themeColor="textSecondary"
                            testID="quick-meal-reason"
                          >
                            {QUICK_MEAL_REASON_LABEL[reason]}
                          </ThemedText>
                        ) : null}
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
                editable={!inputsLocked}
              />
            </Card>
          </View>

          <View style={styles.section}>
            <SectionHeader title="Estimate nutrition with AI" />
            <ThemedText themeColor="textSecondary" type="small">
              Optional: describe your meal or attach a photo. Your description
              and photo are sent together for an estimate. Review before saving.
            </ThemedText>
            <Card style={styles.cardStack}>
              <FormTextInput
                testID="meal-description-input"
                accessibilityLabel="Describe meal for AI draft"
                multiline
                maxLength={1_000}
                placeholder="Describe food and portions, e.g. two eggs, toast, and a teaspoon of butter"
                value={mealDescription}
                onChangeText={setMealDescription}
                style={styles.description}
              />

              {attachedPhotos.map((attachedPhoto, index) => (
                <View
                  key={attachedPhoto.uri}
                  style={[
                    styles.attachedPhotoCard,
                    { backgroundColor: theme.backgroundSelected },
                  ]}
                >
                  <Image
                    source={attachedPhoto.uri}
                    style={styles.attachedPhotoImage}
                    contentFit="cover"
                    cachePolicy="none"
                    accessibilityLabel="Attached meal photo"
                  />
                  <View style={styles.attachedPhotoInfo}>
                    <ThemedText type="smallBold">
                      Photo {index + 1} of {attachedPhotos.length}
                    </ThemedText>
                    <ThemedText themeColor="textSecondary" type="footnote">
                      {canKeepMealPhoto
                        ? "Optional photo · AI processing is separate"
                        : "Ready to process with your description"}
                    </ThemedText>
                  </View>
                  <View style={styles.attachedPhotoActions}>
                    {canKeepMealPhoto &&
                    keepPhoto &&
                    attachedPhotos.length > 1 ? (
                      <Chip
                        accessibilityRole="radio"
                        accessibilityState={{
                          checked: selectedPhotoUri === attachedPhoto.uri,
                        }}
                        accessibilityLabel={`Keep photo ${index + 1} with this meal`}
                        label={
                          selectedPhotoUri === attachedPhoto.uri
                            ? "Selected"
                            : "Keep this"
                        }
                        selected={selectedPhotoUri === attachedPhoto.uri}
                        disabled={photoActionsDisabled}
                        onPress={() => setSelectedPhotoUri(attachedPhoto.uri)}
                      />
                    ) : null}
                    <Button
                      variant="plain"
                      size="small"
                      icon="close"
                      label="Remove"
                      accessibilityLabel={`Remove attached photo ${index + 1}`}
                      disabled={photoActionsDisabled}
                      onPress={() => onRemovePhoto(index)}
                    />
                  </View>
                </View>
              ))}
              {canKeepMealPhoto && attachedPhotos.length > 0 ? (
                <Pressable
                  testID="keep-meal-photo-toggle"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: keepPhoto }}
                  disabled={submitting || snapping || refining}
                  onPress={() => setKeepPhoto((value) => !value)}
                  style={styles.keepPhotoChoice}
                >
                  {keepPhoto ? (
                    <Icon name="checkCircle" size={24} color="primary" />
                  ) : (
                    <View
                      style={[
                        styles.checkOff,
                        { borderColor: theme.textTertiary },
                      ]}
                    />
                  )}
                  <View style={styles.keepPhotoText}>
                    <ThemedText type="smallBold">
                      Keep photo with meal
                    </ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      One compressed photo, kept on this phone. You can remove
                      it later. Backed up only when Back up photos is on (Pro).
                    </ThemedText>
                  </View>
                </Pressable>
              ) : null}
              <ThemedText type="footnote" themeColor="textSecondary">
                {advancedCapability.enabled
                  ? "Up to 3 photos · multiple angles or separate meals. Describe which photos belong together."
                  : "1 photo per request · Pro supports up to 3."}
              </ThemedText>
              {pendingPhotoDrafts.length > 0 ? (
                <ThemedText type="smallBold">
                  Review this meal, then {pendingPhotoDrafts.length} more. Each
                  meal needs its own Save.
                </ThemedText>
              ) : null}
              {attachedPhotos.length > 0 &&
              attachedPhotos.length < (advancedCapability.enabled ? 3 : 1) ? (
                <View style={styles.photoRow}>
                  <Button
                    variant="secondary"
                    icon="photo"
                    label="Add photos"
                    accessibilityLabel="Add meal photos"
                    disabled={photoActionsDisabled}
                    onPress={() => void onChoosePhoto()}
                    style={styles.photoButton}
                  />
                  <Button
                    variant="secondary"
                    icon="camera"
                    label="Take photo"
                    accessibilityLabel="Take another meal photo"
                    disabled={photoActionsDisabled}
                    onPress={() => void onTakePhoto()}
                    style={styles.photoButton}
                  />
                </View>
              ) : null}

              {attachedPhotos.length > 0 ? (
                <Button
                  variant="tinted"
                  icon="sparkles"
                  block
                  testID="process-meal-photo-button"
                  label={`Process ${attachedPhotos.length > 1 ? "photos" : "photo"} with AI`}
                  accessibilityLabel="Process photo with AI"
                  accessibilityHint="Send the attached photo and your description to Mizyun to generate a meal draft with estimated portion weight, calories, and macros."
                  accessibilityValue={
                    snapping ? { text: "Analysing photo" } : undefined
                  }
                  loading={snapping}
                  disabled={snapping || submitting || refining}
                  onPress={() => {
                    void onProcessPhoto();
                  }}
                />
              ) : (
                <>
                  {mealDescription.trim().length >= 2 ? (
                    <Button
                      variant="tinted"
                      icon="sparkles"
                      block
                      label="Draft from description"
                      accessibilityLabel="Draft from description"
                      accessibilityValue={
                        snapping ? { text: "Analysing description" } : undefined
                      }
                      loading={snapping}
                      disabled={snapping || submitting || refining}
                      onPress={() => void onTextDraft()}
                    />
                  ) : null}

                  <View style={styles.photoRow}>
                    <Button
                      variant="secondary"
                      icon="camera"
                      testID="take-meal-photo-button"
                      label="Take photo"
                      accessibilityLabel="Take a meal photo"
                      accessibilityHint="Open the camera to take a meal photo and attach it to this entry."
                      disabled={photoActionsDisabled}
                      onPress={() => {
                        void onTakePhoto();
                      }}
                      style={styles.photoButton}
                    />
                    <Button
                      variant="secondary"
                      icon="photo"
                      testID="snap-meal-button"
                      label="Choose photo"
                      accessibilityLabel="Choose a meal photo"
                      accessibilityHint="Open the photo library to pick a meal photo and attach it to this entry."
                      disabled={photoActionsDisabled}
                      onPress={() => {
                        void onChoosePhoto();
                      }}
                      style={styles.photoButton}
                    />
                  </View>

                  {aiUsage !== null ? (
                    <View style={styles.quotaBadgeRow}>
                      <Icon name="camera" size={14} color="textSecondary" />
                      <ThemedText type="footnote" themeColor="textSecondary">
                        {aiUsage.photos.draftsRemaining} of{" "}
                        {aiUsage.photos.dailyLimit} photo scans left today
                        {aiUsage.planTier === "free" ? " (Free)" : " (Pro)"}
                      </ThemedText>
                    </View>
                  ) : null}
                </>
              )}
            </Card>
          </View>

          {draftWarnings.length > 0 ? (
            <Card style={styles.warnings} accessibilityRole="alert">
              {draftWarnings.map((warning) => (
                <ThemedText
                  key={warning}
                  type="small"
                  themeColor="textSecondary"
                >
                  {warning}
                </ThemedText>
              ))}
            </Card>
          ) : null}

          <View style={styles.section}>
            <SectionHeader title="Nutrition" />
            <Card style={styles.cardStack}>
              {aiDraft === null ? (
                <View style={styles.field}>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Nutrition values
                  </ThemedText>
                  <View style={styles.basisRow}>
                    {(
                      [
                        ["total", "For this portion"],
                        ["per100g", "Per 100 g"],
                      ] as const
                    ).map(([basis, label]) => (
                      <Chip
                        key={basis}
                        testID={`meal-basis-${basis}`}
                        label={label}
                        selected={nutritionBasis === basis}
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
                        style={styles.basisChip}
                      />
                    ))}
                  </View>
                  <ThemedText type="footnote" themeColor="textSecondary">
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
                editable={!inputsLocked}
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
                editable={!inputsLocked}
              />

              <View style={styles.macroRow}>
                <View style={styles.macroField}>
                  <Field
                    testID="meal-protein-input"
                    label={per100g ? "Protein (g / 100 g)" : "Protein (g)"}
                    accent="protein"
                    value={protein}
                    onChangeText={setProtein}
                    onFocus={() => measurement.current?.tap()}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    editable={!inputsLocked}
                  />
                </View>
                <View style={styles.macroField}>
                  <Field
                    testID="meal-carbs-input"
                    label={per100g ? "Carbs (g / 100 g)" : "Carbs (g)"}
                    accent="carbs"
                    value={carbs}
                    onChangeText={setCarbs}
                    onFocus={() => measurement.current?.tap()}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    editable={!inputsLocked}
                  />
                </View>
                <View style={styles.macroField}>
                  <Field
                    testID="meal-fat-input"
                    label={per100g ? "Fat (g / 100 g)" : "Fat (g)"}
                    accent="fat"
                    value={fat}
                    onChangeText={setFat}
                    onFocus={() => measurement.current?.tap()}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    editable={!inputsLocked}
                  />
                </View>
              </View>

              <AdvancedNutrientFields
                form={advanced}
                per100g={per100g}
                enabled={advancedCapability.enabled}
                editable={!inputsLocked}
                onChange={(field, value) =>
                  setAdvanced((current) => ({ ...current, [field]: value }))
                }
              />

              {servingPreview !== null ? (
                <View testID="meal-serving-preview" style={styles.field}>
                  <ThemedText type="smallBold">
                    Totals for this portion
                  </ThemedText>
                  {servingPreview.ok ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {[
                        [
                          "Calories",
                          servingPreview.nutrition.caloriesKcal,
                          "kcal",
                        ],
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
            </Card>
          </View>

          {aiDraft !== null ? (
            <View style={styles.section}>
              <SectionHeader title="Refine with AI" />
              <Card style={styles.cardStack}>
                <ThemedText type="small" themeColor="textSecondary">
                  Tell the AI how to adjust the values above — for example “make
                  the chicken 200g instead of 100g”. The form will be re-filled
                  with the refined estimate. Review uncertain values before
                  saving.
                </ThemedText>
                <FormTextInput
                  testID="meal-refine-input"
                  accessibilityLabel="Refine AI meal draft"
                  placeholder="Make the chicken 200g instead of 100g"
                  multiline
                  maxLength={1_000}
                  value={refineInstruction}
                  onChangeText={setRefineInstruction}
                  style={styles.refineInput}
                />
                <Button
                  variant="tinted"
                  icon="sparkles"
                  block
                  testID="meal-refine-button"
                  label="Refine"
                  accessibilityLabel="Refine the AI draft"
                  accessibilityHint="Send the current draft and your instruction to Mizyun. The form will be re-filled with the refined estimate."
                  accessibilityValue={
                    refining ? { text: "Refining draft" } : undefined
                  }
                  loading={refining}
                  disabled={
                    refining ||
                    submitting ||
                    snapping ||
                    refineInstruction.trim().length < 2
                  }
                  onPress={() => {
                    void onRefineDraft();
                  }}
                />
              </Card>
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            {hasContent ? (
              <Button
                variant="secondary"
                testID="clear-meal-button"
                label="Clear"
                accessibilityLabel="Clear meal"
                accessibilityHint="Clears all meal fields, photo, and draft"
                disabled={submitting || snapping || refining}
                onPress={() => {
                  void onClear();
                }}
              />
            ) : null}

            <Button
              variant="primary"
              testID="submit-meal-button"
              label={submitting ? "Saving…" : "Save meal"}
              loading={submitting}
              disabled={!draftLoaded || submitting || snapping || refining}
              accessibilityState={{
                disabled: !draftLoaded || submitting || snapping || refining,
                busy: submitting,
              }}
              onPress={() => {
                void onSubmit();
              }}
              style={styles.submit}
            />
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
  readonly editable?: boolean;
  /** Macro token shown as a dot beside the label. */
  readonly accent?: "protein" | "carbs" | "fat";
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        {props.accent !== undefined ? (
          <View
            style={[styles.accentDot, { backgroundColor: theme[props.accent] }]}
          />
        ) : null}
        <ThemedText
          type="footnote"
          themeColor="textSecondary"
          style={styles.fieldLabel}
        >
          {props.label}
        </ThemedText>
      </View>
      <FormTextInput
        testID={props.testID}
        value={props.value}
        editable={props.editable}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus === true}
        keyboardType={props.keyboardType ?? "default"}
        accessibilityLabel={props.label}
      />
      {props.helperText !== undefined ? (
        <ThemedText type="footnote" themeColor="textTertiary">
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
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  messages: { gap: Spacing.two },
  section: { gap: Spacing.two },
  cardStack: { gap: Spacing.three },
  basisRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  basisChip: { minHeight: MinTouchTarget },
  field: { gap: Spacing.one },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one + Spacing.half,
  },
  fieldLabel: { flexShrink: 1 },
  accentDot: { width: 8, height: 8, borderRadius: Radius.pill },
  description: { minHeight: 76, textAlignVertical: "top" },
  macroRow: { flexDirection: "row", gap: Spacing.two },
  macroField: { flex: 1 },
  actionsRow: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
  },
  submit: { flex: 1 },
  pressed: { opacity: 0.6 },
  photoRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  photoButton: { flex: 1 },
  quotaBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
    paddingVertical: Spacing.one,
  },
  warnings: { gap: Spacing.one },
  refineInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  keepPhotoChoice: {
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  keepPhotoText: { flex: 1, gap: Spacing.half },
  checkOff: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  attachedPhotoCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    borderRadius: Radius.md,
    padding: Spacing.two,
    gap: Spacing.two,
  },
  attachedPhotoImage: {
    width: 56,
    height: 56,
    borderRadius: Radius.sm,
  },
  attachedPhotoInfo: {
    flex: 1,
    minWidth: 110,
    gap: Spacing.half,
  },
  attachedPhotoActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  recentMealsContainer: {
    gap: Spacing.one,
  },
  recentMealsScroll: {
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  recentMealChip: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: MinTouchTarget,
    minWidth: 120,
    gap: Spacing.half,
  },
});
