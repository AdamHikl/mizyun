import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import type {
  RecurringMealSuggestionProposal,
  RecurringMealSuggestionAcceptResponse,
} from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/features/auth/auth-context";
import {
  useRecurringMealSuggestion,
  type RecurringMealSuggestionTimeZones,
} from "./recurring-meal-suggestion-data";

export interface RecurringMealSuggestionPresentation {
  candidate: RecurringMealSuggestionProposal | null;
  timezoneChoice?: RecurringMealSuggestionTimeZones;
  status:
    | "idle"
    | "loading"
    | "ready"
    | "timezone-choice"
    | "pending"
    | "unknown"
    | "success"
    | "already-scheduled"
    | "stale"
    | "error";
  result: RecurringMealSuggestionAcceptResponse | null;
  error: string | null;
  accept(overrides?: { localTime: string; weekdays: number[] }): Promise<void>;
  dismiss(permanent: boolean): Promise<void>;
  chooseTimeZone(zone: string): Promise<void>;
  refresh(): Promise<void>;
  retry(): Promise<void>;
  undo(): Promise<void>;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A calendar-only preview. The server revalidates the actual first date at Save.
function firstSelectedDate(tomorrow: string, weekdays: number[]): string {
  const date = new Date(`${tomorrow}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    if (weekdays.includes(date.getUTCDay()))
      return date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return tomorrow;
}

export function RecurringMealSuggestionCard(props: {
  userId: string | null;
  hidden?: boolean;
}) {
  const { profile } = useAuth();
  const model = useRecurringMealSuggestion(props.userId, {
    visible: !props.hidden,
    profileTimeZone: profile?.userId === props.userId ? profile.timezone : null,
  });
  if (props.hidden || props.userId === null) return null;
  return (
    <RecurringMealSuggestionCardView
      key={`${props.userId}:${model.candidate?.candidateId ?? "receipt"}`}
      model={model}
    />
  );
}

export function RecurringMealSuggestionCardView(props: {
  model: RecurringMealSuggestionPresentation;
}) {
  const { model } = props;
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [localTime, setLocalTime] = useState(model.candidate?.localTime ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(
    model.candidate?.weekdays ?? [],
  );
  const candidate = model.candidate;
  const pending = model.status === "pending";
  const resolved = model.result !== null;
  const unknown = model.status === "unknown";
  const stale = model.status === "stale";
  const choosingTimezone = model.status === "timezone-choice";
  const recoveryError = model.status === "error" && candidate === null;
  const recoveryPending = pending && candidate === null;
  const actionable = model.status === "ready" || model.status === "error";
  if (
    !candidate &&
    !resolved &&
    !unknown &&
    !stale &&
    !recoveryError &&
    !recoveryPending &&
    !choosingTimezone
  )
    return null;
  if (model.status === "idle" || model.status === "loading") return null;
  const start = candidate
    ? firstSelectedDate(candidate.startLocalDate, weekdays)
    : "";
  const valid =
    /^([01]\d|2[0-3]):[0-5]\d$/.test(localTime) && weekdays.length > 0;
  const cadence =
    weekdays.length === 7
      ? "every day"
      : weekdays.map((day) => DAYS[day]).join(", ");

  const action = (
    label: string,
    onPress: () => void,
    disabled = pending,
    accessibilityLabel = label,
    selected?: boolean,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        disabled,
        busy: pending,
        ...(selected === undefined ? {} : { selected }),
      }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: theme.border,
          backgroundColor: selected
            ? theme.backgroundSelected
            : theme.background,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <ThemedText type="smallBold">
        {resolved
          ? !model.result?.recurringMeal.enabled
            ? "This schedule is inactive"
            : model.result?.created
              ? "Automatic logging enabled"
              : "Already scheduled"
          : choosingTimezone
            ? "Choose a timezone"
            : "Make this meal automatic?"}
      </ThemedText>
      {choosingTimezone && model.timezoneChoice ? (
        <>
          <ThemedText type="small">
            {model.timezoneChoice.profile
              ? `Your device timezone (${model.timezoneChoice.device}) differs from your profile timezone (${model.timezoneChoice.profile}). Choose which timezone to use, then we will check your meal pattern again.`
              : "Your profile timezone is unavailable. Choose the device timezone to check your meal pattern."}
          </ThemedText>
          <View style={styles.actions}>
            {action(
              `Use device timezone: ${model.timezoneChoice.device}`,
              () => void model.chooseTimeZone(model.timezoneChoice!.device),
            )}
            {model.timezoneChoice.profile
              ? action(
                  `Use profile timezone: ${model.timezoneChoice.profile}`,
                  () =>
                    void model.chooseTimeZone(model.timezoneChoice!.profile!),
                )
              : null}
          </View>
        </>
      ) : resolved ? (
        <>
          <ThemedText type="small" accessibilityLiveRegion="polite">
            {!model.result?.recurringMeal.enabled
              ? "This schedule is not logging meals. Open Manage to review it."
              : model.result?.created
                ? `Automatic logging enabled from ${model.result.startLocalDate}.`
                : "An equivalent meal schedule already exists."}
          </ThemedText>
          <ThemedText type="small">
            Timezone: {model.result?.recurringMeal.timeZone}
          </ThemedText>
          <View style={styles.actions}>
            {action("Manage", () => router.push("/recurring-meals"))}
            {model.result?.created && model.result.recurringMeal.enabled
              ? action("Undo", () => void model.undo())
              : null}
          </View>
        </>
      ) : unknown || recoveryError || recoveryPending ? (
        <>
          <ThemedText type="small" accessibilityLiveRegion="polite">
            The result is not confirmed. Retry to check the same request before
            making another change.
          </ThemedText>
          {candidate ? (
            <ThemedText type="small">
              Setup timezone: {candidate.timeZone}
            </ThemedText>
          ) : null}
          {action("Retry", () => void model.retry())}
        </>
      ) : stale ? (
        <>
          <ThemedText type="small">
            This suggestion needs fresh meal information before you can enable
            it.
          </ThemedText>
          {action("Refresh suggestion", () => void model.refresh())}
        </>
      ) : candidate ? (
        <>
          <ThemedText type="small">
            You logged “{candidate.name}” for 3 days in a row.
          </ThemedText>
          <ThemedText type="small">
            Auto-log this serving every day at {candidate.localTime}, starting
            tomorrow ({candidate.startLocalDate}). You can skip or pause it any
            time.
          </ThemedText>
          <ThemedText type="small">
            Timezone: {candidate.timeZone}
            {model.timezoneChoice ? " (your chosen timezone)" : ""}
          </ThemedText>
          <View style={styles.actions}>
            {!expanded
              ? action(
                  "Auto-log daily",
                  () => void model.accept(),
                  !actionable,
                  `Auto-log ${candidate.name} every day at ${candidate.localTime} starting ${candidate.startLocalDate} in ${candidate.timeZone}`,
                )
              : null}
            {action(
              expanded ? "Close details" : "Change",
              () => setExpanded(!expanded),
              !actionable,
            )}
            {action("Not now", () => void model.dismiss(false), !actionable)}
          </View>
          {expanded ? (
            <View style={styles.detail}>
              <ThemedText type="smallBold">Saved serving</ThemedText>
              <ThemedText type="small">
                {candidate.grams === null
                  ? "Serving size not recorded"
                  : `${candidate.grams} g`}
              </ThemedText>
              <ThemedText type="small">
                {[
                  ["Calories", candidate.caloriesKcal, "kcal"],
                  ["Protein", candidate.proteinG, "g"],
                  ["Carbs", candidate.carbohydrateG, "g"],
                  ["Fat", candidate.fatG, "g"],
                ]
                  .map(
                    ([label, value, unit]) =>
                      `${label}: ${value === null ? "not recorded" : `${value} ${unit}`}`,
                  )
                  .join(" · ")}
              </ThemedText>
              {model.timezoneChoice ? (
                <View style={styles.actions}>
                  {action(
                    `Use device timezone: ${model.timezoneChoice.device}`,
                    () =>
                      void model.chooseTimeZone(model.timezoneChoice!.device),
                    !actionable,
                  )}
                  {model.timezoneChoice.profile
                    ? action(
                        `Use profile timezone: ${model.timezoneChoice.profile}`,
                        () =>
                          void model.chooseTimeZone(
                            model.timezoneChoice!.profile!,
                          ),
                        !actionable,
                      )
                    : null}
                </View>
              ) : null}
              <ThemedText type="smallBold">Time (24-hour HH:MM)</ThemedText>
              <TextInput
                accessibilityLabel="Automatic meal time, 24-hour HH:MM"
                value={localTime}
                onChangeText={setLocalTime}
                editable={actionable}
                autoCapitalize="none"
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
              <View style={styles.actions}>
                {DAYS.map((day, index) =>
                  action(
                    day,
                    () =>
                      setWeekdays((current) =>
                        current.includes(index)
                          ? current.filter((value) => value !== index)
                          : [...current, index].sort(),
                      ),
                    !actionable,
                    `Auto-log on ${day}`,
                    weekdays.includes(index),
                  ),
                )}
              </View>
              <ThemedText type="small">
                {valid
                  ? `Starts ${start}, ${cadence} at ${localTime}.`
                  : "Choose at least one day and enter a time as HH:MM."}
              </ThemedText>
              {action(
                "Save custom schedule",
                () => void model.accept({ localTime, weekdays }),
                !actionable || !valid,
                `Auto-log ${candidate.name} ${cadence} at ${localTime} starting ${start} in ${candidate.timeZone}`,
              )}
              {action(
                "Don't suggest this meal",
                () => void model.dismiss(true),
                !actionable,
              )}
            </View>
          ) : null}
        </>
      ) : null}
      {pending ? (
        <ThemedText type="small" accessibilityLiveRegion="polite">
          Saving…
        </ThemedText>
      ) : null}
      {model.error ? (
        <ThemedText type="small" accessibilityLiveRegion="polite">
          {model.error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    marginVertical: 8,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 44,
    minWidth: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
  },
  detail: { gap: 10 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 16,
  },
});
