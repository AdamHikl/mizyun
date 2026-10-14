import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SharedMealDetails as MealDetails } from "@mizyun/contracts";
import { useTheme } from "@/hooks/use-theme";

export function SharedMealDetails({
  details,
  compact = false,
}: {
  details: MealDetails;
  compact?: boolean;
}) {
  const colors = useTheme();
  const values = [
    details.caloriesKcal !== null ? `${details.caloriesKcal} kcal` : null,
    details.proteinG !== null ? `${details.proteinG} g protein` : null,
    details.carbsG !== null ? `${details.carbsG} g carbs` : null,
    details.fatG !== null ? `${details.fatG} g fat` : null,
  ].filter((value) => value !== null);
  return (
    <View style={styles.container}>
      {!compact ? (
        <Text
          accessibilityRole="header"
          style={[styles.name, { color: colors.text }]}
        >
          {details.name}
        </Text>
      ) : null}
      <Text style={[styles.values, { color: colors.textSecondary }]}>
        {values.length ? values.join(" · ") : "Nutrition not shared"}
      </Text>
      {values.length > 0 && !compact ? (
        <Text style={[styles.values, { color: colors.textSecondary }]}>
          Values from the saved meal; they may be estimates.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 14 },
  name: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  values: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
});
