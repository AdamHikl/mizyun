import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SharedBoulderingDetails as BoulderingDetails } from "@mizyun/contracts";
import { useTheme } from "@/hooks/use-theme";
import {
  boulderingCardCounts,
  boulderingCardSpoken,
} from "./bouldering-card-text";

export {
  boulderingCardCounts,
  boulderingCardSpoken,
  boulderingCardTitle,
} from "./bouldering-card-text";

/**
 * Renders only the allowlisted snapshot fields. Gym, notes, photos, colours,
 * attempts and times are not in the DTO and are never shown.
 */
export function SharedBoulderingDetails({
  details,
  compact = false,
}: {
  details: BoulderingDetails;
  compact?: boolean;
}) {
  const colors = useTheme();
  const rows = details.gradeBreakdown ?? [];
  const max = rows.reduce((top, row) => Math.max(top, row.sends), 1);
  return (
    <View
      style={styles.container}
      accessible
      accessibilityLabel={boulderingCardSpoken(details)}
    >
      <Text style={[styles.values, { color: colors.textSecondary }]}>
        {boulderingCardCounts(details)}
      </Text>
      {rows.length > 0 ? (
        <View style={styles.rows}>
          {!compact ? (
            <Text style={[styles.heading, { color: colors.text }]}>
              Sends by grade
            </Text>
          ) : null}
          {rows.map((row) => (
            <View key={row.grade} style={styles.row}>
              <Text style={[styles.grade, { color: colors.text }]}>
                {row.grade}
              </Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.bar,
                    {
                      width: `${Math.max(8, (row.sends / max) * 100)}%`,
                      backgroundColor: colors.primary,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.sends, { color: colors.textSecondary }]}>
                {row.sends}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 6 },
  values: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  heading: { fontSize: 14, fontWeight: "600" },
  rows: { gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20 },
  grade: { minWidth: 36, fontSize: 13, fontWeight: "600" },
  track: { flex: 1, height: 10, justifyContent: "center" },
  bar: { height: 10, borderRadius: 4 },
  sends: { minWidth: 24, fontSize: 13, textAlign: "right" },
});
