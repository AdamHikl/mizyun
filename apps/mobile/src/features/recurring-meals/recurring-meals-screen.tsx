import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  recurringMealCreateSchema,
  type RecurringMeal,
} from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { fetchFoodEntry } from "@/features/log-meal/public-data";
import { useTheme } from "@/hooks/use-theme";
import { RecurringMealSuggestionControls } from "./recurring-meal-suggestion-controls";
import {
  createSchedule,
  deviceTimeZone,
  EVERY_DAY,
  loadSchedules,
  scheduleDate,
  scheduleDays,
  skipSchedule,
  stopSchedule,
  updateSchedule,
  WEEKDAY_LABELS,
  type MealScheduleForm,
  type ScheduleResult,
} from "./recurring-meal-data";

import {
  canSkipToday,
  describeNextOccurrence,
  SPOKEN_WEEKDAYS,
  timeZoneNote,
} from "./recurring-meal-schedule";
import {
  clearScheduleAttempt,
  persistScheduleAttempt,
  prepareSchedule,
  resetRejectedSchedule,
} from "./recurring-meal-retry";

interface Editor extends MealScheduleForm {
  id: string;
  name: string;
  sourceEntryId?: string;
  attempted?: boolean;
  confirmed?: boolean;
  rejected?: boolean;
}

export function RecurringMealsScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const { sourceEntryId } = useLocalSearchParams<{ sourceEntryId?: string }>();
  const userId = session?.user.id ?? null;
  const owner = `${userId ?? ""}:${session?.accessToken ?? ""}`;
  const currentSource = useRef(sourceEntryId);
  currentSource.current = sourceEntryId;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const displayOwner = useRef(owner);
  const mounted = useRef(true);
  const version = useRef(0);
  const commandBusy = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<RecurringMeal[]>([]);
  const [editorState, setEditor] = useState<Editor | null>(null);
  const editor = displayOwner.current === owner ? editorState : null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // "Next:" and Skip today depend on the wall clock; re-render as it moves.
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const lifetime = useCallback(
    () => ({
      expectedUserId: userId ?? "",
      isCurrent: () =>
        mounted.current &&
        owner === currentOwner.current &&
        sourceEntryId === currentSource.current,
    }),
    [owner, userId, sourceEntryId],
  );
  const load = useCallback(async () => {
    if (!userId) return;
    const current = lifetime();
    const request = ++version.current;
    const result = await loadSchedules(current);
    if (!current.isCurrent() || request !== version.current) return;
    setLoading(false);
    if (result.ok) {
      setSchedules(result.recurringMeals);
      setError(null);
    } else setError(result.message);
  }, [userId, lifetime]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      version.current++;
    };
  }, []);
  useEffect(() => {
    version.current++;
    displayOwner.current = owner;
    setSchedules([]);
    setEditor(null);
    setError(null);
    setNotice(null);
    setLoading(true);
    commandBusy.current = false;
    setBusy(false);
    if (!userId || !sourceEntryId) return;
    let active = true;
    const current = lifetime();
    void Promise.all([
      fetchFoodEntry(sourceEntryId),
      prepareSchedule(userId, sourceEntryId),
    ])
      .then(([result, pending]) => {
        if (!active || !current.isCurrent()) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setEditor({
          ...pending.payload,
          attempted: pending.attempted,
          name: result.entry.name,
        });
      })
      .catch(() => {
        if (active && current.isCurrent())
          setError("Could not safely prepare this schedule. Please retry.");
      });
    return () => {
      active = false;
    };
  }, [owner, sourceEntryId, userId, lifetime]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        version.current++;
      };
    }, [load]),
  );

  const command = async (
    action: () => Promise<ScheduleResult>,
    success: string,
    closeEditor = false,
  ) => {
    if (!userId || commandBusy.current) return;
    const current = lifetime();
    if (!current.isCurrent()) return;
    commandBusy.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!current.isCurrent()) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (closeEditor) setEditor(null);
      setNotice(success);
      await load();
    } catch {
      if (current.isCurrent())
        setError(
          "Could not confirm the change. Check your connection and retry.",
        );
    } finally {
      if (current.isCurrent()) {
        commandBusy.current = false;
        setBusy(false);
      }
    }
  };
  const save = () => {
    if (!editor) return;
    const { id, sourceEntryId: source, localTime, timeZone, weekdays } = editor;
    const form = {
      localTime: localTime.trim(),
      timeZone: timeZone.trim(),
      weekdays,
    };
    const current = lifetime();
    if (
      source &&
      !recurringMealCreateSchema.safeParse({
        id,
        sourceEntryId: source,
        ...form,
      }).success
    ) {
      setError("Choose a valid time (HH:mm), time zone and at least one day.");
      return;
    }
    void command(
      async () => {
        if (!source) return updateSchedule(id, form, current);
        const payload = { id, sourceEntryId: source, ...form };
        await persistScheduleAttempt(userId!, payload);
        if (!current.isCurrent())
          return { ok: false, message: "Sign in again." };
        setEditor((value) => (value ? { ...value, attempted: true } : null));
        const result = await createSchedule(payload, current);
        if (!current.isCurrent()) return result;
        if (result.ok) {
          try {
            await clearScheduleAttempt(userId!, source, undefined, id);
          } catch {
            if (!current.isCurrent()) return result;
            setEditor((value) =>
              value ? { ...value, confirmed: true } : null,
            );
            return {
              ok: false,
              message:
                "Schedule saved. Local retry cleanup failed; choose Finish saved schedule to finish safely.",
            };
          }
        } else if (result.definitiveRejected) {
          try {
            const fresh = await resetRejectedSchedule(userId!, payload);
            if (current.isCurrent())
              setEditor((value) =>
                value ? { ...value, ...fresh.payload, attempted: false } : null,
              );
          } catch {
            if (!current.isCurrent()) return result;
            setEditor((value) =>
              value ? { ...value, confirmed: true, rejected: true } : null,
            );
            return {
              ok: false,
              message:
                "This request was rejected. Local retry cleanup failed; choose Discard rejected request to try a corrected schedule.",
            };
          }
        }
        return result;
      },
      "Schedule saved.",
      true,
    );
  };
  const finishConfirmed = () => {
    if (!editor?.sourceEntryId || !editor.confirmed) return;
    const source = editor.sourceEntryId;
    const id = editor.id;
    void command(
      async () => {
        await clearScheduleAttempt(userId!, source, undefined, id);
        return { ok: true };
      },
      "Local retry data cleared.",
      true,
    );
  };
  const confirmStop = (schedule: RecurringMeal) => {
    const current = lifetime();
    Alert.alert(
      "Stop recurring meal?",
      `Stop automatic logging of “${schedule.name}”? Previously logged meals remain.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop",
          style: "destructive",
          onPress: () => {
            if (current.isCurrent())
              void command(
                () => stopSchedule(schedule.id, current),
                "Schedule stopped.",
              );
          },
        },
      ],
    );
  };
  const patchEditor = (patch: Partial<Editor>) =>
    setEditor((value) =>
      value && !value.attempted ? { ...value, ...patch } : value,
    );
  const button = (
    label: string,
    onPress: () => void,
    selected = false,
    locked = false,
    visible = label,
    hint?: string,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: busy || locked, selected }}
      disabled={busy || locked}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: theme.border,
          backgroundColor: selected
            ? theme.primaryLight
            : theme.backgroundElement,
        },
      ]}
    >
      <ThemedText type="smallBold">{visible}</ThemedText>
    </Pressable>
  );
  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ title: "Recurring meals", headerShown: true }} />
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="subtitle">Recurring meals</ThemedText>
          <RecurringMealSuggestionControls userId={userId} />
          <ThemedText>
            Choose a logged food's Repeat action to save its foods and portions
            as a recurring meal.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Automatic entries use your saved meal. They do not prove what you
            ate. Review, edit or skip them whenever your day changes.
          </ThemedText>
          {!userId ? (
            <ThemedText>Sign in to manage recurring meals.</ThemedText>
          ) : null}
          {error ? (
            <ThemedText accessibilityRole="alert">{error}</ThemedText>
          ) : null}
          {notice ? (
            <ThemedText accessibilityLiveRegion="polite">{notice}</ThemedText>
          ) : null}
          {editor ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">
                {editor.sourceEntryId ? "Repeat" : "Edit schedule"}:{" "}
                {editor.name}
              </ThemedText>
              <View style={styles.row}>
                {button(
                  "Morning · 08:00",
                  () => patchEditor({ localTime: "08:00" }),
                  editor.localTime === "08:00",
                  editor.attempted,
                )}
                {button(
                  "Evening · 19:00",
                  () => patchEditor({ localTime: "19:00" }),
                  editor.localTime === "19:00",
                  editor.attempted,
                )}
              </View>
              <ThemedText type="smallBold">Time (24-hour HH:mm)</ThemedText>
              <TextInput
                accessibilityLabel="Scheduled time"
                value={editor.localTime}
                onChangeText={(localTime) => patchEditor({ localTime })}
                editable={!busy && !editor.attempted}
                placeholder="10:00"
                maxLength={5}
                autoCorrect={false}
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
              <ThemedText type="smallBold">Time zone</ThemedText>
              <TextInput
                accessibilityLabel="Schedule time zone"
                value={editor.timeZone}
                onChangeText={(timeZone) => patchEditor({ timeZone })}
                editable={!busy && !editor.attempted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
              <ThemedText type="small" themeColor="textSecondary">
                Times follow this time zone, including daylight saving changes.
                Travel does not change the schedule automatically.
              </ThemedText>
              {button(
                "Every day",
                () => patchEditor({ weekdays: [...EVERY_DAY] }),
                editor.weekdays.length === 7,
                editor.attempted,
              )}
              <View style={styles.row}>
                {WEEKDAY_LABELS.map((day, index) => (
                  <Pressable
                    key={day}
                    accessibilityRole="checkbox"
                    accessibilityLabel={SPOKEN_WEEKDAYS[index]}
                    accessibilityState={{
                      checked: editor.weekdays.includes(index),
                      disabled: busy || !!editor.attempted,
                    }}
                    disabled={busy || !!editor.attempted}
                    onPress={() =>
                      patchEditor({
                        weekdays: editor.weekdays.includes(index)
                          ? editor.weekdays.filter((value) => value !== index)
                          : [...editor.weekdays, index].sort(),
                      })
                    }
                    style={[
                      styles.button,
                      {
                        backgroundColor: editor.weekdays.includes(index)
                          ? theme.primaryLight
                          : theme.background,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <ThemedText>{day}</ThemedText>
                  </Pressable>
                ))}
              </View>
              {editor.attempted ? (
                <ThemedText type="small">
                  This save is awaiting confirmation. Retry with the same time
                  and days to avoid a duplicate schedule.
                </ThemedText>
              ) : null}
              <ThemedText type="small">
                By saving, you enable automatic logging at the selected time on
                these days. You can pause or stop it at any time. Existing
                entries are unchanged; today's meal is added only if its time is
                still ahead.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                To change foods or portions for future days, stop this schedule,
                edit a logged meal, then choose Repeat on that meal.
              </ThemedText>
              <View style={styles.row}>
                {button(
                  busy
                    ? "Saving…"
                    : editor.confirmed
                      ? editor.rejected
                        ? "Discard rejected request"
                        : "Finish saved schedule"
                      : editor.attempted
                        ? "Retry save"
                        : "Save schedule",
                  editor.confirmed ? finishConfirmed : save,
                )}
                {button("Cancel editing", () => setEditor(null))}
              </View>
            </ThemedView>
          ) : null}
          {loading && userId ? <ActivityIndicator /> : null}
          {!loading && schedules.length === 0 && userId ? (
            <ThemedText>No recurring meals yet.</ThemedText>
          ) : null}
          {(displayOwner.current === owner ? schedules : []).map((schedule) => {
            const next = describeNextOccurrence(schedule, now);
            const zoneNote = timeZoneNote(schedule.timeZone, deviceTimeZone());
            return (
              <ThemedView
                key={schedule.id}
                type="backgroundElement"
                style={styles.card}
              >
                <ThemedText type="smallBold">{schedule.name}</ThemedText>
                <ThemedText>
                  {schedule.localTime} · {scheduleDays(schedule.weekdays)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {schedule.enabled ? "Active" : "Paused"}
                </ThemedText>
                {next ? <ThemedText type="small">{next}</ThemedText> : null}
                {zoneNote ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {zoneNote}
                  </ThemedText>
                ) : null}
                <View style={styles.row}>
                  {button(
                    `Edit ${schedule.name}`,
                    () => {
                      setError(null);
                      setEditor({
                        id: schedule.id,
                        name: schedule.name,
                        localTime: schedule.localTime,
                        timeZone: schedule.timeZone,
                        weekdays: [...schedule.weekdays],
                      });
                    },
                    false,
                    false,
                    "Edit",
                  )}
                  {button(
                    `${schedule.enabled ? "Pause" : "Resume"} ${schedule.name}`,
                    () => {
                      const current = lifetime();
                      void command(
                        () =>
                          updateSchedule(
                            schedule.id,
                            { enabled: !schedule.enabled },
                            current,
                          ),
                        schedule.enabled
                          ? "Schedule paused."
                          : "Schedule resumed.",
                      );
                    },
                    false,
                    false,
                    schedule.enabled ? "Pause" : "Resume",
                  )}
                  {canSkipToday(schedule, now)
                    ? button(
                        `Skip today for ${schedule.name}`,
                        () => {
                          const current = lifetime();
                          Alert.alert(
                            "Skip today?",
                            `Skip today's entry in ${schedule.timeZone}? If it has already been automatically logged, it will be removed.`,
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Skip today",
                                onPress: () => {
                                  if (current.isCurrent())
                                    void command(
                                      () =>
                                        skipSchedule(
                                          schedule.id,
                                          scheduleDate(schedule.timeZone),
                                          current,
                                        ),
                                      "Today's occurrence skipped.",
                                    );
                                },
                              },
                            ],
                          );
                        },
                        false,
                        false,
                        "Skip today",
                        "Skips today's automatic entry and removes it if already logged.",
                      )
                    : null}
                  {button(
                    `Stop ${schedule.name}`,
                    () => confirmStop(schedule),
                    false,
                    false,
                    "Stop",
                    "Stops this recurring meal. Previously logged meals remain.",
                  )}
                </View>
              </ThemedView>
            );
          })}
          {userId ? button("Refresh recurring meals", () => void load()) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  card: { padding: Spacing.three, borderRadius: 16, gap: Spacing.two },
  row: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    minHeight: 44,
  },
});
