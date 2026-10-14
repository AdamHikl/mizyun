import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Card,
  Chip,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  SectionHeader,
  type IconName,
  type ListRowProps,
} from "@/components/ui";
import {
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
import {
  getAppVariant,
  isProgressPhotosEnabled,
} from "@/composition/app-variant";
import { analyticsClient } from "@/composition/analytics-client";
import {
  trackSettingsSearchSelected,
  trackSettingsSearchUsed,
} from "@/features/analytics/ui-analytics";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import {
  applyCoachReminders,
  loadCoachReminders,
} from "@/features/coach/coach-reminders";
import { router, type Href } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SETTINGS_CATEGORIES,
  getAvailableSettings,
  type SettingsAvailabilityContext,
  type SettingsCategoryDefinition,
  type SettingsCategoryId,
} from "./settings-catalog";
import { navigateToSetting } from "./settings-destinations";
import { searchSettings, type SettingsSearchResult } from "./settings-search";
import { SettingsSearchResults } from "./settings-search-results";

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { signOut, profile, refreshProfile, session, openOnboarding } =
    useAuth();
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
      isHealthPreviewEnabled: getAppVariant() === "dev",
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
      trackSettingsSearchSelected(result.item.destinationId);
      navigateToSetting(result.item, {
        onSignOutRequest: onSignOut,
        onOpenOnboarding: openOnboarding,
      });
    },
    [onSignOut, openOnboarding],
  );

  const openFeedback = useCallback(() => {
    router.push("/feedback" as Href);
  }, []);

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
  const emailOrId =
    session?.user?.email ?? session?.user?.id ?? "Active Member";
  const planLabel =
    profile?.planTier === "paid" ? "Launch Pro Pass" : "Free Plan";
  const bottomPadding = insets.bottom + Spacing.six;

  const isSearching = searchQuery.trim().length > 0;

  return (
    <ThemedView style={styles.page}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPadding },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* Compact identity; profile details live in their settings. */}
        <Card
          accessible
          accessibilityLabel={`${displayName}, ${emailOrId}, ${planLabel}`}
          style={styles.identityCard}
        >
          <View
            style={[styles.avatar, { backgroundColor: theme.primaryLight }]}
          >
            <ThemedText type="headline" themeColor="primary">
              {initialsFor(displayName)}
            </ThemedText>
          </View>
          <View style={styles.identityText}>
            <ThemedText type="headline">{displayName}</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {emailOrId}
            </ThemedText>
            <Chip
              label={planLabel}
              tone={profile?.planTier === "paid" ? "primary" : "neutral"}
              style={styles.planChip}
            />
          </View>
        </Card>

        {/* Search settings input */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: theme.backgroundSelected },
          ]}
        >
          <Icon name="search" size={17} color="textSecondary" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => {
              if (searchQuery.trim())
                trackSettingsSearchUsed(searchResults.length);
            }}
            placeholder="Search settings"
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            accessibilityLabel="Search settings"
            accessibilityHint="Search by name or describe what you want to change"
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 ? (
            <IconButton
              icon="close"
              variant="plain"
              accessibilityLabel="Clear search text"
              onPress={() => setSearchQuery("")}
              style={styles.clearSearchButton}
            />
          ) : null}
        </View>

        {/* Content: Either Search Results or Category Browsing */}
        {isSearching ? (
          <SettingsSearchResults
            results={searchResults}
            query={searchQuery}
            onSelectResult={handleSelectResult}
            onClearQuery={() => setSearchQuery("")}
            onBrowseCategories={() => setSearchQuery("")}
            onFeedback={openFeedback}
          />
        ) : (
          <>
            {!profile?.displayName ? <SetupWizardCard /> : null}

            <ListGroup>
              {SETTINGS_CATEGORIES.map((category) => {
                const visual = CATEGORY_ICONS[category.id];
                return (
                  <ListRow
                    key={category.id}
                    icon={visual.icon}
                    iconTone={visual.tone}
                    title={category.title}
                    subtitle={category.shortDescription}
                    accessibilityLabel={`${category.title}, ${category.shortDescription}`}
                    onPress={() => handleOpenCategory(category)}
                  />
                );
              })}
            </ListGroup>

            <View style={styles.section}>
              <SectionHeader title="Support" />
              <ListGroup>
                <ListRow
                  icon="feedback"
                  title="Feedback & reviews"
                  subtitle="Report a problem or suggest an idea"
                  accessibilityLabel="Feedback & reviews, send feedback or report an issue"
                  onPress={openFeedback}
                />
                <ListRow
                  icon="chart"
                  iconTone="info"
                  title="Help improve Mizyun"
                  subtitle="Optional usage analytics · Separate from AI consent"
                  accessibilityLabel="Help improve Mizyun, optional usage analytics consent"
                  onPress={() =>
                    router.push("/account-settings/analytics" as Href)
                  }
                />
              </ListGroup>
            </View>

            <View style={styles.section}>
              <Button
                label="Sign out"
                variant="destructive"
                block
                accessibilityLabel="Sign out"
                onPress={onSignOut}
              />
              <ThemedText
                type="footnote"
                themeColor="textSecondary"
                style={styles.centered}
              >
                Ends this device&apos;s session. Other devices and stored cloud
                data are unaffected.
              </ThemedText>
            </View>

            <ThemedText
              type="caption"
              themeColor="textTertiary"
              style={styles.centered}
            >
              Mizyun Alpha
            </ThemedText>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const CATEGORY_ICONS: Record<
  SettingsCategoryId,
  {
    readonly icon: IconName;
    readonly tone: NonNullable<ListRowProps["iconTone"]>;
  }
> = {
  "profile-goals": { icon: "target", tone: "primary" },
  "workouts-reminders": { icon: "timer", tone: "warning" },
  appearance: { icon: "appearance", tone: "info" },
  "health-connections": { icon: "steps", tone: "danger" },
  "ai-coach": { icon: "sparkles", tone: "fat" },
  "privacy-data": { icon: "privacy", tone: "neutral" },
  "account-help": { icon: "person", tone: "neutral" },
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "M";
}

function SetupWizardCard() {
  const { openOnboarding } = useAuth();
  return (
    <Card>
      <ThemedText type="headline">Finish setting up Mizyun</ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        Add your display name, units, starting weight, and primary goal to
        personalize your daily targets.
      </ThemedText>
      <Button
        label="Start setup"
        size="small"
        accessibilityLabel="Finish setting up Mizyun"
        onPress={openOnboarding}
        style={styles.setupButton}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  identityText: {
    flex: 1,
    gap: Spacing.half,
  },
  planChip: {
    marginTop: Spacing.one,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: Spacing.three - 4,
    borderRadius: Radius.md,
    gap: Spacing.two,
    minHeight: MinTouchTarget,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    paddingVertical: Spacing.two,
  },
  clearSearchButton: {
    margin: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  setupButton: {
    marginTop: Spacing.one,
  },
  centered: {
    textAlign: "center",
  },
});
