import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { PrincipalRenderState } from "./principal-state";

export function PrincipalCard({
  state,
  onRetry,
}: {
  readonly state: PrincipalRenderState;
  readonly onRetry: () => void;
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
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retryButton}
          >
            <ThemedText type="smallBold">Retry</ThemedText>
          </Pressable>
        </View>
      ) : state.kind === "server_error" ? (
        <View style={styles.column}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            SERVER ERROR ({state.status})
          </ThemedText>
          <ThemedText>{state.message}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retryButton}
          >
            <ThemedText type="smallBold">Retry</ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.column}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            UNEXPECTED RESPONSE
          </ThemedText>
          <ThemedText>{state.message}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retryButton}
          >
            <ThemedText type="smallBold">Retry</ThemedText>
          </Pressable>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.four,
    borderRadius: 16,
    gap: Spacing.three,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
  column: {
    gap: Spacing.two,
  },
  retryButton: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    minHeight: 44,
    justifyContent: "center",
  },
});
