import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import type { Goal, GoalKind, GoalPace } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { apiClient } from "@/composition/api-client";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  displayWeightToKilograms,
  kilogramsToDisplayWeight,
  weightUnitLabel,
  type WeightUnitSystem,
} from "@/lib/weight-units";

import {
  goalSettingsFormFromGoal,
  loadActiveGoal,
  saveGoalSettings,
  validateGoalSettingsForm,
  type GoalSettingsForm,
} from "./goal-settings-data";

const GOAL_KINDS: ReadonlyArray<[string, GoalKind]> = [
  ["Cut — lose body mass", "cut"],
  ["Bulk — gain muscle mass", "bulk"],
  ["Recomp — redistribute mass", "recomp"],
  ["Maintain — hold current mass", "maintain"],
];

const PACE_CHOICES: ReadonlyArray<[string, GoalPace]> = [
  ["Steady", "steady"],
  ["Gradual", "gradual"],
  ["Aggressive", "aggressive"],
];

export function GoalSettingsCard({
  unitSystem,
}: {
  readonly unitSystem: WeightUnitSystem;
}) {
  const theme = useTheme();
  const [activeGoal, setActiveGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<GoalSettingsForm>({
    kind: "cut",
    targetWeight: "",
    pace: "steady",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    void loadActiveGoal(apiClient).then((goal) => {
      if (!active) return;
      setActiveGoal(goal);
      setForm(goalSettingsFormFromGoal(goal, unitSystem));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [unitSystem]);

  const validation = useMemo(
    () => validateGoalSettingsForm(form, unitSystem),
    [form, unitSystem],
  );

  const patch = useCallback(
    <K extends keyof GoalSettingsForm>(
      field: K,
      value: GoalSettingsForm[K],
    ) => {
      setMessage(null);
      setIsSuccess(false);
      setForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const onSave = useCallback(async () => {
    if (!validation.ok) return;
    setSaving(true);
    setMessage(null);
    setIsSuccess(false);
    const result = await saveGoalSettings(
      apiClient,
      activeGoal,
      form,
      unitSystem,
    );
    if (!result.ok) {
      setSaving(false);
      setMessage(result.message);
      setIsSuccess(false);
      return;
    }
    setActiveGoal(result.goal);
    setSaving(false);
    setIsSuccess(true);
    setMessage("Goal saved successfully.");
  }, [activeGoal, form, unitSystem, validation]);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          PRIMARY GOAL
        </ThemedText>
        <ThemedText type="subtitle">Your active goal</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Target weight and pace for your current cycle.
        </ThemedText>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <>
          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Goal kind
            </ThemedText>
            <View style={styles.choiceColumn}>
              {GOAL_KINDS.map(([label, value]) => (
                <ChoiceChip
                  key={value}
                  label={label}
                  selected={form.kind === value}
                  onPress={() => patch("kind", value)}
                />
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Goal weight ({weightUnitLabel(unitSystem)})
            </ThemedText>
            <TextInput
              accessibilityLabel={`Goal weight (${weightUnitLabel(unitSystem)})`}
              keyboardType="decimal-pad"
              value={form.targetWeight}
              onChangeText={(value) => patch("targetWeight", value)}
              style={[styles.input, { color: theme.text }]}
            />
          </View>

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Pace
            </ThemedText>
            <View style={styles.choiceRow}>
              {PACE_CHOICES.map(([label, value]) => (
                <ChoiceChip
                  key={value}
                  label={label}
                  selected={form.pace === value}
                  onPress={() => patch("pace", value)}
                />
              ))}
            </View>
          </View>

          {!validation.ok && form.targetWeight.length > 0 ? (
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
            accessibilityLabel="Save goal"
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
              {saving ? "Saving…" : "Save goal"}
            </ThemedText>
          </Pressable>
        </>
      )}
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
  center: { paddingVertical: Spacing.four, alignItems: "center" },
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
