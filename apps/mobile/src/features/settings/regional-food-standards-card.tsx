import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { Profile } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { CountryFlag } from "@/components/ui/country-flag";
import { CountryPickerModal } from "@/components/ui/country-picker-modal";
import { apiClient } from "@/composition/api-client";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

import {
  getCountryStandardDisplay,
  saveCountryStandard,
} from "./regional-food-standards-data";

export interface RegionalFoodStandardsCardProps {
  readonly profile: Profile;
  readonly onSaved: () => Promise<void>;
}

export function RegionalFoodStandardsCard({
  profile,
  onSaved,
}: RegionalFoodStandardsCardProps) {
  const theme = useTheme();
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    readonly text: string;
    readonly isError: boolean;
  } | null>(null);

  const countryCode = profile.coachingPreferences?.countryCode ?? null;
  const standardDisplay = getCountryStandardDisplay(countryCode);

  const handleSelectCountry = useCallback(
    async (nextCountryCode: string | null) => {
      setCountryPickerVisible(false);
      const normalizedNext = nextCountryCode?.trim().toUpperCase() ?? null;
      if (normalizedNext === countryCode) return;

      setSaving(true);
      setMessage(null);

      const result = await saveCountryStandard(
        apiClient,
        profile,
        normalizedNext,
      );

      setSaving(false);
      if (result.ok) {
        const nextDisplay = getCountryStandardDisplay(normalizedNext);
        setMessage({
          text: nextDisplay.isGlobal
            ? "Reset to Global standard."
            : `Regional standard updated to ${nextDisplay.label}.`,
          isError: false,
        });
        await onSaved();
      } else {
        setMessage({
          text: result.message,
          isError: true,
        });
      }
    },
    [countryCode, onSaved, profile],
  );

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Food & Portion Standards</ThemedText>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        style={styles.description}
      >
        Calibrates food nutrition standards, portion sizing norms, and
        restaurant databases (e.g. EU vs US portion norms, regional branded
        menus).
      </ThemedText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          standardDisplay.isGlobal
            ? "Regional food standard: Global standard (No regional calibration). Tap to change."
            : `Regional food standard: ${standardDisplay.label}. Tap to change.`
        }
        accessibilityState={{ disabled: saving }}
        disabled={saving}
        onPress={() => setCountryPickerVisible(true)}
        style={({ pressed }) => [
          styles.countryTrigger,
          pressed && styles.pressed,
          saving && styles.disabled,
        ]}
      >
        <View style={styles.countryTriggerLeft}>
          {standardDisplay.code ? (
            <>
              <CountryFlag code={standardDisplay.code} size={24} />
              <View style={styles.countryInfoCol}>
                <ThemedText
                  type="default"
                  style={styles.countryTriggerText}
                  numberOfLines={1}
                >
                  {standardDisplay.label}
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={1}
                >
                  Regional nutrition & portion calibration active
                </ThemedText>
              </View>
            </>
          ) : (
            <>
              <ThemedText style={styles.globalIcon}>🌐</ThemedText>
              <View style={styles.countryInfoCol}>
                <ThemedText
                  type="default"
                  themeColor="textSecondary"
                  style={styles.countryTriggerText}
                  numberOfLines={1}
                >
                  Global standard
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={1}
                >
                  No regional calibration applied
                </ThemedText>
              </View>
            </>
          )}
        </View>

        <View style={styles.countryTriggerRight}>
          {saving ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <ThemedText
              type="smallBold"
              themeColor="primary"
              style={styles.changeActionText}
            >
              Change ›
            </ThemedText>
          )}
        </View>
      </Pressable>

      {message !== null ? (
        <ThemedText
          type="small"
          accessibilityRole="alert"
          themeColor={message.isError ? "textSecondary" : "primary"}
          style={styles.feedbackMessage}
        >
          {message.text}
        </ThemedText>
      ) : null}

      <CountryPickerModal
        visible={countryPickerVisible}
        selectedCode={countryCode}
        onSelect={(code) => void handleSelectCountry(code)}
        onClose={() => setCountryPickerVisible(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  description: {
    lineHeight: 18,
  },
  countryTrigger: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    backgroundColor: "rgba(22, 29, 34, 0.6)",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  countryTriggerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.three,
  },
  countryInfoCol: {
    flex: 1,
    justifyContent: "center",
  },
  countryTriggerText: {
    fontSize: 15,
  },
  countryTriggerRight: {
    marginLeft: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
  },
  changeActionText: {
    marginLeft: Spacing.two,
  },
  globalIcon: {
    fontSize: 24,
  },
  feedbackMessage: {
    marginTop: Spacing.one,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
});
