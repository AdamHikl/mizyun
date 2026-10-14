import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { useLoggingFlowMeasurement } from "@/features/analytics/flow-measurement";

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
  FormField,
  FormStatus,
  FormTextInput,
  Notice,
} from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import {
  classifyAnalyticsFailure,
  isRetryableAnalyticsFailure,
} from "@/features/analytics/classify-failure";
import { lengthUnitLabel } from "@/lib/length-units";
import {
  clearLoggingDraft,
  loadRequiredLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";

import {
  isWeightSubmission,
  prepareWeightSubmission,
  submitLogWeight,
  type WeightSubmission,
} from "./log-weight-data";

export function LogWeightScreen() {
  const { profile, session } = useAuth();
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [chest, setChest] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [loadedGeneration, setLoadedGeneration] = useState(-1);
  const [draftUnitSystem, setDraftUnitSystem] = useState<
    "metric" | "imperial" | null
  >(null);
  const [pending, setPending] = useState<WeightSubmission | null>(null);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const pendingRef = useRef<WeightSubmission | null>(null);
  const submittingRef = useRef(false);
  const completedRef = useRef(false);
  const mountedRef = useRef(true);
  const hadFailure = useRef(false);
  const userId = session?.user.id ?? null;
  const ownerRef = useRef(userId);
  const generationRef = useRef(0);
  if (ownerRef.current !== userId) {
    ownerRef.current = userId;
    generationRef.current++;
  }
  const generation = generationRef.current;
  const measurement = useLoggingFlowMeasurement("body_measurement", userId);
  const profileUnitSystem = profile?.unitSystem ?? "metric";
  const unitSystem =
    loadedOwner === userId && draftUnitSystem !== null
      ? draftUnitSystem
      : profileUnitSystem;
  const unitLabel = unitSystem === "imperial" ? "lb" : "kg";
  const canSave =
    userId !== null &&
    loadedOwner === userId &&
    loadedGeneration === generation;
  const canEdit = canSave && pending === null && !submitting;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setLoadedOwner(null);
    setWeight("");
    setWaist("");
    setChest("");
    setPending(null);
    setDraftUnitSystem(null);
    setSubmitting(false);
    setError(null);
    pendingRef.current = null;
    submittingRef.current = false;
    completedRef.current = false;
    hadFailure.current = false;
    if (userId === null) return;
    let active = true;
    void loadRequiredLoggingDraft(userId, "weight", isWeightDraft)
      .then((draft) => {
        if (!active || generationRef.current !== generation) return;
        if (draft !== null) {
          setWeight(draft.weight);
          setWaist(draft.waist ?? "");
          setChest(draft.chest ?? "");
          setDraftUnitSystem(draft.unitSystem);
          pendingRef.current = draft.pending ?? null;
          setPending(pendingRef.current);
        }
        setLoadedOwner(userId);
        setLoadedGeneration(generation);
      })
      .catch(() => {
        if (active && generationRef.current === generation)
          setError(
            "Your saved measurement could not be recovered. Retry recovery before saving.",
          );
      });
    return () => {
      active = false;
    };
  }, [userId, recoveryAttempt]);

  useEffect(() => {
    if (
      !canSave ||
      userId === null ||
      pendingRef.current !== null ||
      completedRef.current ||
      submittingRef.current
    )
      return;
    void saveLoggingDraft(userId, "weight", {
      version: 1,
      weight,
      waist,
      chest,
      unitSystem,
    });
  }, [chest, canSave, unitSystem, userId, waist, weight]);

  const onSubmit = useCallback(async () => {
    if (
      !canSave ||
      userId === null ||
      ownerRef.current !== userId ||
      generationRef.current !== generation ||
      submittingRef.current ||
      completedRef.current
    )
      return;
    const isCurrent = () =>
      mountedRef.current &&
      ownerRef.current === userId &&
      generationRef.current === generation;
    submittingRef.current = true;
    const attempt = measurement.current;
    attempt?.tap();
    if (hadFailure.current) attempt?.retry();
    setSubmitting(true);
    setError(null);
    try {
      let payload = pendingRef.current;
      if (payload === null) {
        const prepared = prepareWeightSubmission(
          { weight, waist, chest, unitSystem },
          Crypto.randomUUID(),
          new Date().toISOString(),
        );
        if (!prepared.ok) {
          setError(prepared.message);
          attempt?.fail("validation", "invalid_input", false);
          return;
        }
        payload = prepared.payload;
        // Freeze the command synchronously before React renders disabled fields.
        pendingRef.current = payload;
        setPending(payload);
      }
      const stored = await saveLoggingDraft(userId, "weight", {
        version: 1,
        weight,
        waist,
        chest,
        unitSystem,
        pending: payload,
      });
      if (!isCurrent()) return;
      if (!stored) {
        setError(
          "Your measurement could not be saved on this device. Retry when device storage is available; nothing was sent.",
        );
        return;
      }
      const result = await submitLogWeight(payload, {
        expectedUserId: userId,
        isCurrent,
      });
      if (!isCurrent()) return;
      if (result.ok) {
        completedRef.current = true;
        attempt?.complete();
        await clearLoggingDraft(userId, "weight");
        if (isCurrent()) router.back();
        return;
      }
      hadFailure.current = true;
      const reason = classifyAnalyticsFailure(result.message);
      attempt?.fail(
        reason === "invalid_input" ? "validation" : "submit",
        reason,
        isRetryableAnalyticsFailure(reason),
      );
      setError(result.message);
    } catch {
      if (isCurrent()) {
        hadFailure.current = true;
        attempt?.fail("submit", "network", true);
        setError(
          "The save could not be confirmed. Retry the pending measurement when you're online.",
        );
      }
    } finally {
      if (isCurrent()) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }, [canSave, chest, generation, unitSystem, userId, waist, weight]);

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Add weight" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {pending !== null && canSave ? (
            <Notice
              tone="info"
              title="Pending measurement"
              message="A measurement save is pending. Retry the original values to confirm it before recording another measurement."
            />
          ) : null}

          <Card>
            <Field
              testID="body-weight-input"
              label={`Weight (${unitLabel})`}
              value={canSave ? weight : ""}
              editable={canEdit}
              onChangeText={setWeight}
              onFocus={() => measurement.current?.tap()}
              placeholder="72.5"
              keyboardType="numeric"
              autoFocus
            />

            <Field
              testID="body-waist-input"
              label={`Waist (${lengthUnitLabel(unitSystem)}, optional)`}
              value={canSave ? waist : ""}
              editable={canEdit}
              onChangeText={setWaist}
              onFocus={() => measurement.current?.tap()}
              placeholder="81"
              keyboardType="numeric"
            />

            <Field
              testID="body-chest-input"
              label={`Chest (${lengthUnitLabel(unitSystem)}, optional)`}
              value={canSave ? chest : ""}
              editable={canEdit}
              onChangeText={setChest}
              onFocus={() => measurement.current?.tap()}
              placeholder="100"
              keyboardType="numeric"
            />
          </Card>

          <ThemedText type="footnote" themeColor="textSecondary">
            Weight is optional when you only want to record a body measurement.
            Mizyun stores canonical metric values without changing what you see.
          </ThemedText>

          {error !== null ? (
            <FormStatus tone="error">{error}</FormStatus>
          ) : null}

          {!canSave && error !== null ? (
            <Button
              label="Retry draft recovery"
              variant="tinted"
              onPress={() => setRecoveryAttempt((current) => current + 1)}
            />
          ) : null}

          <Button
            label={
              submitting
                ? "Saving…"
                : pending !== null
                  ? "Retry measurement"
                  : "Save measurement"
            }
            variant="primary"
            block
            disabled={submitting || !canSave}
            accessibilityState={{
              disabled: submitting || !canSave,
              busy: submitting,
            }}
            onPress={() => {
              void onSubmit();
            }}
          />
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
  readonly autoFocus?: boolean;
  readonly keyboardType?: "default" | "numeric";
  readonly editable: boolean;
}) {
  return (
    <FormField label={props.label}>
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
});

interface WeightDraft {
  readonly version?: 1;
  readonly weight: string;
  readonly waist?: string;
  readonly chest?: string;
  readonly unitSystem: "metric" | "imperial";
  readonly pending?: WeightSubmission;
}

const isWeightDraft = (value: unknown): value is WeightDraft =>
  typeof value === "object" &&
  value !== null &&
  (!("version" in value) || value.version === 1) &&
  "weight" in value &&
  typeof value.weight === "string" &&
  "unitSystem" in value &&
  (value.unitSystem === "metric" || value.unitSystem === "imperial") &&
  (!("waist" in value) || typeof value.waist === "string") &&
  (!("chest" in value) || typeof value.chest === "string") &&
  (!("pending" in value) || isWeightSubmission(value.pending));
