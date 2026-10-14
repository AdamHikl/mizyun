import {
  Button,
  Card,
  Chip,
  EmptyState,
  ListGroup,
  ListRow,
  SectionHeader,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import React from "react";
import { StyleSheet, View } from "react-native";
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
      <Card>
        <EmptyState
          icon="search"
          title="No matching setting found"
          message={`We couldn’t find a setting matching “${query.trim()}”. Try describing what you want to change, like “dark mode”, “pounds instead of kilos”, “stop rest timer sound” or “download my data”.`}
          action={
            <View style={styles.noMatchActions}>
              <Button
                label="Clear search"
                variant="secondary"
                size="small"
                accessibilityLabel="Clear search query"
                onPress={onClearQuery}
              />
              {onBrowseCategories ? (
                <Button
                  label="Browse categories"
                  variant="secondary"
                  size="small"
                  accessibilityLabel="Browse categories"
                  onPress={onBrowseCategories}
                />
              ) : null}
              {onFeedback ? (
                <Button
                  label="Suggest a setting"
                  variant="tinted"
                  size="small"
                  icon="feedback"
                  accessibilityLabel="Send feedback"
                  onPress={onFeedback}
                />
              ) : null}
            </View>
          }
        />
      </Card>
    );
  }

  return (
    <View style={styles.resultsContainer}>
      <View accessibilityRole="summary" accessibilityLiveRegion="polite">
        <SectionHeader
          title={`${results.length} result${results.length === 1 ? "" : "s"}`}
          action={
            <Button
              label="Clear"
              variant="plain"
              size="small"
              accessibilityLabel="Clear search"
              onPress={onClearQuery}
            />
          }
        />
      </View>

      <ListGroup>
        {results.map((result) => {
          const item = result.item;
          return (
            <ListRow
              key={item.id}
              title={item.label}
              subtitle={`${item.description}\n${item.categoryLabel}`}
              accessibilityLabel={`${item.label}, ${item.description}, ${item.breadcrumb}`}
              onPress={() => onSelectResult(result)}
              trailing={
                item.anchorId ? <Chip label="Direct" tone="primary" /> : null
              }
            />
          );
        })}
      </ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  resultsContainer: {
    gap: Spacing.two,
  },
  noMatchActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
});
