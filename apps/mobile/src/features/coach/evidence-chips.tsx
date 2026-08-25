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
import { Spacing } from "@/constants/theme";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface EvidenceMeta {
  readonly label: string;
  readonly icon: string;
  readonly description: string;
}

const EVIDENCE_META: Readonly<Record<string, EvidenceMeta>> = {
  profile: {
    label: "Profile & Setup",
    icon: "👤",
    description:
      "Your confirmed experience, available equipment, schedule, and preferences.",
  },
  goal: {
    label: "Active Goal",
    icon: "🎯",
    description: "Your active goal target, pace preference, and timeframe.",
  },
  training: {
    label: "Workout History",
    icon: "🏋️",
    description:
      "Your completed workouts, sets, and exercise performance from the last 28 days.",
  },
  body: {
    label: "Body & Weight Trend",
    icon: "📈",
    description: "Your confirmed weight measurements and smoothed body trends.",
  },
  nutrition: {
    label: "Nutrition Log",
    icon: "🥗",
    description:
      "Your confirmed food entries and daily calorie/macronutrient totals.",
  },
  energy: {
    label: "Energy Model",
    icon: "🔥",
    description:
      "Deterministic BMR/TDEE calculation and surplus/deficit targets.",
  },
  plan: {
    label: "Prescription Engine",
    icon: "⚡",
    description: "Deterministic exercise prescription and volume rules.",
  },
  memory: {
    label: "Recalled Context",
    icon: "🧠",
    description: "Context retrieved from your personal memory store.",
  },
  tool: {
    label: "Live Tool",
    icon: "🛠️",
    description: "Read-only live context queried by Coach.",
  },
};

const resolveMeta = (kind: string): EvidenceMeta =>
  EVIDENCE_META[kind] ?? {
    label: kind.charAt(0).toUpperCase() + kind.slice(1),
    icon: "📋",
    description: `Verified ${kind} records.`,
  };

export interface EvidenceChipsProps {
  readonly kinds: readonly string[];
}

export function EvidenceChips({ kinds }: EvidenceChipsProps) {
  const [expanded, setExpanded] = useState(false);
  if (kinds.length === 0) return null;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  const labels = kinds.map((k) => resolveMeta(k).label);
  const summaryText =
    labels.length <= 2
      ? labels.join(" & ")
      : `${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sources used: ${labels.join(", ")}`}
        accessibilityState={{ expanded }}
        onPress={toggle}
        style={styles.toggleRow}
      >
        <ThemedText style={styles.badgeIcon}>⚡</ThemedText>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.toggleLabel}
        >
          Based on {summaryText}
        </ThemedText>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.chevron}
        >
          {expanded ? "▲" : "▼"}
        </ThemedText>
      </Pressable>

      {expanded ? (
        <View style={styles.detailCard}>
          <ThemedText type="smallBold" style={styles.cardHeading}>
            Verified Data Sources
          </ThemedText>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.cardSubheading}
          >
            Coach referenced your confirmed account data to build this response:
          </ThemedText>
          <View style={styles.sourcesList}>
            {kinds.map((kind) => {
              const meta = resolveMeta(kind);
              return (
                <View key={kind} style={styles.sourceItem}>
                  <ThemedText style={styles.sourceIcon}>{meta.icon}</ThemedText>
                  <View style={styles.sourceContent}>
                    <ThemedText type="smallBold">{meta.label}</ThemedText>
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.sourceDescription}
                    >
                      {meta.description}
                    </ThemedText>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.two,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 8,
    alignSelf: "flex-start",
    gap: 6,
  },
  badgeIcon: {
    fontSize: 12,
  },
  toggleLabel: {
    fontSize: 12,
  },
  chevron: {
    fontSize: 10,
    marginLeft: 2,
  },
  detailCard: {
    marginTop: Spacing.one,
    padding: Spacing.three,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    gap: Spacing.two,
  },
  cardHeading: {
    fontSize: 13,
  },
  cardSubheading: {
    fontSize: 12,
    marginTop: -Spacing.one,
  },
  sourcesList: {
    gap: Spacing.two,
    marginTop: 2,
  },
  sourceItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  sourceIcon: {
    fontSize: 16,
    marginTop: 1,
  },
  sourceContent: {
    flex: 1,
    gap: 2,
  },
  sourceDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
});
