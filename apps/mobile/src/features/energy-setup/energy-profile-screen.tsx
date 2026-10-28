import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Turned18Question } from "@/components/turned-18-question";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { apiClient } from "@/composition/api-client";
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
  ChoiceGroup,
  FormField,
  FormStatus,
  FormTextInput,
  Icon,
  ListGroup,
  ListRow,
} from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
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
  turned18: null,
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
    () =>
      validateEnergyProfileForm(form, unitSystem, new Date().getUTCFullYear()),
    [form, unitSystem],
  );

  const patch = useCallback(
    <K extends keyof EnergyProfileForm>(
      field: K,
      value: EnergyProfileForm[K],
    ) =>
      setForm((current) => ({
        ...current,
        [field]: value,
        // A new birth year needs a new answer to the turned-18 question.
        ...(field === "birthYear" && value !== current.birthYear
          ? { turned18: null }
          : {}),
      })),
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
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="footnote" themeColor="textSecondary">
            Mizyun uses these confirmed inputs in a deterministic formula. The
            result is an estimate, not medical advice, and no value is guessed
            when an input is missing.
          </ThemedText>

          <Card>
            <Field
              label={`Height (${lengthUnitLabel(unitSystem)})`}
              value={form.height}
              onChangeText={(value) => patch("height", value)}
            />
            <Field
              label="Birth year"
              value={form.birthYear}
              onChangeText={(value) => patch("birthYear", value)}
            />
            <Turned18Question
              birthYear={form.birthYear}
              value={form.turned18}
              onChange={(value) => patch("turned18", value)}
            />
            <FormField label="Formula sex input">
              <ChoiceGroup>
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
              </ChoiceGroup>
            </FormField>
          </Card>

          <FormField label="Usual activity">
            <ListGroup>
              {ACTIVITY_CHOICES.map(([label, value]) => (
                <ListRow
                  key={value}
                  title={label}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{
                    selected: form.activityLevel === value,
                  }}
                  chevron={false}
                  trailing={
                    form.activityLevel === value ? (
                      <Icon name="check" size={16} color="primary" />
                    ) : null
                  }
                  onPress={() => patch("activityLevel", value)}
                />
              ))}
            </ListGroup>
          </FormField>

          {!validation.ok ? (
            <FormStatus tone="error">{validation.message}</FormStatus>
          ) : null}
          {submitError !== null ? (
            <FormStatus tone="error">{submitError}</FormStatus>
          ) : null}

          <Button
            label={submitting ? "Saving…" : "Save energy inputs"}
            variant="primary"
            block
            accessibilityLabel="Save energy inputs"
            accessibilityState={{
              disabled: !validation.ok || submitting,
              busy: submitting,
            }}
            disabled={!validation.ok || submitting}
            onPress={() => void onSave()}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
}) {
  return (
    <FormField label={props.label}>
      <FormTextInput
        accessibilityLabel={props.label}
        keyboardType="numeric"
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
      />
    </FormField>
  );
}

function Choice(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Chip
      label={props.label}
      selected={props.selected}
      icon={props.selected ? "check" : undefined}
      accessibilityRole="radio"
      onPress={props.onPress}
    />
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
