import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import {
  useThemePreference,
  type ThemePreference,
} from "@/features/theme/theme-context";
import { useTheme } from "@/hooks/use-theme";

interface ThemeOption {
  readonly id: ThemePreference;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "auto",
    title: "Auto (System)",
    description: "Follows your device's light and dark settings automatically.",
    icon: "📱",
  },
  {
    id: "light",
    title: "Light",
    description: "Always uses the light appearance.",
    icon: "☀️",
  },
  {
    id: "dark",
    title: "Dark",
    description: "Always uses the high-contrast dark appearance.",
    icon: "🌙",
  },
];

export function AppearanceSettingsCard() {
  const theme = useTheme();
  const { preference, setPreference } = useThemePreference();
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectPreference = useCallback(
    async (nextPref: ThemePreference) => {
      const option = THEME_OPTIONS.find((opt) => opt.id === nextPref);
      await setPreference(nextPref);
      setFeedback(`Saved: ${option?.title ?? nextPref} appearance`);
    },
    [setPreference],
  );

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          DISPLAY & APPEARANCE
        </ThemedText>
        <ThemedText type="subtitle">Theme Mode</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Choose whether Mizyun follows your system settings or stays in light
          or dark mode.
        </ThemedText>
      </View>

      <View style={styles.optionsList}>
        {THEME_OPTIONS.map((option) => {
          const isSelected = preference === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`Set theme to ${option.title}`}
              onPress={() => void selectPreference(option.id)}
              style={({ pressed }) => [
                styles.optionRow,
                {
                  borderColor: isSelected ? theme.primary : theme.border,
                  backgroundColor: isSelected
                    ? theme.backgroundSelected
                    : theme.background,
                },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.iconBox}>
                <ThemedText style={styles.icon}>{option.icon}</ThemedText>
              </View>

              <View style={styles.contentBox}>
                <ThemedText type="smallBold" style={styles.optionTitle}>
                  {option.title}
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.optionDescription}
                >
                  {option.description}
                </ThemedText>
              </View>

              <View
                style={[
                  styles.radioCircle,
                  {
                    borderColor: isSelected ? theme.primary : theme.border,
                    backgroundColor: isSelected ? theme.primary : "transparent",
                  },
                ]}
              >
                {isSelected ? (
                  <ThemedText style={styles.radioCheckmark}>✓</ThemedText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {feedback ? (
        <ThemedText
          type="small"
          style={[styles.feedbackText, { color: theme.primary }]}
        >
          {feedback}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.one,
  },
  optionsList: {
    gap: Spacing.two,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.three,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.75,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 20,
  },
  contentBox: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: 15,
  },
  optionDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioCheckmark: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "bold",
    lineHeight: 14,
  },
  feedbackText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
