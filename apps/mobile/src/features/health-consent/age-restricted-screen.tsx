import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui";
import { MaxContentWidth, PageGutter, Spacing } from "@/constants/theme";
import { AccountDataCard } from "@/features/settings/account-data-card";

/**
 * Shown when the stored birth year belongs to someone under 18 (PRIV-02).
 * Nothing else in the app is reachable; the user can export or delete their
 * data, or sign out.
 */
export function AgeRestrictedScreen({
  onSignOut,
}: {
  readonly onSignOut: () => void;
}) {
  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title" accessibilityRole="header">
            Mizyun is for adults
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            Thanks for trying Mizyun. It's made for people aged 18 and over, and
            the birth year on this account says you're younger, so we can't keep
            it open. You can download a copy of your data or delete the account
            below. If the birth year is wrong, contact
            support@mizyun.phiskel.com.
          </ThemedText>
          <AccountDataCard />
          <Button label="Sign out" variant="plain" onPress={onSignOut} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
  },
});
