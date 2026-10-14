import { useCallback, useRef, useState } from "react";
import { Alert, StyleSheet, View, type TextInput } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, Card, Chip, Notice } from "@/components/ui";
import { authClient } from "@/composition/auth-client";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";

import { FormTextInput } from "./settings-form";

/**
 * Password & Security Settings Card.
 *
 * Rendered on the Sign-in & security settings detail screen.
 */
export function PasswordSecurityCard() {
  const { session } = useAuth();
  const [isChangingInApp, setIsChangingInApp] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [inAppBusy, setInAppBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const confirmInput = useRef<TextInput>(null);

  const provider = session?.user?.provider ?? "email";
  const email = session?.user?.email;
  const isGoogle = provider === "google";
  const isApple = provider === "apple";

  const handleSendResetEmail = useCallback(async () => {
    if (!email) {
      Alert.alert(
        "Email unavailable",
        "Could not determine your email address to send a reset link.",
      );
      return;
    }
    setEmailBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await authClient.requestPasswordRecovery({ email });
      Alert.alert(
        "Reset Link Sent",
        `A password reset link was sent to ${email}. Check your inbox to choose a new password.`,
      );
      setMessage(`Reset link sent to ${email}.`);
    } catch (cause) {
      const msg =
        cause instanceof Error
          ? cause.message
          : "Could not send password reset email.";
      setError(msg);
    } finally {
      setEmailBusy(false);
    }
  }, [email]);

  const handleUpdatePasswordInApp = useCallback(async () => {
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setInAppBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await authClient.updatePassword({ password: newPassword });
      setMessage("Your password was updated successfully!");
      setNewPassword("");
      setConfirmPassword("");
      setIsChangingInApp(false);
      Alert.alert(
        "Password Updated",
        "Your password has been changed successfully.",
      );
    } catch (cause) {
      const msg =
        cause instanceof Error ? cause.message : "Could not update password.";
      setError(msg);
    } finally {
      setInAppBusy(false);
    }
  }, [newPassword, confirmPassword]);

  if (isApple) {
    return (
      <Card>
        <Chip label="Apple Account" style={styles.providerChip} />
        <ThemedText type="footnote" themeColor="textSecondary">
          You are signed in with Apple ID. Your password and account security
          are managed directly through your Apple Account.
        </ThemedText>
      </Card>
    );
  }

  if (isGoogle) {
    return (
      <Card>
        <Chip label="Google Account" style={styles.providerChip} />
        <ThemedText type="footnote" themeColor="textSecondary">
          You are signed in with Google OAuth. Your password and account
          security are managed directly through your Google Account.
        </ThemedText>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <Card>
        <Chip
          label="Email & password"
          tone="primary"
          style={styles.providerChip}
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          Manage your password or request an official reset link sent to{" "}
          <ThemedText type="footnote" style={styles.emphasis}>
            {email ?? "your email"}
          </ThemedText>
          .
        </ThemedText>

        {!isChangingInApp ? (
          <View style={styles.buttonRow}>
            <Button
              label="Change password in app"
              variant="tinted"
              block
              onPress={() => {
                setIsChangingInApp(true);
                setError(undefined);
                setMessage(undefined);
              }}
            />
            <Button
              label="Send reset link by email"
              variant="secondary"
              block
              loading={emailBusy}
              onPress={handleSendResetEmail}
            />
          </View>
        ) : (
          <View style={styles.formContainer}>
            <ThemedText type="headline">Choose a new password</ThemedText>

            <FormTextInput
              accessibilityLabel="New password (min 8 characters)"
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="New password (min 8 characters)"
              returnKeyType="next"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              onSubmitEditing={() => confirmInput.current?.focus()}
            />

            <FormTextInput
              accessibilityLabel="Confirm new password"
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="Confirm new password"
              ref={confirmInput}
              returnKeyType="done"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              onSubmitEditing={() => void handleUpdatePasswordInApp()}
            />

            <View style={styles.buttonRow}>
              <Button
                label="Save new password"
                block
                loading={inAppBusy}
                onPress={handleUpdatePasswordInApp}
              />
              <Button
                label="Cancel"
                variant="plain"
                block
                onPress={() => {
                  setIsChangingInApp(false);
                  setNewPassword("");
                  setConfirmPassword("");
                  setError(undefined);
                }}
              />
            </View>
          </View>
        )}
      </Card>

      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="danger" message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  providerChip: {
    marginBottom: Spacing.one,
  },
  emphasis: {
    fontWeight: "600",
  },
  buttonRow: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  formContainer: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
});
