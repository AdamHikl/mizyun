import { apiClient, apiConfiguration } from "@/composition/api-client";
import { analyticsClient } from "@/composition/analytics-client";
import { authConfiguration } from "@/composition/auth-client";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { meResponseSchema, type AuthPrincipalWire } from "@mizyun/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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

/**
 * Account / settings screen.
 *
 * Loads the verified principal from `/v1/me` through the real
 * `HttpApiClient` (so the bearer token round-trips in the rendered UI,
 * not just in the e2e test) and exposes an explicit sign-out button
 * wired through `useAuth().signOut()`. The same render path also
 * handles the disabled-auth and disabled-api states so the screen is
 * the single "post-onboarding" surface regardless of configuration.
 */
export function SettingsScreen() {
  const { signOut, profile } = useAuth();
  const [state, setState] = useState<PrincipalRenderState>({
    kind: "loading",
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
    void analyticsClient.track({
      name: "feature_viewed",
      properties: { feature: "settings" },
    });
  }, [refresh]);

  const onSignOut = useCallback(async () => {
    // Fire-and-forget by design: analytics storage failure must not block the
    // identity boundary. Denial clears the local log and prevents a later
    // account on this device from inheriting the prior user's choice.
    void analyticsClient.setConsent("denied");
    await signOut();
  }, [signOut]);

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              ACCOUNT
            </ThemedText>
            <ThemedText type="subtitle">Your space</ThemedText>
            <ThemedText themeColor="textSecondary">
              Confirmed profile details from Mizyun.
            </ThemedText>
          </View>

          <PrincipalCard state={state} onRetry={refresh} />
          {profile?.displayName ? null : <SetupWizardCard />}
          <AnalyticsCard />
          <SignOutCard
            disabled={state.kind === "disabled"}
            onPress={onSignOut}
          />

          <ThemedView type="backgroundElement" style={styles.note}>
            <ThemedText type="small" themeColor="textSecondary">
              Sign-out removes the native session. The next protected request
              fails with a session-expired error.
            </ThemedText>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
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
    <ThemedView type="backgroundElement" style={styles.analyticsCard}>
      <ThemedText type="smallBold">Optional product analytics</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Help measure onboarding, feature use, failures, and coarse time/tap
        ranges. Events stay on this device unless you choose Export. They never
        include account or device IDs, food names, health values, photos,
        messages, tokens, or file paths.
      </ThemedText>
      <ThemedText type="smallBold">
        {consent === "loading"
          ? "Loading preference…"
          : enabled
            ? `Enabled · ${eventCount} local event${eventCount === 1 ? "" : "s"}`
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
          disabled={!enabled || eventCount === 0}
          onPress={() => void shareExport()}
        />
        <AnalyticsButton
          label="Clear"
          disabled={!enabled || eventCount === 0}
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
        pressed && styles.signOutButtonPressed,
        disabled && styles.signOutButtonDisabled,
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
    <ThemedView type="backgroundElement" style={styles.card}>
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
            {state.principal.userId}
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
        personalize your daily dashboard.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Finish setting up Mizyun"
        onPress={openOnboarding}
        style={({ pressed }) => [
          styles.setupWizardButton,
          pressed && styles.setupWizardButtonPressed,
        ]}
      >
        <ThemedText type="smallBold" style={{ color: "#000000" }}>
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
      <ThemedText type="smallBold">Sign out</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        End this device&apos;s session and clear optional local analytics. Other
        devices are not affected.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.signOutButton,
          pressed && styles.signOutButtonPressed,
          disabled && styles.signOutButtonDisabled,
        ]}
      >
        <ThemedText type="smallBold">Sign out</ThemedText>
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
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  header: { gap: Spacing.one },
  card: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.12)",
  },
  signOutCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  analyticsCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  finishSetupCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  setupWizardButton: {
    marginTop: Spacing.two,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: "center",
    backgroundColor: "#10B981",
  },
  setupWizardButtonPressed: { opacity: 0.8 },
  analyticsActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  analyticsButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
  },
  column: { gap: Spacing.one },
  center: { alignItems: "center", paddingVertical: Spacing.three },
  signOutButton: {
    marginTop: Spacing.two,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EF4444",
    backgroundColor: "rgba(239, 68, 68, 0.05)",
  },
  signOutButtonPressed: { opacity: 0.65 },
  signOutButtonDisabled: { opacity: 0.4 },
  note: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
  },
});
