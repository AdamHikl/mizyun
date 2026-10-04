import { StyleSheet, View } from "react-native";

import { Spacing } from "@/constants/theme";

import { ThemedText } from "./themed-text";

interface BrandWordmarkProps {
  readonly suffix?: string;
}

/** Compact product identifier. */
export function BrandWordmark({ suffix }: BrandWordmarkProps) {
  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        MIZYUN
      </ThemedText>
      {suffix ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {suffix}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.one,
  },
});
