import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { apiClient } from "@/composition/api-client";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { lengthUnitLabel } from "@/lib/length-units";

import {
  energyProfileFormFromProfile,
  saveEnergyProfile,
  validateEnergyProfileForm,
  type EnergyProfileForm,
} from "./energy-profile-data";

const EMPTY_FORM: EnergyProfileForm = {
  height: "",
  birthYear: "",
  activityLevel: null,
  sexAtBirth: null,
};

const ACTIVITY_CHOICES = [
  ["Sedentary", "sedentary"],
  ["Lightly active", "lightly_active"],
  ["Moderately active", "moderately_active"],
  ["Very active", "very_active"],
  ["Extra active", "extra_active"],
] as const;

export function EnergyProfileScreen() {
  const { profile, refreshProfile } = useAuth();
  const theme = useTheme();
  const [form, setForm] = useState<EnergyProfileForm>(EMPTY_FORM);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const unitSystem = profile?.unitSystem ?? "metric";

  useEffect(() => {
    if (profile === null || profile.userId === loadedUserId) return;
    setForm(energyProfileFormFromProfile(profile));
    setLoadedUserId(profile.userId);
  }, [loadedUserId, profile]);

  const validation = useMemo(
    () => validateEnergyProfileForm(form, unitSystem, new Date().getFullYear()),
    [form, unitSystem],
  );

  const patch = useCallback(
    <K extends keyof EnergyProfileForm>(
      field: K,
      value: EnergyProfileForm[K],
    ) => setForm((current) => ({ ...current, [field]: value })),
    [],
  );

  const onSave = useCallback(async () => {
    if (!validation.ok) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await saveEnergyProfile(apiClient, validation.patch);
    if (!result.ok) {
      setSubmitting(false);
      setSubmitError(result.message);
      return;
    }
    await refreshProfile();
    setSubmitting(false);
    router.back();
  }, [refreshProfile, validation]);

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Energy inputs" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="subtitle">
            Make the estimate inspectable.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Mizyun uses these confirmed inputs in a deterministic formula. The
            result is an estimate, not medical advice, and no value is guessed
            when an input is missing.
          </ThemedText>

          <Field
            label={`Height (${lengthUnitLabel(unitSystem)})`}
            value={form.height}
            onChangeText={(value) => patch("height", value)}
            placeholder={unitSystem === "imperial" ? "70" : "178"}
            inputColor={theme.text}
          />
          <Field
            label="Birth year"
            value={form.birthYear}
            onChangeText={(value) => patch("birthYear", value)}
            placeholder="1990"
            inputColor={theme.text}
          />

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Formula sex input
            </ThemedText>
            <View style={styles.choiceRow}>
              <Choice
                label="Female"
                selected={form.sexAtBirth === "female"}
                onPress={() => patch("sexAtBirth", "female")}
              />
              <Choice
                label="Male"
                selected={form.sexAtBirth === "male"}
                onPress={() => patch("sexAtBirth", "male")}
              />
            </View>
          </View>

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Usual activity
            </ThemedText>
            <View style={styles.choiceColumn}>
              {ACTIVITY_CHOICES.map(([label, value]) => (
                <Choice
                  key={value}
                  label={label}
                  selected={form.activityLevel === value}
                  onPress={() => patch("activityLevel", value)}
                />
              ))}
            </View>
          </View>

          {!validation.ok ? (
            <ThemedText accessibilityRole="alert" style={styles.errorText}>
              {validation.message}
            </ThemedText>
          ) : null}
          {submitError !== null ? (
            <ThemedText accessibilityRole="alert" style={styles.errorText}>
              {submitError}
            </ThemedText>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save energy inputs"
            accessibilityState={{
              disabled: !validation.ok || submitting,
              busy: submitting,
            }}
            disabled={!validation.ok || submitting}
            onPress={() => void onSave()}
            style={({ pressed }) => [
              styles.submit,
              (pressed || !validation.ok || submitting) && styles.disabled,
            ]}
          >
            <ThemedText style={styles.submitText} type="smallBold">
              {submitting ? "Saving…" : "Save energy inputs"}
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly inputColor: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <TextInput
        accessibilityLabel={props.label}
        keyboardType="numeric"
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#8A8D91"
        style={[styles.input, { color: props.inputColor }]}
      />
    </View>
  );
}

function Choice(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={[styles.choice, props.selected && styles.choiceSelected]}
    >
      <ThemedText type="smallBold">{props.label}</ThemedText>
    </Pressable>
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
  choiceRow: { flexDirection: "row", gap: Spacing.two },
  choiceColumn: { gap: Spacing.two },
  choice: {
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  choiceSelected: { borderWidth: 2, borderColor: "#4C8BF5" },
  errorText: { color: "#B42318" },
  submit: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    alignItems: "center",
    backgroundColor: "#1F1F23",
  },
  submitText: { color: "#FFFFFF" },
  disabled: { opacity: 0.5 },
});
