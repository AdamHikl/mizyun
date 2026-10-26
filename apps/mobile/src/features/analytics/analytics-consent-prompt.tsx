import { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card, ChoiceChip, ChoiceGroup } from "@/components/ui";
import { analyticsClient } from "@/composition/analytics-client";
import { Spacing } from "@/constants/theme";

/** Optional product-analytics choice shared by setup and the first-run card. */
export function AnalyticsConsentPrompt({
  onConsentSaved,
  onConsentChange,
}: {
  readonly onConsentSaved?: () => void;
  readonly onConsentChange?: (
    consent: "unknown" | "granted" | "denied",
  ) => void;
}) {
  const [consent, setConsent] = useState<
    "loading" | "unknown" | "granted" | "denied"
  >("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void analyticsClient.getConsent().then((current) => {
      setConsent(current);
      onConsentChange?.(current);
    });
    // Read once on mount; later changes are reported by `choose`.
  }, []);

  const choose = useCallback(
    async (next: "granted" | "denied") => {
      const saved = await analyticsClient.setConsent(next);
      setConsent(saved ? next : "unknown");
      onConsentChange?.(saved ? next : "unknown");
      if (saved && next === "granted") onConsentSaved?.();
      setMessage(
        saved
          ? next === "granted"
            ? "Optional analytics enabled. You can disable and clear it in Account."
            : "Optional analytics is off. Mizyun works the same way."
          : "The preference could not be saved, so analytics remains off.",
      );
    },
    [onConsentChange, onConsentSaved],
  );

  return (
    <Card style={styles.analyticsPrompt}>
      <ThemedText type="headline">Optional product analytics</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Help improve Mizyun by sharing which features and screens you use,
        whether actions succeed, and coarse time ranges. These optional events
        are sent to Mizyun's servers to help improve the app UI and experience,
        and are linked to your account for export and deletion. They never
        include food text, health measurements, photos, messages, or typed
        content. You can change this anytime in Account. Core features work the
        same either way.
      </ThemedText>
      <ChoiceGroup>
        <ChoiceChip
          label={consent === "granted" ? "Enabled" : "Enable"}
          selected={consent === "granted"}
          disabled={consent === "loading"}
          onPress={() => void choose("granted")}
        />
        <ChoiceChip
          label="Keep off"
          selected={consent === "denied"}
          disabled={consent === "loading"}
          onPress={() => void choose("denied")}
        />
      </ChoiceGroup>
      {message !== null ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
        >
          {message}
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  analyticsPrompt: { gap: Spacing.three },
});
