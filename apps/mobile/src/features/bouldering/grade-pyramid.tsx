import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { BoulderProgressResponse } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { pyramidRows } from "./progress";

const STRIPES = 24;

/**
 * Flash portion: vertical stripes on a light fill with an outline, so it is
 * distinguishable from the solid "sent" portion without relying on colour.
 */
function Hatched({ color, background }: { color: string; background: string }) {
  return (
    <View
      accessible={false}
      testID="flash-hatch"
      style={[
        styles.hatch,
        { backgroundColor: background, borderColor: color },
      ]}
    >
      {Array.from({ length: STRIPES }, (_, index) => (
        <View key={index} style={[styles.stripe, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

/** Legend: both swatches carry a text label. */
export function PyramidLegend() {
  const theme = useTheme();
  return (
    <View style={styles.legend} accessible={false}>
      <View style={styles.legendItem}>
        <View
          style={[styles.legendSwatch, { backgroundColor: theme.primary }]}
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          Sent
        </ThemedText>
      </View>
      <View style={styles.legendItem}>
        <View style={styles.legendSwatch}>
          <Hatched color={theme.primary} background={theme.primaryLight} />
        </View>
        <ThemedText type="footnote" themeColor="textSecondary">
          Flash (striped)
        </ThemedText>
      </View>
    </View>
  );
}

/** A tappable row when it opens a grade; otherwise one labelled summary. */
function PyramidRow({
  accessibilityLabel,
  onPress,
  children,
}: {
  accessibilityLabel: string;
  onPress?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  if (!onPress)
    return (
      <View
        style={styles.row}
        accessible
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </View>
    );
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        styles.selectable,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Shows each boulder sent at this grade"
    >
      {children}
    </Pressable>
  );
}

/**
 * Horizontal bar per grade, hardest at top, a count on every bar. With
 * `onSelectGrade`, the whole row opens that grade's sends.
 */
export function GradePyramid({
  pyramid,
  onSelectGrade,
}: {
  pyramid: BoulderProgressResponse["pyramid"];
  onSelectGrade?: (grade: string) => void;
}) {
  const theme = useTheme();
  const rows = pyramidRows(pyramid);
  if (rows.length === 0) return null;
  return (
    <View style={styles.list}>
      <PyramidLegend />
      {rows.map((row) => (
        <PyramidRow
          key={row.grade}
          accessibilityLabel={row.accessibilityLabel}
          onPress={onSelectGrade ? () => onSelectGrade(row.grade) : undefined}
        >
          <ThemedText type="smallBold" style={styles.grade}>
            {row.grade}
          </ThemedText>
          <View style={styles.track}>
            <View
              style={[
                styles.bar,
                { width: `${Math.max(6, row.fraction * 100)}%` },
              ]}
            >
              {row.flashes > 0 ? (
                <View style={{ flex: row.flashFraction }}>
                  <Hatched
                    color={theme.primary}
                    background={theme.primaryLight}
                  />
                </View>
              ) : null}
              {row.sends > row.flashes ? (
                <View
                  style={{
                    flex: 1 - row.flashFraction,
                    backgroundColor: theme.primary,
                  }}
                />
              ) : null}
            </View>
          </View>
          <ThemedText type="small" style={styles.count}>
            {row.countLabel}
          </ThemedText>
          {onSelectGrade ? (
            <Icon name="chevronRight" size={14} color="textTertiary" />
          ) : null}
        </PyramidRow>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  legendSwatch: {
    width: 20,
    height: 12,
    borderRadius: Radius.sm,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 28,
  },
  selectable: {
    minHeight: MinTouchTarget,
    marginHorizontal: -Spacing.one,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.sm,
  },
  grade: { minWidth: 40 },
  track: { flex: 1, height: 16, justifyContent: "center" },
  bar: {
    height: 16,
    flexDirection: "row",
    borderRadius: Radius.sm,
    overflow: "hidden",
  },
  hatch: {
    flex: 1,
    flexDirection: "row",
    gap: 3,
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: Radius.sm,
  },
  stripe: { width: 2, height: "100%" },
  count: { minWidth: 72, textAlign: "right" },
});
