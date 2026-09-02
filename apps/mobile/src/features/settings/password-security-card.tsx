import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { authClient } from "@/composition/auth-client";
import { useAuth } from "@/features/auth/auth-context";

/**
 * Password & Security Settings Card.
 *
 * Displays the active authentication method. If the user signed in
 * with email/password, provides both an outbound password reset email
 * trigger (via AWS SES) and direct in-app password update. If the user
 * signed in with Google OAuth, clarifies that password management is
 * handled through their Google Account.
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

  if (isGoogle) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.badgeRow}>
            <View style={styles.googleBadge}>
              <ThemedText type="smallBold" style={styles.googleBadgeText}>
                GOOGLE ACCOUNT
              </ThemedText>
            </View>
          </View>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
          You are signed in with Google OAuth. Your password and account
          security are managed directly through your Google Account.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.badgeRow}>
          <View style={styles.emailBadge}>
            <ThemedText type="smallBold" style={styles.emailBadgeText}>
              EMAIL & PASSWORD
            </ThemedText>
          </View>
        </View>
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
        Manage your password or request a reset link sent to your registered
        email address ({email ?? "your email"}).
      </ThemedText>

      {message ? (
        <ThemedText type="smallBold" style={styles.successText}>
          {message}
        </ThemedText>
      ) : null}

      {error ? (
        <ThemedText type="smallBold" style={styles.errorText}>
          {error}
        </ThemedText>
      ) : null}

      {!isChangingInApp ? (
        <View style={styles.buttonRow}>
          <Pressable
            accessibilityRole="button"
            disabled={emailBusy}
            onPress={handleSendResetEmail}
            style={({ pressed }) => [
              styles.actionButton,
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
          >
            {emailBusy ? (
              <ActivityIndicator color="#18633d" size="small" />
            ) : (
              <ThemedText type="smallBold" style={styles.secondaryButtonText}>
                ✉️ Send Reset Link via Email
              </ThemedText>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setIsChangingInApp(true);
              setError(undefined);
              setMessage(undefined);
            }}
            style={({ pressed }) => [
              styles.actionButton,
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" style={styles.primaryButtonText}>
              🔒 Change Password In-App
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.formContainer}>
          <ThemedText type="smallBold" style={styles.formTitle}>
            Set a new password
          </ThemedText>

          <TextInput
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="New password (min 8 characters)"
            placeholderTextColor="#8E8E93"
            returnKeyType="next"
            secureTextEntry
            value={newPassword}
            onChangeText={setNewPassword}
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
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onSubmitEditing={() => void handleUpdatePasswordInApp()}
            style={styles.input}
          />

          <View style={styles.formButtonRow}>
            <Pressable
              accessibilityRole="button"
              disabled={inAppBusy}
              onPress={handleUpdatePasswordInApp}
              style={({ pressed }) => [
                styles.actionButton,
                styles.primaryButton,
                pressed && styles.pressed,
              ]}
            >
              {inAppBusy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText type="smallBold" style={styles.primaryButtonText}>
                  Save New Password
                </ThemedText>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setIsChangingInApp(false);
                setNewPassword("");
                setConfirmPassword("");
                setError(undefined);
              }}
              style={({ pressed }) => [
                styles.actionButton,
                styles.cancelButton,
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold" style={styles.cancelButtonText}>
                Cancel
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e0e6e2",
    padding: 18,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
  },
  emailBadge: {
    backgroundColor: "rgba(24, 99, 61, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  emailBadgeText: {
    color: "#18633d",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  googleBadge: {
    backgroundColor: "rgba(66, 133, 244, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  googleBadgeText: {
    color: "#1a73e8",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  buttonRow: {
    gap: 10,
    marginTop: 4,
  },
  actionButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryButton: {
    backgroundColor: "#18633d",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#f2f6f4",
    borderWidth: 1,
    borderColor: "#d6ded8",
  },
  secondaryButtonText: {
    color: "#18633d",
    fontWeight: "600",
  },
  cancelButton: {
    backgroundColor: "transparent",
  },
  cancelButtonText: {
    color: "#73887c",
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.8,
  },
  formContainer: {
    gap: 10,
    marginTop: 4,
  },
  formTitle: {
    fontSize: 14,
    color: "#132019",
    marginBottom: 2,
  },
  input: {
    backgroundColor: "#f7f8f4",
    borderColor: "#d6ded8",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: "#132019",
  },
  formButtonRow: {
    gap: 8,
    marginTop: 4,
  },
  successText: {
    color: "#18633d",
    fontSize: 13,
  },
  errorText: {
    color: "#a13a25",
    fontSize: 13,
  },
});
