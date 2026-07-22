import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, useFocusEffect, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useState } from "react";
import type { DailyFoodSummary, FoodEntry } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { analyticsClient } from "@/composition/analytics-client";

import {
  copyFoodEntry,
  deleteFoodEntry,
  fetchFoodDay,
} from "./meal-lifecycle-data";

interface MealListState {
  readonly entries: ReadonlyArray<FoodEntry>;
  readonly summary: DailyFoodSummary | null;
  readonly loading: boolean;
  readonly message: string | null;
}

const INITIAL_STATE: MealListState = {
  entries: [],
  summary: null,
  loading: true,
  message: null,
};

const isoLocalDate = (now: Date): string => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatTotal = (value: number | null, suffix: string): string =>
  value === null ? "Incomplete" : `${Math.round(value)} ${suffix}`;

const formatEntryNutrition = (entry: FoodEntry): string => {
  const values = [
    entry.caloriesKcal === null ? null : `${entry.caloriesKcal} kcal`,
    entry.proteinG === null ? null : `${entry.proteinG}P`,
    entry.carbohydrateG === null ? null : `${entry.carbohydrateG}C`,
    entry.fatG === null ? null : `${entry.fatG}F`,
  ].filter((value): value is string => value !== null);
  return values.length === 0
    ? "No calories or macros recorded"
    : values.join(" · ");
};

const formatMealTime = (instant: string): string =>
  new Date(instant).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export function MealListScreen() {
  const date = isoLocalDate(new Date());
  const [state, setState] = useState<MealListState>(INITIAL_STATE);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState((current) => ({ ...current, loading: true, message: null }));
    const result = await fetchFoodDay(date);
    setState({
      entries: result.entries,
      summary: result.summary,
      loading: false,
      message: result.message,
    });
  }, [date]);

  useFocusEffect(
    useCallback(() => {
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "nutrition_history" },
      });
      void load();
    }, [load]),
  );

  const copy = useCallback(
    async (entry: FoodEntry): Promise<void> => {
      setBusyEntryId(entry.id);
      setState((current) => ({ ...current, message: null }));
      const result = await copyFoodEntry(entry);
      setBusyEntryId(null);
      if (!result.ok) {
        setState((current) => ({ ...current, message: result.message }));
        return;
      }
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (entryId: string): Promise<void> => {
      setBusyEntryId(entryId);
      setState((current) => ({ ...current, message: null }));
      const result = await deleteFoodEntry(entryId);
      setBusyEntryId(null);
      if (!result.ok) {
        setState((current) => ({ ...current, message: result.message }));
        return;
      }
      await load();
    },
    [load],
  );

  const confirmDelete = useCallback(
    (entry: FoodEntry): void => {
      Alert.alert(
        "Delete meal?",
        `This permanently removes “${entry.name}” from today's totals.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void remove(entry.id);
            },
          },
        ],
      );
    },
    [remove],
  );

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Today's meals" }} />
      <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Today's nutrition</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Confirmed manual entries for your current calendar day.
            </ThemedText>
          </View>

          <SummaryCard summary={state.summary} />

          {state.message !== null ? (
            <ThemedView type="backgroundElement" style={styles.messageCard}>
              <ThemedText type="small" accessibilityRole="alert">
                {state.message}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading today's meals"
                onPress={() => void load()}
                style={styles.inlineButton}
              >
                <ThemedText type="smallBold">Retry</ThemedText>
              </Pressable>
            </ThemedView>
          ) : null}

          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Entries</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add another meal"
              onPress={() => router.push("/log-meal" as Href)}
              style={styles.inlineButton}
            >
              <ThemedText type="smallBold">＋ Add</ThemedText>
            </Pressable>
          </View>

          {state.loading && state.entries.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Loading today's meals…
            </ThemedText>
          ) : null}

          {!state.loading &&
          state.entries.length === 0 &&
          state.message === null ? (
            <ThemedView type="backgroundElement" style={styles.emptyCard}>
              <ThemedText type="smallBold">Nothing logged yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Add your first meal to start today's totals.
              </ThemedText>
            </ThemedView>
          ) : null}

          <View style={styles.entryList}>
            {state.entries.map((entry) => {
              const busy = busyEntryId === entry.id;
              return (
                <ThemedView
                  key={entry.id}
                  type="backgroundElement"
                  style={styles.entryCard}
                >
                  <View style={styles.entryHeader}>
                    <ThemedText type="smallBold" style={styles.entryName}>
                      {entry.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatMealTime(entry.consumedAt)}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatEntryNutrition(entry)}
                  </ThemedText>
                  <View style={styles.entryActions}>
                    <EntryAction
                      label="Edit"
                      disabled={busy}
                      onPress={() =>
                        router.push(
                          `/edit-meal?id=${encodeURIComponent(entry.id)}` as Href,
                        )
                      }
                    />
                    <EntryAction
                      label={busy ? "Working…" : "Copy"}
                      disabled={busy}
                      onPress={() => void copy(entry)}
                    />
                    <EntryAction
                      label="Delete"
                      disabled={busy}
                      destructive
                      onPress={() => confirmDelete(entry)}
                    />
                  </View>
                </ThemedView>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SummaryCard({
  summary,
}: {
  readonly summary: DailyFoodSummary | null;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.summaryCard}>
      <View style={styles.summaryPrimary}>
        <ThemedText type="small" themeColor="textSecondary">
          Calories
        </ThemedText>
        <ThemedText type="subtitle">
          {formatTotal(summary?.caloriesKcal ?? null, "kcal")}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {summary === null
            ? "Waiting for totals"
            : `${summary.entryCount} ${summary.entryCount === 1 ? "entry" : "entries"}`}
        </ThemedText>
      </View>
      <View style={styles.macroTotals}>
        <ThemedText type="small">
          Protein {formatTotal(summary?.proteinG ?? null, "g")}
        </ThemedText>
        <ThemedText type="small">
          Carbs {formatTotal(summary?.carbohydrateG ?? null, "g")}
        </ThemedText>
        <ThemedText type="small">
          Fat {formatTotal(summary?.fatG ?? null, "g")}
        </ThemedText>
      </View>
    </ThemedView>
  );
}

function EntryAction(props: {
  readonly label: string;
  readonly disabled: boolean;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} meal`}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.entryAction,
        (pressed || props.disabled) && styles.pressed,
      ]}
    >
      <ThemedText
        type="smallBold"
        style={props.destructive === true ? styles.destructiveText : undefined}
      >
        {props.label}
      </ThemedText>
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
  header: { gap: Spacing.one },
  summaryCard: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  summaryPrimary: { gap: Spacing.one },
  macroTotals: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.three },
  messageCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inlineButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.two,
  },
  emptyCard: {
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  entryList: { gap: Spacing.two },
  entryCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  entryName: { flex: 1 },
  entryActions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  entryAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.two,
  },
  pressed: { opacity: 0.55 },
  destructiveText: { color: "#C83232" },
});
