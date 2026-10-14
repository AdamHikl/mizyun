import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { Profile } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { Icon, IconBadge, ListGroup } from "@/components/ui";
import { CountryFlag } from "@/components/ui/country-flag";
import { CountryPickerModal } from "@/components/ui/country-picker-modal";
import { apiClient } from "@/composition/api-client";
import { MinTouchTarget, Spacing } from "@/constants/theme";
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
    <View style={styles.section}>
      <ListGroup>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            standardDisplay.isGlobal
              ? "Regional food standard: Global standard (No regional calibration). Tap to change."
              : `Regional food standard: ${standardDisplay.label}. Tap to change.`
          }
          accessibilityState={{ disabled: saving, busy: saving }}
          disabled={saving}
          onPress={() => setCountryPickerVisible(true)}
          style={({ pressed }) => [
            styles.countryRow,
            pressed && { backgroundColor: theme.backgroundSelected },
            saving && styles.disabled,
          ]}
        >
          {standardDisplay.code ? (
            <CountryFlag code={standardDisplay.code} size={24} />
          ) : (
            <IconBadge name="globe" tone="neutral" />
          )}
          <View style={styles.countryText}>
            <ThemedText type="default">
              {standardDisplay.code ? standardDisplay.label : "Global standard"}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {standardDisplay.code
                ? "Regional nutrition & portion calibration active"
                : "No regional calibration applied"}
            </ThemedText>
          </View>
          {saving ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Change
            </ThemedText>
          )}
          <Icon name="chevronRight" size={14} color="textTertiary" />
        </Pressable>
      </ListGroup>

      <ThemedText type="footnote" themeColor="textSecondary">
        Calibrates food nutrition standards, portion sizing norms, and
        restaurant databases (e.g. EU vs US portion norms, regional branded
        menus).
      </ThemedText>

      {message !== null ? (
        <ThemedText
          type="footnote"
          accessibilityRole="alert"
          themeColor={message.isError ? "danger" : "primary"}
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
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  countryRow: {
    minHeight: MinTouchTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  countryText: {
    flex: 1,
    gap: 1,
  },
  disabled: {
    opacity: 0.5,
  },
});
