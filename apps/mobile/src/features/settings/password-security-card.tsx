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
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";

/**
 * Password & Security Settings Card.
 *
 * Designed to live inside a CollapsibleSection in the Account & Session hub.
 * Fully theme-aware with dark mode compliance.
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
      <View style={styles.container}>
        <View style={styles.badgeRow}>
          <View style={styles.googleBadge}>
            <ThemedText type="smallBold" style={styles.googleBadgeText}>
              GOOGLE ACCOUNT
            </ThemedText>
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
    <View style={styles.container}>
      <View style={styles.badgeRow}>
        <View style={styles.emailBadge}>
          <ThemedText type="smallBold" style={styles.emailBadgeText}>
            EMAIL & PASSWORD
          </ThemedText>
        </View>
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
        Manage your password or request an official reset link sent to{" "}
        <ThemedText type="smallBold" style={styles.highlightEmail}>
          {email ?? "your email"}
        </ThemedText>
        .
      </ThemedText>

      {message ? (
        <ThemedText type="smallBold" style={styles.successText}>
          ✓ {message}
        </ThemedText>
      ) : null}

      {error ? (
        <ThemedText type="smallBold" style={styles.errorText}>
          ⚠️ {error}
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
              <ActivityIndicator color="#10B981" size="small" />
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
          <ThemedText type="smallBold">Choose a new password</ThemedText>

          <TextInput
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="New password (min 8 characters)"
            placeholderTextColor="#64748B"
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
            placeholderTextColor="#64748B"
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
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  badgeRow: {
    flexDirection: "row",
  },
  emailBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  emailBadgeText: {
    color: "#10B981",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  googleBadge: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  googleBadgeText: {
    color: "#60A5FA",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  highlightEmail: {
    color: "#E2E8F0",
  },
  buttonRow: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  actionButton: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
  },
  primaryButton: {
    backgroundColor: "#10B981",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  secondaryButtonText: {
    color: "#34D399",
    fontWeight: "600",
    fontSize: 14,
  },
  cancelButton: {
    backgroundColor: "transparent",
  },
  cancelButtonText: {
    color: "#94A3B8",
    fontWeight: "600",
    fontSize: 14,
  },
  pressed: {
    opacity: 0.8,
  },
  formContainer: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  input: {
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    borderColor: "rgba(148, 163, 184, 0.2)",
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    fontSize: 15,
    color: "#F8FAFC",
  },
  formButtonRow: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  successText: {
    color: "#10B981",
    fontSize: 13,
  },
  errorText: {
    color: "#EF4444",
    fontSize: 13,
  },
});
