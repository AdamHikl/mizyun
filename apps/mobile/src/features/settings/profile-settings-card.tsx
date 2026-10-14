import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { Profile } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { Button, Card } from "@/components/ui";
import { apiClient } from "@/composition/api-client";
import { Spacing } from "@/constants/theme";
import {
  centimetersToDisplayLength,
  displayLengthToCentimeters,
  lengthUnitLabel,
} from "@/lib/length-units";

import {
  profileSettingsFormFromProfile,
  saveProfileSettings,
  validateProfileSettingsForm,
  type ProfileSettingsForm,
} from "./profile-settings-data";
import {
  ChoiceChip,
  ChoiceGroup,
  FormField,
  FormStatus,
  FormTextInput,
} from "./settings-form";

const ACTIVITY_CHOICES = [
  ["Sedentary", "sedentary"],
  ["Lightly active", "lightly_active"],
  ["Moderately active", "moderately_active"],
  ["Very active", "very_active"],
  ["Extra active", "extra_active"],
] as const;

export function ProfileSettingsCard({
  profile,
  onSaved,
}: {
  readonly profile: Profile;
  readonly onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<ProfileSettingsForm>(() =>
    profileSettingsFormFromProfile(profile),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    setForm(profileSettingsFormFromProfile(profile));
  }, [profile]);

  const validation = useMemo(
    () => validateProfileSettingsForm(form, new Date().getFullYear()),
    [form],
  );

  const patch = useCallback(
    <K extends keyof ProfileSettingsForm>(
      field: K,
      value: ProfileSettingsForm[K],
    ) => {
      setMessage(null);
      setIsSuccess(false);
      setForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const onUnitSystemChange = useCallback(
    (nextUnitSystem: Profile["unitSystem"]) => {
      if (form.unitSystem === nextUnitSystem) return;
      setMessage(null);
      setIsSuccess(false);
      setForm((current) => {
        const heightNum = Number(current.height.trim());
        let nextHeight = current.height;
        if (Number.isFinite(heightNum) && heightNum > 0) {
          const cm = displayLengthToCentimeters(heightNum, current.unitSystem);
          const converted = centimetersToDisplayLength(cm, nextUnitSystem);
          nextHeight = String(converted);
        }
        return {
          ...current,
          unitSystem: nextUnitSystem,
          height: nextHeight,
        };
      });
    },
    [form.unitSystem],
  );

  const onSave = useCallback(async () => {
    if (!validation.ok) return;
    setSaving(true);
    setMessage(null);
    setIsSuccess(false);
    const result = await saveProfileSettings(apiClient, validation.patch);
    if (!result.ok) {
      setSaving(false);
      setMessage(result.message);
      setIsSuccess(false);
      return;
    }
    await onSaved();
    setSaving(false);
    setIsSuccess(true);
    setMessage("Profile details saved.");
  }, [onSaved, validation]);

  return (
    <View style={styles.section}>
      <ThemedText type="footnote" themeColor="textSecondary">
        These confirmed inputs power your daily energy calculations.
      </ThemedText>

      <Card style={styles.form}>
        <FormField label="Display name">
          <FormTextInput
            accessibilityLabel="Display name"
            autoCapitalize="words"
            autoCorrect={false}
            value={form.displayName}
            onChangeText={(value) => patch("displayName", value)}
          />
        </FormField>

        <FormField label="Units">
          <ChoiceGroup>
            <ChoiceChip
              label="Metric (kg, cm)"
              selected={form.unitSystem === "metric"}
              onPress={() => onUnitSystemChange("metric")}
            />
            <ChoiceChip
              label="Imperial (lb, in)"
              selected={form.unitSystem === "imperial"}
              onPress={() => onUnitSystemChange("imperial")}
            />
          </ChoiceGroup>
        </FormField>

        <FormField label={`Height (${lengthUnitLabel(form.unitSystem)})`}>
          <FormTextInput
            accessibilityLabel={`Height (${lengthUnitLabel(form.unitSystem)})`}
            keyboardType="decimal-pad"
            value={form.height}
            onChangeText={(value) => patch("height", value)}
          />
        </FormField>

        <FormField label="Birth year">
          <FormTextInput
            accessibilityLabel="Birth year"
            keyboardType="number-pad"
            value={form.birthYear}
            onChangeText={(value) => patch("birthYear", value)}
          />
        </FormField>

        <FormField label="Formula sex input">
          <ChoiceGroup>
            <ChoiceChip
              label="Female"
              selected={form.sexAtBirth === "female"}
              onPress={() => patch("sexAtBirth", "female")}
            />
            <ChoiceChip
              label="Male"
              selected={form.sexAtBirth === "male"}
              onPress={() => patch("sexAtBirth", "male")}
            />
          </ChoiceGroup>
        </FormField>

        <FormField label="Usual activity">
          <ChoiceGroup>
            {ACTIVITY_CHOICES.map(([label, value]) => (
              <ChoiceChip
                key={value}
                label={label}
                selected={form.activityLevel === value}
                onPress={() => patch("activityLevel", value)}
              />
            ))}
          </ChoiceGroup>
        </FormField>
      </Card>

      {!validation.ok ? (
        <FormStatus tone="error">{validation.message}</FormStatus>
      ) : null}

      {message !== null ? (
        <FormStatus tone={isSuccess ? "success" : "error"}>
          {message}
        </FormStatus>
      ) : null}

      <Button
        label={saving ? "Saving…" : "Save profile details"}
        block
        loading={saving}
        disabled={!validation.ok}
        accessibilityLabel="Save profile details"
        onPress={() => void onSave()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  form: { gap: Spacing.three },
});
