import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import {
  getAppVariant,
  isProgressPhotosEnabled,
} from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import { router } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getSettingsForCategory,
  SETTINGS_CATEGORIES,
  type SettingsAvailabilityContext,
  type SettingsCategoryId,
} from "./settings-catalog";
import { navigateToSetting } from "./settings-destinations";

export function SettingsCategoryScreen({
  categoryId,
}: {
  readonly categoryId: string;
}) {
  const insets = useSafeAreaInsets();
  const { session, profile } = useAuth();

  const categoryDef = useMemo(
    () => SETTINGS_CATEGORIES.find((cat) => cat.id === categoryId),
    [categoryId],
  );

  const availabilityContext: SettingsAvailabilityContext = useMemo(
    () => ({
      isSignedIn: session !== null,
      hasProfile: profile !== null,
      isProgressPhotosEnabled: isProgressPhotosEnabled(),
      isHealthPreviewEnabled: getAppVariant() === "dev",
      isSetupComplete: Boolean(profile?.displayName),
    }),
    [session, profile],
  );

  const items = useMemo(() => {
    if (!categoryDef) return [];
    return getSettingsForCategory(
      categoryDef.id as SettingsCategoryId,
      availabilityContext,
    );
  }, [categoryDef, availabilityContext]);

  if (!categoryDef) {
    return (
      <ThemedView style={styles.page}>
        <View style={styles.centerContainer}>
          <ThemedText type="subtitle">Category Not Found</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            This category is not available or has moved.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <ThemedText type="smallBold">Go Back</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  const topPadding = Math.max(insets.top, 16) + Spacing.two;
  const bottomPadding = BottomTabInset + insets.bottom + Spacing.six;

  return (
    <ThemedView style={styles.page}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: topPadding,
            paddingBottom: bottomPadding,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Category Header */}
        <View style={styles.header}>
          <View style={styles.iconBox}>
            <ThemedText style={styles.icon}>{categoryDef.icon}</ThemedText>
          </View>
          <View style={styles.headerText}>
            <ThemedText type="subtitle">{categoryDef.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {categoryDef.shortDescription}
            </ThemedText>
          </View>
        </View>

        {/* List of Settings in this Category */}
        <View style={styles.itemsList}>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}, ${item.description}`}
              onPress={() => navigateToSetting(item)}
              style={({ pressed }) => [
                styles.itemRow,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.itemTextContent}>
                <ThemedText type="smallBold" style={styles.itemLabel}>
                  {item.label}
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={2}
                  style={styles.itemDescription}
                >
                  {item.description}
                </ThemedText>
              </View>
              <ThemedText style={styles.itemArrow}>›</ThemedText>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.four,
    gap: Spacing.four,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(128, 128, 128, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 24,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  itemsList: {
    gap: Spacing.two,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.four,
    borderRadius: 14,
    backgroundColor: "rgba(128, 128, 128, 0.08)",
    minHeight: 56,
  },
  itemTextContent: {
    flex: 1,
    gap: 4,
    paddingRight: Spacing.two,
  },
  itemLabel: {
    fontSize: 15,
  },
  itemDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  itemArrow: {
    fontSize: 22,
    opacity: 0.4,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
    gap: Spacing.three,
  },
  backButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "rgba(128, 128, 128, 0.15)",
  },
  pressed: {
    opacity: 0.7,
  },
});
