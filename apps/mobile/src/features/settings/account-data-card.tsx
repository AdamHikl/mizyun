import React, { useState } from "react";
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
  clearLocalUserData,
  confirmAccountDeletion,
  fetchAccountExport,
  requestAccountDeletion,
  saveExportToFile,
} from "./account-data-management";
import { useAiConsentController } from "@/features/coach/ai-consent-controller";

type DeletionStage =
  | "idle"
  | "requesting_challenge"
  | "erasing_server_data"
  | "clearing_local_cache"
  | "failed";

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
              await executeRevokeAiConsent();
              setFeedbackMessage("AI consent has been revoked.");
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
        setPendingChallenge({
          token: challenge.confirmationToken,
          expiresAt: challenge.expiresAt,
        });
      }

      setDeletionStage("erasing_server_data");
      const confirmResult = await confirmAccountDeletion(apiClient, token);
      if (!confirmResult.ok) {
        if (
          confirmResult.reason === "expired" ||
          confirmResult.reason === "mismatch"
        ) {
          setPendingChallenge(null);
        }
        Alert.alert("Deletion Error", confirmResult.message);
        setFeedbackMessage(confirmResult.message);
        setDeletionStage("failed");
        setIsDeleting(false);
        return;
      }

      setPendingChallenge(null);
      setDeletionStage("clearing_local_cache");

      if (session?.user.id) {
        await clearLocalUserData(session.user.id).catch(() => {});
      }

      await signOut().catch(() => {});
      Alert.alert(
        "Account Deleted",
        "Your account and all associated personal data have been permanently erased from active systems.",
      );
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
      "• All active records (profile, goals, logged meals, workouts, body metrics, private photos, and AI chats) will be permanently erased immediately.\n\n• Rolling operational backups are automatically purged on a 30-day retention schedule.\n\n• Files previously exported to your device storage cannot be remotely erased and remain in your local files.",
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
          and photo records immediately from active systems. Rolling operational
          backups expire automatically on a 30-day retention schedule.
          Previously exported local files are not remotely erased.
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
