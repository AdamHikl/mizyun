import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { router, type Href } from "expo-router";
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { ThemedText } from "./themed-text";

export interface FeedbackHeaderButtonProps {
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Global header button that opens the feedback & review modal.
 * Placed to the right of the "MIZYUN" brand eyebrow across main tabs.
 */
export function FeedbackHeaderButton({ style }: FeedbackHeaderButtonProps) {
  const colors = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send feedback or report an issue"
      onPress={() => router.push("/feedback" as Href)}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.backgroundElement,
          borderColor: colors.border,
        },
        pressed && styles.pressed,
        style,
      ]}
    >
      <ThemedText style={styles.icon}>💬</ThemedText>
      <ThemedText type="smallBold" style={styles.label}>
        Feedback
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  pressed: {
    opacity: 0.7,
  },
  icon: {
    fontSize: 11,
    lineHeight: 14,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
  },
});
