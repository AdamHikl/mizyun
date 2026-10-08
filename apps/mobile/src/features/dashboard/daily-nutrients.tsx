import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import type { DailyFoodSummary } from "@mizyun/contracts";
import { adultNutrientReferences } from "@mizyun/core";
import { ThemedText } from "@/components/themed-text";

const fields = [
  ["fibreG", "Fibre", "g", "#10B981"],
  ["saturatedFatG", "Saturated fat", "g", "#8B5CF6"],
  ["totalSugarsG", "Total sugars", "g", "#F59E0B"],
  ["sodiumMg", "Sodium", "mg", "#10B981"],
  ["cholesterolMg", "Dietary cholesterol", "mg", "#8B5CF6"],
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
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.3;
  const references = adultNutrientReferences(dailyTargetKcal);
  const referenceAmounts = {
    fibreG: references.fibreMinimumG,
    saturatedFatG: references.saturatedFatMaximumG,
    totalSugarsG: null,
    sodiumMg: references.sodiumBelowMg,
    cholesterolMg: null,
  };
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
              <View style={styles.grid}>
                {fields.map(([key, label, unit, color]) => {
                  const total = summary![key];
                  const known = summary!.advancedCoverage?.[key];
                  const subtotal = summary!.advancedKnownSubtotal?.[key];
                  const complete = total != null;
                  const amount = complete
                    ? total
                    : known != null && known > 0
                      ? subtotal
                      : null;
                  const amountLabel =
                    amount != null
                      ? `${formatAmount(amount)} ${unit}${complete ? "" : " recorded"}`
                      : "Not recorded";
                  const coverageLabel = complete
                    ? null
                    : known == null
                      ? "Incomplete · coverage unavailable"
                      : `Incomplete · ${known} of ${summary!.entryCount} meals recorded`;
                  const referenceAmount = referenceAmounts[key];
                  const recordedMeals = complete ? summary!.entryCount : known;
                  const coverageProgressLabel =
                    referenceAmount === null
                      ? recordedMeals == null
                        ? "Meal coverage unavailable"
                        : `Meal coverage: ${recordedMeals} of ${summary!.entryCount} recorded`
                      : null;
                  const percent =
                    amount != null && referenceAmount != null
                      ? Math.max(
                          0,
                          Math.min(100, (amount / referenceAmount) * 100),
                        )
                      : referenceAmount === null && recordedMeals != null
                        ? Math.max(
                            0,
                            Math.min(
                              100,
                              (recordedMeals / summary!.entryCount) * 100,
                            ),
                          )
                        : 0;
                  return (
                    <View
                      key={key}
                      style={[styles.card, stacked && styles.stackedCard]}
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={[
                        label,
                        amountLabel,
                        coverageLabel,
                        referenceLabels[key],
                        coverageProgressLabel,
                      ]
                        .filter(Boolean)
                        .join(". ")}
                    >
                      <View style={styles.header}>
                        <View
                          style={[styles.dot, { backgroundColor: color }]}
                        />
                        <ThemedText
                          type="smallBold"
                          style={[styles.label, { color }]}
                        >
                          {label}
                        </ThemedText>
                      </View>
                      <View
                        style={styles.track}
                        testID={`daily-nutrient-${key}-progress`}
                        accessible={false}
                      >
                        <View
                          style={[
                            styles.fill,
                            { backgroundColor: color, width: `${percent}%` },
                          ]}
                        />
                      </View>
                      <ThemedText type="smallBold" style={styles.amount}>
                        {amountLabel}
                      </ThemedText>
                      {coverageLabel !== null ? (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          style={styles.caption}
                        >
                          {coverageLabel}
                        </ThemedText>
                      ) : null}
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        style={styles.caption}
                      >
                        {referenceLabels[key]}
                      </ThemedText>
                      {coverageProgressLabel !== null ? (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          style={styles.caption}
                        >
                          {coverageProgressLabel}
                        </ThemedText>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.caption}
              >
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
  details: { gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: {
    flexBasis: "45%",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 128,
    padding: 8,
    borderRadius: 12,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    gap: 6,
  },
  stackedCard: { flexBasis: "100%" },
  header: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { flexShrink: 1, fontSize: 12, fontWeight: "700", lineHeight: 18 },
  track: {
    height: 4,
    backgroundColor: "rgba(148, 163, 184, 0.2)",
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 2 },
  amount: { fontSize: 11, fontWeight: "700", lineHeight: 16 },
  caption: { fontSize: 11, lineHeight: 16 },
});
