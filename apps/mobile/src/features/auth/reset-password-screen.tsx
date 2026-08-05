import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";

import { authClient } from "@/composition/auth-client";
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
      style={styles.page}
    >
      <Text style={styles.eyebrow}>RESET PASSWORD</Text>
      <Text style={styles.title}>Choose a new password</Text>
      <Text style={styles.body}>
        Your account is verified. Set a new password to finish the reset.
      </Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="new-password"
        placeholder="New password"
        placeholderTextColor="#8E8E93"
        returnKeyType="next"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => confirmInput.current?.focus()}
        style={styles.input}
      />
      <TextInput
        autoCapitalize="none"
        autoComplete="new-password"
        placeholder="Confirm new password"
        placeholderTextColor="#8E8E93"
        ref={confirmInput}
        returnKeyType="done"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
        onSubmitEditing={() => {
          if (ready) void submit();
        }}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save new password"
        disabled={!ready}
        onPress={submit}
        style={[styles.primary, !ready && styles.primaryDisabled]}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>Save new password</Text>
        )}
      </Pressable>
      <Pressable accessibilityRole="button" onPress={cancel}>
        <Text style={styles.cancel}>Cancel and sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f7f8f4" },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 28,
    gap: 14,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: "#51705d",
  },
  title: { fontSize: 30, fontWeight: "700", color: "#132019", marginBottom: 8 },
  body: { fontSize: 16, lineHeight: 24, color: "#4d5c53" },
  input: {
    backgroundColor: "#fff",
    borderColor: "#d6ded8",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    color: "#132019",
  },
  error: { color: "#a13a25", lineHeight: 20 },
  message: { color: "#18633d", lineHeight: 20 },
  primary: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#18633d",
    marginTop: 4,
  },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  cancel: {
    textAlign: "center",
    color: "#18633d",
    padding: 10,
    fontWeight: "600",
  },
});
