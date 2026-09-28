import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import { bucketDuration, bucketTaps } from "@mizyun/observability";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BetaProStatus } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BrandWordmark } from "@/components/brand-wordmark";
import { BetaNoticeCard } from "@/components/beta-notice";
import { apiClient } from "@/composition/api-client";
import { analyticsClient } from "@/composition/analytics-client";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useOptionalAuth } from "@/features/auth/auth-context";
import {
  fetchBetaProStatus,
  requestBetaProPass,
  requestSetupNotificationPermission,
  registerDevicePushToken,
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
  const startedAt = useRef(Date.now());
  const taps = useRef(0);

  const validationError = useMemo(() => validateStep(step, form), [step, form]);
  const canContinue = validationError === null && !busy;

  const onAdvance = useCallback(async () => {
    taps.current += 1;
    const next = nextStep(step);
    if (next === null) {
      // Final step — submit to the API.
      setBusy(true);
      setError(null);
      try {
        const result = await submitOnboarding(form, apiClient);
        if (result.ok) {
          void analyticsClient.track({
            name: "onboarding_completed",
            properties: {
              duration: bucketDuration(Date.now() - startedAt.current),
              taps: bucketTaps(taps.current),
            },
          });
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
    taps.current += 1;
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
              <BrandWordmark suffix="SETUP" />
              {onExit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Exit setup"
                  onPress={onExit}
                  style={styles.exitButton}
                >
                  <ThemedText type="smallBold" style={styles.exitButtonText}>
                    ✕ Exit / Explore
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
            <ThemedText type="subtitle">{titleFor(step)}</ThemedText>
            <ThemedText themeColor="textSecondary">
              {subtitleFor(step)}
            </ThemedText>
          </View>

          {step === "welcome" ? <NotificationPermissionPrompt /> : null}

          <StepBody
            step={step}
            form={form}
            onPatch={patch}
            error={validationError}
          />

          {step === "welcome" ? <AnalyticsConsentPrompt /> : null}

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
            ) : onExit ? (
              <Pressable
                accessibilityRole="button"
                onPress={onExit}
                disabled={busy}
                style={styles.secondaryButton}
              >
                <ThemedText type="smallBold">Explore First</ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isFinalStep(step) ? "Finish" : "Continue"}
              disabled={!canContinue}
              onPress={() => {
                void onAdvance();
              }}
              style={[
                styles.primaryButton,
                step === "welcome" && styles.primaryButtonFullWidth,
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

function NotificationPermissionPrompt() {
  const [permission, setPermission] = useState<
    "loading" | "available" | "granted" | "settings" | "busy"
  >("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Notifications.getPermissionsAsync()
      .then((result) => {
        if (active) {
          setPermission(
            result.granted
              ? "granted"
              : result.canAskAgain
                ? "available"
                : "settings",
          );
        }
      })
      .catch(() => {
        if (active) setPermission("available");
      });
    return () => {
      active = false;
    };
  }, []);

  const enable = useCallback(async () => {
    setPermission("busy");
    setMessage(null);
    try {
      const result = await requestSetupNotificationPermission();
      if (result === "granted") {
        setPermission("granted");
        void registerDevicePushToken(apiClient);
      } else {
        const current = await Notifications.getPermissionsAsync();
        setPermission(current.canAskAgain ? "available" : "settings");
        setMessage("Notifications are off. You can still finish setup.");
      }
    } catch {
      setPermission("available");
      setMessage("Could not check notification access. Try again later.");
    }
  }, []);

  return (
    <ThemedView type="backgroundElement" style={styles.analyticsPrompt}>
      <ThemedText type="smallBold">Get useful updates</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Allow notifications for your Beta Pro Pass decision, workout alerts, and
        reminders you choose later. You can change this in device settings.
      </ThemedText>
      {permission === "granted" ? (
        <ThemedText type="smallBold">✓ Notifications enabled</ThemedText>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            permission === "settings"
              ? "Open notification settings"
              : "Enable notifications"
          }
          disabled={permission === "loading" || permission === "busy"}
          onPress={() => {
            if (permission === "settings") {
              void Linking.openSettings();
            } else {
              void enable();
            }
          }}
          style={styles.analyticsChoice}
        >
          <ThemedText type="smallBold">
            {permission === "settings"
              ? "Open Settings"
              : permission === "busy"
                ? "Checking…"
                : "Enable notifications"}
          </ThemedText>
        </Pressable>
      )}
      {message ? (
        <ThemedText type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

function AnalyticsConsentPrompt() {
  const [consent, setConsent] = useState<
    "loading" | "unknown" | "granted" | "denied"
  >("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void analyticsClient.getConsent().then(setConsent);
  }, []);

  const choose = useCallback(async (next: "granted" | "denied") => {
    const saved = await analyticsClient.setConsent(next);
    setConsent(saved ? next : "unknown");
    setMessage(
      saved
        ? next === "granted"
          ? "Optional analytics enabled. You can disable and clear it in Account."
          : "Optional analytics is off. Mizyun works the same way."
        : "The preference could not be saved, so analytics remains off.",
    );
  }, []);

  return (
    <ThemedView type="backgroundElement" style={styles.analyticsPrompt}>
      <ThemedText type="smallBold">Optional product analytics</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Help improve Mizyun by sharing which features and screens you use,
        whether actions succeed, and coarse time ranges. These optional events
        are sent to Mizyun's servers to help improve the app UI and experience,
        and are linked to your account for export and deletion. They never
        include food text, health measurements, photos, messages, or typed
        content. You can change this anytime in Account. Core features work the
        same either way.
      </ThemedText>
      <View style={styles.analyticsChoiceRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: consent === "granted" }}
          disabled={consent === "loading"}
          onPress={() => void choose("granted")}
          style={styles.analyticsChoice}
        >
          <ThemedText type="smallBold">
            {consent === "granted" ? "✓ Enabled" : "Enable"}
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: consent === "denied" }}
          disabled={consent === "loading"}
          onPress={() => void choose("denied")}
          style={styles.analyticsChoice}
        >
          <ThemedText type="smallBold">
            {consent === "denied" ? "✓ Keep off" : "Keep off"}
          </ThemedText>
        </Pressable>
      </View>
      {message !== null ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
        >
          {message}
        </ThemedText>
      ) : null}
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
          "Your Beta Pro Pass request has been submitted. You'll be notified when it's reviewed.",
        );
      } else {
        Alert.alert(
          "Request Failed",
          "Could not submit Beta Pro request. Try again later.",
        );
      }
    } catch {
      if (mountedRef.current) {
        Alert.alert(
          "Request Failed",
          "Could not submit Beta Pro request. Try again later.",
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
      <ThemedText style={styles.paragraph}>
        Mizyun tracks your daily energy, training, and weight against a single
        primary goal so the math stays honest. Set up your starting point in
        five short steps.
      </ThemedText>

      <BetaNoticeCard />

      <ThemedView type="backgroundElement" style={styles.betaCard}>
        <View style={styles.betaHeaderRow}>
          <ThemedText style={styles.betaBadge}>✨ BETA PRO PASS</ThemedText>
        </View>
        <ThemedText type="smallBold">
          Full complimentary Pro access included during the testing period.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Enjoy AI meal photo drafts, full 880+ workout routines, and
          memory-aware coaching.
        </ThemedText>

        <View style={styles.betaActionRow}>
          {isPaid || betaStatus === "approved" ? (
            <View style={styles.approvedBadge}>
              <ThemedText type="smallBold" style={styles.approvedBadgeText}>
                ✨ Beta Pro Pass Active
              </ThemedText>
            </View>
          ) : betaStatus === "pending" ? (
            <View style={styles.pendingBadge}>
              <ThemedText type="smallBold" style={styles.pendingBadgeText}>
                ⏳ Request Pending
              </ThemedText>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Request Beta Pro Pass"
              accessibilityState={{
                disabled: requesting || betaStatus === null,
                busy: requesting,
              }}
              disabled={requesting || betaStatus === null}
              onPress={() => void requestBetaPro()}
              style={({ pressed }) => [
                styles.betaRequestButton,
                pressed && styles.pressed,
                (requesting || betaStatus === null) &&
                  styles.betaRequestButtonDisabled,
              ]}
            >
              {requesting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <ThemedText
                  type="smallBold"
                  style={styles.betaRequestButtonText}
                >
                  {betaStatus === null
                    ? "Checking Pass…"
                    : "Request Beta Pro Pass"}
                </ThemedText>
              )}
            </Pressable>
          )}
        </View>
      </ThemedView>

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
      <ThemedText style={styles.label}>Display name</ThemedText>
      <TextInput
        autoCapitalize="words"
        autoCorrect={false}
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
        style={styles.input}
      />
      <ThemedText style={styles.label}>Birth year</ThemedText>
      <TextInput
        accessibilityLabel="Birth year"
        keyboardType="number-pad"
        value={form.birthYear}
        onChangeText={(value) => onPatch({ field: "birthYear", value })}
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
          label="Bulk — gain muscle mass"
          selected={form.goalKind === "bulk"}
          onPress={() => onPatch({ field: "goalKind", value: "bulk" })}
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
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.five,
  },
  header: { gap: Spacing.two },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  exitButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.12)",
  },
  exitButtonText: {
    color: "#8A8D91",
    fontSize: 12,
  },
  body: { gap: Spacing.three },
  betaCard: {
    borderRadius: 14,
    padding: Spacing.four,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  betaHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  betaBadge: {
    fontSize: 11,
    fontWeight: "800",
    color: "#059669",
    letterSpacing: 0.8,
  },
  analyticsPrompt: {
    borderRadius: 14,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  analyticsChoiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  analyticsChoice: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: Spacing.four,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
  },
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
  primaryButtonFullWidth: {
    flex: 1,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  betaActionRow: {
    marginTop: Spacing.two,
  },
  betaRequestButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#10B981",
  },
  betaRequestButtonText: {
    color: "#ffffff",
    fontSize: 15,
  },
  betaRequestButtonDisabled: {
    opacity: 0.6,
  },
  pendingBadge: {
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.35)",
    backgroundColor: "rgba(234, 179, 8, 0.08)",
  },
  pendingBadgeText: {
    color: "#CA8A04",
    fontSize: 13,
  },
  approvedBadge: {
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  approvedBadgeText: {
    color: "#059669",
    fontSize: 13,
  },
  pressed: {
    opacity: 0.75,
  },
});
