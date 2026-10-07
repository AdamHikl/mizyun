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
import { SharedWorkoutDetails } from "./shared-workout-details";
import { randomUUID } from "expo-crypto";
import type {
  AuthorSharedActivityDto,
  WorkoutCategory,
  WorkoutSharePreviewDto,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import {
  fetchWorkoutSharePreview,
  humanizeCommunityError,
  unpublishActivity,
} from "./community-client";
import { InitialsAvatar } from "./initials-avatar";
import { useCommunityProfile } from "./use-community-profile";
import { saveWorkoutShare } from "./share-workout-actions";
import { scopeCommunityClient } from "./scoped-client";
import { useAuth } from "@/features/auth/auth-context";

export interface ShareWorkoutModalProps {
  readonly visible: boolean;
  readonly workoutId: string;
  readonly onDismiss: () => void;
  readonly onPublished?: (activity: AuthorSharedActivityDto) => void;
  readonly onRevoked?: () => void;
  readonly existingActivityId?: string | null;
}

const CATEGORY_LABELS: Record<
  WorkoutCategory,
  { label: string; icon: string }
> = {
  strength: { label: "Strength Workout", icon: "🏋️" },
  running: { label: "Running Workout", icon: "🏃" },
  cycling: { label: "Cycling Workout", icon: "🚴" },
  hiit: { label: "HIIT Workout", icon: "⚡" },
  mobility: { label: "Mobility & Stretch", icon: "🧘" },
  walking: { label: "Walk Workout", icon: "🚶" },
  other: { label: "Completed Workout", icon: "💪" },
};

export function ShareWorkoutModal({
  visible,
  workoutId,
  onDismiss,
  onPublished,
  onRevoked,
  existingActivityId,
}: ShareWorkoutModalProps) {
  const colors = useTheme();
  const styles = createStyles(colors);
  const { session, profile: accountProfile } = useAuth();
  const principalKey = session?.user.id ?? null;
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
    workoutId,
    visible,
    existingActivityId,
  });
  currentSelection.current = {
    principalKey,
    workoutId,
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
          currentSelection.current.principalKey === principalKey,
      ),
    [principalKey],
  );
  const selectionRevision = useRef(0);
  const publicationOperation = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<"publish" | "revoke">(
    "publish",
  );
  const [preview, setPreview] = useState<WorkoutSharePreviewDto | null>(null);
  const [includeDuration, setIncludeDuration] = useState(false);
  const [includeWorkoutDetails, setIncludeWorkoutDetails] = useState(false);

  useEffect(() => {
    let active = true;
    selectionRevision.current += 1;
    publicationOperation.current = null;
    setPreview(null);
    setError(null);
    setIncludeDuration(false);
    setIncludeWorkoutDetails(false);
    setSubmitting(false);
    if (!visible || !workoutId || !principalKey || !foreground.current) return;
    setLoading(true);
    const load = async () => {
      const res = await fetchWorkoutSharePreview(
        scopedClient,
        workoutId,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      if (!active) return;
      setLoading(false);
      if (!res.ok) {
        setError(
          humanizeCommunityError(res.error, "Could not load workout preview."),
        );
      } else if (
        existingActivityId &&
        res.value.existingActivity?.id !== existingActivityId
      ) {
        setError(
          "The shared card changed. Reopen the workout before updating it.",
        );
      } else {
        const existing = res.value.existingActivity;
        setPreview(
          existing
            ? {
                ...res.value,
                category: existing.category,
                sharedDay: existing.sharedDay,
              }
            : res.value,
        );
        setIncludeWorkoutDetails(
          Boolean(
            res.value.workoutDetails &&
            existing &&
            !existing.revokedAt &&
            existing.workoutDetails,
          ),
        );
        setIncludeDuration(
          existing && !existing.revokedAt
            ? existing.durationSeconds !== null
            : false,
        );
      }
    };
    void load().catch(() => {
      if (active) {
        setLoading(false);
        setError("Unable to load workout preview.");
      }
    });
    return () => {
      active = false;
      selectionRevision.current += 1;
    };
  }, [
    visible,
    workoutId,
    existingActivityId,
    principalKey,
    scopedClient,
    foregroundRevision,
  ]);

  const selectionIsCurrent = () => {
    const selection = currentSelection.current;
    return (
      foreground.current &&
      selection.visible &&
      selection.principalKey === principalKey &&
      selection.workoutId === workoutId &&
      selection.existingActivityId === existingActivityId
    );
  };

  const effectiveActivityId =
    preview?.existingActivity?.id ?? existingActivityId;

  const handlePublish = async () => {
    if (
      !preview ||
      preview.workoutId !== workoutId ||
      submitting ||
      !isEnrolled ||
      !selectionIsCurrent()
    )
      return;
    const revision = selectionRevision.current;
    setSubmitting(true);
    setError(null);

    setFailedAction("publish");
    const enrollmentGeneration = preview.enrollmentGeneration;
    if (!enrollmentGeneration) {
      setSubmitting(false);
      setError("Reload the sharing preview before publishing.");
      return;
    }
    publicationOperation.current ??= randomUUID();
    const res = await saveWorkoutShare(scopedClient, {
      workoutId,
      preview,
      includeDuration,
      includeWorkoutDetails,
      existingActivityId: effectiveActivityId,
      operationId: publicationOperation.current,
      enrollmentGeneration,
    });
    if (!selectionIsCurrent() || revision !== selectionRevision.current) return;

    setSubmitting(false);

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
      setError(humanizeCommunityError(res.error, "Failed to share workout."));
    }
  };

  const handleUnpublish = async () => {
    if (!effectiveActivityId || submitting || !selectionIsCurrent()) return;
    const revision = selectionRevision.current;
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
      setError(
        humanizeCommunityError(res.error, "Failed to unpublish workout."),
      );
    }
  };

  if (!visible) return null;

  const durationMin =
    preview?.durationSeconds !== null && preview?.durationSeconds !== undefined
      ? Math.round(preview.durationSeconds / 60)
      : null;

  const categoryMeta =
    CATEGORY_LABELS[preview?.category ?? "strength"] ??
    CATEGORY_LABELS.strength;

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
              <Text style={styles.title}>Share workout</Text>
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
                  Sign in to share a workout.
                </Text>
              </View>
            ) : !foreground.current ||
              loading ||
              profileStatus === "loading" ||
              profileStatus === "idle" ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>
                  Preparing workout preview...
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
                  Join Community to share workouts with your approved followers.
                </Text>
                <Pressable
                  style={styles.keepPrivateBtn}
                  onPress={onDismiss}
                  accessibilityRole="button"
                >
                  <Text style={styles.keepPrivateText}>Close</Text>
                </Pressable>
              </View>
            ) : error ? (
              <View style={styles.centerBox}>
                <Text style={styles.errorText}>{error}</Text>
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
                      Reload workout preview
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

                  <View style={styles.activityDetails}>
                    <Text style={styles.categoryText}>
                      {categoryMeta.label}
                    </Text>
                    <Text style={styles.metaText}>
                      {includeDuration && durationMin !== null
                        ? `⏱️ ${durationMin} min · ${preview?.sharedDay}`
                        : preview?.sharedDay}
                    </Text>
                  </View>
                </View>

                <Text style={styles.checkboxLabel}>Selected calendar day</Text>
                <TextInput
                  value={preview?.sharedDay ?? ""}
                  accessibilityLabel="Shared calendar day YYYY-MM-DD"
                  style={styles.metaText}
                  placeholder="YYYY-MM-DD"
                  editable={!submitting}
                  onChangeText={(sharedDay) => {
                    publicationOperation.current = null;
                    setPreview((current) =>
                      current ? { ...current, sharedDay } : current,
                    );
                  }}
                />
                <Text style={styles.checkboxLabel}>
                  Generic workout category
                </Text>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {(Object.keys(CATEGORY_LABELS) as WorkoutCategory[]).map(
                    (category) => (
                      <Pressable
                        key={category}
                        disabled={submitting}
                        accessibilityRole="radio"
                        style={{
                          minHeight: 48,
                          justifyContent: "center",
                          paddingHorizontal: 8,
                        }}
                        accessibilityState={{
                          selected: preview?.category === category,
                        }}
                        onPress={() => {
                          publicationOperation.current = null;
                          setPreview((current) =>
                            current ? { ...current, category } : current,
                          );
                        }}
                      >
                        <Text style={styles.metaText}>
                          {preview?.category === category ? "● " : "○ "}
                          {CATEGORY_LABELS[category].label}
                        </Text>
                      </Pressable>
                    ),
                  )}
                </View>
                {/* Duration toggle checkbox */}
                {durationMin !== null && (
                  <Pressable
                    style={styles.checkboxRow}
                    disabled={submitting}
                    onPress={() => {
                      publicationOperation.current = null;
                      setIncludeDuration((prev) => !prev);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: includeDuration }}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        includeDuration && styles.checkboxActive,
                      ]}
                    >
                      {includeDuration && (
                        <Text style={styles.checkmark}>✓</Text>
                      )}
                    </View>
                    <Text style={styles.checkboxLabel}>
                      Include duration ({durationMin} min)
                    </Text>
                  </Pressable>
                )}

                {preview?.workoutDetails ? (
                  <Pressable
                    style={styles.checkboxRow}
                    disabled={submitting}
                    onPress={() => {
                      publicationOperation.current = null;
                      setIncludeWorkoutDetails((value) => !value);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityLabel="Include exercises, sets, reps and weights"
                    accessibilityState={{
                      checked: includeWorkoutDetails,
                      disabled: submitting,
                    }}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        includeWorkoutDetails && styles.checkboxActive,
                      ]}
                    >
                      {includeWorkoutDetails && (
                        <Text style={styles.checkmark}>✓</Text>
                      )}
                    </View>
                    <Text style={[styles.checkboxLabel, { flex: 1 }]}>
                      Include exercises, sets, reps and weights
                    </Text>
                  </Pressable>
                ) : null}
                {includeWorkoutDetails && preview?.workoutDetails ? (
                  <View style={styles.previewBox}>
                    <Text style={styles.previewHeading}>
                      These workout details will be shared
                    </Text>
                    <SharedWorkoutDetails details={preview.workoutDetails} />
                  </View>
                ) : null}

                {preview?.workoutDetails ? (
                  <Text style={styles.privacyBody}>
                    Check every exercise name before sharing. Custom names can
                    contain personal information.
                  </Text>
                ) : preview?.existingActivity?.workoutDetails ? (
                  <Text style={styles.privacyBody}>
                    Current workout details are unavailable. Confirming this
                    update removes the previously shared exercise and set
                    details.
                  </Text>
                ) : null}
                {/* Sharing disclosure */}
                <View style={styles.privacyNoticeBox}>
                  <Text style={styles.privacyHeading}>
                    Your sharing choices
                  </Text>
                  <Text style={styles.privacyBody}>
                    Your category and selected day are shared. Duration and
                    workout details are shared only when selected above. Workout
                    titles, notes, health integrations, Coach context and
                    unselected fields stay private. Updating clears
                    encouragement reactions.
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
                      submitting || !preview || preview.workoutId !== workoutId
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
                            ? "Update shared workout"
                            : "Publish workout"}
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
                            "Friends lose access immediately. Copies they already made cannot be recalled. Your private workout stays intact.",
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
                          Unpublish workout
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
