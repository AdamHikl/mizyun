import { HealthExportCard } from "@/features/health-exports/ui";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button, Chip, EmptyState } from "@/components/ui";
import { MaxContentWidth, PageGutter, Spacing } from "@/constants/theme";
import { apiClient, apiConfiguration } from "@/composition/api-client";
import { authConfiguration } from "@/composition/auth-client";
import { useAuth } from "@/features/auth/auth-context";
import { getAppVariant } from "@/composition/app-variant";
import { HealthPreviewCard } from "@/features/health-connections";
import { meResponseSchema, type AuthPrincipalWire } from "@mizyun/contracts";
import { router, Stack } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  isSettingsDetailKey,
  SETTINGS_DETAIL_CONFIGS,
  type SettingsDetailKey,
} from "./settings-destinations";
import {
  reducePrincipalState,
  type PrincipalRenderState,
} from "./principal-state";

// Cards
import { ProfileSettingsCard } from "./profile-settings-card";
import { GoalSettingsCard } from "./goal-settings-card";
import { RegionalFoodStandardsCard } from "./regional-food-standards-card";
import { WorkoutSettingsCard } from "./workout-settings-card";
import { CoachRemindersCard } from "./coach-reminders-card";
import { FirstMealRemindersCard } from "./first-meal-reminders-card";
import { EveningCatchUpRemindersCard } from "./evening-catch-up-reminders-card";
import { WeeklyReviewReminderCard } from "./weekly-review-reminder-card";
import { WeighInReminderCard } from "./weigh-in-reminder-card";
import { AppearanceSettingsCard } from "./appearance-settings-card";
import { HealthStepsSettingsCard } from "../health-steps/health-steps-settings-card";
import { CoachPreferencesCard } from "./coach-preferences-card";
import { AiUsageCard } from "./ai-usage-card";
import { MemoryControlsCard } from "./memory-controls-card";
import { AnalyticsCard } from "./analytics-card";
import { AccountDataCard } from "./account-data-card";
import { PasswordSecurityCard } from "./password-security-card";
import { PrincipalCard } from "./principal-card";
import { LegalCard } from "./legal-card";

export function SettingsDetailScreen({
  settingKey,
  anchor,
}: {
  readonly settingKey: string;
  readonly anchor?: string;
}) {
  const insets = useSafeAreaInsets();
  const { profile, refreshProfile, session } = useAuth();
  const [state, setState] = useState<PrincipalRenderState>({
    kind: "loading",
  });

  const refreshPrincipal = useCallback(async () => {
    const result = await apiClient.request<{
      user: AuthPrincipalWire;
    }>({
      method: "GET",
      path: "/v1/me",
      schema: meResponseSchema,
    });
    setState(
      reducePrincipalState({
        apiConfigured: apiConfiguration.configured,
        authConfigured: authConfiguration.configured,
        authDisabledReason:
          "Supabase public configuration has not been provided.",
        apiDisabledReason: "Mizyun API base URL has not been provided.",
        result: result.ok
          ? { ok: true, value: result.value.user }
          : { ok: false, error: result.error },
      }),
    );
  }, []);

  useEffect(() => {
    if (settingKey === "identity" || settingKey === "account-data") {
      void refreshPrincipal();
    }
  }, [settingKey, refreshPrincipal]);

  if (!isSettingsDetailKey(settingKey)) {
    return (
      <ThemedView style={styles.page}>
        <Stack.Screen options={{ title: "Setting unavailable" }} />
        <View style={styles.centerContainer}>
          <EmptyState
            icon="warning"
            title="Setting unavailable"
            message="This setting could not be found or is not available."
            action={
              <Button
                label="Go back"
                variant="tinted"
                size="small"
                onPress={() => router.back()}
              />
            }
          />
        </View>
      </ThemedView>
    );
  }

  const detailKey: SettingsDetailKey = settingKey;
  const config = SETTINGS_DETAIL_CONFIGS[detailKey];

  const bottomPadding = insets.bottom + Spacing.six;

  const renderContent = () => {
    switch (detailKey) {
      case "profile":
        return profile !== null ? (
          <ProfileSettingsCard profile={profile} onSaved={refreshProfile} />
        ) : (
          <ThemedText type="footnote" themeColor="textSecondary">
            Profile details are not available.
          </ThemedText>
        );

      case "goal":
        return profile !== null ? (
          <GoalSettingsCard unitSystem={profile.unitSystem} />
        ) : (
          <ThemedText type="footnote" themeColor="textSecondary">
            Goal settings are not available.
          </ThemedText>
        );

      case "food-standards":
        return profile !== null ? (
          <RegionalFoodStandardsCard
            profile={profile}
            onSaved={refreshProfile}
          />
        ) : (
          <ThemedText type="footnote" themeColor="textSecondary">
            Food standards are not available.
          </ThemedText>
        );

      case "workout":
        return <WorkoutSettingsCard userId={session?.user.id} />;

      case "reminders":
        return session !== null ? (
          <View style={styles.cardGroup}>
            <CoachRemindersCard userId={session.user.id} />
            <FirstMealRemindersCard userId={session.user.id} />
            <EveningCatchUpRemindersCard userId={session.user.id} />
            <WeeklyReviewReminderCard userId={session.user.id} />
            <WeighInReminderCard userId={session.user.id} />
          </View>
        ) : (
          <ThemedText type="footnote" themeColor="textSecondary">
            Please sign in to configure reminders.
          </ThemedText>
        );

      case "appearance":
        return <AppearanceSettingsCard />;

      case "health-steps":
        return session !== null ? (
          <HealthStepsSettingsCard userId={session.user.id} />
        ) : (
          <ThemedText type="footnote" themeColor="textSecondary">
            Please sign in to configure Health steps.
          </ThemedText>
        );

      case "health-exports":
        return <HealthExportCard />;

      case "health-preview":
        return session !== null && getAppVariant() === "dev" ? (
          <HealthPreviewCard
            key={session.user.id}
            userId={session.user.id}
            unitSystem={profile?.unitSystem ?? "metric"}
          />
        ) : (
          <ThemedText type="footnote" themeColor="textSecondary">
            Health previews are unavailable in this build or account.
          </ThemedText>
        );

      case "coach-preferences":
        return profile !== null ? (
          <CoachPreferencesCard profile={profile} onSaved={refreshProfile} />
        ) : (
          <ThemedText type="footnote" themeColor="textSecondary">
            Coach preferences are not available.
          </ThemedText>
        );

      case "ai-usage":
        return <AiUsageCard />;

      case "memory":
        return <MemoryControlsCard />;

      case "analytics":
        return <AnalyticsCard />;

      case "account-data":
        return <AccountDataCard disabled={state.kind === "disabled"} />;

      case "security":
        return <PasswordSecurityCard />;

      case "identity":
        return <PrincipalCard state={state} onRetry={refreshPrincipal} />;

      case "legal":
        return <LegalCard highlightAnchor={anchor} />;

      default:
        return null;
    }
  };

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: config.title }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPadding },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {anchor ? <Chip label={`Viewing: ${anchor}`} tone="primary" /> : null}
        {renderContent()}
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
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
  cardGroup: {
    gap: Spacing.five,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
});
