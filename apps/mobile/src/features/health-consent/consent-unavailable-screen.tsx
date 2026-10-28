import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui";
import { MaxContentWidth, PageGutter, Spacing } from "@/constants/theme";

/** Shown when neither the server nor this device knows the consent answer. */
export function ConsentUnavailableScreen({
  onRetry,
  onSignOut,
}: {
  readonly onRetry: () => void;
  readonly onSignOut: () => void;
}) {
  return (
    <ThemedView style={styles.page}>
      <View style={styles.content}>
        <ThemedText type="subtitle" accessibilityRole="header">
          Can't reach Mizyun
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          Check your connection and try again.
        </ThemedText>
        <Button label="Try again" block onPress={onRetry} />
        <Button label="Sign out" variant="plain" onPress={onSignOut} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    gap: Spacing.three,
  },
});
