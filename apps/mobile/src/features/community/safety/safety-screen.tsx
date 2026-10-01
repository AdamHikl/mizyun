import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect, type Href } from "expo-router";
import {
  moderationAppealDtoSchema,
  type CommunityReportSummaryDto,
} from "@mizyun/contracts";
import { MaxContentWidth } from "@/constants/theme";
import { CommunityIntro } from "../community-presentation";
import { apiClient } from "@/composition/api-client";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import {
  fetchMyCommunityReports,
  humanizeCommunityError,
  submitModerationAppeal,
} from "../community-client";
import { scopeCommunityClient } from "../scoped-client";
import { ReportModal } from "./report-modal";
import {
  ownNoticeListSchema,
  recentReceiptListSchema,
  requestSafetyContact,
  type OwnNotice,
  type RecentReceipt,
  type VerifiedSafetyContact,
} from "./safety-api";

export function CommunitySafetyScreen() {
  const { session } = useAuth();
  return (
    <SafetyContent
      key={session?.user.id ?? "signed-out"}
      principalKey={session?.user.id ?? null}
    />
  );
}

export function SafetyContent({
  principalKey,
}: {
  principalKey: string | null;
}) {
  const theme = useTheme();
  const lifetime = useRef({ principalKey, active: true, revision: 0 });
  if (lifetime.current.principalKey !== principalKey) {
    lifetime.current.active = false;
    lifetime.current = { principalKey, active: true, revision: 0 };
  }
  const current = lifetime.current;
  useEffect(() => {
    current.active = true;
    return () => {
      current.active = false;
    };
  }, [current]);
  const isCurrent = () => current.active && lifetime.current === current;
  const [reports, setReports] = useState<readonly CommunityReportSummaryDto[]>(
    [],
  );
  const [receipts, setReceipts] = useState<readonly RecentReceipt[]>([]);
  const [notices, setNotices] = useState<readonly OwnNotice[]>([]);
  const [contact, setContact] = useState<VerifiedSafetyContact | null>(null);
  const [selected, setSelected] = useState<RecentReceipt | null>(null);
  const [appealNotice, setAppealNotice] = useState<OwnNotice | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [appealStatus, setAppealStatus] = useState<{
    id: string;
    status: "pending" | "approved" | "rejected";
  } | null>(null);
  const [displayPrincipal, setDisplayPrincipal] = useState(principalKey);
  if (displayPrincipal !== principalKey) {
    setDisplayPrincipal(principalKey);
    setReports([]);
    setReceipts([]);
    setNotices([]);
    setContact(null);
    setSelected(null);
    setAppealNotice(null);
    setReason("");
    setMessage(null);
    setLoading(false);
    setSending(false);
    setAppealStatus(null);
  }

  const load = useCallback(async () => {
    if (!principalKey || !isCurrent()) return;
    const revision = ++current.revision;
    const valid = () => isCurrent() && current.revision === revision;
    const client = scopeCommunityClient(apiClient, principalKey, valid);
    setLoading(true);
    setMessage(null);
    // Do not retain safety evidence after a failed refresh.
    setReports([]);
    setReceipts([]);
    setNotices([]);
    setContact(null);
    const [reportResult, receiptResult, noticeResult, contactResult] =
      await Promise.all([
        fetchMyCommunityReports(client),
        client.request<RecentReceipt[]>({
          method: "GET",
          path: "/v1/community/safety/receipts",
          schema: recentReceiptListSchema,
        }),
        client.request<OwnNotice[]>({
          method: "GET",
          path: "/v1/community/safety/notices",
          schema: ownNoticeListSchema,
        }),
        requestSafetyContact(client),
      ]);
    if (!valid()) return;
    if (reportResult.ok) {
      setReports(reportResult.value);
    }
    if (receiptResult.ok) setReceipts(receiptResult.value);
    if (noticeResult.ok) setNotices(noticeResult.value);
    if (contactResult.ok) setContact(contactResult.value);
    if (!reportResult.ok || !receiptResult.ok || !noticeResult.ok)
      setMessage(
        "Safety history could not be fully loaded. Retry when connected. No new report or appeal was sent.",
      );
    setLoading(false);
  }, [principalKey, current]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const appeal = async () => {
    if (
      !principalKey ||
      !appealNotice ||
      !reason.trim() ||
      sending ||
      !isCurrent()
    )
      return;
    const client = scopeCommunityClient(apiClient, principalKey, isCurrent);
    setSending(true);
    setMessage(null);
    const result = await submitModerationAppeal(client, {
      reportId: appealNotice.id,
      reason: reason.trim(),
    });
    if (!isCurrent()) return;
    setSending(false);
    if (result.ok) {
      setAppealStatus({ id: result.value.id, status: result.value.status });
      setMessage(
        result.value.status === "pending"
          ? "Appeal received. An independent reviewer must review the decision."
          : `Existing appeal: ${result.value.status}.`,
      );
      setAppealNotice(null);
      setReason("");
    } else
      setMessage(
        `Appeal not confirmed. ${humanizeCommunityError(result.error, "Retry when connected.")}`,
      );
  };
  const refreshAppeal = async () => {
    if (!principalKey || !appealStatus || sending || !isCurrent()) return;
    setSending(true);
    const result = await scopeCommunityClient(
      apiClient,
      principalKey,
      isCurrent,
    ).request<{ id: string; status: "pending" | "approved" | "rejected" }>({
      method: "GET",
      path: `/v1/community/appeals/${encodeURIComponent(appealStatus.id)}`,
      schema: moderationAppealDtoSchema,
    });
    if (!isCurrent()) return;
    setSending(false);
    if (result.ok)
      setAppealStatus({ id: result.value.id, status: result.value.status });
    else
      setMessage("Appeal status could not be confirmed. Retry when connected.");
  };
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "Community safety" }} />
      <CommunityIntro
        icon="🛡️"
        title="Help & safety"
        description="Manage your boundaries, report a concern or check an appeal."
        tone="peach"
      />
      <ThemedText>
        For immediate danger, contact local emergency services. Mizyun reports
        are not an emergency response service.
      </ThemedText>
      {action("Keep tracking privately", () => router.replace("/(tabs)"))}
      {action("Manage blocks and safety lists", () =>
        router.push("/community/relationships" as Href),
      )}
      {contact?.available && contact.contactEmail ? (
        action(
          `Contact safety: ${contact.contactEmail}`,
          () => void Linking.openURL(`mailto:${contact.contactEmail}`),
        )
      ) : (
        <ThemedText>
          Verified Community safety contact is currently unavailable.
        </ThemedText>
      )}
      {contact?.available &&
        contact.standardsUrl &&
        action(
          "Community standards",
          () => void Linking.openURL(contact.standardsUrl!),
        )}
      {principalKey ? (
        <>
          {action(
            loading ? "Checking safety history…" : "Refresh safety history",
            () => void load(),
            loading,
          )}
          {message && (
            <ThemedText accessibilityLiveRegion="polite">{message}</ThemedText>
          )}
          <ThemedText type="subtitle">Your reports</ThemedText>
          {!loading && reports.length === 0 && (
            <ThemedText>No report history loaded.</ThemedText>
          )}
          {reports.map((report) => (
            <View
              key={report.id}
              style={[
                styles.record,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <ThemedText>Case {report.id}</ThemedText>
              <ThemedText>
                {report.reason.replaceAll("_", " ")} ·{" "}
                {report.status.replaceAll("_", " ")}
              </ThemedText>
            </View>
          ))}
          <ThemedText type="subtitle">Report a recent interaction</ThemedText>
          <ThemedText>
            Recent references expire after 30 days. They permit reporting
            without restoring the profile or activity.
          </ThemedText>
          {receipts.map((receipt, index) =>
            action(
              `Report recent ${receipt.targetType} interaction ${index + 1}`,
              () => setSelected(receipt),
            ),
          )}
          {appealStatus && (
            <View style={styles.record}>
              <ThemedText>
                Appeal {appealStatus.id}: {appealStatus.status}
              </ThemedText>
              {action(
                "Check appeal status",
                () => void refreshAppeal(),
                sending,
              )}
              <ThemedText>
                Approval reverses only the linked restriction. It restores no
                withdrawn profile, shared card or follow connection.
              </ThemedText>
            </View>
          )}
          <ThemedText type="subtitle">Your moderation notices</ThemedText>
          {notices.map((notice) => (
            <View key={notice.id} style={styles.record}>
              <ThemedText>
                Reason: {notice.reason.replaceAll("_", " ")} · Decision:{" "}
                {notice.decision ?? notice.status}
              </ThemedText>
              <ThemedText>
                {notice.decision === "suspend" || notice.decision === "ban"
                  ? "This decision restricted Community sharing and social access. Private tracking and safety controls remain available. Later appeals or expiry may change the restriction."
                  : notice.decision === "remove"
                    ? "This decision removed the reported social content."
                    : "This notice does not suspend private tracking."}
              </ThemedText>
              {notice.suspensionExpiresAt && (
                <ThemedText>
                  Recorded restriction expiry:{" "}
                  {new Date(notice.suspensionExpiresAt).toLocaleString()}.
                  Returning to Community requires a fresh choice.
                </ThemedText>
              )}
              {action(
                `Appeal decision ${notice.id}`,
                () => {
                  setAppealNotice(notice);
                  setReason("");
                  setMessage(null);
                },
                sending,
              )}
            </View>
          ))}
          {appealNotice && (
            <View style={styles.record}>
              <ThemedText>Why should this decision be reconsidered?</ThemedText>
              <TextInput
                accessibilityLabel="Appeal reason"
                multiline
                maxLength={1000}
                value={reason}
                onChangeText={setReason}
                editable={!sending}
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
              {action(
                sending ? "Sending appeal…" : "Submit appeal",
                () => void appeal(),
                sending || !reason.trim(),
              )}
              {action(
                "Cancel appeal",
                () => {
                  setAppealNotice(null);
                  setReason("");
                },
                sending,
              )}
            </View>
          )}
          {selected && (
            <ReportModal
              visible
              targetType={selected.targetType}
              targetId={selected.targetId}
              interactionReceiptId={selected.id}
              principalKey={principalKey}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      ) : (
        <ThemedText>
          Sign in to view your reports and appeal decisions.
        </ThemedText>
      )}
      {action("Account export and deletion", () =>
        router.push("/account-settings/account-data?anchor=export" as Href),
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  action: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    justifyContent: "center",
  },
  record: { gap: 8 },
  input: { borderWidth: 1, minHeight: 96, padding: 12, borderRadius: 10 },
});
