import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CommunityReportReason } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useTheme } from "@/hooks/use-theme";
import {
  humanizeCommunityError,
  submitCommunityReport,
} from "../community-client";
import { scopeCommunityClient } from "../scoped-client";
import { requestSafetyContact, type VerifiedSafetyContact } from "./safety-api";

export interface ReportModalProps {
  readonly visible: boolean;
  readonly targetType: "activity" | "profile";
  readonly targetId: string;
  readonly targetHandle?: string;
  readonly principalKey: string | null;
  readonly interactionReceiptId?: string;
  readonly onClose: () => void;
  readonly onSuccess?: (reportId: string, blocked: boolean) => void;
}

interface ReasonOption {
  readonly key: CommunityReportReason;
  readonly label: string;
  readonly description: string;
}

const REASONS: readonly ReasonOption[] = [
  {
    key: "harassment",
    label: "Harassment, bullying, or hate",
    description: "Targeted attacks, threats, body shaming, or intimidation.",
  },
  {
    key: "unsafe_or_sexual_content",
    label: "Sexual content or unsafe advice",
    description:
      "Explicit media, sexual solicitation, dangerous diets, or unsafe health guidance.",
  },
  {
    key: "impersonation",
    label: "Impersonation",
    description: "Pretending to be someone else or misrepresenting identity.",
  },
  {
    key: "spam",
    label: "Spam, scam, or solicitation",
    description: "Commercial advertising, repetitive links, scams, or fraud.",
  },
  {
    key: "offensive_content",
    label: "Offensive or inappropriate content",
    description: "Violates community norms or contains vulgar material.",
  },
  {
    key: "other",
    label: "Other violation",
    description: "Other violation of Mizyun Community Standards.",
  },
];

const MAX_NOTES_LENGTH = 1000;

export function ReportModal({
  visible,
  targetType,
  targetId,
  targetHandle,
  principalKey,
  interactionReceiptId,
  onClose,
  onSuccess,
}: ReportModalProps) {
  const colors = useTheme();
  const identity = `${principalKey}:${targetType}:${targetId}:${interactionReceiptId ?? ""}:${visible}`;
  const lifetime = useRef({ identity, active: true });
  if (lifetime.current.identity !== identity) {
    lifetime.current.active = false;
    lifetime.current = { identity, active: true };
  }
  const current = lifetime.current;
  const isCurrent = () => current.active && lifetime.current === current;
  useEffect(() => {
    current.active = true;
    return () => {
      current.active = false;
    };
  }, [current]);

  const [selectedReason, setSelectedReason] =
    useState<CommunityReportReason | null>(null);
  const [notes, setNotes] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedReportId, setSubmittedReportId] = useState<string | null>(
    null,
  );

  const [blocked, setBlocked] = useState(false);
  const [contact, setContact] = useState<VerifiedSafetyContact | null>(null);
  const [formIdentity, setFormIdentity] = useState(identity);

  const resetForm = () => {
    setSelectedReason(null);
    setNotes("");
    setAlsoBlock(false);
    setError(null);
    setSubmittedReportId(null);
    setSubmitting(false);
    setBlocked(false);
  };

  if (formIdentity !== identity) {
    setFormIdentity(identity);
    resetForm();
    setContact(null);
  }
  useEffect(() => {
    if (!visible || !principalKey) return;
    const client = scopeCommunityClient(apiClient, principalKey, isCurrent);
    void requestSafetyContact(client).then((result) => {
      if (isCurrent()) setContact(result.ok ? result.value : null);
    });
  }, [current, visible, principalKey]);

  const handleClose = () => {
    current.active = false;
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (
      !selectedReason ||
      !principalKey ||
      submitting ||
      !visible ||
      !isCurrent()
    )
      return;

    setSubmitting(true);
    setError(null);

    const client = scopeCommunityClient(apiClient, principalKey, isCurrent);

    const result = await submitCommunityReport(client, {
      targetType,
      targetId,
      reason: selectedReason,
      notes: notes.trim() || undefined,
      alsoBlock: alsoBlock ? true : undefined,
      interactionReceiptId: interactionReceiptId || undefined,
    });

    if (!isCurrent()) return;
    setSubmitting(false);

    if (result.ok) {
      setSubmittedReportId(result.value.id);
      const confirmedBlock = result.value.blocked === true;
      setBlocked(confirmedBlock);
      onSuccess?.(result.value.id, confirmedBlock);
    } else {
      setError(
        `Report not confirmed. ${humanizeCommunityError(result.error, "Retry when connected.")} Check your report history before retrying.`,
      );
    }
  };

  const targetLabel = targetHandle ? `@${targetHandle}` : `this ${targetType}`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {submittedReportId ? "Report Submitted" : `Report ${targetLabel}`}
          </Text>
          <Pressable
            onPress={handleClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close report dialog"
          >
            <Text style={[styles.closeButtonText, { color: colors.primary }]}>
              {submittedReportId ? "Done" : "Cancel"}
            </Text>
          </Pressable>
        </View>

        {submittedReportId ? (
          /* Confirmation / Success Screen */
          <ScrollView contentContainerStyle={styles.successContent}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: `${colors.primary}1A` },
              ]}
            >
              <Text style={[styles.successIcon, { color: colors.primary }]}>
                ✓
              </Text>
            </View>

            <Text style={[styles.successHeading, { color: colors.text }]}>
              Thank you for keeping Mizyun safe
            </Text>

            <Text style={[styles.successBody, { color: colors.textSecondary }]}>
              The server received your report. Filing a report does not by
              itself impose a sanction.
            </Text>

            <View
              style={[
                styles.referenceBox,
                {
                  backgroundColor: colors.backgroundElement,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[styles.referenceLabel, { color: colors.textSecondary }]}
              >
                Case Reference ID:
              </Text>
              <Text
                style={[styles.referenceId, { color: colors.text }]}
                selectable
                accessibilityLabel={`Reference ID: ${submittedReportId}`}
              >
                {submittedReportId}
              </Text>
            </View>

            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: colors.backgroundElement,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.infoTitle, { color: colors.text }]}>
                What happens next?
              </Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                • Reports are confidential to authorized moderation staff.
              </Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                • The subject does not receive your identity or report details.
              </Text>
              {blocked ? (
                <Text
                  style={[styles.infoText, { color: colors.textSecondary }]}
                >
                  • You have blocked {targetLabel}. They cannot view your
                  profile or workouts.
                </Text>
              ) : null}
              {alsoBlock && !blocked && (
                <Text
                  style={[styles.infoText, { color: colors.textSecondary }]}
                >
                  The report was received, but blocking was not confirmed.
                  Manage blocks in Community safety lists.
                </Text>
              )}
              {contact?.available && contact.contactEmail && (
                <Pressable
                  accessibilityRole="link"
                  onPress={() =>
                    void Linking.openURL(`mailto:${contact.contactEmail}`)
                  }
                >
                  <Text style={[styles.infoText, { color: colors.primary }]}>
                    Contact safety: {contact.contactEmail}
                  </Text>
                </Pressable>
              )}
            </View>

            <Pressable
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary },
              ]}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Dismiss confirmation"
            >
              <Text
                style={[styles.primaryButtonText, { color: colors.background }]}
              >
                Done
              </Text>
            </Pressable>
          </ScrollView>
        ) : (
          /* Form Content */
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Emergency Advice Banner */}
            <View
              style={[
                styles.emergencyBanner,
                {
                  backgroundColor: "#FEF2F2",
                  borderColor: "#FCA5A5",
                },
              ]}
              accessibilityRole="alert"
            >
              <Text style={styles.emergencyHeading}>⚠️ Immediate danger?</Text>
              <Text style={styles.emergencyBody}>
                If you or someone else is in immediate danger or needs emergency
                help, please contact your local emergency services immediately.
                Mizyun reporting is not an emergency response service.
              </Text>
            </View>

            {/* Error Message */}
            {error ? (
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: "#FEF2F2",
                    borderColor: "#F87171",
                  },
                ]}
                accessibilityRole="alert"
              >
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Reason Picker */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Why are you reporting {targetLabel}?
            </Text>
            <Text
              style={[styles.sectionSubtitle, { color: colors.textSecondary }]}
            >
              Select the reason that best describes the issue:
            </Text>

            <View style={styles.reasonList}>
              {REASONS.map((r) => {
                const isSelected = selectedReason === r.key;
                return (
                  <Pressable
                    key={r.key}
                    style={[
                      styles.reasonItem,
                      {
                        borderColor: isSelected
                          ? colors.primary
                          : colors.border,
                        backgroundColor: isSelected
                          ? `${colors.primary}0D`
                          : colors.backgroundElement,
                      },
                    ]}
                    onPress={() => setSelectedReason(r.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={r.label}
                  >
                    <View style={styles.radioOuter}>
                      {isSelected ? (
                        <View
                          style={[
                            styles.radioInner,
                            { backgroundColor: colors.primary },
                          ]}
                        />
                      ) : null}
                    </View>
                    <View style={styles.reasonTextContainer}>
                      <Text
                        style={[
                          styles.reasonLabel,
                          {
                            color: isSelected ? colors.primary : colors.text,
                            fontWeight: isSelected ? "600" : "500",
                          },
                        ]}
                      >
                        {r.label}
                      </Text>
                      <Text
                        style={[
                          styles.reasonDesc,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {r.description}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Additional Notes */}
            <View style={styles.notesSection}>
              <View style={styles.notesHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Additional details (optional)
                </Text>
                <Text
                  style={[styles.counterText, { color: colors.textSecondary }]}
                >
                  {notes.length}/{MAX_NOTES_LENGTH}
                </Text>
              </View>
              <Text
                style={[
                  styles.healthWarningText,
                  { color: colors.textSecondary },
                ]}
              >
                Please leave out private health information. Describe the
                behavior or content concisely.
              </Text>
              <TextInput
                style={[
                  styles.notesInput,
                  {
                    color: colors.text,
                    backgroundColor: colors.backgroundElement,
                    borderColor: colors.border,
                  },
                ]}
                multiline
                numberOfLines={4}
                maxLength={MAX_NOTES_LENGTH}
                placeholder="What happened? (Do not include medical details)"
                placeholderTextColor={colors.textSecondary}
                value={notes}
                onChangeText={setNotes}
                editable={!submitting}
                textAlignVertical="top"
                accessibilityLabel="Additional report details"
              />
            </View>

            {/* Also Block Toggle */}
            {targetType === "profile" && (
              <Pressable
                style={[
                  styles.blockRow,
                  {
                    backgroundColor: colors.backgroundElement,
                    borderColor: colors.border,
                  },
                ]}
                disabled={submitting}
                onPress={() => setAlsoBlock((prev) => !prev)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: alsoBlock }}
                accessibilityLabel={`Also block ${targetLabel}`}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: alsoBlock ? colors.primary : colors.border,
                      backgroundColor: alsoBlock
                        ? colors.primary
                        : "transparent",
                    },
                  ]}
                >
                  {alsoBlock ? (
                    <Text
                      style={[styles.checkmark, { color: colors.background }]}
                    >
                      ✓
                    </Text>
                  ) : null}
                </View>
                <View style={styles.blockTextContainer}>
                  <Text style={[styles.blockTitle, { color: colors.text }]}>
                    Also block {targetLabel}
                  </Text>
                  <Text
                    style={[styles.blockDesc, { color: colors.textSecondary }]}
                  >
                    You will lose mutual follow connections. Neither of you will
                    be able to see each other&apos;s profile or workouts.
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Submit Action */}
            <Pressable
              style={[
                styles.primaryButton,
                {
                  backgroundColor:
                    selectedReason && !submitting
                      ? colors.primary
                      : colors.border,
                },
              ]}
              disabled={!selectedReason || submitting || !principalKey}
              onPress={handleSubmit}
              accessibilityRole="button"
              accessibilityLabel="Submit community report"
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text
                  style={[
                    styles.primaryButtonText,
                    {
                      color:
                        selectedReason && !submitting
                          ? colors.background
                          : colors.textSecondary,
                    },
                  ]}
                >
                  Submit Report
                </Text>
              )}
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  formContent: {
    padding: 20,
    gap: 16,
  },
  emergencyBanner: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  emergencyHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#991B1B",
  },
  emergencyBody: {
    fontSize: 13,
    lineHeight: 18,
    color: "#7F1D1D",
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 14,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  sectionSubtitle: {
    fontSize: 13,
    marginTop: -8,
  },
  reasonList: {
    gap: 10,
  },
  reasonItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 12,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#9CA3AF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  reasonTextContainer: {
    flex: 1,
    gap: 2,
  },
  reasonLabel: {
    fontSize: 15,
  },
  reasonDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  notesSection: {
    gap: 8,
    marginTop: 4,
  },
  notesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  counterText: {
    fontSize: 12,
  },
  healthWarningText: {
    fontSize: 12,
    lineHeight: 16,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 90,
  },
  blockRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    gap: 12,
    marginTop: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkmark: {
    fontSize: 13,
    fontWeight: "800",
  },
  blockTextContainer: {
    flex: 1,
    gap: 2,
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  blockDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    marginBottom: 32,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  successContent: {
    padding: 24,
    alignItems: "center",
    gap: 18,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  successIcon: {
    fontSize: 32,
    fontWeight: "700",
  },
  successHeading: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  successBody: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  referenceBox: {
    width: "100%",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    gap: 4,
  },
  referenceLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  referenceId: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  infoCard: {
    width: "100%",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  infoText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
