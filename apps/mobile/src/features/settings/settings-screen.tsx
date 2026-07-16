import { apiClient, apiConfiguration } from "@/composition/api-client";
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
  const { signOut } = useAuth();
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
  }, [refresh]);

  const onSignOut = useCallback(async () => {
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
        End this device&apos;s session. Other devices are not affected.
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
  safeArea: { flex: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  header: { gap: Spacing.two },
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  signOutCard: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  column: { gap: Spacing.one },
  center: { alignItems: "center", paddingVertical: Spacing.three },
  signOutButton: {
    marginTop: Spacing.two,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
  },
  signOutButtonPressed: { opacity: 0.65 },
  signOutButtonDisabled: { opacity: 0.4 },
  note: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
});
