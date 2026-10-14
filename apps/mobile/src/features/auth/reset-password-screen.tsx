import { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, type TextInput } from "react-native";

import { BrandWordmark } from "@/components/brand-wordmark";
import { ThemedText } from "@/components/themed-text";
import { Button, Card, FormStatus, FormTextInput } from "@/components/ui";
import { authClient } from "@/composition/auth-client";
import {
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Spacing,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "./auth-context";

/**
 * Reset-password screen.
 *
 * Reached via the SessionGate when a `kind: "recovery"` deep link
 * has been consumed: the user is signed in (the deep link set the
 * session), and the Supabase auth client is in the recovery state
 * that allows `updateUser({ password })` without re-authentication.
 */
export function ResetPasswordScreen() {
  const theme = useTheme();
  const confirmInput = useRef<TextInput>(null);
  const { clearRecoveryState, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const submit = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
      await authClient.updatePassword({ password });
      clearRecoveryState();
      setMessage("Password updated. You are now signed in.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update password.",
      );
    } finally {
      setBusy(false);
    }
  }, [password, confirm, clearRecoveryState]);

  const cancel = useCallback(async () => {
    clearRecoveryState();
    await signOut();
  }, [clearRecoveryState, signOut]);

  const ready = !busy && password.length >= 8 && password === confirm;

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={[styles.page, { backgroundColor: theme.background }]}
    >
      <View style={styles.hero}>
        <BrandWordmark />
        <ThemedText type="subtitle" style={styles.center}>
          Choose a new password
        </ThemedText>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.center}
        >
          Your account is verified. Set a new password to finish the reset.
        </ThemedText>
      </View>
      <Card padded={false} style={styles.inputGroup}>
        <FormTextInput
          accessibilityLabel="New password"
          autoCapitalize="none"
          autoComplete="new-password"
          placeholder="New password"
          returnKeyType="next"
          secureTextEntry
          textContentType="newPassword"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => confirmInput.current?.focus()}
          style={styles.groupedInput}
        />
        <View
          style={[styles.inputSeparator, { backgroundColor: theme.separator }]}
        />
        <FormTextInput
          accessibilityLabel="Confirm new password"
          autoCapitalize="none"
          autoComplete="new-password"
          placeholder="Confirm new password"
          ref={confirmInput}
          returnKeyType="done"
          secureTextEntry
          textContentType="newPassword"
          value={confirm}
          onChangeText={setConfirm}
          onSubmitEditing={() => {
            if (ready) void submit();
          }}
          style={styles.groupedInput}
        />
      </Card>
      {error ? <FormStatus tone="error">{error}</FormStatus> : null}
      {message ? <FormStatus tone="success">{message}</FormStatus> : null}
      <Button
        accessibilityLabel="Save new password"
        label="Save new password"
        block
        loading={busy}
        disabled={!ready}
        onPress={submit}
      />
      <Button
        label="Cancel and sign out"
        variant="plain"
        style={styles.centerAction}
        onPress={cancel}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingVertical: Spacing.five,
    gap: Spacing.three,
  },
  hero: {
    alignItems: "center",
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  center: { textAlign: "center" },
  centerAction: { alignSelf: "center" },
  inputGroup: { overflow: "hidden" },
  groupedInput: {
    minHeight: MinTouchTarget + 6,
    borderRadius: 0,
    backgroundColor: "transparent",
    paddingHorizontal: Spacing.three,
  },
  inputSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
});
