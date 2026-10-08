import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { DailyFoodSummary } from "@mizyun/contracts";
import { adultNutrientReferences } from "@mizyun/core";
import { ThemedText } from "@/components/themed-text";

const fields = [
  ["fibreG", "Fibre", "g"],
  ["saturatedFatG", "Saturated fat", "g"],
  ["totalSugarsG", "Total sugars", "g"],
  ["sodiumMg", "Sodium", "mg"],
  ["cholesterolMg", "Dietary cholesterol", "mg"],
] as const;

const formatAmount = (value: number) => String(Math.round(value * 10) / 10);

export function DailyNutrients({
  summary,
  dailyTargetKcal,
  loading,
  hasError,
}: {
  readonly summary: DailyFoodSummary | null;
  readonly dailyTargetKcal: number | null;
  readonly loading: boolean;
  readonly hasError: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const references = adultNutrientReferences(dailyTargetKcal);
  const referenceLabels = {
    fibreG: `Reference goal: at least ${references.fibreMinimumG} g`,
    saturatedFatG:
      references.saturatedFatMaximumG === null
        ? "Reference limit: 10% of daily energy"
        : `Reference limit: up to ${formatAmount(references.saturatedFatMaximumG)} g · 10% of calorie target`,
    totalSugarsG: "No total-sugars limit · free sugars are different",
    sodiumMg: `Reference limit: below ${references.sodiumBelowMg} mg`,
    cholesterolMg: "No general daily limit",
  };
  // Use the existing scoped summary and its bounded cache lifetime. Do not
  // expose retained aggregates while that read is pending or has failed.
  const available =
    summary !== null &&
    (summary.advancedCoverage !== undefined ||
      fields.some(([key]) => summary[key] !== undefined));

  let message: string | null = null;
  if (hasError) message = "Refresh today’s nutrition to see more nutrients.";
  else if (loading) message = "Updating today’s nutrients…";
  else if (summary === null) message = "Today’s nutrients are unavailable.";
  else if (summary.entryCount === 0) message = "No meals logged today.";
  else if (!available)
    message =
      "Daily nutrient totals are available with Pro. Saved values remain in your meal details.";

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More nutrients"
        accessibilityHint="Show or hide today’s additional nutrients and daily references"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.toggle}
      >
        <ThemedText type="smallBold">More nutrients</ThemedText>
        <ThemedText themeColor="textSecondary">
          {expanded ? "−" : "+"}
        </ThemedText>
      </Pressable>
      {expanded ? (
        <View style={styles.details}>
          {message !== null ? (
            <ThemedText type="small" themeColor="textSecondary">
              {message}
            </ThemedText>
          ) : (
            <>
              {fields.map(([key, label, unit]) => {
                const total = summary![key];
                const known = summary!.advancedCoverage?.[key];
                const subtotal = summary!.advancedKnownSubtotal?.[key];
                const complete = total != null;
                const amount = complete
                  ? total
                  : known != null && known > 0
                    ? subtotal
                    : null;
                return (
                  <View key={key} style={styles.row}>
                    <View style={styles.amountRow}>
                      <ThemedText type="smallBold" style={styles.label}>
                        {label}
                      </ThemedText>
                      <ThemedText type="smallBold">
                        {amount != null
                          ? `${formatAmount(amount)} ${unit}${complete ? "" : " recorded"}`
                          : "Not recorded"}
                      </ThemedText>
                    </View>
                    {!complete ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {known == null
                          ? "Incomplete · coverage unavailable"
                          : `Incomplete · ${known} of ${summary!.entryCount} meals recorded`}
                      </ThemedText>
                    ) : null}
                    <ThemedText type="small" themeColor="textSecondary">
                      {referenceLabels[key]}
                    </ThemedText>
                  </View>
                );
              })}
              <ThemedText type="small" themeColor="textSecondary">
                General adult WHO references, not personal targets. Totals use
                saved meal values, including any AI estimates you confirmed.
              </ThemedText>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, borderTopColor: "rgba(148, 163, 184, 0.2)" },
  toggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
  },
  details: { gap: 14 },
  row: { gap: 4 },
  amountRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  label: { flexGrow: 1, flexShrink: 1 },
});
