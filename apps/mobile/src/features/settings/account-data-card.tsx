import React, { useEffect, useRef, useState } from "react";
import { isStretchAiEnabled } from "@/composition/app-variant";
import * as AppleAuthentication from "expo-apple-authentication";
import { Alert, Platform, Share, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, Card, SectionHeader } from "@/components/ui";
import { apiClient } from "@/composition/api-client";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import {
  clearDeletionChallenge,
  clearLocalUserData,
  checkAccountDeletionStatus,
  confirmRecoverableAccountDeletion,
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

/** Settings status line naming which provider handles each AI feature. */
export const aiConsentStatusText = (
  granted: boolean,
  stretchAi: boolean,
): string =>
  granted
    ? `Third-party AI processing is currently enabled. Anthropic (Claude) handles Coach chat, typed meal estimates and draft changes, and Log activity descriptions. Google (Gemini API) handles meal, label and ingredient photos, the cooking assistant${stretchAi ? ", meal illustrations and the evening stretch" : " and meal illustrations"}. You confirmed adult eligibility (18+).`
    : "Third-party AI processing is currently not enabled. You'll be asked for consent the first time you use Coach or AI meal drafts.";

export function AccountDataCard({
  disabled = false,
}: {
  readonly disabled?: boolean;
}) {
  const { session, signOut } = useAuth();
  const exportSession = useRef(session);
  exportSession.current = session;
  const exportMounted = useRef(true);
  useEffect(() => {
    exportMounted.current = true;
    return () => {
      exportMounted.current = false;
    };
  }, []);
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
    // A retired export must not keep a replacement owner/token's controls busy.
    setIsExporting(false);
  }, [session?.user.id, session?.accessToken]);

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
      `Revoking consent turns off Coach, AI meal drafts and illustrations, ingredient photos and the cooking assistant until you consent again. Log activity goes back to filling in descriptions on your device${isStretchAiEnabled() ? ", and the evening stretch uses Mizyun's own picks" : ""}. Your existing logs and workouts will remain untouched.`,
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
    const captured = session;
    if (!captured) return;
    const isCurrent = () =>
      exportMounted.current &&
      exportSession.current?.user.id === captured.user.id &&
      exportSession.current?.accessToken === captured.accessToken;
    setIsExporting(true);
    setFeedbackMessage(null);
    try {
      const result = await fetchAccountExport(apiClient, {
        expectedUserId: captured.user.id,
        isCurrent,
      });
      if (!isCurrent()) return;
      if (!result.ok) {
        setFeedbackMessage(result.message);
        return;
      }
      const saved = await saveExportToFile(result.data);
      if (!isCurrent()) return;
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
      if (!isCurrent()) return;
      if (shareResult.action === Share.sharedAction) {
        setFeedbackMessage("Account data export saved successfully.");
      } else if (shareResult.action === Share.dismissedAction) {
        setFeedbackMessage("Account data export share dismissed.");
      }
    } catch {
      if (isCurrent())
        setFeedbackMessage("Could not open share sheet for account export.");
    } finally {
      if (isCurrent()) setIsExporting(false);
    }
  };

  const executeDeletion = async () => {
    const currentUserId = session?.user.id;
    if (!currentUserId) return;
    setIsDeleting(true);
    setFeedbackMessage(null);
    try {
      let token = pendingChallenge?.token;
      let expiresAt = pendingChallenge?.expiresAt;
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
        expiresAt = challenge.expiresAt;
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
      if (!expiresAt) throw new Error("Missing deletion recovery receipt");
      const confirmResult = await confirmRecoverableAccountDeletion(
        apiClient,
        currentUserId,
        { token, expiresAt },
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
        return "Requesting deletion…";
      case "erasing_server_data":
        return "Erasing account data…";
      case "clearing_local_cache":
        return "Clearing local session…";
      case "failed":
        return pendingChallenge
          ? "Retry account deletion"
          : "Delete account & all data";
      default:
        return "Delete account & all data";
    }
  };

  return (
    <View style={styles.page}>
      <ThemedText type="footnote" themeColor="textSecondary">
        You own all your personal health and fitness data. You can download a
        complete copy of your records or permanently delete your account at any
        time in accordance with GDPR and CCPA.
      </ThemedText>

      <SectionHeader title="Export" />
      <Card>
        <Button
          label="Export all account data (JSON)"
          variant="tinted"
          icon="share"
          block
          accessibilityLabel="Export all account data"
          loading={isExporting}
          disabled={disabled || isDeleting}
          onPress={() => void handleExport()}
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          Export creates a single JSON file containing all your profile, health
          metrics, logged meals, workouts, AI chat history, and stored coach
          memories. For private photos, temporary 24-hour signed download links
          are included so you can save the original files before the links
          expire (full raw media files are not directly embedded in the JSON
          export).
        </ThemedText>
      </Card>

      <SectionHeader title="Third-party AI & consent" />
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {aiConsentStatusText(aiConsentGranted, isStretchAiEnabled())}
        </ThemedText>
        {aiConsentGranted ? (
          <Button
            label="Revoke AI consent"
            variant="secondary"
            block
            accessibilityLabel="Revoke AI consent"
            loading={isRevokingConsent}
            disabled={disabled || isExporting || isDeleting}
            onPress={handleRevokeConsent}
          />
        ) : null}
      </Card>

      <SectionHeader title="Permanent account erasure" />
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Permanently erase your account, login credentials, and all database
          and photo records from active systems after the staged deletion
          succeeds. Operational backup copies have a standard 90-day retention
          period; a cleanup outage may delay physical deletion. Previously
          exported local files are not remotely erased.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Deleting your account does not cancel a Mizyun Pro subscription.
          Cancel it first in Settings → Mizyun Pro plan → Manage or cancel
          subscription, or in your App Store or Google Play account.
        </ThemedText>
        <Button
          label={deletionButtonLabel()}
          variant="destructive"
          icon="trash"
          block
          accessibilityLabel="Permanently delete account"
          loading={isDeleting}
          disabled={disabled || isExporting}
          onPress={handleDeletePress}
        />
      </Card>

      {feedbackMessage !== null ? (
        <ThemedText
          type="footnote"
          themeColor="textSecondary"
          accessibilityRole="alert"
        >
          {feedbackMessage}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: Spacing.two,
  },
});
