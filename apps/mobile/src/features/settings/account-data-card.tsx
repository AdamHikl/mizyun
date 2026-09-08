import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Share,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { apiClient } from "@/composition/api-client";
import { authClient } from "@/composition/auth-client";
import { Spacing } from "@/constants/theme";
import {
  confirmAccountDeletion,
  fetchAccountExport,
  requestAccountDeletion,
} from "./account-data-management";

export function AccountDataCard({
  disabled = false,
}: {
  readonly disabled?: boolean;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setFeedbackMessage(null);
    try {
      const result = await fetchAccountExport(apiClient);
      if (!result.ok) {
        setFeedbackMessage(result.message);
        return;
      }
      await Share.share({
        title: "Mizyun Account Data Export",
        message: JSON.stringify(result.data.export, null, 2),
      });
      setFeedbackMessage("Account data export opened in system share sheet.");
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
      const challenge = await requestAccountDeletion(apiClient);
      if (!challenge.ok) {
        Alert.alert("Deletion Error", challenge.message);
        setFeedbackMessage(challenge.message);
        setIsDeleting(false);
        return;
      }

      const confirmResult = await confirmAccountDeletion(
        apiClient,
        challenge.confirmationToken,
      );
      if (!confirmResult.ok) {
        Alert.alert("Deletion Error", confirmResult.message);
        setFeedbackMessage(confirmResult.message);
        setIsDeleting(false);
        return;
      }

      await authClient.signOut();
      Alert.alert(
        "Account Deleted",
        "Your account and all associated personal data have been permanently erased.",
      );
    } catch {
      const errorMsg = "An unexpected error occurred during account deletion.";
      Alert.alert("Deletion Error", errorMsg);
      setFeedbackMessage(errorMsg);
      setIsDeleting(false);
    }
  };

  const handleDeletePress = () => {
    Alert.alert(
      "Permanently Delete Account?",
      "This action is irreversible. All of your profile details, goals, logged meals, workout history, body measurements, private progress photos, AI conversations, and login credentials will be permanently erased immediately.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete My Account",
          style: "destructive",
          onPress: () => void executeDeletion(),
        },
      ],
    );
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

      <View style={styles.deleteSection}>
        <ThemedText type="smallBold" style={styles.dangerTitle}>
          Permanent Account Erasure
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Permanently erase your account, login credentials, and all database
          and photo records. This action cannot be undone.
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
            <ActivityIndicator size="small" color="#EF4444" />
          ) : (
            <ThemedText type="smallBold" style={styles.deleteButtonText}>
              🗑️ Delete Account & All Data
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
