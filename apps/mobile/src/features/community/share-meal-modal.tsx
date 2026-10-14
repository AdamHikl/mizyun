import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { SharedMealDetails } from "./shared-meal-details";
import { randomUUID } from "expo-crypto";
import type {
  AuthorSharedActivityDto,
  MealSharePreviewDto,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import {
  fetchMealSharePreview,
  humanizeCommunityError,
  unpublishActivity,
} from "./community-client";
import { InitialsAvatar } from "./initials-avatar";
import { useCommunityProfile } from "./use-community-profile";
import { saveMealShare } from "./share-meal-actions";
import { scopeCommunityClient } from "./scoped-client";
import { useAuth } from "@/features/auth/auth-context";
import {
  COMMUNITY_READ_LIFETIME_MS,
  getCommunityReadEpoch,
} from "./state/read-cache";

export interface ShareMealModalProps {
  readonly visible: boolean;
  readonly mealId: string;
  readonly onDismiss: () => void;
  readonly onPublished?: (activity: AuthorSharedActivityDto) => void;
  readonly onRevoked?: () => void;
  readonly existingActivityId?: string | null;
}

export function ShareMealModal({
  visible,
  mealId,
  onDismiss,
  onPublished,
  onRevoked,
  existingActivityId,
}: ShareMealModalProps) {
  const colors = useTheme();
  const styles = createStyles(colors);
  const { session, profile: accountProfile } = useAuth();
  const principalKey = session?.user.id ?? null;
  const accessToken = session?.accessToken ?? null;
  const {
    profile,
    isEnrolled,
    status: profileStatus,
    error: profileError,
    actions: profileActions,
  } = useCommunityProfile({
    principalKey,
    birthYear: accountProfile?.birthYear,
  });
  const currentSelection = useRef({
    principalKey,
    accessToken,
    mealId,
    visible,
    existingActivityId,
  });
  currentSelection.current = {
    principalKey,
    accessToken,
    mealId,
    visible,
    existingActivityId,
  };
  const foreground = useRef(AppState.currentState === "active");
  const [foregroundRevision, setForegroundRevision] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (foreground.current === (next === "active")) return;
      foreground.current = next === "active";
      selectionRevision.current += 1;
      setPreview(null);
      publicationOperation.current = null;
      if (next === "active" && currentSelection.current.visible) {
        void profileActions.load();
        setForegroundRevision((revision) => revision + 1);
      }
    });
    return () => subscription.remove();
  }, [profileActions.load]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const scopedClient = useMemo(
    () =>
      scopeCommunityClient(
        apiClient,
        principalKey,
        () =>
          mounted.current &&
          foreground.current &&
          currentSelection.current.principalKey === principalKey &&
          currentSelection.current.accessToken === accessToken &&
          currentSelection.current.mealId === mealId &&
          currentSelection.current.visible === visible &&
          visible &&
          currentSelection.current.existingActivityId === existingActivityId,
      ),
    [principalKey, accessToken, mealId, visible, existingActivityId],
  );
  const selectionRevision = useRef(0);
  const publicationOperation = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<"publish" | "revoke">(
    "publish",
  );
  const [previewState, setPreview] = useState<MealSharePreviewDto | null>(null);
  const previewAuthority = useRef<{
    principal: string | null;
    token: string | null;
    epoch: number;
    expiresAt: number;
  } | null>(null);
  const preview =
    previewState?.mealId === mealId &&
    (!existingActivityId ||
      previewState.existingActivity?.id === existingActivityId) &&
    previewAuthority.current?.principal === principalKey &&
    previewAuthority.current.token === accessToken &&
    previewAuthority.current.epoch === getCommunityReadEpoch() &&
    Date.now() < previewAuthority.current.expiresAt &&
    foreground.current
      ? previewState
      : null;
  const [includeNutrition, setIncludeNutrition] = useState(false);

  useEffect(() => {
    let active = true;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    selectionRevision.current += 1;
    publicationOperation.current = null;
    previewAuthority.current = null;
    setPreview(null);
    setError(null);
    setIncludeNutrition(false);
    setSubmitting(false);
    inFlight.current = false;
    if (!visible || !mealId || !principalKey || !foreground.current) return;
    setLoading(true);
    const load = async () => {
      const expiresAt = Date.now() + COMMUNITY_READ_LIFETIME_MS;
      const epoch = getCommunityReadEpoch();
      const revision = selectionRevision.current;
      expiryTimer = setTimeout(
        () => {
          if (!active) return;
          selectionRevision.current += 1;
          publicationOperation.current = null;
          previewAuthority.current = null;
          setPreview(null);
          setLoading(false);
          setSubmitting(false);
          inFlight.current = false;
          setError(
            "Reload the meal preview to check your current Community access.",
          );
        },
        Math.max(0, expiresAt - Date.now()),
      );
      const res = await fetchMealSharePreview(
        scopedClient,
        mealId,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      if (
        !active ||
        !foreground.current ||
        revision !== selectionRevision.current ||
        currentSelection.current.principalKey !== principalKey ||
        currentSelection.current.accessToken !== accessToken
      )
        return;
      setLoading(false);
      if (Date.now() >= expiresAt || epoch !== getCommunityReadEpoch()) {
        setError(
          "Reload the meal preview to check your current Community access.",
        );
        return;
      }
      if (!res.ok) {
        setError(
          humanizeCommunityError(res.error, "Could not load meal preview."),
        );
      } else if (
        existingActivityId &&
        res.value.existingActivity?.id !== existingActivityId
      ) {
        setError(
          "The shared card changed. Reopen the meal before updating it.",
        );
      } else {
        previewAuthority.current = {
          principal: principalKey,
          token: accessToken,
          epoch,
          expiresAt,
        };
        const existing = res.value.existingActivity;
        setPreview(
          existing
            ? {
                ...res.value,
                sharedDay: existing.sharedDay,
              }
            : res.value,
        );
        setIncludeNutrition(
          Boolean(
            existing &&
            !existing.revokedAt &&
            existing.mealDetails &&
            [
              existing.mealDetails.caloriesKcal,
              existing.mealDetails.proteinG,
              existing.mealDetails.carbsG,
              existing.mealDetails.fatG,
            ].some((value) => value !== null),
          ),
        );
      }
    };
    void load().catch(() => {
      if (active) {
        setLoading(false);
        setError("Unable to load meal preview.");
      }
    });
    return () => {
      active = false;
      if (expiryTimer !== null) clearTimeout(expiryTimer);
      selectionRevision.current += 1;
    };
  }, [
    visible,
    mealId,
    existingActivityId,
    principalKey,
    accessToken,
    scopedClient,
    foregroundRevision,
  ]);

  const selectionIsCurrent = () => {
    const selection = currentSelection.current;
    return (
      mounted.current &&
      foreground.current &&
      selection.visible &&
      selection.principalKey === principalKey &&
      selection.accessToken === accessToken &&
      selection.mealId === mealId &&
      selection.existingActivityId === existingActivityId
    );
  };

  const effectiveActivityId =
    preview?.existingActivity?.id ?? existingActivityId;

  const handlePublish = async () => {
    if (
      !preview ||
      previewAuthority.current?.epoch !== getCommunityReadEpoch() ||
      Date.now() >= (previewAuthority.current?.expiresAt ?? 0) ||
      preview.mealId !== mealId ||
      submitting ||
      inFlight.current ||
      !isEnrolled ||
      !selectionIsCurrent()
    )
      return;
    const revision = selectionRevision.current;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);

    setFailedAction("publish");
    const enrollmentGeneration = preview.enrollmentGeneration;
    if (!enrollmentGeneration) {
      setSubmitting(false);
      inFlight.current = false;
      setError("Reload the sharing preview before publishing.");
      return;
    }
    publicationOperation.current ??= randomUUID();
    const res = await saveMealShare(scopedClient, {
      mealId,
      preview,
      includeNutrition,
      existingActivityId: effectiveActivityId,
      operationId: publicationOperation.current,
      enrollmentGeneration,
    });
    if (!selectionIsCurrent() || revision !== selectionRevision.current) return;

    setSubmitting(false);
    inFlight.current = false;

    if (res.ok) {
      onPublished?.(res.value);
      onDismiss();
    } else {
      if (
        res.error.kind === "no_session" ||
        res.error.kind === "session_expired" ||
        (res.error.kind === "http_error" &&
          [401, 403, 404, 409].includes(res.error.status))
      ) {
        setPreview(null);
        publicationOperation.current = null;
      }
      setError(humanizeCommunityError(res.error, "Failed to share meal."));
    }
  };

  const handleUnpublish = async () => {
    if (
      !preview ||
      !effectiveActivityId ||
      submitting ||
      inFlight.current ||
      !selectionIsCurrent() ||
      previewAuthority.current?.epoch !== getCommunityReadEpoch() ||
      Date.now() >= (previewAuthority.current?.expiresAt ?? 0)
    )
      return;
    const revision = selectionRevision.current;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);

    setFailedAction("revoke");
    const res = await unpublishActivity(
      scopedClient,
      effectiveActivityId,
      preview?.existingActivity?.version,
    );
    if (!selectionIsCurrent() || revision !== selectionRevision.current) return;
    setSubmitting(false);
    inFlight.current = false;

    if (res.ok) {
      onRevoked?.();
      onDismiss();
    } else {
      if (
        res.error.kind === "no_session" ||
        res.error.kind === "session_expired" ||
        (res.error.kind === "http_error" &&
          [401, 403, 404, 409].includes(res.error.status))
      ) {
        setPreview(null);
        publicationOperation.current = null;
      }
      setError(humanizeCommunityError(res.error, "Failed to unpublish meal."));
    }
  };

  if (!visible) return null;

  const sharedDetails = preview
    ? {
        name: preview.mealDetails.name,
        caloriesKcal: includeNutrition
          ? preview.mealDetails.caloriesKcal
          : null,
        proteinG: includeNutrition ? preview.mealDetails.proteinG : null,
        carbsG: includeNutrition ? preview.mealDetails.carbsG : null,
        fatG: includeNutrition ? preview.mealDetails.fatG : null,
      }
    : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.background }}
        edges={["top", "bottom", "left", "right"]}
      >
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            style={styles.card}
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.headerRow}>
              <Text style={styles.title}>Share meal</Text>
              <Pressable
                onPress={onDismiss}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
              >
                <Text style={styles.closeBtn}>✕</Text>
              </Pressable>
            </View>

            {!principalKey ? (
              <View style={styles.centerBox}>
                <Text style={styles.notEnrolledText}>
                  Sign in to share a meal.
                </Text>
              </View>
            ) : !foreground.current ||
              loading ||
              profileStatus === "loading" ||
              profileStatus === "idle" ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>
                  Preparing meal preview...
                </Text>
              </View>
            ) : profileError ? (
              <View style={styles.centerBox}>
                <Text style={styles.errorText}>{profileError}</Text>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => void profileActions.load()}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryBtnText}>
                    Check Community status
                  </Text>
                </Pressable>
              </View>
            ) : !isEnrolled ? (
              <View style={styles.centerBox}>
                <Text style={styles.notEnrolledText}>
                  Join Community to share meals with your approved followers.
                </Text>
                <Pressable
                  style={styles.keepPrivateBtn}
                  onPress={onDismiss}
                  accessibilityRole="button"
                >
                  <Text style={styles.keepPrivateText}>Close</Text>
                </Pressable>
              </View>
            ) : error || !preview ? (
              <View style={styles.centerBox}>
                <Text style={styles.errorText}>
                  {error ??
                    "Reload the meal preview to check your current Community access."}
                </Text>
                {preview && (
                  <Pressable
                    style={styles.primaryBtn}
                    onPress={
                      failedAction === "revoke"
                        ? handleUnpublish
                        : handlePublish
                    }
                    disabled={submitting}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryBtnText}>
                      {failedAction === "revoke"
                        ? "Retry unpublishing"
                        : "Retry sharing"}
                    </Text>
                  </Pressable>
                )}
                {!preview && (
                  <Pressable
                    style={styles.primaryBtn}
                    onPress={() =>
                      setForegroundRevision((revision) => revision + 1)
                    }
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryBtnText}>
                      Reload meal preview
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  style={styles.keepPrivateBtn}
                  onPress={onDismiss}
                  accessibilityRole="button"
                >
                  <Text style={styles.keepPrivateText}>Dismiss</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.subtitle}>Choose what to include</Text>
                <Text style={styles.previewHeading}>
                  Preview for your approved followers
                </Text>

                {/* Shared Card Preview Box */}
                <View style={styles.previewBox}>
                  <View style={styles.authorRow}>
                    <InitialsAvatar
                      symbol={profile?.avatarSymbol ?? "ME"}
                      seed={profile?.displayName ?? "You"}
                      accessibilityLabel={profile?.displayName ?? "You"}
                      size={38}
                    />
                    <View style={styles.authorTextCol}>
                      <Text style={styles.authorName}>
                        {profile?.displayName ?? "You"}
                      </Text>
                      <Text style={styles.authorHandle}>
                        @{profile?.handle ?? "handle"}
                      </Text>
                    </View>
                  </View>

                  {sharedDetails ? (
                    <SharedMealDetails details={sharedDetails} />
                  ) : null}
                  <Text style={styles.metaText}>{preview?.sharedDay}</Text>
                </View>

                <Text style={styles.checkboxLabel}>Selected calendar day</Text>
                <TextInput
                  value={preview?.sharedDay ?? ""}
                  accessibilityLabel="Shared calendar day YYYY-MM-DD"
                  style={styles.metaText}
                  placeholder="YYYY-MM-DD"
                  editable={!submitting}
                  onChangeText={(sharedDay) => {
                    if (!selectionIsCurrent() || inFlight.current || !preview)
                      return;
                    publicationOperation.current = null;
                    setPreview((current) =>
                      current ? { ...current, sharedDay } : current,
                    );
                  }}
                />
                <Pressable
                  style={styles.checkboxRow}
                  disabled={submitting}
                  onPress={() => {
                    if (!selectionIsCurrent() || inFlight.current || !preview)
                      return;
                    publicationOperation.current = null;
                    setIncludeNutrition((value) => !value);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityLabel="Include calories and macros"
                  accessibilityState={{
                    checked: includeNutrition,
                    disabled: submitting,
                  }}
                >
                  <View
                    style={[
                      styles.checkbox,
                      includeNutrition && styles.checkboxActive,
                    ]}
                  >
                    {includeNutrition ? (
                      <Text style={styles.checkmark}>✓</Text>
                    ) : null}
                  </View>
                  <Text style={styles.checkboxLabel}>
                    Include calories and macros
                  </Text>
                </Pressable>
                <Text style={styles.privacyBody}>
                  Check the meal name before sharing. Names can contain personal
                  information.
                </Text>
                {/* Sharing disclosure */}
                <View style={styles.privacyNoticeBox}>
                  <Text style={styles.privacyHeading}>
                    Your sharing choices
                  </Text>
                  <Text style={styles.privacyBody}>
                    Your meal name and selected day are shared. Calories and
                    macros are shared only when selected above. Photos, notes,
                    AI metadata, and unselected fields stay private. Updating
                    clears encouragement reactions.
                  </Text>
                </View>

                {/* Audience badge */}
                <Text style={styles.audienceText}>
                  Audience: current and future approved followers.{" "}
                  {preview?.followerCount ?? 0} currently approved. Already
                  viewed or copied content cannot be recalled.
                </Text>

                {/* Action buttons */}
                <View style={styles.btnCol}>
                  <Pressable
                    style={[
                      styles.primaryBtn,
                      submitting && styles.btnDisabled,
                    ]}
                    onPress={handlePublish}
                    disabled={
                      submitting || !preview || preview.mealId !== mealId
                    }
                    accessibilityRole="button"
                  >
                    {submitting ? (
                      <ActivityIndicator color={colors.text} />
                    ) : (
                      <Text style={styles.primaryBtnText}>
                        {preview?.existingActivity?.revokedAt
                          ? "Share again"
                          : effectiveActivityId
                            ? "Update shared meal"
                            : "Publish meal"}
                      </Text>
                    )}
                  </Pressable>

                  {effectiveActivityId &&
                    !preview?.existingActivity?.revokedAt && (
                      <Pressable
                        style={styles.unpublishBtn}
                        onPress={() =>
                          Alert.alert(
                            "Unpublish this card?",
                            "Friends lose access immediately. Copies they already made cannot be recalled. Your private meal stays intact.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Unpublish",
                                style: "destructive",
                                onPress: () => void handleUnpublish(),
                              },
                            ],
                          )
                        }
                        disabled={submitting}
                        accessibilityRole="button"
                      >
                        <Text style={styles.unpublishBtnText}>
                          Unpublish meal
                        </Text>
                      </Pressable>
                    )}

                  <Pressable
                    style={styles.keepPrivateBtn}
                    onPress={onDismiss}
                    disabled={submitting}
                    accessibilityRole="button"
                  >
                    <Text style={styles.keepPrivateText}>
                      {effectiveActivityId ? "Cancel" : "Keep private"}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: "flex-end",
    },
    card: {
      backgroundColor: colors.background,

      padding: 24,
      flex: 1,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    title: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
    },
    closeBtn: {
      color: colors.textSecondary,
      fontSize: 20,
      padding: 12,
      minWidth: 48,
      minHeight: 48,
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 16,
      fontWeight: "600",
      marginBottom: 16,
    },
    previewHeading: {
      color: colors.textSecondary,
      fontSize: 17,
      fontWeight: "600",
      marginBottom: 8,
    },
    previewBox: {
      backgroundColor: colors.backgroundElement,
      borderRadius: 14,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    authorRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 12,
    },
    authorTextCol: {
      marginLeft: 12,
    },
    authorName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    authorHandle: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    activityDetails: {
      paddingLeft: 4,
    },
    categoryText: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "600",
      marginBottom: 4,
    },
    metaText: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    checkboxRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 16,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.textSecondary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 10,
    },
    checkboxActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    checkmark: {
      color: "#FFFFFF",
      fontSize: 14,
      fontWeight: "700",
    },
    checkboxLabel: {
      color: colors.text,
      fontSize: 15,
    },
    privacyNoticeBox: {
      paddingVertical: 12,
      marginBottom: 14,
    },
    privacyHeading: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: "700",
      marginBottom: 2,
    },
    privacyBody: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    audienceText: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 21,
      marginBottom: 16,
    },
    btnCol: {
      gap: 10,
    },
    primaryBtn: {
      minHeight: 48,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtnText: {
      color: "#FFFFFF",
      fontSize: 16,
      fontWeight: "600",
    },
    unpublishBtn: {
      backgroundColor: "rgba(255,69,58,0.15)",
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
    },
    unpublishBtnText: {
      color: "#FF453A",
      fontSize: 15,
      fontWeight: "600",
    },
    keepPrivateBtn: {
      minHeight: 48,
      paddingVertical: 10,
      alignItems: "center",
    },
    keepPrivateText: {
      color: colors.textSecondary,
      fontSize: 15,
    },
    centerBox: {
      padding: 30,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingText: {
      color: colors.textSecondary,
      fontSize: 14,
      marginTop: 12,
    },
    notEnrolledText: {
      color: "#FF9F0A",
      fontSize: 15,
      lineHeight: 21,
      marginBottom: 16,
    },
    errorText: {
      color: "#FF453A",
      fontSize: 14,
      lineHeight: 21,
      marginBottom: 16,
    },
    btnDisabled: {
      opacity: 0.6,
    },
  });
