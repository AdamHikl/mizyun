import { ScrollView, StyleSheet, View } from "react-native";
import type { BoulderProgressResponse } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { timelineColumns, timelineSummary } from "./progress";

/**
 * Hardest send per finished session (last 20), oldest on the left. View-built
 * like the strength ProgressionChart; personal bests carry a star icon AND the
 * text "PB"; sessions without sends say "No sends".
 */
export function HardestSendTimeline({
  timeline,
}: {
  timeline: BoulderProgressResponse["timeline"];
}) {
  const theme = useTheme();
  const columns = timelineColumns(timeline);
  if (columns.length === 0) return null;
  const summary = timelineSummary(columns);
  return (
    <View style={styles.container}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {summary}
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {columns.map((column) => (
          <View
            key={column.sessionId}
            style={styles.column}
            accessible
            accessibilityLabel={column.accessibilityLabel}
          >
            <View style={styles.pb}>
              {column.personalBest ? (
                <>
                  <Icon name="starFill" size={12} color="primary" />
                  <ThemedText type="caption" themeColor="primary">
                    PB
                  </ThemedText>
                </>
              ) : null}
            </View>
            <ThemedText
              type="caption"
              style={styles.centered}
              numberOfLines={2}
              themeColor={column.grade ? "text" : "textTertiary"}
            >
              {column.grade ?? "No sends"}
            </ThemedText>
            <View
              style={[
                styles.track,
                { backgroundColor: theme.backgroundSelected },
              ]}
            >
              {column.grade ? (
                <View
                  style={[
                    styles.fill,
                    {
                      height: `${Math.round(column.heightFraction * 100)}%`,
                      backgroundColor: column.personalBest
                        ? theme.primary
                        : theme.textTertiary,
                    },
                  ]}
                />
              ) : null}
            </View>
            <ThemedText
              type="caption"
              themeColor="textTertiary"
              style={styles.centered}
              numberOfLines={2}
            >
              {column.dateLabel}
            </ThemedText>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  row: { gap: Spacing.one + Spacing.half, alignItems: "flex-end" },
  column: { width: 48, alignItems: "center", gap: Spacing.half },
  pb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 16,
  },
  centered: { textAlign: "center" },
  track: {
    width: 20,
    height: 96,
    borderRadius: Radius.sm,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  fill: { width: "100%", borderRadius: Radius.sm },
});
