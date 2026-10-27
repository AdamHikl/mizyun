import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LegalLinks } from "@/components/legal-links";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button, Card, Icon } from "@/components/ui";
import {
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
import { AccountDataCard } from "@/features/settings/account-data-card";
import { useTheme } from "@/hooks/use-theme";

export const HEALTH_DATA_CONSENT_LABEL =
  "I agree that Mizyun may store and use my health data as described above.";

/**
 * The "Your health data" step (PRIV-01). Shown after sign-up and before any
 * health data is collected, and to existing users before further logging.
 * The checkbox starts unticked and is separate from the Terms.
 */
export function HealthDataConsentScreen({
  withdrawn,
  onAgree,
  onSignOut,
}: {
  /** The user withdrew earlier (changes the export/delete wording). */
  readonly withdrawn: boolean;
  /** Saves the grant; resolves to an error message, or null on success. */
  readonly onAgree: () => Promise<string | null>;
  readonly onSignOut: () => void;
}) {
  const theme = useTheme();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);

  const agree = async () => {
    if (!checked || saving) return;
    setSaving(true);
    setError(null);
    const message = await onAgree();
    setSaving(false);
    setError(message);
  };

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title" accessibilityRole="header">
            Your health data
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            Mizyun is a health and fitness tracker, so the things you log are
            health data. We need your permission to store them.
          </ThemedText>
          <Card>
            <ThemedText type="smallBold">What we store</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your weight and body measurements, height, birth year, sex at
              birth, activity level, goals, meals, workouts, runs and climbing
              sessions, and anything else you choose to log.
            </ThemedText>
            <ThemedText type="smallBold">Why</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              To keep your logs in your account and show your history, trends
              and energy estimates. Mizyun does not sell your data or use it for
              advertising. AI features and Community ask for their own
              permission separately.
            </ThemedText>
            <ThemedText type="smallBold">Your choice</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              You can withdraw at any time in Settings → Privacy & data. The app
              then stops collecting new health data and asks again before you
              can continue. Withdrawing doesn't delete what you've already
              saved; you can export it or delete your account.
            </ThemedText>
          </Card>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={HEALTH_DATA_CONSENT_LABEL}
            onPress={() => {
              setChecked((value) => !value);
              setError(null);
            }}
            style={styles.checkRow}
          >
            <View
              style={[
                styles.box,
                {
                  borderColor: checked ? theme.primary : theme.border,
                  backgroundColor: checked ? theme.primary : "transparent",
                },
              ]}
            >
              {checked ? (
                <Icon name="check" size={16} color="onPrimary" />
              ) : null}
            </View>
            <ThemedText type="small" style={styles.checkLabel}>
              {HEALTH_DATA_CONSENT_LABEL}
            </ThemedText>
          </Pressable>

          {error ? (
            <ThemedText
              type="footnote"
              themeColor="danger"
              accessibilityRole="alert"
            >
              {error}
            </ThemedText>
          ) : null}

          <Button
            label="Continue"
            block
            loading={saving}
            disabled={!checked}
            onPress={() => void agree()}
          />
          <LegalLinks intro="Read the details:" />

          <ThemedText type="small" themeColor="textSecondary">
            {withdrawn
              ? "You withdrew your consent earlier. Without it, Mizyun can't keep tracking your health, but you can still download or delete your data."
              : "Don't want to agree? You can still download or delete any data already in your account."}
          </ThemedText>
          <Button
            label={
              showData ? "Hide export and delete" : "Export or delete my data"
            }
            variant="plain"
            onPress={() => setShowData((value) => !value)}
          />
          {showData ? <AccountDataCard /> : null}
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
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: MinTouchTarget,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: { flex: 1 },
});
