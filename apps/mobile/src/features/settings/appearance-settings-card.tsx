import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon, ListGroup, ListRow } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import {
  useThemePreference,
  type ThemePreference,
} from "@/features/theme/theme-context";

interface ThemeOption {
  readonly id: ThemePreference;
  readonly title: string;
  readonly description: string;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "auto",
    title: "Auto (System)",
    description: "Follows your device's light and dark settings automatically.",
  },
  {
    id: "light",
    title: "Light",
    description: "Always uses the light appearance.",
  },
  {
    id: "dark",
    title: "Dark",
    description: "Always uses the high-contrast dark appearance.",
  },
];

export function AppearanceSettingsCard() {
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
    <View style={styles.section}>
      <ListGroup>
        {THEME_OPTIONS.map((option) => {
          const isSelected = preference === option.id;
          return (
            <ListRow
              key={option.id}
              title={option.title}
              subtitle={option.description}
              chevron={false}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`Set theme to ${option.title}`}
              onPress={() => void selectPreference(option.id)}
              trailing={
                isSelected ? (
                  <Icon name="check" size={18} color="primary" />
                ) : (
                  <View style={styles.checkPlaceholder} />
                )
              }
            />
          );
        })}
      </ListGroup>

      <ThemedText type="footnote" themeColor="textSecondary">
        Choose whether Mizyun follows your system settings or stays in light or
        dark mode.
      </ThemedText>

      {feedback ? (
        <ThemedText
          type="footnote"
          themeColor="primary"
          accessibilityLiveRegion="polite"
        >
          {feedback}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  checkPlaceholder: {
    width: 18,
    height: 18,
  },
});
