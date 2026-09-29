import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SettingsSearchResult } from "./settings-search";

export function SettingsSearchResults({
  results,
  query,
  onSelectResult,
  onClearQuery,
  onBrowseCategories,
  onFeedback,
}: {
  readonly results: readonly SettingsSearchResult[];
  readonly query: string;
  readonly onSelectResult: (result: SettingsSearchResult) => void;
  readonly onClearQuery: () => void;
  readonly onBrowseCategories?: () => void;
  readonly onFeedback?: () => void;
}) {
  if (results.length === 0 && query.trim().length > 0) {
    return (
      <ThemedView type="backgroundElement" style={styles.noMatchCard}>
        <View style={styles.noMatchIconBox}>
          <ThemedText style={styles.noMatchIcon}>🔍</ThemedText>
        </View>
        <ThemedText type="smallBold" style={styles.noMatchTitle}>
          No matching setting found
        </ThemedText>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.noMatchDescription}
        >
          We couldn&apos;t find a setting matching &ldquo;{query.trim()}&rdquo;.
          Try describing what you want to change, or browse categories.
        </ThemedText>

        <View style={styles.examplesBox}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            EXAMPLES TO TRY:
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            • &ldquo;dark mode&rdquo; or &ldquo;too bright&rdquo;
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            • &ldquo;pounds instead of kilos&rdquo;
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            • &ldquo;stop rest timer sound&rdquo;
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            • &ldquo;download my data&rdquo;
          </ThemedText>
        </View>

        <View style={styles.noMatchActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search query"
            onPress={onClearQuery}
            style={({ pressed }) => [
              styles.actionButton,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold">Clear search</ThemedText>
          </Pressable>

          {onBrowseCategories ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Browse categories"
              onPress={onBrowseCategories}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold">Browse categories</ThemedText>
            </Pressable>
          ) : null}

          {onFeedback ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send feedback"
              onPress={onFeedback}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold">Suggest a setting</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </ThemedView>
    );
  }

  return (
    <View style={styles.resultsContainer}>
      <View
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        style={styles.resultsHeader}
      >
        <ThemedText type="smallBold" themeColor="textSecondary">
          {results.length} SETTING RESULT{results.length === 1 ? "" : "S"}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={onClearQuery}
          hitSlop={8}
        >
          <ThemedText type="small" themeColor="textSecondary">
            Clear
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.resultsList}>
        {results.map((result) => {
          const item = result.item;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}, ${item.description}, ${item.breadcrumb}`}
              onPress={() => onSelectResult(result)}
              style={({ pressed }) => [
                styles.resultRow,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.resultContent}>
                <View style={styles.resultTitleRow}>
                  <ThemedText type="smallBold" style={styles.resultLabel}>
                    {item.label}
                  </ThemedText>
                  {item.anchorId ? (
                    <View style={styles.directPill}>
                      <ThemedText type="small" style={styles.directPillText}>
                        Direct
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={2}
                  style={styles.resultDescription}
                >
                  {item.description}
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.resultBreadcrumb}
                >
                  {item.breadcrumb}
                </ThemedText>
              </View>
              <ThemedText style={styles.resultArrow}>›</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  resultsContainer: {
    gap: Spacing.two,
  },
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
  },
  resultsList: {
    gap: Spacing.two,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.four,
    borderRadius: 14,
    backgroundColor: "rgba(128, 128, 128, 0.08)",
    minHeight: 56,
  },
  resultContent: {
    flex: 1,
    gap: 4,
    paddingRight: Spacing.two,
  },
  resultTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  resultLabel: {
    fontSize: 15,
  },
  resultDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  resultBreadcrumb: {
    fontSize: 11,
    marginTop: 2,
    opacity: 0.75,
  },
  directPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  directPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#10B981",
  },
  resultArrow: {
    fontSize: 22,
    opacity: 0.4,
  },
  noMatchCard: {
    padding: Spacing.five,
    borderRadius: 16,
    alignItems: "center",
    gap: Spacing.three,
  },
  noMatchIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(128, 128, 128, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  noMatchIcon: {
    fontSize: 24,
  },
  noMatchTitle: {
    fontSize: 16,
    textAlign: "center",
  },
  noMatchDescription: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  examplesBox: {
    alignSelf: "stretch",
    padding: Spacing.three,
    borderRadius: 10,
    backgroundColor: "rgba(128, 128, 128, 0.06)",
    gap: 4,
  },
  noMatchActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "rgba(128, 128, 128, 0.12)",
    minHeight: 44,
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});
