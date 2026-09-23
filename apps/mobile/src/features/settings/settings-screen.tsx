import { apiClient, apiConfiguration } from "@/composition/api-client";
import { analyticsClient } from "@/composition/analytics-client";
import { authConfiguration } from "@/composition/auth-client";
import { isProgressPhotosEnabled } from "@/composition/app-variant";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BrandWordmark } from "@/components/brand-wordmark";
import { FeedbackHeaderButton } from "@/components/feedback-header-button";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { meResponseSchema, type AuthPrincipalWire } from "@mizyun/contracts";
import { router, type Href } from "expo-router";
import {
  openBrowserAsync,
  WebBrowserPresentationStyle,
} from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  reducePrincipalState,
  type PrincipalRenderState,
} from "./principal-state";
import { AccountDataCard } from "./account-data-card";
import { CoachPreferencesCard } from "./coach-preferences-card";
import { CoachRemindersCard } from "./coach-reminders-card";
import { FirstMealRemindersCard } from "./first-meal-reminders-card";
import { EveningCatchUpRemindersCard } from "./evening-catch-up-reminders-card";
import { GoalSettingsCard } from "./goal-settings-card";
import { MemoryControlsCard } from "./memory-controls-card";
import { PasswordSecurityCard } from "./password-security-card";
import { ProfileSettingsCard } from "./profile-settings-card";
import { RegionalFoodStandardsCard } from "./regional-food-standards-card";
import { getCountryStandardDisplay } from "./regional-food-standards-data";
import { AiUsageCard } from "./ai-usage-card";
import { WorkoutSettingsCard } from "./workout-settings-card";
import {
  applyCoachReminders,
  loadCoachReminders,
} from "@/features/coach/coach-reminders";
import {
  centimetersToDisplayLength,
  lengthUnitLabel,
} from "@/lib/length-units";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type SettingsCategory =
  "all" | "profile" | "workout" | "coach" | "privacy" | "session";

/**
 * Account / Settings Screen (Redesigned IA & UX).
 *
 * Provides a high-efficiency settings hub featuring:
 * 1. Hero Profile Header with initials avatar, verification badges, and summary chips.
 * 2. Quick Action Dock for deep navigation (Energy Targets, Body History, Photos, Feedback).
 * 3. Segmented Category Tabs (All, Profile, AI Coach, Privacy, Session) for fast jumping.
 * 4. Collapsible setting sections with live value previews and expand/collapse controls.
 * 5. Full compliance with authentication, principal state, and data management boundaries.
 */
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { signOut, profile, refreshProfile, session } = useAuth();
  const [state, setState] = useState<PrincipalRenderState>({
    kind: "loading",
  });
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("all");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    identity: false,
    security: false,
    profile: true,
    goal: true,
    foodStandards: false,
    workout: true,
    aiProvider: true,
    coachPrefs: false,
    reminders: false,
    memory: false,
    analytics: false,
    accountData: false,
    legal: false,
  });

  const refresh = useCallback(async () => {
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
    void refresh();
    void refreshProfile();
    void analyticsClient.track({
      name: "feature_viewed",
      properties: { feature: "settings" },
    });
  }, [refresh, refreshProfile]);

  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const selectCategory = useCallback((cat: SettingsCategory) => {
    setActiveCategory(cat);
    if (cat === "profile") {
      setOpenSections((prev) => ({
        ...prev,
        profile: true,
        goal: true,
        foodStandards: true,
      }));
    } else if (cat === "workout") {
      setOpenSections((prev) => ({ ...prev, workout: true }));
    } else if (cat === "coach") {
      setOpenSections((prev) => ({
        ...prev,
        aiProvider: true,
        coachPrefs: true,
        reminders: true,
      }));
    } else if (cat === "privacy") {
      setOpenSections((prev) => ({
        ...prev,
        memory: true,
        analytics: true,
        accountData: true,
      }));
    } else if (cat === "session") {
      setOpenSections((prev) => ({
        ...prev,
        identity: true,
        accountData: true,
      }));
    }
  }, []);

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

  // Derived user details for hero card
  const displayName = profile?.displayName ?? "Mizyun Member";
  const userInitial = displayName.trim().charAt(0).toUpperCase() || "M";
  const emailOrId =
    state.kind === "ready"
      ? (state.principal.email ?? state.principal.userId)
      : "Active Member";
  const unitSystemDisplay =
    profile?.unitSystem === "imperial"
      ? "Imperial (lb, in)"
      : "Metric (kg, cm)";
  const foodStandardsDisplay = getCountryStandardDisplay(
    profile?.coachingPreferences?.countryCode,
  );
  const aiProviderDisplay = "Gemini 3.8";

  const showProfileGroup =
    activeCategory === "all" || activeCategory === "profile";
  const showWorkoutGroup =
    activeCategory === "all" || activeCategory === "workout";
  const showCoachGroup = activeCategory === "all" || activeCategory === "coach";
  const showPrivacyGroup =
    activeCategory === "all" || activeCategory === "privacy";
  const showSessionGroup =
    activeCategory === "all" || activeCategory === "session";

  const topPadding = Math.max(insets.top, 24) + Spacing.two;
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
          <ThemedText type="subtitle">Account & Settings</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Manage your identity, physical stats, AI coach, and preferences.
          </ThemedText>
        </View>

        {/* Hero Profile Card */}
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

          {/* Quick Status Pill Badges */}
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
                🤖 {aiProviderDisplay}
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

        {/* Quick Action Navigation Grid */}
        <View style={styles.section}>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            SHORTCUTS
          </ThemedText>
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Energy Targets"
              onPress={() => router.push("/energy-setup" as Href)}
              style={({ pressed }) => [
                styles.actionCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.actionIconBox}>
                <ThemedText style={styles.actionIcon}>⚡</ThemedText>
              </View>
              <View style={styles.actionTextBox}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  Energy
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={1}
                >
                  Targets
                </ThemedText>
              </View>
              <ThemedText style={styles.actionArrow}>→</ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Body Progress History"
              onPress={() => router.push("/body" as Href)}
              style={({ pressed }) => [
                styles.actionCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.actionIconBox}>
                <ThemedText style={styles.actionIcon}>📊</ThemedText>
              </View>
              <View style={styles.actionTextBox}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  Body
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={1}
                >
                  Trends
                </ThemedText>
              </View>
              <ThemedText style={styles.actionArrow}>→</ThemedText>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            {isProgressPhotosEnabled() ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Progress Photos"
                onPress={() => router.push("/progress-photos" as Href)}
                style={({ pressed }) => [
                  styles.actionCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.actionIconBox}>
                  <ThemedText style={styles.actionIcon}>📷</ThemedText>
                </View>
                <View style={styles.actionTextBox}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    Photos
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={1}
                  >
                    Timeline
                  </ThemedText>
                </View>
                <ThemedText style={styles.actionArrow}>→</ThemedText>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send feedback or report an issue"
              onPress={() => router.push("/feedback" as Href)}
              style={({ pressed }) => [
                styles.actionCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.actionIconBox}>
                <ThemedText style={styles.actionIcon}>💬</ThemedText>
              </View>
              <View style={styles.actionTextBox}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  Feedback
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  numberOfLines={1}
                >
                  Reviews
                </ThemedText>
              </View>
              <ThemedText style={styles.actionArrow}>→</ThemedText>
            </Pressable>
          </View>
        </View>

        {/* Category Filter Chips */}
        <View style={styles.tabsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show all settings"
            onPress={() => selectCategory("all")}
            style={[
              styles.tabChip,
              activeCategory === "all" && styles.tabChipActive,
            ]}
          >
            <ThemedText
              type="smallBold"
              style={[
                styles.tabChipText,
                activeCategory === "all" && styles.tabChipTextActive,
              ]}
            >
              All
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show profile and goal settings"
            onPress={() => selectCategory("profile")}
            style={[
              styles.tabChip,
              activeCategory === "profile" && styles.tabChipActive,
            ]}
          >
            <ThemedText
              type="smallBold"
              style={[
                styles.tabChipText,
                activeCategory === "profile" && styles.tabChipTextActive,
              ]}
            >
              Profile & Goal
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show workout and rest timer settings"
            onPress={() => selectCategory("workout")}
            style={[
              styles.tabChip,
              activeCategory === "workout" && styles.tabChipActive,
            ]}
          >
            <ThemedText
              type="smallBold"
              style={[
                styles.tabChipText,
                activeCategory === "workout" && styles.tabChipTextActive,
              ]}
            >
              Workout
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show coaching and AI settings"
            onPress={() => selectCategory("coach")}
            style={[
              styles.tabChip,
              activeCategory === "coach" && styles.tabChipActive,
            ]}
          >
            <ThemedText
              type="smallBold"
              style={[
                styles.tabChipText,
                activeCategory === "coach" && styles.tabChipTextActive,
              ]}
            >
              AI Coach
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show privacy and memory settings"
            onPress={() => selectCategory("privacy")}
            style={[
              styles.tabChip,
              activeCategory === "privacy" && styles.tabChipActive,
            ]}
          >
            <ThemedText
              type="smallBold"
              style={[
                styles.tabChipText,
                activeCategory === "privacy" && styles.tabChipTextActive,
              ]}
            >
              Privacy
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show session settings"
            onPress={() => selectCategory("session")}
            style={[
              styles.tabChip,
              activeCategory === "session" && styles.tabChipActive,
            ]}
          >
            <ThemedText
              type="smallBold"
              style={[
                styles.tabChipText,
                activeCategory === "session" && styles.tabChipTextActive,
              ]}
            >
              Session
            </ThemedText>
          </Pressable>
        </View>

        {!profile?.displayName ? <SetupWizardCard /> : null}

        {/* Section 1: Profile & Physical Stats */}
        {showProfileGroup && profile !== null ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                PROFILE & PHYSICAL STATS
              </ThemedText>
            </View>

            {/* Physical Stats Accordion */}
            <CollapsibleSection
              id="profile"
              icon="👤"
              title="Personal & Physical Details"
              subtitle={`${profile.displayName ?? "Name not set"} · ${unitSystemDisplay}`}
              isOpen={!!openSections.profile}
              onToggle={() => toggleSection("profile")}
            >
              <ProfileSettingsCard profile={profile} onSaved={refreshProfile} />
            </CollapsibleSection>

            {/* Goal & Pace Accordion */}
            <CollapsibleSection
              id="goal"
              icon="🎯"
              title="Goal & Target Pace"
              subtitle="Calorie deficit/surplus & target weight"
              isOpen={!!openSections.goal}
              onToggle={() => toggleSection("goal")}
            >
              <GoalSettingsCard unitSystem={profile.unitSystem} />
            </CollapsibleSection>

            {/* Regional Food Standards Accordion */}
            <CollapsibleSection
              id="foodStandards"
              icon="🌍"
              title="Regional Food Standards"
              subtitle={foodStandardsDisplay.label}
              isOpen={!!openSections.foodStandards}
              onToggle={() => toggleSection("foodStandards")}
            >
              <RegionalFoodStandardsCard
                profile={profile}
                onSaved={refreshProfile}
              />
            </CollapsibleSection>
          </View>
        ) : null}

        {/* Section 2: Workout & Rest Timer */}
        {showWorkoutGroup ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                WORKOUT & REST TIMER
              </ThemedText>
            </View>

            <CollapsibleSection
              id="workout"
              icon="⏱️"
              title="Rest Timer & Workout Preferences"
              subtitle="Default rest duration & timer alerts"
              isOpen={!!openSections.workout}
              onToggle={() => toggleSection("workout")}
            >
              <WorkoutSettingsCard userId={session?.user.id} />
            </CollapsibleSection>
          </View>
        ) : null}

        {/* Section 2: AI Coach & Intelligence */}
        {showCoachGroup ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                AI COACH & INTELLIGENCE
              </ThemedText>
            </View>

            <AiUsageCard />

            {profile !== null ? (
              <CollapsibleSection
                id="coachPrefs"
                icon="💬"
                title="Coaching Style & Preferences"
                subtitle="Experience level, equipment & dietary focus"
                isOpen={!!openSections.coachPrefs}
                onToggle={() => toggleSection("coachPrefs")}
              >
                <CoachPreferencesCard
                  profile={profile}
                  onSaved={refreshProfile}
                />
              </CollapsibleSection>
            ) : null}

            {session !== null ? (
              <CollapsibleSection
                id="reminders"
                icon="🔔"
                title="Push Notification Reminders"
                subtitle="Daily & weekly coaching check-ins"
                isOpen={!!openSections.reminders}
                onToggle={() => toggleSection("reminders")}
              >
                <CoachRemindersCard userId={session.user.id} />
                <FirstMealRemindersCard userId={session.user.id} />
                <EveningCatchUpRemindersCard userId={session.user.id} />
              </CollapsibleSection>
            ) : null}
          </View>
        ) : null}

        {/* Section 3: Privacy, Data & Durable Memory */}
        {showPrivacyGroup ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                PRIVACY, DATA & MEMORY
              </ThemedText>
            </View>

            <CollapsibleSection
              id="memory"
              icon="🧠"
              title="Durable AI Memories"
              subtitle="Inspect, edit, or wipe learned coach context"
              isOpen={!!openSections.memory}
              onToggle={() => toggleSection("memory")}
            >
              <MemoryControlsCard />
            </CollapsibleSection>

            <CollapsibleSection
              id="analytics"
              icon="🛡️"
              title="Product Analytics & Export"
              subtitle="Privacy-first usage telemetry"
              isOpen={!!openSections.analytics}
              onToggle={() => toggleSection("analytics")}
            >
              <AnalyticsCard />
            </CollapsibleSection>

            <CollapsibleSection
              id="accountData"
              icon="📦"
              title="Account Data & Erasure"
              subtitle="Export all personal records or delete account"
              isOpen={!!openSections.accountData}
              onToggle={() => toggleSection("accountData")}
            >
              <AccountDataCard disabled={state.kind === "disabled"} />
            </CollapsibleSection>
          </View>
        ) : null}

        {/* Section 4: Session & Identity */}
        {showSessionGroup ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                ACCOUNT & SESSION
              </ThemedText>
            </View>

            <CollapsibleSection
              id="identity"
              icon="🔑"
              title="Authentication & Principal State"
              subtitle={emailOrId}
              isOpen={!!openSections.identity}
              onToggle={() => toggleSection("identity")}
            >
              <PrincipalCard state={state} onRetry={refresh} />
            </CollapsibleSection>

            <CollapsibleSection
              id="security"
              icon="🔒"
              title="Password & Security"
              subtitle={
                session?.user?.provider === "google"
                  ? "Google Account · Managed via Google"
                  : session?.user?.provider === "apple"
                    ? "Apple ID · Managed via Apple"
                    : "Email & Password · Reset or change password"
              }
              isOpen={!!openSections.security}
              onToggle={() => toggleSection("security")}
            >
              <PasswordSecurityCard />
            </CollapsibleSection>

            {activeCategory === "session" ? (
              <CollapsibleSection
                id="accountData"
                icon="📦"
                title="Account Data & Erasure"
                subtitle="Export all personal records or delete account"
                isOpen={!!openSections.accountData}
                onToggle={() => toggleSection("accountData")}
              >
                <AccountDataCard disabled={state.kind === "disabled"} />
              </CollapsibleSection>
            ) : null}

            <CollapsibleSection
              id="legal"
              icon="⚖️"
              title="Legal, Terms & Health Advisory"
              subtitle="Privacy policy, terms & medical disclaimer"
              isOpen={!!openSections.legal}
              onToggle={() => toggleSection("legal")}
            >
              <LegalCard />
            </CollapsibleSection>

            <FeedbackCard />
            <SignOutCard
              disabled={state.kind === "disabled"}
              onPress={onSignOut}
            />
          </View>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.footerNote}>
          <ThemedText type="small" themeColor="textSecondary">
            Mizyun Alpha · Pure domain calculations, client-side RLS isolation,
            and private secure storage.
          </ThemedText>
        </ThemedView>
      </ScrollView>
    </ThemedView>
  );
}

function CollapsibleSection({
  icon,
  title,
  subtitle,
  isOpen,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly subtitle: string;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.collapsibleContainer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isOpen ? "Collapse" : "Expand"} ${title}`}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.collapsibleHeader,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.collapsibleIconBox}>
          <ThemedText style={styles.collapsibleIcon}>{icon}</ThemedText>
        </View>
        <View style={styles.collapsibleTitleBlock}>
          <ThemedText type="smallBold" style={styles.collapsibleTitle}>
            {title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>
        <View style={styles.chevronBox}>
          <ThemedText type="smallBold" style={styles.chevronText}>
            {isOpen ? "▾" : "›"}
          </ThemedText>
        </View>
      </Pressable>

      {isOpen ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </ThemedView>
  );
}

function FeedbackCard() {
  return (
    <ThemedView type="backgroundElement" style={styles.feedbackCard}>
      <View style={styles.feedbackHeaderRow}>
        <View style={styles.feedbackIconBox}>
          <ThemedText style={styles.feedbackIcon}>💡</ThemedText>
        </View>
        <View style={styles.feedbackTitleBlock}>
          <ThemedText type="smallBold">Feedback & Ideas</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Help improve Mizyun directly with feature requests or bug reports.
          </ThemedText>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send feedback or review"
        onPress={() => router.push("/feedback" as Href)}
        style={({ pressed }) => [
          styles.feedbackButton,
          pressed && styles.pressed,
        ]}
      >
        <ThemedText type="smallBold" style={styles.feedbackButtonText}>
          Send feedback or review →
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function LegalCard() {
  const baseUrl = apiConfiguration.configured
    ? apiConfiguration.baseUrl
    : "https://mizyun-api.phiskel.com";

  const openUrl = async (path: string) => {
    try {
      await openBrowserAsync(`${baseUrl}${path}`, {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
    } catch {
      // Graceful fallback if browser cannot be launched
    }
  };

  return (
    <View style={styles.legalCard}>
      <ThemedView type="backgroundElement" style={styles.disclaimerContainer}>
        <ThemedText style={styles.disclaimerIcon}>⚠️</ThemedText>
        <View style={styles.disclaimerTextBlock}>
          <ThemedText type="smallBold" style={styles.disclaimerTitle}>
            Health & Medical Advisory
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Mizyun is an informational fitness and nutrition tool and is not a
            medical device. Always consult a physician or qualified healthcare
            provider before starting any new diet or training program.
          </ThemedText>
        </View>
      </ThemedView>

      <View style={styles.legalLinksList}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Privacy Policy"
          onPress={() => void openUrl("/legal/privacy")}
          style={({ pressed }) => [
            styles.legalLinkRow,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText style={styles.legalLinkIcon}>📄</ThemedText>
          <View style={styles.legalLinkTextBlock}>
            <ThemedText type="smallBold">Privacy Policy</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              How your health and photo data is protected
            </ThemedText>
          </View>
          <ThemedText style={styles.legalLinkArrow}>↗</ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Terms of Service"
          onPress={() => void openUrl("/legal/terms")}
          style={({ pressed }) => [
            styles.legalLinkRow,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText style={styles.legalLinkIcon}>⚖️</ThemedText>
          <View style={styles.legalLinkTextBlock}>
            <ThemedText type="smallBold">Terms of Service</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Service conditions and beta access terms
            </ThemedText>
          </View>
          <ThemedText style={styles.legalLinkArrow}>↗</ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Support and Inquiries"
          onPress={() => void openUrl("/legal/support")}
          style={({ pressed }) => [
            styles.legalLinkRow,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText style={styles.legalLinkIcon}>💬</ThemedText>
          <View style={styles.legalLinkTextBlock}>
            <ThemedText type="smallBold">Support & Inquiries</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Contact us via email or support channels
            </ThemedText>
          </View>
          <ThemedText style={styles.legalLinkArrow}>↗</ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Account Deletion Instructions"
          onPress={() => void openUrl("/legal/delete-account")}
          style={({ pressed }) => [
            styles.legalLinkRow,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText style={styles.legalLinkIcon}>🗑️</ThemedText>
          <View style={styles.legalLinkTextBlock}>
            <ThemedText type="smallBold">Account Deletion</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              External data erasure request pathway
            </ThemedText>
          </View>
          <ThemedText style={styles.legalLinkArrow}>↗</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function AnalyticsCard() {
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
    <View style={styles.innerCard}>
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
    </View>
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

function PrincipalCard({
  state,
  onRetry,
}: {
  state: PrincipalRenderState;
  onRetry: () => void;
}) {
  return (
    <View style={styles.innerCard}>
      {state.kind === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : state.kind === "ready" ? (
        <View style={styles.column}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            SIGNED IN AS
          </ThemedText>
          <ThemedText type="subtitle">
            {state.principal.email ?? state.principal.userId}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            User ID: {state.principal.userId}
          </ThemedText>
        </View>
      ) : state.kind === "disabled" ? (
        <View style={styles.column}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            NOT CONFIGURED
          </ThemedText>
          <ThemedText>{state.reason}</ThemedText>
        </View>
      ) : state.kind === "no_session" ? (
        <View style={styles.column}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            NO ACTIVE SESSION
          </ThemedText>
          <ThemedText>
            The session has not been established yet. Return to the welcome
            screen to sign in.
          </ThemedText>
        </View>
      ) : state.kind === "session_expired" ? (
        <View style={styles.column}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            SESSION EXPIRED
          </ThemedText>
          <ThemedText>
            The Mizyun server rejected the bearer token. Sign in again to
            continue.
          </ThemedText>
        </View>
      ) : state.kind === "network_error" ? (
        <View style={styles.column}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            NETWORK ERROR
          </ThemedText>
          <ThemedText>{state.message}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <ThemedText type="smallBold">Retry</ThemedText>
          </Pressable>
        </View>
      ) : state.kind === "server_error" ? (
        <View style={styles.column}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            SERVER ERROR ({state.status})
          </ThemedText>
          <ThemedText>{state.message}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <ThemedText type="smallBold">Retry</ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.column}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            UNEXPECTED RESPONSE
          </ThemedText>
          <ThemedText>{state.message}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <ThemedText type="smallBold">Retry</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
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

function SignOutCard({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
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
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.signOutButton,
          pressed && styles.pressed,
          disabled && styles.signOutButtonDisabled,
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
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
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
    marginTop: 2,
  },
  heroPill: {
    backgroundColor: "rgba(148, 163, 184, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  heroPillText: {
    fontSize: 12,
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    color: "#64748B",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  actionRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  actionCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    backgroundColor: "rgba(148, 163, 184, 0.05)",
  },
  actionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionIcon: {
    fontSize: 18,
  },
  actionTextBox: {
    flex: 1,
    gap: 1,
  },
  actionArrow: {
    fontSize: 16,
    color: "#10B981",
    fontWeight: "700",
  },
  tabsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  tabChip: {
    paddingVertical: 7,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    backgroundColor: "rgba(148, 163, 184, 0.05)",
  },
  tabChipActive: {
    backgroundColor: "#10B981",
    borderColor: "#10B981",
  },
  tabChipText: {
    fontSize: 12,
  },
  tabChipTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  collapsibleContainer: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    overflow: "hidden",
  },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.four,
  },
  collapsibleIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(148, 163, 184, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  collapsibleIcon: {
    fontSize: 18,
  },
  collapsibleTitleBlock: {
    flex: 1,
    gap: 2,
  },
  collapsibleTitle: {
    fontSize: 15,
  },
  chevronBox: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  chevronText: {
    fontSize: 18,
    color: "#64748B",
  },
  collapsibleBody: {
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.12)",
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  innerCard: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  feedbackCard: {
    padding: Spacing.four,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
    gap: Spacing.three,
  },
  feedbackHeaderRow: {
    flexDirection: "row",
    gap: Spacing.three,
    alignItems: "center",
  },
  feedbackIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  feedbackIcon: {
    fontSize: 18,
  },
  feedbackTitleBlock: {
    flex: 1,
    gap: 2,
  },
  feedbackButton: {
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#10B981",
  },
  feedbackButtonText: {
    color: "#ffffff",
  },
  finishSetupCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.06)",
  },
  setupWizardButton: {
    marginTop: Spacing.two,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#10B981",
  },
  signOutCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  signOutButton: {
    marginTop: Spacing.two,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EF4444",
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },
  signOutButtonText: {
    color: "#EF4444",
  },
  signOutButtonDisabled: { opacity: 0.4 },
  analyticsActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  analyticsButton: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.25)",
    backgroundColor: "rgba(148, 163, 184, 0.05)",
  },
  analyticsButtonDisabled: { opacity: 0.4 },
  column: { gap: Spacing.one },
  center: { alignItems: "center", paddingVertical: Spacing.three },
  footerNote: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  betaPill: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  betaPillText: {
    color: "#059669",
    fontSize: 12,
  },
  legalCard: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  disclaimerContainer: {
    flexDirection: "row",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
    backgroundColor: "rgba(239, 68, 68, 0.04)",
  },
  disclaimerIcon: {
    fontSize: 18,
    marginTop: 2,
  },
  disclaimerTextBlock: {
    flex: 1,
    gap: 2,
  },
  disclaimerTitle: {
    color: "#B91C1C",
    fontSize: 13,
  },
  legalLinksList: {
    gap: Spacing.two,
  },
  legalLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: 12,
    backgroundColor: "rgba(148, 163, 184, 0.06)",
  },
  legalLinkIcon: {
    fontSize: 16,
  },
  legalLinkTextBlock: {
    flex: 1,
    gap: 2,
  },
  legalLinkArrow: {
    fontSize: 16,
    color: "#64748B",
    paddingRight: Spacing.two,
  },
  pressed: { opacity: 0.75 },
});
