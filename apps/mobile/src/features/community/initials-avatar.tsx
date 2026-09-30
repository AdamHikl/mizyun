import React from "react";
import { StyleSheet, Text, View } from "react-native";

export const AVATAR_PALETTES = [
  { bg: "#059669", fg: "#FFFFFF" }, // Emerald 600
  { bg: "#0D9488", fg: "#FFFFFF" }, // Teal 600
  { bg: "#4F46E5", fg: "#FFFFFF" }, // Indigo 600
  { bg: "#7C3AED", fg: "#FFFFFF" }, // Violet 600
  { bg: "#E11D48", fg: "#FFFFFF" }, // Rose 600
  { bg: "#B45309", fg: "#FFFFFF" }, // Amber 700
  { bg: "#0891B2", fg: "#FFFFFF" }, // Cyan 600
  { bg: "#2563EB", fg: "#FFFFFF" }, // Blue 600
] as const;

export function getAvatarColor(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index];
}

export interface InitialsAvatarProps {
  symbol: string;
  size?: number;
  seed?: string;
  testID?: string;
  accessibilityLabel?: string;
}

export function InitialsAvatar({
  symbol,
  size = 40,
  seed,
  testID = "initials-avatar",
  accessibilityLabel,
}: InitialsAvatarProps) {
  const effectiveSeed = seed || symbol || "avatar";
  const palette = getAvatarColor(effectiveSeed);
  const fontSize = Math.round(size * 0.42);
  const borderRadius = Math.round(size / 2);
  const cleanSymbol = (symbol || "?").slice(0, 4).toUpperCase();

  return (
    <View
      testID={testID}
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel || `Avatar ${cleanSymbol}`}
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: palette.bg,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            fontSize,
            lineHeight: size,
            color: palette.fg,
          },
        ]}
        numberOfLines={1}
      >
        {cleanSymbol}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  text: {
    fontWeight: "700",
    textAlign: "center",
    includeFontPadding: false,
  },
});
