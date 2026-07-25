import { SymbolView } from "expo-symbols";
import { PropsWithChildren, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface CollapsibleProps {
  readonly children: React.ReactNode;
  /**
   * Optional title shown next to the chevron. Required in
   * uncontrolled mode; the controlled mode (when `open` is
   * provided) treats the parent as the title source and lets
   * `title` be omitted.
   */
  readonly title?: string;
  /**
   * When `open` is provided, the parent owns the open state
   * (controlled mode). When omitted, the component manages its
   * own state (uncontrolled mode). AI-MOB-002 uses controlled
   * mode for the evidence-chips list so only one chip is open
   * at a time.
   */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

export function Collapsible({
  children,
  title,
  open,
  onOpenChange,
}: PropsWithChildren<CollapsibleProps>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const theme = useTheme();

  return (
    <ThemedView>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        style={({ pressed }) => [
          styles.heading,
          pressed && styles.pressedHeading,
        ]}
        onPress={() => {
          if (isControlled) onOpenChange?.(!isOpen);
          else setInternalOpen(!isOpen);
        }}
      >
        <ThemedView type="backgroundElement" style={styles.button}>
          <SymbolView
            name={{
              ios: "chevron.right",
              android: "chevron_right",
              web: "chevron_right",
            }}
            size={14}
            weight="bold"
            tintColor={theme.text}
            style={{ transform: [{ rotate: isOpen ? "-90deg" : "90deg" }] }}
          />
        </ThemedView>

        {title !== undefined ? (
          <ThemedText type="small">{title}</ThemedText>
        ) : null}
      </Pressable>
      {isOpen && (
        <Animated.View entering={FadeIn.duration(200)}>
          <ThemedView type="backgroundElement" style={styles.content}>
            {children}
          </ThemedView>
        </Animated.View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  pressedHeading: {
    opacity: 0.7,
  },
  button: {
    width: Spacing.four,
    height: Spacing.four,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    marginLeft: Spacing.four,
    padding: Spacing.four,
  },
});
