import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Spacing } from "@/constants/theme";

import { ThemedText } from "./themed-text";
import { BetaNoticeModal } from "./beta-notice";

interface BrandWordmarkProps {
  readonly suffix?: string;
}

/** Compact product identifier and beta-disclosure entry point. */
export function BrandWordmark({ suffix }: BrandWordmarkProps) {
  const [isBetaNoticeVisible, setBetaNoticeVisible] = useState(false);

  return (
    <>
      <View style={styles.container}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          MIZYUN
        </ThemedText>
        <Pressable
          accessibilityHint="Opens information about Mizyun beta testing"
          accessibilityLabel="Mizyun Beta"
          accessibilityRole="button"
          accessibilityState={{ expanded: isBetaNoticeVisible }}
          hitSlop={8}
          onPress={() => setBetaNoticeVisible(true)}
          style={({ pressed }) => [styles.badge, pressed && styles.pressed]}
        >
          <ThemedText type="smallBold" style={styles.badgeLabel}>
            BETA
          </ThemedText>
        </Pressable>
        {suffix ? (
          <ThemedText type="smallBold" themeColor="textSecondary">
            {suffix}
          </ThemedText>
        ) : null}
      </View>
      <BetaNoticeModal
        onClose={() => setBetaNoticeVisible(false)}
        visible={isBetaNoticeVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.one,
  },
  badge: {
    backgroundColor: "#0C70ED",
    borderRadius: 9999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeLabel: {
    color: "#FFFFFF",
    fontSize: 9,
    letterSpacing: 0.6,
    lineHeight: 12,
  },
  pressed: {
    opacity: 0.75,
  },
});
