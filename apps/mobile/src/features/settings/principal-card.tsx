import { ThemedText } from "@/components/themed-text";
import { Button, Card } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { PrincipalRenderState } from "./principal-state";

function StateBlock({
  label,
  message,
  onRetry,
}: {
  readonly label: string;
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <View style={styles.column}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText>{message}</ThemedText>
      {onRetry ? (
        <Button
          label="Retry"
          variant="tinted"
          size="small"
          icon="repeat"
          onPress={onRetry}
          style={styles.retry}
        />
      ) : null}
    </View>
  );
}

export function PrincipalCard({
  state,
  onRetry,
}: {
  readonly state: PrincipalRenderState;
  readonly onRetry: () => void;
}) {
  return (
    <Card>
      {state.kind === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : state.kind === "ready" ? (
        <View style={styles.column}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Signed in as
          </ThemedText>
          <ThemedText type="headline">
            {state.principal.email ?? state.principal.userId}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary" selectable>
            User ID: {state.principal.userId}
          </ThemedText>
        </View>
      ) : state.kind === "disabled" ? (
        <StateBlock label="Not configured" message={state.reason} />
      ) : state.kind === "no_session" ? (
        <StateBlock
          label="No active session"
          message="The session has not been established yet. Return to the welcome screen to sign in."
        />
      ) : state.kind === "session_expired" ? (
        <StateBlock
          label="Session expired"
          message="The Mizyun server rejected the bearer token. Sign in again to continue."
        />
      ) : state.kind === "network_error" ? (
        <StateBlock
          label="Network error"
          message={state.message}
          onRetry={onRetry}
        />
      ) : state.kind === "server_error" ? (
        <StateBlock
          label={`Server error (${state.status})`}
          message={state.message}
          onRetry={onRetry}
        />
      ) : (
        <StateBlock
          label="Unexpected response"
          message={state.message}
          onRetry={onRetry}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
  column: {
    gap: Spacing.one,
  },
  retry: {
    marginTop: Spacing.two,
  },
});
