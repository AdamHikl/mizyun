import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { apiClient } from "@/composition/api-client";
import { MaxContentWidth, Spacing } from "@/constants/theme";
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

interface OnboardingScreenProps {
  /**
   * Called when the user has completed the final step and the API
   * writes have succeeded. The parent (typically `SessionGate`)
   * transitions to the regular tabs.
   */
  readonly onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [form, setForm] = useState<OnboardingForm>(() =>
    freshOnboardingForm(new Date()),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validationError = useMemo(() => validateStep(step, form), [step, form]);
  const canContinue = validationError === null && !busy;

  const onAdvance = useCallback(async () => {
    const next = nextStep(step);
    if (next === null) {
      // Final step — submit to the API.
      setBusy(true);
      setError(null);
      try {
        const result = await submitOnboarding(form, apiClient);
        if (result.ok) {
          onComplete();
        } else {
          setError(result.message);
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep(next);
  }, [step, form, onComplete]);

  const onBack = useCallback(() => {
    const prev = previousStep(step);
    if (prev !== null) setStep(prev);
  }, [step]);

  const patch = useCallback((p: OnboardingPatch) => {
    setForm((current) => applyOnboardingPatch(current, p));
  }, []);

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              WELCOME
            </ThemedText>
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

          {error ? (
            <ThemedText style={styles.apiError}>{error}</ThemedText>
          ) : null}

          <View style={styles.actions}>
            {step !== "welcome" ? (
              <Pressable
                accessibilityRole="button"
                onPress={onBack}
                disabled={busy}
                style={styles.secondaryButton}
              >
                <ThemedText type="smallBold">Back</ThemedText>
              </Pressable>
            ) : (
              <View style={styles.secondaryButton} />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isFinalStep(step) ? "Finish" : "Continue"}
              disabled={!canContinue}
              onPress={() => {
                void onAdvance();
              }}
              style={[
                styles.primaryButton,
                !canContinue && styles.primaryButtonDisabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.primaryButtonText}>
                  {isFinalStep(step) ? "Finish" : "Continue"}
                </ThemedText>
              )}
            </Pressable>
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
  return (
    <View style={styles.body}>
      <ThemedText style={styles.paragraph}>
        Mizyun tracks your daily energy, training, and weight against a single
        primary goal so the math stays honest. Set up your starting point in
        five short steps.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        You can change anything later from the Account tab.
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
      <ThemedText style={styles.label}>Display name</ThemedText>
      <TextInput
        autoCapitalize="words"
        autoCorrect={false}
        placeholder="Adam"
        value={value}
        onChangeText={onChange}
        style={styles.input}
      />
      {error ? (
        <ThemedText style={styles.fieldError}>{error}</ThemedText>
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
      <ThemedText style={styles.label}>Units</ThemedText>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        style={styles.paragraph}
      >
        Mizyun stores weight in kilograms. Pick the unit for what you see in the
        app and what you enter at the scale.
      </ThemedText>
      <View style={styles.choiceRow}>
        <UnitChoice
          label="Metric (kg, cm)"
          selected={value === "metric"}
          onPress={() => onChange("metric")}
        />
        <UnitChoice
          label="Imperial (lb, in)"
          selected={value === "imperial"}
          onPress={() => onChange("imperial")}
        />
      </View>
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
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        keyboardType="decimal-pad"
        placeholder="72.5"
        value={value}
        onChangeText={onChange}
        style={styles.input}
      />
      {error ? (
        <ThemedText accessibilityRole="alert" style={styles.fieldError}>
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
      <ThemedText style={styles.label}>
        Height ({lengthUnitLabel(form.unitSystem)})
      </ThemedText>
      <TextInput
        accessibilityLabel={`Height (${lengthUnitLabel(form.unitSystem)})`}
        keyboardType="decimal-pad"
        value={form.height}
        onChangeText={(value) => onPatch({ field: "height", value })}
        placeholder={form.unitSystem === "imperial" ? "70" : "178"}
        style={styles.input}
      />
      <ThemedText style={styles.label}>Birth year</ThemedText>
      <TextInput
        accessibilityLabel="Birth year"
        keyboardType="number-pad"
        value={form.birthYear}
        onChangeText={(value) => onPatch({ field: "birthYear", value })}
        placeholder="1995"
        style={styles.input}
      />
      <ThemedText style={styles.label}>Formula sex input</ThemedText>
      <View style={styles.choiceRow}>
        <KindChoice
          label="Female"
          selected={form.sexAtBirth === "female"}
          onPress={() => onPatch({ field: "sexAtBirth", value: "female" })}
        />
        <KindChoice
          label="Male"
          selected={form.sexAtBirth === "male"}
          onPress={() => onPatch({ field: "sexAtBirth", value: "male" })}
        />
      </View>
      <ThemedText style={styles.label}>Usual activity</ThemedText>
      <View style={styles.choiceColumn}>
        {(
          [
            ["Sedentary", "sedentary"],
            ["Lightly active", "lightly_active"],
            ["Moderately active", "moderately_active"],
            ["Very active", "very_active"],
            ["Extra active", "extra_active"],
          ] as const
        ).map(([label, value]) => (
          <KindChoice
            key={value}
            label={label}
            selected={form.activityLevel === value}
            onPress={() => onPatch({ field: "activityLevel", value })}
          />
        ))}
      </View>
      {error ? (
        <ThemedText accessibilityRole="alert" style={styles.fieldError}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

interface UnitChoiceProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}

function UnitChoice({ label, selected, onPress }: UnitChoiceProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
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
      <ThemedText style={styles.label}>Primary goal</ThemedText>
      <View style={styles.choiceColumn}>
        <KindChoice
          label="Cut — lose body mass"
          selected={form.goalKind === "cut"}
          onPress={() => onPatch({ field: "goalKind", value: "cut" })}
        />
        <KindChoice
          label="Recomp — redistribute mass"
          selected={form.goalKind === "recomp"}
          onPress={() => onPatch({ field: "goalKind", value: "recomp" })}
        />
        <KindChoice
          label="Maintain — hold current mass"
          selected={form.goalKind === "maintain"}
          onPress={() => onPatch({ field: "goalKind", value: "maintain" })}
        />
      </View>

      <ThemedText style={[styles.label, styles.labelGap]}>
        Goal weight ({weightUnitLabel(form.unitSystem)})
      </ThemedText>
      <TextInput
        accessibilityLabel={`Goal weight (${weightUnitLabel(form.unitSystem)})`}
        keyboardType="decimal-pad"
        placeholder="78.0"
        value={form.goalWeight}
        onChangeText={(value) => onPatch({ field: "goalWeight", value })}
        style={styles.input}
      />
      {error ? (
        <ThemedText style={styles.fieldError}>{error}</ThemedText>
      ) : null}
    </View>
  );
}

interface KindChoiceProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}

function KindChoice({ label, selected, onPress }: KindChoiceProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
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
      return "Three short steps.";
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
  safeArea: { flex: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.five,
  },
  header: { gap: Spacing.two },
  body: { gap: Spacing.three },
  paragraph: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  labelGap: { marginTop: Spacing.three },
  input: {
    backgroundColor: "#fff",
    borderColor: "#d6ded8",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
  },
  fieldError: { color: "#a13a25" },
  apiError: { color: "#a13a25", lineHeight: 20 },
  choiceColumn: { gap: Spacing.two },
  choiceRow: { flexDirection: "row", gap: Spacing.two },
  choice: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: Spacing.four,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
  },
  choiceSelected: {
    backgroundColor: "#18633d",
    borderColor: "#18633d",
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
    marginTop: Spacing.four,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
  },
  primaryButton: {
    flex: 2,
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#18633d",
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
