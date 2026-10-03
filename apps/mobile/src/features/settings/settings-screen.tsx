import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BrandWordmark } from "@/components/brand-wordmark";
import { FeedbackHeaderButton } from "@/components/feedback-header-button";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { isProgressPhotosEnabled } from "@/composition/app-variant";
import { analyticsClient } from "@/composition/analytics-client";
import { useAuth } from "@/features/auth/auth-context";
import { useThemePreference } from "@/features/theme/theme-context";
import { useTheme } from "@/hooks/use-theme";
import {
  applyCoachReminders,
  loadCoachReminders,
} from "@/features/coach/coach-reminders";
import {
  centimetersToDisplayLength,
  lengthUnitLabel,
} from "@/lib/length-units";
import { router, type Href } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SETTINGS_CATEGORIES,
  getAvailableSettings,
  type SettingsAvailabilityContext,
  type SettingsCategoryDefinition,
} from "./settings-catalog";
import { navigateToSetting } from "./settings-destinations";
import { searchSettings, type SettingsSearchResult } from "./settings-search";
import { SettingsSearchResults } from "./settings-search-results";

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { signOut, profile, refreshProfile, session, openOnboarding } =
    useAuth();
  const { preference: themePreference } = useThemePreference();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    void analyticsClient.track({
      name: "feature_viewed",
      properties: { feature: "settings" },
    });
  }, []);

  useEffect(() => {
    if (!profile && session) void refreshProfile();
  }, [profile, refreshProfile, session]);

  // Clear search on sign-out / account switch
  useEffect(() => {
    if (!session) {
      setSearchQuery("");
    }
  }, [session]);

  const availabilityContext: SettingsAvailabilityContext = useMemo(
    () => ({
      isSignedIn: session !== null,
      hasProfile: profile !== null,
      isProgressPhotosEnabled: isProgressPhotosEnabled(),
      isSetupComplete: Boolean(profile?.displayName),
    }),
    [session, profile],
  );

  const availableSettings = useMemo(
    () => getAvailableSettings(availabilityContext),
    [availabilityContext],
  );

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchSettings(searchQuery, availableSettings);
  }, [searchQuery, availableSettings]);

  const onSignOut = useCallback(async () => {
    Alert.alert(
      "Sign out of Mizyun?",
      "You can sign back in anytime with your email.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            void analyticsClient.resetLocalSession();
            if (session !== null) {
              const reminders = await loadCoachReminders(session.user.id);
              await applyCoachReminders(session.user.id, {
                dailyEnabled: false,
                weeklyEnabled: false,
                hour: reminders.hour,
                minute: reminders.minute,
                weeklyWeekday: reminders.weeklyWeekday,
              });
            }
            await signOut();
          },
        },
      ],
    );
  }, [session, signOut]);

  const handleSelectResult = useCallback(
    (result: SettingsSearchResult) => {
      navigateToSetting(result.item, {
        onSignOutRequest: onSignOut,
        onOpenOnboarding: openOnboarding,
      });
    },
    [onSignOut, openOnboarding],
  );

  const handleOpenCategory = useCallback(
    (category: SettingsCategoryDefinition) => {
      if (category.id === "appearance") {
        router.push("/account-settings/appearance" as Href);
      } else {
        router.push({
          pathname: "/account-settings/category/[categoryId]",
          params: { categoryId: category.id },
        } as unknown as Href);
      }
    },
    [],
  );

  const displayName = profile?.displayName ?? "Mizyun Member";
  const userInitial = displayName.trim().charAt(0).toUpperCase() || "M";
  const emailOrId =
    session?.user?.email ?? session?.user?.id ?? "Active Member";
  const unitSystemDisplay =
    profile?.unitSystem === "imperial"
      ? "Imperial (lb, in)"
      : "Metric (kg, cm)";
  const appearanceDisplay =
    themePreference === "auto"
      ? "Auto (System)"
      : themePreference === "light"
        ? "Light mode"
        : "Dark mode";

  const topPadding = Spacing.two;
  const bottomPadding = insets.bottom + Spacing.six;

  const isSearching = searchQuery.trim().length > 0;

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
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Top Header */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <BrandWordmark />
            <View style={styles.headerActions}>
              <FeedbackHeaderButton />
              <View style={styles.verifiedBadge}>
                <View style={styles.verifiedDot} />
                <ThemedText type="small" style={styles.verifiedText}>
                  Authenticated
                </ThemedText>
              </View>
            </View>
          </View>
          <ThemedText type="subtitle">Account</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Manage your physical stats, AI coach, and preferences.
          </ThemedText>
        </View>

        {/* Hero Profile Summary Card */}
        <ThemedView type="backgroundElement" style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.avatarContainer}>
              <ThemedText style={styles.avatarText}>{userInitial}</ThemedText>
            </View>
            <View style={styles.heroIdentity}>
              <ThemedText type="subtitle" style={styles.heroName}>
                {displayName}
              </ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {emailOrId}
              </ThemedText>
            </View>
          </View>

          {/* Quick Badges Row */}
          <View style={styles.heroBadgesRow}>
            {profile?.planTier === "paid" ? (
              <View style={[styles.heroPill, styles.betaPill]}>
                <ThemedText type="smallBold" style={styles.betaPillText}>
                  ✨ Beta Pro Pass
                </ThemedText>
              </View>
            ) : (
              <View style={styles.heroPill}>
                <ThemedText type="smallBold" style={styles.heroPillText}>
                  🌱 Free Plan
                </ThemedText>
              </View>
            )}
            <View style={styles.heroPill}>
              <ThemedText type="smallBold" style={styles.heroPillText}>
                📏 {unitSystemDisplay}
              </ThemedText>
            </View>
            <View style={styles.heroPill}>
              <ThemedText type="smallBold" style={styles.heroPillText}>
                🎨 {appearanceDisplay}
              </ThemedText>
            </View>
            {profile?.heightCm ? (
              <View style={styles.heroPill}>
                <ThemedText type="smallBold" style={styles.heroPillText}>
                  ⚡{" "}
                  {centimetersToDisplayLength(
                    profile.heightCm,
                    profile.unitSystem,
                  )}{" "}
                  {lengthUnitLabel(profile.unitSystem)}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </ThemedView>

        {/* Search settings input */}
        <View style={styles.searchSection}>
          <View style={styles.searchBar}>
            <ThemedText style={styles.searchIcon}>🔍</ThemedText>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search settings (e.g. dark mode, units, reminders)..."
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.text }]}
              accessibilityLabel="Search settings"
              accessibilityHint="Search by name or describe what you want to change"
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search text"
                onPress={() => setSearchQuery("")}
                style={styles.clearSearchButton}
                hitSlop={8}
              >
                <ThemedText style={styles.clearSearchIcon}>✕</ThemedText>
              </Pressable>
            ) : null}
          </View>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.searchHint}
          >
            Search by name or describe what you want to change.
          </ThemedText>
        </View>

        {/* Content: Either Search Results or Category Browsing */}
        {isSearching ? (
          <SettingsSearchResults
            results={searchResults}
            query={searchQuery}
            onSelectResult={handleSelectResult}
            onClearQuery={() => setSearchQuery("")}
            onBrowseCategories={() => setSearchQuery("")}
            onFeedback={() => router.push("/feedback" as Href)}
          />
        ) : (
          <>
            {!profile?.displayName ? <SetupWizardCard /> : null}

            {/* Category Rows */}
            <View style={styles.categoriesSection}>
              <ThemedText type="smallBold" style={styles.sectionHeader}>
                SETTINGS CATEGORIES
              </ThemedText>
              <View style={styles.categoryList}>
                {SETTINGS_CATEGORIES.map((category) => (
                  <Pressable
                    key={category.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${category.title}, ${category.shortDescription}`}
                    onPress={() => handleOpenCategory(category)}
                    style={({ pressed }) => [
                      styles.categoryCard,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.categoryIconBox}>
                      <ThemedText style={styles.categoryIcon}>
                        {category.icon}
                      </ThemedText>
                    </View>
                    <View style={styles.categoryTextBlock}>
                      <ThemedText type="smallBold" style={styles.categoryTitle}>
                        {category.title}
                      </ThemedText>
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        numberOfLines={1}
                        style={styles.categoryDescription}
                      >
                        {category.shortDescription}
                      </ThemedText>
                    </View>
                    <ThemedText style={styles.categoryArrow}>›</ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Sign Out Card */}
            <SignOutCard onSignOut={onSignOut} />

            {/* Footer */}
            <ThemedView type="backgroundElement" style={styles.footerNote}>
              <ThemedText type="small" themeColor="textSecondary">
                Mizyun Alpha · Pure domain calculations, client-side RLS
                isolation, and private secure storage.
              </ThemedText>
            </ThemedView>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function SetupWizardCard() {
  const { openOnboarding } = useAuth();
  return (
    <ThemedView type="backgroundElement" style={styles.finishSetupCard}>
      <ThemedText type="smallBold">Finish setting up Mizyun</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Add your display name, units, starting weight, and primary goal to
        personalize your daily targets.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Finish setting up Mizyun"
        onPress={openOnboarding}
        style={({ pressed }) => [
          styles.setupWizardButton,
          pressed && styles.pressed,
        ]}
      >
        <ThemedText type="smallBold" style={{ color: "#ffffff" }}>
          Start setup →
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function SignOutCard({ onSignOut }: { readonly onSignOut: () => void }) {
  return (
    <ThemedView type="backgroundElement" style={styles.signOutCard}>
      <ThemedText type="smallBold">Sign Out</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        End this device&apos;s active session. Other devices and stored cloud
        data are unaffected.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={onSignOut}
        style={({ pressed }) => [
          styles.signOutButton,
          pressed && styles.pressed,
        ]}
      >
        <ThemedText type="smallBold" style={styles.signOutButtonText}>
          Sign Out of Account
        </ThemedText>
      </Pressable>
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
  header: { gap: Spacing.one },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  verifiedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
  },
  verifiedText: {
    fontSize: 11,
    color: "#10B981",
    fontWeight: "700",
  },
  heroCard: {
    padding: Spacing.four,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
    gap: Spacing.three,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  avatarContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 2,
    borderColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#10B981",
  },
  heroIdentity: {
    flex: 1,
    gap: 2,
  },
  heroName: {
    fontSize: 18,
  },
  heroBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  heroPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(128, 128, 128, 0.12)",
  },
  heroPillText: {
    fontSize: 12,
  },
  betaPill: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  betaPillText: {
    fontSize: 12,
    color: "#10B981",
  },
  searchSection: {
    gap: Spacing.one,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 14,
    backgroundColor: "rgba(128, 128, 128, 0.12)",
    gap: Spacing.two,
    minHeight: 48,
  },
  searchIcon: {
    fontSize: 16,
    opacity: 0.6,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  clearSearchButton: {
    padding: 4,
  },
  clearSearchIcon: {
    fontSize: 14,
    opacity: 0.6,
  },
  searchHint: {
    paddingHorizontal: Spacing.one,
    fontSize: 12,
  },
  categoriesSection: {
    gap: Spacing.two,
  },
  sectionHeader: {
    fontSize: 12,
    letterSpacing: 0.5,
    opacity: 0.6,
    paddingHorizontal: Spacing.one,
  },
  categoryList: {
    gap: Spacing.two,
  },
  categoryCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.four,
    borderRadius: 16,
    backgroundColor: "rgba(128, 128, 128, 0.08)",
    minHeight: 64,
  },
  categoryIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(128, 128, 128, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  categoryIcon: {
    fontSize: 22,
  },
  categoryTextBlock: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  categoryTitle: {
    fontSize: 15,
  },
  categoryDescription: {
    fontSize: 12,
    opacity: 0.7,
  },
  categoryArrow: {
    fontSize: 22,
    opacity: 0.4,
  },
  finishSetupCard: {
    padding: Spacing.four,
    borderRadius: 16,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  setupWizardButton: {
    alignSelf: "flex-start",
    marginTop: Spacing.two,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#10B981",
    minHeight: 44,
    justifyContent: "center",
  },
  signOutCard: {
    padding: Spacing.four,
    borderRadius: 16,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  signOutButton: {
    marginTop: Spacing.two,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  signOutButtonText: {
    color: "#EF4444",
    fontSize: 14,
  },
  footerNote: {
    padding: Spacing.four,
    borderRadius: 12,
    alignItems: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});
