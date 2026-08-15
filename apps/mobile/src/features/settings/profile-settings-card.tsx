import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { Profile } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { apiClient } from "@/composition/api-client";
import { Colors, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
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
  const theme = useTheme();
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
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          PROFILE & STATS
        </ThemedText>
        <ThemedText type="subtitle">Your physical stats</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          These confirmed inputs power your daily energy calculations.
        </ThemedText>
      </View>

      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Display name
        </ThemedText>
        <TextInput
          accessibilityLabel="Display name"
          autoCapitalize="words"
          autoCorrect={false}
          value={form.displayName}
          onChangeText={(value) => patch("displayName", value)}
          style={[styles.input, { color: theme.text }]}
        />
      </View>

      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Units
        </ThemedText>
        <View style={styles.choiceRow}>
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
        </View>
      </View>

      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Height ({lengthUnitLabel(form.unitSystem)})
        </ThemedText>
        <TextInput
          accessibilityLabel={`Height (${lengthUnitLabel(form.unitSystem)})`}
          keyboardType="decimal-pad"
          value={form.height}
          onChangeText={(value) => patch("height", value)}
          style={[styles.input, { color: theme.text }]}
        />
      </View>

      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Birth year
        </ThemedText>
        <TextInput
          accessibilityLabel="Birth year"
          keyboardType="number-pad"
          value={form.birthYear}
          onChangeText={(value) => patch("birthYear", value)}
          style={[styles.input, { color: theme.text }]}
        />
      </View>

      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Formula sex input
        </ThemedText>
        <View style={styles.choiceRow}>
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
        </View>
      </View>

      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Usual activity
        </ThemedText>
        <View style={styles.choiceColumn}>
          {ACTIVITY_CHOICES.map(([label, value]) => (
            <ChoiceChip
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

      {message !== null ? (
        <ThemedText
          accessibilityRole="alert"
          style={isSuccess ? styles.successText : styles.errorText}
        >
          {message}
        </ThemedText>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save profile details"
        accessibilityState={{
          disabled: !validation.ok || saving,
          busy: saving,
        }}
        disabled={!validation.ok || saving}
        onPress={() => void onSave()}
        style={({ pressed }) => [
          styles.saveButton,
          pressed && styles.pressed,
          (!validation.ok || saving) && styles.disabled,
        ]}
      >
        <ThemedText type="smallBold" style={styles.saveText}>
          {saving ? "Saving…" : "Save profile details"}
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
  },
  header: { gap: Spacing.half },
  field: { gap: Spacing.one },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  choiceRow: { flexDirection: "row", gap: Spacing.two, flexWrap: "wrap" },
  choiceColumn: { gap: Spacing.one },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chipSelected: {
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.one,
  },
  saveText: { color: "#000000" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  errorText: { color: "#EF4444" },
  successText: { color: "#10B981" },
});
