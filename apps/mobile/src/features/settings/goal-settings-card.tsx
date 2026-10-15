import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { Goal, GoalKind } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { Button, Card } from "@/components/ui";
import { apiClient } from "@/composition/api-client";
import { Spacing } from "@/constants/theme";
import { weightUnitLabel, type WeightUnitSystem } from "@/lib/weight-units";

import {
  goalSettingsFormFromGoal,
  loadActiveGoal,
  loadCurrentWeightKg,
  saveGoalSettings,
  validateGoalSettingsForm,
  type GoalSettingsForm,
} from "./goal-settings-data";
import { goalKindHasPace, paceChoicesFor } from "./goal-mode-presentation";
import {
  ChoiceChip,
  ChoiceGroup,
  FormField,
  FormStatus,
  FormTextInput,
} from "./settings-form";

const GOAL_KINDS: ReadonlyArray<[string, GoalKind]> = [
  ["Cut — lose body mass", "cut"],
  ["Bulk — gain muscle mass", "bulk"],
  ["Recomp — redistribute mass", "recomp"],
  ["Maintain — hold current mass", "maintain"],
];

export function GoalSettingsCard({
  unitSystem,
}: {
  readonly unitSystem: WeightUnitSystem;
}) {
  const [activeGoal, setActiveGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<GoalSettingsForm>({
    kind: "cut",
    targetWeight: "",
    pace: "steady",
  });
  const [saving, setSaving] = useState(false);
  const [currentWeightKg, setCurrentWeightKg] = useState<number | null>(null);
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

  useEffect(() => {
    let active = true;
    void loadCurrentWeightKg(apiClient)
      .then((weight) => {
        if (active) setCurrentWeightKg(weight);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const paceChoices = useMemo(
    () => paceChoicesFor(form.kind, currentWeightKg, unitSystem),
    [form.kind, currentWeightKg, unitSystem],
  );
  const selectedChoice = paceChoices.find((c) => c.pace === form.pace);

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
    <View style={styles.section}>
      <ThemedText type="footnote" themeColor="textSecondary">
        Target weight and pace for your current cycle.
      </ThemedText>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <>
          <Card style={styles.form}>
            <FormField label="Goal kind">
              <ChoiceGroup>
                {GOAL_KINDS.map(([label, value]) => (
                  <ChoiceChip
                    key={value}
                    label={label}
                    selected={form.kind === value}
                    onPress={() => patch("kind", value)}
                  />
                ))}
              </ChoiceGroup>
            </FormField>

            <FormField label={`Goal weight (${weightUnitLabel(unitSystem)})`}>
              <FormTextInput
                accessibilityLabel={`Goal weight (${weightUnitLabel(unitSystem)})`}
                keyboardType="decimal-pad"
                value={form.targetWeight}
                onChangeText={(value) => patch("targetWeight", value)}
              />
            </FormField>

            {goalKindHasPace(form.kind) ? (
              <FormField label="Mode and weekly rate">
                <ChoiceGroup>
                  {paceChoices.map((choice) => (
                    <ChoiceChip
                      key={choice.pace}
                      label={choice.label}
                      selected={form.pace === choice.pace}
                      onPress={() => patch("pace", choice.pace)}
                    />
                  ))}
                </ChoiceGroup>
                {selectedChoice ? (
                  <ThemedText
                    type="footnote"
                    themeColor="textSecondary"
                    accessibilityLabel={`${selectedChoice.modeLabel}, ${selectedChoice.detail}.${selectedChoice.note ? ` ${selectedChoice.note}` : ""}`}
                  >
                    {selectedChoice.detail}
                    {selectedChoice.note ? `. ${selectedChoice.note}` : ""}
                  </ThemedText>
                ) : null}
              </FormField>
            ) : null}
          </Card>

          {!validation.ok && form.targetWeight.length > 0 ? (
            <FormStatus tone="error">{validation.message}</FormStatus>
          ) : null}

          {message !== null ? (
            <FormStatus tone={isSuccess ? "success" : "error"}>
              {message}
            </FormStatus>
          ) : null}

          <Button
            label={saving ? "Saving…" : "Save goal"}
            block
            loading={saving}
            disabled={!validation.ok}
            accessibilityLabel="Save goal"
            onPress={() => void onSave()}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  center: { paddingVertical: Spacing.four, alignItems: "center" },
  form: { gap: Spacing.three },
});
