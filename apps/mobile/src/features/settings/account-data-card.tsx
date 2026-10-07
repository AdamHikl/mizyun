import React, { useEffect, useState } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { apiClient } from "@/composition/api-client";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import {
  clearDeletionChallenge,
  clearLocalUserData,
  checkAccountDeletionStatus,
  confirmAccountDeletion,
  fetchAccountExport,
  loadDeletionChallenge,
  requestAccountDeletion,
  saveDeletionChallenge,
  saveExportToFile,
} from "./account-data-management";
import { useAiConsentController } from "@/features/coach/ai-consent-controller";

type DeletionStage =
  | "idle"
  | "requesting_challenge"
  | "erasing_server_data"
  | "clearing_local_cache"
  | "failed";

/** Server deletion is complete; local cleanup has its own truthful retry boundary. */
export async function finishDeletedAccountLocally(
  userId: string,
  signOut: () => Promise<unknown>,
): Promise<void> {
  let cleaned = true;
  try {
    await clearLocalUserData(userId);
  } catch {
    cleaned = false;
  }
  await signOut().catch(() => undefined);
  Alert.alert(
    "Account Deleted",
    "Your account data has been removed from active systems. Backup copies age out under the retention policy. Copies you exported to Apple Health or Health Connect remain in those apps." +
      (cleaned
        ? " You have been signed out."
        : " Local data cleanup is incomplete. Retry local cleanup on this phone."),
    cleaned
      ? undefined
      : [
          {
            text: "Retry local cleanup",
            onPress: () => {
              void finishDeletedAccountLocally(userId, async () => undefined);
            },
          },
          { text: "OK" },
        ],
  );
}

export function AccountDataCard({
  disabled = false,
}: {
  readonly disabled?: boolean;
}) {
  const { session, signOut } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionStage, setDeletionStage] = useState<DeletionStage>("idle");
  const [pendingChallenge, setPendingChallenge] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isRevokingConsent, setIsRevokingConsent] = useState(false);

  useEffect(() => {
    let active = true;
    const userId = session?.user.id;
    if (!userId) {
      setPendingChallenge(null);
      return;
    }
    void loadDeletionChallenge(userId)
      .then(async (challenge) => {
        if (!active || !challenge) return;
        setPendingChallenge(challenge);

        const status = await checkAccountDeletionStatus(
          apiClient,
          challenge.token,
        );
        if (!active) return;

        if (status.ok) {
          if (status.status === "completed") {
            setPendingChallenge(null);
            await clearDeletionChallenge(userId).catch(() => {});
            await finishDeletedAccountLocally(userId, signOut);
            return;
          }
          if (status.status === "in_progress") {
            setFeedbackMessage(
              `Account deletion is in progress on the server (stage: ${status.stage}). You can check status or retry shortly.`,
            );
            return;
          }
          if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
            setFeedbackMessage(
              "A previous account deletion challenge has expired.",
            );
          } else {
            setFeedbackMessage(
              "A pending account deletion challenge is active.",
            );
          }
        } else if (status.notFound) {
          if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
            await clearDeletionChallenge(userId).catch(() => {});
            setPendingChallenge(null);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [session?.user.id, signOut]);

  const {
    consentGranted: aiConsentGranted,
    revokeConsent: executeRevokeAiConsent,
  } = useAiConsentController({
    userId: session?.user.id ?? null,
    apiClient,
  });

  const handleRevokeConsent = () => {
    Alert.alert(
      "Revoke AI Consent",
      "Revoking consent will disable AI Coach responses and photo meal estimation until consent is granted again. Your existing logs and workouts will remain untouched.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke Consent",
          style: "destructive",
          onPress: async () => {
            setIsRevokingConsent(true);
            try {
              const revoked = await executeRevokeAiConsent();
              setFeedbackMessage(
                revoked
                  ? "AI consent has been revoked."
                  : "Could not revoke AI consent. Please try again.",
              );
            } catch {
              setFeedbackMessage(
                "Could not revoke AI consent. Please try again.",
              );
            } finally {
              setIsRevokingConsent(false);
            }
          },
        },
      ],
    );
  };

  const handleExport = async () => {
    setIsExporting(true);
    setFeedbackMessage(null);
    try {
      const result = await fetchAccountExport(apiClient);
      if (!result.ok) {
        setFeedbackMessage(result.message);
        return;
      }
      const saved = await saveExportToFile(result.data);
      if (!saved.ok) {
        setFeedbackMessage(saved.message);
        return;
      }
      if (result.data.export.manifest?.completeness === "partial") {
        Alert.alert(
          "Partial export saved",
          "This export may omit records or media. Photo download links expire and do not include offline photo files. Review the export before deleting your account.",
        );
      }
      const shareResult = await Share.share({
        title: "Mizyun Account Data Export",
        url: saved.fileUri,
        message: Platform.OS === "android" ? saved.fileUri : undefined,
      });
      if (shareResult.action === Share.sharedAction) {
        setFeedbackMessage("Account data export saved successfully.");
      } else if (shareResult.action === Share.dismissedAction) {
        setFeedbackMessage("Account data export share dismissed.");
      }
    } catch {
      setFeedbackMessage("Could not open share sheet for account export.");
    } finally {
      setIsExporting(false);
    }
  };

  const executeDeletion = async () => {
    const currentUserId = session?.user.id;
    setIsDeleting(true);
    setFeedbackMessage(null);
    try {
      let token = pendingChallenge?.token;
      if (!token) {
        setDeletionStage("requesting_challenge");
        const challenge = await requestAccountDeletion(apiClient);
        if (!challenge.ok) {
          Alert.alert("Deletion Error", challenge.message);
          setFeedbackMessage(challenge.message);
          setDeletionStage("failed");
          setIsDeleting(false);
          return;
        }
        token = challenge.confirmationToken;
        const newChallenge = {
          token: challenge.confirmationToken,
          expiresAt: challenge.expiresAt,
        };
        setPendingChallenge(newChallenge);
        if (currentUserId) {
          await saveDeletionChallenge(currentUserId, newChallenge).catch(
            () => {},
          );
        }
      }

      let appleAuthorizationCode: string | undefined;
      const isAppleUser =
        session?.user.provider === "apple" ||
        (
          session?.user as { identities?: readonly { provider?: string }[] }
        )?.identities?.some((i) => i.provider === "apple");
      if (Platform.OS === "ios" && isAppleUser) {
        const isAppleAuthAvailable =
          await AppleAuthentication.isAvailableAsync().catch(() => false);
        if (isAppleAuthAvailable) {
          try {
            const credential = await AppleAuthentication.signInAsync({
              requestedScopes: [],
            });
            appleAuthorizationCode = credential.authorizationCode ?? undefined;
          } catch (appleErr: unknown) {
            const code =
              appleErr && typeof appleErr === "object" && "code" in appleErr
                ? (appleErr as { code?: string }).code
                : undefined;
            if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED") {
              setIsDeleting(false);
              setDeletionStage("idle");
              return;
            }
            Alert.alert(
              "Apple Verification Required",
              "Sign in with Apple verification is required to revoke authorization when deleting your account. Please try again.",
            );
            setIsDeleting(false);
            setDeletionStage("idle");
            return;
          }
        }
      }

      setDeletionStage("erasing_server_data");
      const confirmResult = await confirmAccountDeletion(
        apiClient,
        token,
        appleAuthorizationCode,
      );
      if (!confirmResult.ok) {
        if (
          confirmResult.reason === "server_error" ||
          confirmResult.reason === "network_error"
        ) {
          const status = await checkAccountDeletionStatus(
            apiClient,
            token,
          ).catch(() => null);
          if (status && status.ok && status.status === "completed") {
            setPendingChallenge(null);
            if (currentUserId) {
              await clearDeletionChallenge(currentUserId).catch(() => {});
            }
            setDeletionStage("clearing_local_cache");
            setIsDeleting(false);
            if (currentUserId)
              await finishDeletedAccountLocally(currentUserId, signOut);
            return;
          }
        }

        if (
          confirmResult.reason === "expired" ||
          confirmResult.reason === "mismatch"
        ) {
          setPendingChallenge(null);
          if (currentUserId) {
            await clearDeletionChallenge(currentUserId).catch(() => {});
          }
        }
        Alert.alert("Deletion Error", confirmResult.message);
        setFeedbackMessage(confirmResult.message);
        setDeletionStage("failed");
        setIsDeleting(false);
        return;
      }

      setPendingChallenge(null);
      if (currentUserId) {
        await clearDeletionChallenge(currentUserId).catch(() => {});
      }
      setDeletionStage("clearing_local_cache");

      setIsDeleting(false);
      if (currentUserId)
        await finishDeletedAccountLocally(currentUserId, signOut);
    } catch {
      const errorMsg = "An unexpected error occurred during account deletion.";
      Alert.alert("Deletion Error", errorMsg);
      setFeedbackMessage(errorMsg);
      setDeletionStage("failed");
      setIsDeleting(false);
    }
  };

  const handleDeletePress = () => {
    Alert.alert(
      "Permanently Delete Account?",
      "• After the staged deletion succeeds, active records (profile, goals, logged meals, workouts, body metrics, private photos, and AI chats) are removed from active systems.\n\n• Operational backup copies have a standard 90-day retention period; a cleanup outage may delay physical deletion.\n\n• Files previously exported to your device storage cannot be remotely erased and remain in your local files.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: pendingChallenge ? "Retry Deletion" : "Delete My Account",
          style: "destructive",
          onPress: () => void executeDeletion(),
        },
      ],
    );
  };

  const deletionButtonLabel = () => {
    switch (deletionStage) {
      case "requesting_challenge":
        return "Requesting Deletion...";
      case "erasing_server_data":
        return "Erasing Account Data...";
      case "clearing_local_cache":
        return "Clearing Local Session...";
      case "failed":
        return pendingChallenge
          ? "⚠️ Retry Account Deletion"
          : "🗑️ Delete Account & All Data";
      default:
        return "🗑️ Delete Account & All Data";
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Account Data & Privacy Rights</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        You own all your personal health and fitness data. You can download a
        complete copy of your records or permanently delete your account at any
        time in accordance with GDPR and CCPA.
      </ThemedText>

      <View style={styles.buttonRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export all account data"
          disabled={disabled || isExporting || isDeleting}
          onPress={() => void handleExport()}
          style={({ pressed }) => [
            styles.exportButton,
            pressed && styles.pressed,
            (disabled || isExporting || isDeleting) && styles.buttonDisabled,
          ]}
        >
          {isExporting ? (
            <ActivityIndicator size="small" color="#10B981" />
          ) : (
            <ThemedText type="smallBold" style={styles.exportButtonText}>
              📦 Export All Account Data (JSON)
            </ThemedText>
          )}
        </Pressable>
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        Export creates a single JSON file containing all your profile, health
        metrics, logged meals, workouts, AI chat history, and stored coach
        memories. For private photos, temporary 24-hour signed download links
        are included so you can save the original files before the links expire
        (full raw media files are not directly embedded in the JSON export).
      </ThemedText>

      <View style={styles.divider} />

      <View style={styles.consentSection}>
        <ThemedText type="smallBold">Third-Party AI & Consent</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {aiConsentGranted
            ? "Third-party AI processing (Google Gemini API) is currently enabled for Coach conversation and meal photo drafting. You confirmed adult eligibility (18+)."
            : "Third-party AI processing is currently not enabled. You will be prompted for consent before using Coach or AI meal drafting."}
        </ThemedText>
        {aiConsentGranted ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Revoke AI consent"
            disabled={
              disabled || isExporting || isDeleting || isRevokingConsent
            }
            onPress={handleRevokeConsent}
            style={({ pressed }) => [
              styles.revokeButton,
              pressed && styles.pressed,
              (disabled || isExporting || isDeleting || isRevokingConsent) &&
                styles.buttonDisabled,
            ]}
          >
            {isRevokingConsent ? (
              <ActivityIndicator size="small" color="#D97706" />
            ) : (
              <ThemedText type="smallBold" style={styles.revokeButtonText}>
                Revoke AI Consent
              </ThemedText>
            )}
          </Pressable>
        ) : null}
      </View>

      <View style={styles.divider} />

      <View style={styles.deleteSection}>
        <ThemedText type="smallBold" style={styles.dangerTitle}>
          Permanent Account Erasure
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Permanently erase your account, login credentials, and all database
          and photo records from active systems after the staged deletion
          succeeds. Operational backup copies have a standard 90-day retention
          period; a cleanup outage may delay physical deletion. Previously
          exported local files are not remotely erased.
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Permanently delete account"
          disabled={disabled || isExporting || isDeleting}
          onPress={handleDeletePress}
          style={({ pressed }) => [
            styles.deleteButton,
            pressed && styles.pressed,
            (disabled || isExporting || isDeleting) && styles.buttonDisabled,
          ]}
        >
          {isDeleting ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#EF4444" />
              <ThemedText type="smallBold" style={styles.deleteButtonText}>
                {deletionButtonLabel()}
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="smallBold" style={styles.deleteButtonText}>
              {deletionButtonLabel()}
            </ThemedText>
          )}
        </Pressable>
      </View>

      {feedbackMessage !== null ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
          style={styles.feedback}
        >
          {feedbackMessage}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  card: {
    padding: Spacing.two + 4,
    borderRadius: 14,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
  },
  buttonRow: {
    marginTop: 4,
  },
  exportButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  exportButtonText: {
    color: "#10B981",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(148, 163, 184, 0.12)",
    marginVertical: 4,
  },
  consentSection: {
    gap: Spacing.one,
  },
  revokeButton: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  revokeButtonText: {
    color: "#D97706",
  },
  deleteSection: {
    gap: Spacing.one,
  },
  dangerTitle: {
    color: "#EF4444",
  },
  deleteButton: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonText: {
    color: "#EF4444",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.7,
  },
  feedback: {
    marginTop: 4,
    fontSize: 12,
  },
});
