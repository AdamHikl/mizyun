import { ThemedText } from "@/components/themed-text";
import { Button, Card } from "@/components/ui";
import { analyticsClient } from "@/composition/analytics-client";
import { Spacing } from "@/constants/theme";
import React, { useCallback, useEffect, useState } from "react";
import { Share, StyleSheet, View } from "react-native";

export function AnalyticsCard() {
  const [consent, setConsent] = useState<
    "loading" | "unknown" | "granted" | "denied"
  >("loading");
  const [eventCount, setEventCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const refreshAnalytics = useCallback(async () => {
    const [nextConsent, events] = await Promise.all([
      analyticsClient.getConsent(),
      analyticsClient.list(),
    ]);
    setConsent(nextConsent);
    setEventCount(events.length);
  }, []);

  useEffect(() => {
    void refreshAnalytics();
  }, [refreshAnalytics]);

  const chooseConsent = useCallback(
    async (next: "granted" | "denied") => {
      setMessage(null);
      const saved = await analyticsClient.setConsent(next);
      if (!saved) {
        setMessage(
          "The analytics preference could not be saved. Mizyun remains usable and analytics stays off.",
        );
      }
      await refreshAnalytics();
    },
    [refreshAnalytics],
  );

  const shareExport = useCallback(async () => {
    const value = await analyticsClient.export();
    if (value.events.length === 0) {
      setMessage("There are no local analytics events to export.");
      return;
    }
    try {
      await Share.share({
        title: "Mizyun product analytics export",
        message: JSON.stringify(value, null, 2),
      });
      setMessage("The system share sheet opened with your local export.");
    } catch {
      setMessage(
        "The export could not be shared. Your Mizyun data is unaffected.",
      );
    }
  }, []);

  const clearEvents = useCallback(async () => {
    const cleared = await analyticsClient.clear();
    setMessage(
      cleared
        ? "Local analytics events cleared."
        : "Local analytics could not be cleared. Your Mizyun data is unaffected.",
    );
    await refreshAnalytics();
  }, [refreshAnalytics]);

  const enabled = consent === "granted";

  return (
    <View style={styles.section}>
      <Card>
        <ThemedText type="headline">Help improve Mizyun</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Optional usage analytics · Separate from AI consent. Mizyun works the
          same either way.
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Help improve Mizyun’s UI and features by sharing coarse screen use,
          flow completions, and failure stages. Events are sent to Mizyun’s
          servers and linked to your account. They never include food names,
          health values, photos, messages, tokens, or personal inputs. Retained
          events cover up to 30 days. You can disable collection and clear your
          data at any time.
        </ThemedText>

        <ThemedText type="smallBold" accessibilityLiveRegion="polite">
          {consent === "loading"
            ? "Loading preference…"
            : enabled
              ? eventCount > 0
                ? `Enabled · ${eventCount} event${eventCount === 1 ? "" : "s"} in local queue`
                : "Enabled · synced with server"
              : "Off"}
        </ThemedText>
        <View style={styles.actions}>
          <Button
            label={enabled ? "Enabled" : "Allow usage analytics"}
            // Consent choices are deliberately equal in weight (no nudge).
            variant="secondary"
            size="small"
            disabled={consent === "loading" || enabled}
            onPress={() => void chooseConsent("granted")}
          />
          <Button
            label="Disable and clear"
            variant="secondary"
            size="small"
            disabled={consent === "loading" || !enabled}
            onPress={() => void chooseConsent("denied")}
          />
          <Button
            label="Export"
            variant="secondary"
            size="small"
            icon="share"
            disabled={!enabled}
            onPress={() => void shareExport()}
          />
          <Button
            label="Clear"
            variant="secondary"
            size="small"
            disabled={!enabled}
            onPress={() => void clearEvents()}
          />
        </View>
      </Card>
      {message !== null ? (
        <ThemedText
          type="footnote"
          themeColor="textSecondary"
          accessibilityRole="alert"
        >
          {message}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
});
