/**
 * AI-MOB-002 — Render CoachMessage.evidenceKinds as an elegant,
 * expandable data-source badge with humanized descriptions and icons.
 */

import { useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  UIManager,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Icon, type IconName } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface EvidenceMeta {
  readonly label: string;
  readonly icon: IconName;
  readonly description: string;
}

const EVIDENCE_META: Readonly<Record<string, EvidenceMeta>> = {
  profile: {
    label: "Profile & Setup",
    icon: "person",
    description:
      "Your confirmed experience, available equipment, schedule, and preferences.",
  },
  goal: {
    label: "Active Goal",
    icon: "target",
    description: "Your active goal target, pace preference, and timeframe.",
  },
  training: {
    label: "Workout History",
    icon: "dumbbell",
    description:
      "Your completed workouts, sets, and exercise performance from the last 28 days.",
  },
  body: {
    label: "Body & Weight Trend",
    icon: "scale",
    description: "Your confirmed weight measurements and smoothed body trends.",
  },
  nutrition: {
    label: "Nutrition Log",
    icon: "fork",
    description:
      "Your confirmed food entries and daily calorie/macronutrient totals.",
  },
  energy: {
    label: "Energy Model",
    icon: "energy",
    description:
      "Deterministic BMR/TDEE calculation and surplus/deficit targets.",
  },
  plan: {
    label: "Prescription Engine",
    icon: "calendar",
    description: "Deterministic exercise prescription and volume rules.",
  },
  memory: {
    label: "Recalled Context",
    icon: "history",
    description: "Context retrieved from your personal memory store.",
  },
  tool: {
    label: "Live Tool",
    icon: "search",
    description: "Read-only live context queried by Coach.",
  },
};

export const resolveMeta = (kind: string): EvidenceMeta =>
  EVIDENCE_META[kind] ?? {
    label: kind.charAt(0).toUpperCase() + kind.slice(1),
    icon: "info",
    description: `Verified ${kind} records.`,
  };

export function formatEvidenceSummary(kinds: readonly string[]): string {
  const uniqueKinds = Array.from(new Set(kinds));
  if (uniqueKinds.length === 0) return "";
  const labels = uniqueKinds.map((k) => resolveMeta(k).label);
  const remainingCount = labels.length - 1;
  return remainingCount <= 0
    ? labels[0]
    : `${labels[0]} +${remainingCount} more`;
}

export interface EvidenceChipsProps {
  readonly kinds: readonly string[];
}

export function EvidenceChips({ kinds }: EvidenceChipsProps) {
  const [expanded, setExpanded] = useState(false);
  const uniqueKinds = Array.from(new Set(kinds));
  if (uniqueKinds.length === 0) return null;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  const labels = uniqueKinds.map((k) => resolveMeta(k).label);
  const summaryText = formatEvidenceSummary(uniqueKinds);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sources used: ${labels.join(", ")}`}
        accessibilityState={{ expanded }}
        onPress={toggle}
        hitSlop={6}
        style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
      >
        <ThemedView type="backgroundSelected" style={styles.togglePill}>
          <Icon name="checkCircle" size={13} color="primary" />
          <ThemedText
            type="footnote"
            themeColor="textSecondary"
            style={styles.toggleLabel}
          >
            Based on {summaryText}
          </ThemedText>
          <Icon
            name={expanded ? "chevronUp" : "chevronDown"}
            size={11}
            color="textSecondary"
          />
        </ThemedView>
      </Pressable>

      {expanded ? (
        <ThemedView type="backgroundSelected" style={styles.detailCard}>
          <ThemedText type="smallBold">Verified data sources</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Coach referenced your confirmed account data to build this response:
          </ThemedText>
          <View style={styles.sourcesList}>
            {kinds.map((kind) => {
              const meta = resolveMeta(kind);
              return (
                <View key={kind} style={styles.sourceItem}>
                  <Icon
                    name={meta.icon}
                    size={16}
                    color="textSecondary"
                    style={styles.sourceIcon}
                  />
                  <View style={styles.sourceContent}>
                    <ThemedText type="smallBold">{meta.label}</ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {meta.description}
                    </ThemedText>
                  </View>
                </View>
              );
            })}
          </View>
        </ThemedView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.one,
    maxWidth: "100%",
  },
  toggleRow: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: 32,
    justifyContent: "center",
  },
  togglePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.one,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    maxWidth: "100%",
    gap: 6,
  },
  toggleLabel: {
    flexShrink: 1,
  },
  detailCard: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    gap: Spacing.two,
    maxWidth: "100%",
  },
  sourcesList: {
    gap: Spacing.two,
  },
  sourceItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  sourceIcon: {
    marginTop: 1,
  },
  sourceContent: {
    flex: 1,
    gap: Spacing.half,
  },
  pressed: { opacity: 0.6 },
});
