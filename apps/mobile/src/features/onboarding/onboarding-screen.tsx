import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyAnalyticsFailure } from "@/features/analytics/classify-failure";
import { OnboardingMeasurement } from "./onboarding-measurement";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BetaProStatus } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BrandWordmark } from "@/components/brand-wordmark";
import {
  Button,
  Card,
  ChoiceChip,
  ChoiceGroup,
  FormField,
  FormTextInput,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
} from "@/components/ui";
import { apiClient } from "@/composition/api-client";
import { analyticsClient } from "@/composition/analytics-client";
import { MaxContentWidth, PageGutter, Spacing } from "@/constants/theme";
import { useOptionalAuth } from "@/features/auth/auth-context";
import {
  fetchBetaProStatus,
  requestBetaProPass,
} from "@/features/beta-pro/beta-pro-client";
import { weightUnitLabel } from "@/lib/weight-units";
import { lengthUnitLabel } from "@/lib/length-units";

import {
  applyOnboardingPatch,
  freshOnboardingForm,
  nextStep,
  previousStep,
  validateStep,
  type OnboardingForm,
  type OnboardingPatch,
  type OnboardingStep,
} from "./onboarding-state";
import { submitOnboarding } from "./submit-onboarding";
import { AnalyticsConsentPrompt } from "@/features/analytics/analytics-consent-prompt";

interface OnboardingScreenProps {
  /**
   * Called when the user has completed the final step and the API
   * writes have succeeded. The parent (typically `SessionGate`)
   * transitions to the regular tabs.
   */
  readonly onComplete: () => void;
  /**
   * Optional callback to pause/exit onboarding and return to the main app.
   */
  readonly onExit?: () => void;
}

export function OnboardingScreen({
  onComplete,
  onExit,
}: OnboardingScreenProps) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [form, setForm] = useState<OnboardingForm>(() =>
    freshOnboardingForm(new Date()),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const auth = useOptionalAuth();
  const owner = auth?.session?.user.id ?? null;
  const measurement = useRef<OnboardingMeasurement | null>(null);
  const measurementOwner = useRef(owner);
  if (measurementOwner.current !== owner) {
    measurement.current = null;
    measurementOwner.current = owner;
  }
  const beginMeasurement = useCallback(() => {
    let cancelled = false;
    let scope;
    try {
      scope = analyticsClient.createFlowScope();
    } catch {
      return () => undefined;
    }
    void analyticsClient
      .getConsent()
      .then((consent) => {
        if (
          !cancelled &&
          owner !== null &&
          measurementOwner.current === owner &&
          consent === "granted" &&
          measurement.current === null
        ) {
          measurement.current = new OnboardingMeasurement(
            analyticsClient,
            scope,
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [owner]);
  useEffect(beginMeasurement, [beginMeasurement]);
  const exitSetup = useCallback(() => {
    measurement.current?.exit(step);
    onExit?.();
  }, [step, onExit]);

  const validationError = useMemo(() => validateStep(step, form), [step, form]);
  const canContinue = validationError === null && !busy;

  const onAdvance = useCallback(async () => {
    const attempt = measurement.current;
    attempt?.tap();
    const next = nextStep(step);
    if (next === null) {
      // Final step — submit to the API.
      setBusy(true);
      setError(null);
      try {
        const result = await submitOnboarding(form, apiClient);
        if (result.ok) {
          attempt?.stepCompleted(step);
          attempt?.complete();
          onComplete();
        } else {
          attempt?.fail(step, classifyAnalyticsFailure(result.message));
          setError(result.message);
        }
      } catch {
        attempt?.fail(step, "unexpected");
        setError("Could not finish setup. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    attempt?.stepCompleted(step);
    setStep(next);
  }, [step, form, onComplete]);

  const onBack = useCallback(() => {
    measurement.current?.tap();
    const prev = previousStep(step);
    if (prev !== null) setStep(prev);
  }, [step]);

  const patch = useCallback((p: OnboardingPatch) => {
    setForm((current) => applyOnboardingPatch(current, p));
  }, []);

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <BrandWordmark />
              {onExit ? (
                <IconButton
                  icon="close"
                  accessibilityLabel="Exit setup"
                  onPress={exitSetup}
                />
              ) : null}
            </View>
            <ThemedText type="subtitle">{titleFor(step)}</ThemedText>
            <ThemedText themeColor="textSecondary">
              {subtitleFor(step)}
            </ThemedText>
          </View>

          <StepBody
            step={step}
            form={form}
            onPatch={patch}
            error={validationError}
          />

          {step === "welcome" ? (
            <AnalyticsConsentPrompt onConsentSaved={beginMeasurement} />
          ) : null}

          {error ? <Notice tone="danger" message={error} /> : null}

          <View style={styles.actions}>
            {step !== "welcome" ? (
              <Button
                label="Back"
                variant="secondary"
                disabled={busy}
                onPress={onBack}
                style={styles.secondaryAction}
              />
            ) : onExit ? (
              <Button
                label="Explore first"
                variant="secondary"
                disabled={busy}
                onPress={exitSetup}
                style={styles.secondaryAction}
              />
            ) : null}
            <Button
              accessibilityLabel={isFinalStep(step) ? "Finish" : "Continue"}
              label={isFinalStep(step) ? "Finish" : "Continue"}
              loading={busy}
              disabled={!canContinue}
              onPress={() => {
                void onAdvance();
              }}
              style={styles.primaryAction}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

interface StepBodyProps {
  readonly step: OnboardingStep;
  readonly form: OnboardingForm;
  readonly onPatch: (patch: OnboardingPatch) => void;
  readonly error: string | null;
}

function StepBody({ step, form, onPatch, error }: StepBodyProps) {
  switch (step) {
    case "welcome":
      return <WelcomeBody />;
    case "displayName":
      return (
        <DisplayNameBody
          value={form.displayName}
          onChange={(value) => onPatch({ field: "displayName", value })}
          error={error}
        />
      );
    case "units":
      return (
        <UnitsBody
          value={form.unitSystem}
          onChange={(value) => onPatch({ field: "unitSystem", value })}
        />
      );
    case "baselineWeight":
      return (
        <WeightBody
          label={`Current weight (${weightUnitLabel(form.unitSystem)})`}
          value={form.baselineWeight}
          onChange={(value) => onPatch({ field: "baselineWeight", value })}
          error={error}
          supportingText="This becomes your first confirmed measurement and gives future trends a real starting point."
        />
      );
    case "energyProfile":
      return <EnergyProfileBody form={form} onPatch={onPatch} error={error} />;
    case "primaryGoal":
      return <PrimaryGoalBody form={form} onPatch={onPatch} error={error} />;
  }
}

function WelcomeBody() {
  const auth = useOptionalAuth();
  const isPaid = auth?.profile?.planTier === "paid";
  const [betaStatus, setBetaStatus] = useState<BetaProStatus | null>(null);
  const [requesting, setRequesting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void fetchBetaProStatus(apiClient)
      .then((res) => {
        if (mountedRef.current) {
          setBetaStatus(res.ok ? res.value.status : "none");
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setBetaStatus("none");
        }
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestBetaPro = useCallback(async () => {
    setRequesting(true);
    try {
      const result = await requestBetaProPass(apiClient);
      if (!mountedRef.current) return;

      if (result.ok) {
        setBetaStatus("pending");
        Alert.alert(
          "Request Sent",
          "Your Launch Pro Pass request has been submitted. You'll be notified when it's reviewed.",
        );
      } else {
        Alert.alert(
          "Request Failed",
          "Could not submit Launch Pro Pass request. Try again later.",
        );
      }
    } catch {
      if (mountedRef.current) {
        Alert.alert(
          "Request Failed",
          "Could not submit Launch Pro Pass request. Try again later.",
        );
      }
    } finally {
      if (mountedRef.current) {
        setRequesting(false);
      }
    }
  }, []);

  return (
    <View style={styles.body}>
      <ThemedText>
        Mizyun tracks your daily energy, training, and weight against a single
        primary goal so the math stays honest. Set up your starting point in
        five short steps.
      </ThemedText>

      <Card>
        <View style={styles.betaHeaderRow}>
          <Icon name="sparkles" size={15} color="primary" />
          <ThemedText type="smallBold" themeColor="primary">
            Launch Pro Pass
          </ThemedText>
        </View>
        <ThemedText type="smallBold">
          Request free Pro access as an early Mizyun user.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Pro includes higher AI usage limits for meal photo drafts and
          coaching. Requests are reviewed before access is granted. We’d love
          your feedback.
        </ThemedText>

        <View style={styles.betaActionRow}>
          {isPaid || betaStatus === "approved" ? (
            <Notice tone="success" message="Launch Pro Pass active" />
          ) : betaStatus === "pending" ? (
            <Notice tone="info" message="Request pending" />
          ) : (
            <Button
              accessibilityLabel="Request free Pro access with Launch Pro Pass"
              label={
                betaStatus === null
                  ? "Checking pass…"
                  : "Request free Pro access"
              }
              variant="tinted"
              block
              loading={requesting}
              disabled={requesting || betaStatus === null}
              onPress={() => void requestBetaPro()}
            />
          )}
        </View>
      </Card>

      <ThemedText type="small" themeColor="textSecondary">
        You can change any profile detail later from the Account tab.
      </ThemedText>
    </View>
  );
}

interface DisplayNameBodyProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly error: string | null;
}

function DisplayNameBody({ value, onChange, error }: DisplayNameBodyProps) {
  return (
    <View style={styles.body}>
      <FormField label="Display name">
        <FormTextInput
          accessibilityLabel="Display name"
          autoCapitalize="words"
          autoCorrect={false}
          textContentType="nickname"
          value={value}
          onChangeText={onChange}
        />
      </FormField>
      {error ? (
        <ThemedText type="footnote" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

interface UnitsBodyProps {
  readonly value: "metric" | "imperial";
  readonly onChange: (next: "metric" | "imperial") => void;
}

function UnitsBody({ value, onChange }: UnitsBodyProps) {
  return (
    <View style={styles.body}>
      <ThemedText type="small" themeColor="textSecondary">
        Mizyun stores weight in kilograms. Pick the unit for what you see in the
        app and what you enter at the scale.
      </ThemedText>
      <ListGroup>
        <SelectRow
          label="Metric (kg, cm)"
          selected={value === "metric"}
          onPress={() => onChange("metric")}
        />
        <SelectRow
          label="Imperial (lb, in)"
          selected={value === "imperial"}
          onPress={() => onChange("imperial")}
        />
      </ListGroup>
    </View>
  );
}

interface WeightBodyProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly error: string | null;
  readonly supportingText: string;
}

function WeightBody({
  label,
  value,
  onChange,
  error,
  supportingText,
}: WeightBodyProps) {
  return (
    <View style={styles.body}>
      <ThemedText type="small" themeColor="textSecondary">
        {supportingText}
      </ThemedText>
      <FormField label={label}>
        <FormTextInput
          accessibilityLabel={label}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={onChange}
        />
      </FormField>
      {error ? (
        <ThemedText
          accessibilityRole="alert"
          type="footnote"
          themeColor="danger"
        >
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

function EnergyProfileBody(props: {
  readonly form: OnboardingForm;
  readonly onPatch: (patch: OnboardingPatch) => void;
  readonly error: string | null;
}) {
  const { form, onPatch, error } = props;
  return (
    <View style={styles.body}>
      <ThemedText type="small" themeColor="textSecondary">
        These confirmed inputs are used only by the deterministic energy
        formula. They are not a diagnosis and can be changed later.
      </ThemedText>
      <FormField label={`Height (${lengthUnitLabel(form.unitSystem)})`}>
        <FormTextInput
          accessibilityLabel={`Height (${lengthUnitLabel(form.unitSystem)})`}
          keyboardType="decimal-pad"
          value={form.height}
          onChangeText={(value) => onPatch({ field: "height", value })}
        />
      </FormField>
      <FormField label="Birth year">
        <FormTextInput
          accessibilityLabel="Birth year"
          keyboardType="number-pad"
          value={form.birthYear}
          onChangeText={(value) => onPatch({ field: "birthYear", value })}
        />
      </FormField>
      <FormField label="Formula sex input">
        <ChoiceGroup>
          <ChoiceChip
            label="Female"
            selected={form.sexAtBirth === "female"}
            onPress={() => onPatch({ field: "sexAtBirth", value: "female" })}
          />
          <ChoiceChip
            label="Male"
            selected={form.sexAtBirth === "male"}
            onPress={() => onPatch({ field: "sexAtBirth", value: "male" })}
          />
        </ChoiceGroup>
      </FormField>
      <ThemedText type="footnote" themeColor="textSecondary">
        Usual activity
      </ThemedText>
      <ListGroup>
        {(
          [
            ["Sedentary", "sedentary"],
            ["Lightly active", "lightly_active"],
            ["Moderately active", "moderately_active"],
            ["Very active", "very_active"],
            ["Extra active", "extra_active"],
          ] as const
        ).map(([label, value]) => (
          <SelectRow
            key={value}
            label={label}
            selected={form.activityLevel === value}
            onPress={() => onPatch({ field: "activityLevel", value })}
          />
        ))}
      </ListGroup>
      {error ? (
        <ThemedText
          accessibilityRole="alert"
          type="footnote"
          themeColor="danger"
        >
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

interface SelectRowProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}

/** A single-select option in an inset grouped list, checked when selected. */
function SelectRow({ label, selected, onPress }: SelectRowProps) {
  return (
    <ListRow
      title={label}
      chevron={false}
      accessibilityState={{ selected }}
      trailing={
        selected ? <Icon name="check" size={17} color="primary" /> : null
      }
      onPress={onPress}
    />
  );
}

interface PrimaryGoalBodyProps {
  readonly form: OnboardingForm;
  readonly onPatch: (patch: OnboardingPatch) => void;
  readonly error: string | null;
}

function PrimaryGoalBody({ form, onPatch, error }: PrimaryGoalBodyProps) {
  return (
    <View style={styles.body}>
      <ListGroup>
        <SelectRow
          label="Cut — lose body mass"
          selected={form.goalKind === "cut"}
          onPress={() => onPatch({ field: "goalKind", value: "cut" })}
        />
        <SelectRow
          label="Bulk — gain muscle mass"
          selected={form.goalKind === "bulk"}
          onPress={() => onPatch({ field: "goalKind", value: "bulk" })}
        />
        <SelectRow
          label="Recomp — redistribute mass"
          selected={form.goalKind === "recomp"}
          onPress={() => onPatch({ field: "goalKind", value: "recomp" })}
        />
        <SelectRow
          label="Maintain — hold current mass"
          selected={form.goalKind === "maintain"}
          onPress={() => onPatch({ field: "goalKind", value: "maintain" })}
        />
      </ListGroup>

      <FormField label={`Goal weight (${weightUnitLabel(form.unitSystem)})`}>
        <FormTextInput
          accessibilityLabel={`Goal weight (${weightUnitLabel(form.unitSystem)})`}
          keyboardType="decimal-pad"
          value={form.goalWeight}
          onChangeText={(value) => onPatch({ field: "goalWeight", value })}
        />
      </FormField>
      {error ? (
        <ThemedText type="footnote" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const isFinalStep = (step: OnboardingStep): boolean => nextStep(step) === null;

const titleFor = (step: OnboardingStep): string => {
  switch (step) {
    case "welcome":
      return "Set up Mizyun";
    case "displayName":
      return "What should we call you?";
    case "units":
      return "Pick your units";
    case "baselineWeight":
      return "Add your starting point";
    case "energyProfile":
      return "Complete the energy inputs";
    case "primaryGoal":
      return "Set a primary goal";
  }
};

const subtitleFor = (step: OnboardingStep): string => {
  switch (step) {
    case "welcome":
      return "Five short steps.";
    case "displayName":
      return "Shown on the dashboard and in coach messages.";
    case "units":
      return "Stored as kilograms; displayed in your choice.";
    case "baselineWeight":
      return "A confirmed baseline makes progress measurable.";
    case "energyProfile":
      return "Your inputs keep the estimate inspectable and reproducible.";
    case "primaryGoal":
      return "Drives the energy model until you change it.";
  }
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  header: { gap: Spacing.two },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
  },
  body: { gap: Spacing.three },
  betaHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  betaActionRow: { marginTop: Spacing.two },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
    marginTop: Spacing.two,
  },
  secondaryAction: { flex: 1, alignSelf: "stretch" },
  primaryAction: { flex: 2, alignSelf: "stretch" },
});
