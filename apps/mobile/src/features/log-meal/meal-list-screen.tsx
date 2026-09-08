import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, useFocusEffect, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useState } from "react";
import type { FoodEntry } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { FeedbackHeaderButton } from "@/components/feedback-header-button";
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

  const totalDaysTracked = state.groups.length;

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Meals" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Header */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                MIZYUN
              </ThemedText>
              <FeedbackHeaderButton />
            </View>
            <ThemedText type="subtitle">Meals</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Manage daily nutrition, logged foods, and history.
            </ThemedText>
          </View>

          {/* Primary Action Card: Log a Meal */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log a meal"
            onPress={() => router.push("/log-meal" as Href)}
            style={({ pressed }) => [
              styles.logMealHeroCard,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.logMealIconContainer}>
              <ThemedText style={styles.logMealIcon}>🥗</ThemedText>
            </View>
            <View style={styles.logMealBody}>
              <ThemedText type="smallBold">Log a Meal</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Scan photo with AI or manual ingredient entry
              </ThemedText>
            </View>
            <View style={styles.logMealBadge}>
              <ThemedText type="smallBold" style={styles.logMealBadgeText}>
                ＋ Log
              </ThemedText>
            </View>
          </Pressable>

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

          {/* 3. History Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                HISTORY BY DAY
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {totalDaysTracked} {totalDaysTracked === 1 ? "day" : "days"}
              </ThemedText>
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
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.emptyStateDesc}
                >
                  Meals you log manually or scan with AI will appear here
                  grouped by day with detailed calorie and macro breakdowns.
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Log your first meal"
                  onPress={() => router.push("/log-meal" as Href)}
                  style={styles.emptyAddButton}
                >
                  <ThemedText
                    type="smallBold"
                    style={styles.emptyAddButtonText}
                  >
                    ＋ Log your first meal
                  </ThemedText>
                </Pressable>
              </ThemedView>
            ) : null}

            <View style={styles.groupList}>
              {state.groups.map((group) => (
                <ThemedView
                  key={group.date}
                  type="backgroundElement"
                  style={styles.dayGroupCard}
                >
                  <View style={styles.dayHeader}>
                    <View style={styles.dayTitleRow}>
                      <ThemedText type="smallBold" style={styles.dayTitle}>
                        {group.displayDate}
                      </ThemedText>
                      <View style={styles.dayCountBadge}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {group.summary.entryCount}{" "}
                          {group.summary.entryCount === 1 ? "meal" : "meals"}
                        </ThemedText>
                      </View>
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
                        <View key={entry.id} style={styles.entryCard}>
                          <View style={styles.entryHeader}>
                            <ThemedText
                              type="smallBold"
                              style={styles.entryName}
                            >
                              {entry.name}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                              {formatMealTime(entry.consumedAt)}
                            </ThemedText>
                          </View>
                          {/* Semantic Macro Badges */}
                          <View style={styles.macroBadgesRow}>
                            {entry.caloriesKcal !== null ? (
                              <View style={styles.calorieBadge}>
                                <ThemedText
                                  type="smallBold"
                                  style={styles.calorieBadgeText}
                                >
                                  {entry.caloriesKcal} kcal
                                </ThemedText>
                              </View>
                            ) : null}
                            {entry.proteinG !== null ? (
                              <View style={styles.proteinBadge}>
                                <ThemedText
                                  type="small"
                                  style={styles.proteinBadgeText}
                                >
                                  {entry.proteinG}g P
                                </ThemedText>
                              </View>
                            ) : null}
                            {entry.carbohydrateG !== null ? (
                              <View style={styles.carbsBadge}>
                                <ThemedText
                                  type="small"
                                  style={styles.carbsBadgeText}
                                >
                                  {entry.carbohydrateG}g C
                                </ThemedText>
                              </View>
                            ) : null}
                            {entry.fatG !== null ? (
                              <View style={styles.fatBadge}>
                                <ThemedText
                                  type="small"
                                  style={styles.fatBadgeText}
                                >
                                  {entry.fatG}g F
                                </ThemedText>
                              </View>
                            ) : null}
                          </View>
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
                              label={busy ? "Working…" : "Copy to Today"}
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
                        </View>
                      );
                    })}
                  </View>
                </ThemedView>
              ))}
            </View>
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
        props.destructive === true && styles.entryActionDestructive,
        (pressed || props.disabled) && styles.pressed,
      ]}
    >
      <ThemedText
        type="small"
        style={[
          styles.entryActionLabel,
          props.destructive === true ? styles.destructiveText : undefined,
        ]}
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
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  header: { gap: Spacing.one },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logMealHeroCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  logMealIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  logMealIcon: {
    fontSize: 20,
  },
  logMealBody: {
    flex: 1,
    gap: 2,
  },
  logMealBadge: {
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
    paddingVertical: 7,
    borderRadius: 10,
  },
  logMealBadgeText: {
    color: "#ffffff",
    fontSize: 12,
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    color: "#64748B",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  messageCard: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  inlineButton: {
    minHeight: 36,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  emptyCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
  },
  emptyStateDesc: {
    lineHeight: 19,
  },
  emptyAddButton: {
    backgroundColor: "#10B981",
    paddingVertical: 9,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    alignSelf: "flex-start",
    marginTop: Spacing.one,
  },
  emptyAddButtonText: {
    color: "#ffffff",
  },
  groupList: { gap: Spacing.four },
  dayGroupCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
  },
  dayHeader: {
    gap: 3,
    paddingBottom: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148, 163, 184, 0.12)",
  },
  dayTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayTitle: {
    fontSize: 16,
  },
  dayCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.1)",
  },
  dayTotals: {
    fontSize: 13,
  },
  dayEntries: { gap: Spacing.two },
  entryCard: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
    backgroundColor: "rgba(148, 163, 184, 0.04)",
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  entryName: { flex: 1, fontSize: 15 },
  macroBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  calorieBadge: {
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  calorieBadgeText: {
    fontSize: 12,
  },
  proteinBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  proteinBadgeText: {
    fontSize: 11,
    color: "#10B981",
    fontWeight: "700",
  },
  carbsBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  carbsBadgeText: {
    fontSize: 11,
    color: "#F59E0B",
    fontWeight: "700",
  },
  fatBadge: {
    backgroundColor: "rgba(139, 92, 246, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  fatBadgeText: {
    fontSize: 11,
    color: "#8B5CF6",
    fontWeight: "700",
  },
  entryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.1)",
    paddingTop: Spacing.one,
  },
  entryAction: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.1)",
  },
  entryActionDestructive: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  entryActionLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  pressed: { opacity: 0.6 },
  destructiveText: { color: "#EF4444" },
});
