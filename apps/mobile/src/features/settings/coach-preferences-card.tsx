import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  coachMemoryResponseSchema,
  profileResponseSchema,
  type CoachMemoryResponse,
  type CoachingPreferences,
  type Profile,
} from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";
import { ThemedText } from "@/components/themed-text";
import { Button, Card, SectionHeader } from "@/components/ui";
import { Slider } from "@/components/slider";
import { Spacing } from "@/constants/theme";

import {
  ChoiceChip,
  ChoiceGroup,
  FormField,
  FormStatus,
  FormTextInput,
} from "./settings-form";

const experienceOptions = [
  ["beginner", "Beginner"],
  ["intermediate", "Intermediate"],
  ["advanced", "Advanced"],
] as const;
const focusOptions = [
  ["balanced", "Balanced"],
  ["strength", "Strength"],
  ["hypertrophy", "Muscle"],
  ["endurance", "Endurance"],
] as const;
const equipmentOptions = [
  ["bodyweight", "Bodyweight"],
  ["dumbbells", "Dumbbells"],
  ["barbell", "Barbell"],
  ["bench", "Bench"],
  ["rack", "Rack"],
  ["cable_machine", "Cables"],
  ["resistance_bands", "Bands"],
  ["pullup_bar", "Pull-up bar"],
  ["cardio_machine", "Cardio machine"],
  ["full_gym", "Full gym"],
] as const;
const dietOptions = [
  ["omnivore", "Omnivore"],
  ["vegetarian", "Vegetarian"],
  ["vegan", "Vegan"],
  ["pescatarian", "Pescatarian"],
  ["halal", "Halal"],
  ["kosher", "Kosher"],
  ["lactose_free", "Lactose-free"],
  ["gluten_free", "Gluten-free"],
] as const;
const limitationOptions = [
  ["low_impact_only", "Low impact"],
  ["no_overhead_work", "No overhead work"],
  ["no_running", "No running"],
  ["no_jumping", "No jumping"],
  ["limited_knee_flexion", "Limit deep knee bend"],
  ["limited_spinal_loading", "Limit spinal loading"],
] as const;

const toggle = <T extends string>(values: readonly T[], value: T): T[] =>
  values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];

const baseDiets = ["omnivore", "vegetarian", "vegan", "pescatarian"] as const;

const toggleDiet = (
  values: CoachingPreferences["dietaryPreferences"],
  value: CoachingPreferences["dietaryPreferences"][number],
) => {
  if (values.includes(value)) {
    return values.filter((candidate) => candidate !== value);
  }
  if ((baseDiets as readonly string[]).includes(value)) {
    return [
      ...values.filter(
        (candidate) => !(baseDiets as readonly string[]).includes(candidate),
      ),
      value,
    ];
  }
  return [...values, value];
};

export function CoachPreferencesCard({
  profile,
  onSaved,
}: {
  readonly profile: Profile;
  readonly onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<CoachingPreferences>(
    profile.coachingPreferences,
  );
  const [customNoteText, setCustomNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(profile.coachingPreferences);
  }, [profile]);

  const save = async () => {
    setSaving(true);
    setMessage(null);

    // 1. Save profile preferences - preserving countryCode
    const result = await apiClient.request({
      method: "PUT",
      path: "/v1/profile",
      body: {
        coachingPreferences: {
          ...draft,
          countryCode:
            profile.coachingPreferences?.countryCode ??
            draft.countryCode ??
            null,
        },
      },
      schema: profileResponseSchema,
    });
    if (!result.ok) {
      setMessage(
        result.error.kind === "network_error"
          ? "Could not reach Mizyun. Your choices were not changed."
          : "Could not save Coach preferences. Please check the values and retry.",
      );
      setSaving(false);
      return;
    }

    // 2. If user typed a custom note, save it as a confirmed Coach memory
    const note = customNoteText.trim();
    if (note.length > 0) {
      const memoryResult = await apiClient.request<CoachMemoryResponse>({
        method: "POST",
        path: "/v1/coach/memories",
        body: {
          kind: "preference",
          content: note,
          importance: 5,
        },
        schema: coachMemoryResponseSchema,
      });
      if (memoryResult.ok) {
        // Automatically activate so Coach recalls it immediately
        await apiClient.request<CoachMemoryResponse>({
          method: "PATCH",
          path: `/v1/coach/memories/${memoryResult.value.memory.id}`,
          body: { status: "active" },
        });
        setCustomNoteText("");
      }
    }

    setMessage("Coach preferences & custom notes saved.");
    setSaving(false);
    await onSaved();
  };

  return (
    <View style={styles.page}>
      <ThemedText type="footnote" themeColor="textSecondary">
        These explicit choices guide future workout and nutrition suggestions.
        They are not medical diagnoses, and you can change them at any time.
      </ThemedText>

      <SectionHeader title="Training" />
      <Card style={styles.form}>
        <ChoiceSection title="Experience">
          {experienceOptions.map(([value, label]) => (
            <ChoiceChip
              key={value}
              label={label}
              selected={draft.experienceLevel === value}
              onPress={() =>
                setDraft({
                  ...draft,
                  experienceLevel:
                    draft.experienceLevel === value ? null : value,
                })
              }
            />
          ))}
        </ChoiceSection>

        <ChoiceSection title="Training focus">
          {focusOptions.map(([value, label]) => (
            <ChoiceChip
              key={value}
              label={label}
              selected={draft.trainingFocus === value}
              onPress={() =>
                setDraft({
                  ...draft,
                  trainingFocus: draft.trainingFocus === value ? null : value,
                })
              }
            />
          ))}
        </ChoiceSection>

        <Slider
          label="Training days per week"
          min={1}
          max={7}
          step={1}
          value={draft.trainingDaysPerWeek ?? 3}
          formatValue={(v) => `${v} day${v === 1 ? "" : "s"} / week`}
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, trainingDaysPerWeek: value }))
          }
        />

        <Slider
          label="Session length"
          min={15}
          max={180}
          step={5}
          value={draft.sessionDurationMinutes ?? 45}
          formatValue={(v) => `${v} minutes / session`}
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, sessionDurationMinutes: value }))
          }
        />
      </Card>

      <SectionHeader title="Equipment & food" />
      <Card style={styles.form}>
        <ChoiceSection title="Available equipment">
          {equipmentOptions.map(([value, label]) => (
            <ChoiceChip
              key={value}
              label={label}
              selected={draft.availableEquipment?.includes(value) ?? false}
              onPress={() =>
                setDraft({
                  ...draft,
                  availableEquipment: toggle(
                    draft.availableEquipment ?? [],
                    value,
                  ),
                })
              }
            />
          ))}
        </ChoiceSection>

        <ChoiceSection title="Food preferences">
          {dietOptions.map(([value, label]) => (
            <ChoiceChip
              key={value}
              label={label}
              selected={draft.dietaryPreferences?.includes(value) ?? false}
              onPress={() =>
                setDraft({
                  ...draft,
                  dietaryPreferences: toggleDiet(
                    draft.dietaryPreferences ?? [],
                    value,
                  ),
                })
              }
            />
          ))}
        </ChoiceSection>

        <ChoiceSection title="Movement constraints">
          {limitationOptions.map(([value, label]) => (
            <ChoiceChip
              key={value}
              label={label}
              selected={draft.trainingLimitations?.includes(value) ?? false}
              onPress={() =>
                setDraft({
                  ...draft,
                  trainingLimitations: toggle(
                    draft.trainingLimitations ?? [],
                    value,
                  ),
                })
              }
            />
          ))}
        </ChoiceSection>

        <FormField label="Custom equipment, food & injury notes">
          <FormTextInput
            accessibilityLabel="Custom Coach notes and preferences"
            maxLength={500}
            multiline
            placeholder="e.g. I have 2x20kg kettlebells & TRX, allergic to peanuts, left shoulder stiffness..."
            value={customNoteText}
            onChangeText={setCustomNoteText}
            style={styles.customNoteInput}
          />
        </FormField>
      </Card>

      <ThemedText type="footnote" themeColor="textSecondary">
        For pain, injury, or a medical restriction, use guidance from a
        qualified professional. Mizyun will not interpret a diagnosis.
      </ThemedText>

      <Button
        label={saving ? "Saving…" : "Save Coach preferences"}
        block
        loading={saving}
        accessibilityLabel="Save AI Coach preferences"
        onPress={() => void save()}
      />
      {message !== null ? (
        <FormStatus tone="neutral">{message}</FormStatus>
      ) : null}
    </View>
  );
}

function ChoiceSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <FormField label={title}>
      <ChoiceGroup>{children}</ChoiceGroup>
    </FormField>
  );
}

const styles = StyleSheet.create({
  page: { gap: Spacing.three },
  form: { gap: Spacing.three },
  customNoteInput: {
    minHeight: 88,
    textAlignVertical: "top",
  },
});
