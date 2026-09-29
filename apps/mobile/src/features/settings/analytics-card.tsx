import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { analyticsClient } from "@/composition/analytics-client";
import { Spacing } from "@/constants/theme";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";

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
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Optional product analytics</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Help improve Mizyun’s UI and features by sharing coarse screen use, flow
        completions, and failure stages. Events are sent to Mizyun’s servers and
        linked to your account. They never include food names, health values,
        photos, messages, tokens, or personal inputs. Retained events cover up
        to 30 days. You can disable collection and clear your data at any time.
      </ThemedText>
      <ThemedText type="smallBold">
        {consent === "loading"
          ? "Loading preference…"
          : enabled
            ? eventCount > 0
              ? `Enabled · ${eventCount} event${eventCount === 1 ? "" : "s"} in local queue`
              : "Enabled · synced with server"
            : "Off"}
      </ThemedText>
      <View style={styles.analyticsActions}>
        <AnalyticsButton
          label={enabled ? "Enabled" : "Enable"}
          disabled={consent === "loading" || enabled}
          onPress={() => void chooseConsent("granted")}
        />
        <AnalyticsButton
          label="Disable and clear"
          disabled={consent === "loading" || !enabled}
          onPress={() => void chooseConsent("denied")}
        />
        <AnalyticsButton
          label="Export"
          disabled={!enabled}
          onPress={() => void shareExport()}
        />
        <AnalyticsButton
          label="Clear"
          disabled={!enabled}
          onPress={() => void clearEvents()}
        />
      </View>
      {message !== null ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
        >
          {message}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

function AnalyticsButton({
  label,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.analyticsButton,
        pressed && styles.pressed,
        disabled && styles.analyticsButtonDisabled,
      ]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.four,
    borderRadius: 16,
    gap: Spacing.three,
  },
  analyticsActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  analyticsButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(128, 128, 128, 0.15)",
    minHeight: 44,
    justifyContent: "center",
  },
  analyticsButtonDisabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.7,
  },
});
