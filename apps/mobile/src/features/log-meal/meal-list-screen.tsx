import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, useFocusEffect, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useState } from "react";
import type { FoodEntry } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { analyticsClient } from "@/composition/analytics-client";

import {
  copyFoodEntry,
  deleteFoodEntry,
  fetchFoodHistory,
  type DayGroupSummary,
  type FoodDayGroup,
} from "./meal-lifecycle-data";

interface MealListState {
  readonly groups: ReadonlyArray<FoodDayGroup>;
  readonly entries: ReadonlyArray<FoodEntry>;
  readonly loading: boolean;
  readonly message: string | null;
}

const INITIAL_STATE: MealListState = {
  groups: [],
  entries: [],
  loading: true,
  message: null,
};

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

const formatGroupNutrition = (summary: DayGroupSummary): string => {
  const values = [
    summary.caloriesKcal === null ? null : `${summary.caloriesKcal} kcal`,
    summary.proteinG === null ? null : `${summary.proteinG}P`,
    summary.carbohydrateG === null ? null : `${summary.carbohydrateG}C`,
    summary.fatG === null ? null : `${summary.fatG}F`,
  ].filter((value): value is string => value !== null);
  return values.length === 0 ? "No nutrition totals" : values.join(" · ");
};

const formatMealTime = (instant: string): string =>
  new Date(instant).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export function MealListScreen() {
  const [state, setState] = useState<MealListState>(INITIAL_STATE);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState((current) => ({ ...current, loading: true, message: null }));
    const result = await fetchFoodHistory();
    setState({
      groups: result.groups,
      entries: result.entries,
      loading: false,
      message: result.message,
    });
  }, []);

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
      Alert.alert("Delete meal?", `This permanently removes “${entry.name}”.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void remove(entry.id);
          },
        },
      ]);
    },
    [remove],
  );

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Logged meals" }} />
      <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Logged meals</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              All confirmed entries organized by day.
            </ThemedText>
          </View>

          {state.message !== null ? (
            <ThemedView type="backgroundElement" style={styles.messageCard}>
              <ThemedText type="small" accessibilityRole="alert">
                {state.message}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading logged meals"
                onPress={() => void load()}
                style={styles.inlineButton}
              >
                <ThemedText type="smallBold">Retry</ThemedText>
              </Pressable>
            </ThemedView>
          ) : null}

          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">History</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add another meal"
              onPress={() => router.push("/log-meal" as Href)}
              style={styles.inlineButton}
            >
              <ThemedText type="smallBold">＋ Add meal</ThemedText>
            </Pressable>
          </View>

          {state.loading && state.groups.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Loading logged meals…
            </ThemedText>
          ) : null}

          {!state.loading &&
          state.groups.length === 0 &&
          state.message === null ? (
            <ThemedView type="backgroundElement" style={styles.emptyCard}>
              <ThemedText type="smallBold">Nothing logged yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Meals you log will appear here grouped by day.
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Log your first meal"
                onPress={() => router.push("/log-meal" as Href)}
                style={styles.emptyAddButton}
              >
                <ThemedText type="smallBold">＋ Log your first meal</ThemedText>
              </Pressable>
            </ThemedView>
          ) : null}

          <View style={styles.groupList}>
            {state.groups.map((group) => (
              <View key={group.date} style={styles.dayGroup}>
                <View style={styles.dayHeader}>
                  <View style={styles.dayTitleRow}>
                    <ThemedText type="smallBold" style={styles.dayTitle}>
                      {group.displayDate}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {group.summary.entryCount}{" "}
                      {group.summary.entryCount === 1 ? "meal" : "meals"}
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.dayTotals}
                  >
                    {formatGroupNutrition(group.summary)}
                  </ThemedText>
                </View>

                <View style={styles.dayEntries}>
                  {group.entries.map((entry) => {
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
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
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
    gap: Spacing.two,
  },
  emptyAddButton: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "flex-start",
    paddingTop: Spacing.one,
  },
  groupList: { gap: Spacing.four },
  dayGroup: {
    gap: Spacing.two,
  },
  dayHeader: {
    gap: Spacing.half,
    paddingBottom: Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(100, 116, 139, 0.2)",
  },
  dayTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayTitle: {
    fontSize: 15,
  },
  dayTotals: {
    fontSize: 13,
  },
  dayEntries: { gap: Spacing.two },
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
