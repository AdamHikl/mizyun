import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  StyleSheet,
  View,
} from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  Chip,
  FormTextInput,
  Icon,
  IconBadge,
  IconButton,
  type IconName,
  ListGroup,
  ListRow,
  Notice,
} from "@/components/ui";
import { PageGutter, Radius, Spacing } from "@/constants/theme";
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
  { label: string; short: string; icon: IconName }
> = {
  strength: { label: "Strength Workout", short: "Strength", icon: "dumbbell" },
  running: { label: "Running Workout", short: "Running", icon: "run" },
  cycling: { label: "Cycling Workout", short: "Cycling", icon: "bike" },
  hiit: { label: "HIIT Workout", short: "HIIT", icon: "energy" },
  mobility: {
    label: "Mobility & Stretch",
    short: "Mobility",
    icon: "mobility",
  },
  walking: { label: "Walk Workout", short: "Walking", icon: "steps" },
  other: { label: "Completed Workout", short: "Other", icon: "checkCircle" },
};

/** "2026-10-01" → "Thu, 1 Oct 2026"; anything else is shown as typed. */
function formatSharedDay(day: string | undefined): string {
  if (!day) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  )
    return day;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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
  // Synchronous guard: two fast taps can both pass before `submitting` renders.
  const inFlight = useRef(false);
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
    inFlight.current = false;
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
      inFlight.current = false;
      setSubmitting(false);
      setError("Reload the sharing preview before publishing.");
      return;
    }
    publicationOperation.current ??= randomUUID();
    let res: Awaited<ReturnType<typeof saveWorkoutShare>>;
    try {
      res = await saveWorkoutShare(scopedClient, {
        workoutId,
        preview,
        includeDuration,
        includeWorkoutDetails,
        existingActivityId: effectiveActivityId,
        operationId: publicationOperation.current,
        enrollmentGeneration,
      });
    } finally {
      inFlight.current = false;
    }
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
    if (
      !effectiveActivityId ||
      submitting ||
      inFlight.current ||
      !selectionIsCurrent()
    )
      return;
    const revision = selectionRevision.current;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);

    setFailedAction("revoke");
    let res: Awaited<ReturnType<typeof unpublishActivity>>;
    try {
      res = await unpublishActivity(
        scopedClient,
        effectiveActivityId,
        preview?.existingActivity?.version,
      );
    } finally {
      inFlight.current = false;
    }
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
  const followerCount = preview?.followerCount ?? 0;
  const showForm =
    Boolean(principalKey) &&
    foreground.current &&
    !loading &&
    profileStatus !== "loading" &&
    profileStatus !== "idle" &&
    !profileError &&
    isEnrolled &&
    !error;
  const detailsNote = preview?.workoutDetails ? (
    <ThemedText
      type="footnote"
      themeColor="textSecondary"
      style={styles.sectionFootnote}
    >
      Check every exercise name before sharing. Custom names can contain
      personal information.
    </ThemedText>
  ) : preview?.existingActivity?.workoutDetails ? (
    <ThemedText
      type="footnote"
      themeColor="textSecondary"
      style={styles.sectionFootnote}
    >
      Current workout details are unavailable. Confirming this update removes
      the previously shared exercise and set details.
    </ThemedText>
  ) : null;
  const isUpdate = Boolean(
    effectiveActivityId && !preview?.existingActivity?.revokedAt,
  );

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
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <ThemedText type="title3" accessibilityRole="header">
                Share workout
              </ThemedText>
              {showForm ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {followerCount === 1
                    ? "Visible to your 1 approved follower"
                    : `Visible to your ${followerCount} approved followers`}
                </ThemedText>
              ) : null}
            </View>
            <IconButton
              icon="close"
              onPress={onDismiss}
              accessibilityLabel="Close"
            />
          </View>

          <ScrollView
            style={styles.card}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {!principalKey ? (
              <Notice tone="warning" message="Sign in to share a workout." />
            ) : !foreground.current ||
              loading ||
              profileStatus === "loading" ||
              profileStatus === "idle" ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <ThemedText themeColor="textSecondary">
                  Preparing workout preview...
                </ThemedText>
              </View>
            ) : profileError ? (
              <View style={styles.stack}>
                <Notice tone="danger" message={profileError} />
                <Button
                  block
                  label="Check Community status"
                  onPress={() => void profileActions.load()}
                />
              </View>
            ) : !isEnrolled ? (
              <View style={styles.stack}>
                <Notice
                  tone="warning"
                  message="Join Community to share workouts with your approved followers."
                />
                <Button
                  block
                  variant="plain"
                  label="Close"
                  onPress={onDismiss}
                />
              </View>
            ) : error ? (
              <View style={styles.stack}>
                <Notice tone="danger" message={error} />
                {preview && (
                  <Button
                    block
                    label={
                      failedAction === "revoke"
                        ? "Retry unpublishing"
                        : "Retry sharing"
                    }
                    onPress={
                      failedAction === "revoke"
                        ? handleUnpublish
                        : handlePublish
                    }
                    disabled={submitting}
                  />
                )}
                {!preview && (
                  <Button
                    block
                    label="Reload workout preview"
                    onPress={() =>
                      setForegroundRevision((revision) => revision + 1)
                    }
                  />
                )}
                <Button
                  block
                  variant="plain"
                  label="Dismiss"
                  onPress={onDismiss}
                />
              </View>
            ) : (
              <View style={styles.sections}>
                {/* Live preview of the card followers will see */}
                <View style={styles.section}>
                  <ThemedText
                    type="caption"
                    themeColor="textSecondary"
                    style={styles.sectionLabel}
                  >
                    PREVIEW
                  </ThemedText>
                  <Card style={styles.previewCard}>
                    <View style={styles.authorRow}>
                      <InitialsAvatar
                        symbol={profile?.avatarSymbol ?? "ME"}
                        seed={profile?.displayName ?? "You"}
                        accessibilityLabel={profile?.displayName ?? "You"}
                        size={36}
                      />
                      <View style={styles.authorTextCol}>
                        <ThemedText type="smallBold" numberOfLines={1}>
                          {profile?.displayName ?? "You"}
                        </ThemedText>
                        <ThemedText
                          type="footnote"
                          themeColor="textSecondary"
                          numberOfLines={1}
                        >
                          @{profile?.handle ?? "handle"}
                        </ThemedText>
                      </View>
                    </View>

                    <View style={styles.previewDivider} />

                    <View style={styles.activityRow}>
                      <IconBadge name={categoryMeta.icon} size={44} />
                      <View style={styles.activityText}>
                        <ThemedText type="headline">
                          {categoryMeta.label}
                        </ThemedText>
                        <View style={styles.metaRow}>
                          {preview?.sharedDay ? (
                            <>
                              <Icon
                                name="calendar"
                                size={13}
                                color="textSecondary"
                              />
                              <ThemedText
                                type="footnote"
                                themeColor="textSecondary"
                              >
                                {formatSharedDay(preview.sharedDay)}
                              </ThemedText>
                            </>
                          ) : null}
                          {includeDuration && durationMin !== null ? (
                            <>
                              <Icon
                                name="timer"
                                size={13}
                                color="textSecondary"
                                style={styles.metaGap}
                              />
                              <ThemedText
                                type="footnote"
                                themeColor="textSecondary"
                              >
                                {`${durationMin} min`}
                              </ThemedText>
                            </>
                          ) : null}
                        </View>
                      </View>
                    </View>

                    {includeWorkoutDetails && preview?.workoutDetails ? (
                      <View style={styles.previewDetails}>
                        <SharedWorkoutDetails
                          details={preview.workoutDetails}
                        />
                      </View>
                    ) : null}
                  </Card>
                </View>

                {/* Optional fields */}
                {durationMin !== null || preview?.workoutDetails ? (
                  <View style={styles.section}>
                    <ThemedText
                      type="caption"
                      themeColor="textSecondary"
                      style={styles.sectionLabel}
                    >
                      ALSO SHARE
                    </ThemedText>
                    <ListGroup>
                      {durationMin !== null && (
                        <ListRow
                          title="Duration"
                          subtitle={`${durationMin} min`}
                          icon="timer"
                          iconTone="neutral"
                          chevron={false}
                          disabled={submitting}
                          onPress={() => {
                            publicationOperation.current = null;
                            setIncludeDuration((prev) => !prev);
                          }}
                          accessibilityRole="checkbox"
                          accessibilityLabel={`Include duration (${durationMin} min)`}
                          accessibilityState={{ checked: includeDuration }}
                          trailing={
                            <Icon
                              name={includeDuration ? "checkCircle" : "circle"}
                              size={24}
                              color={
                                includeDuration ? "primary" : "textTertiary"
                              }
                            />
                          }
                        />
                      )}
                      {preview?.workoutDetails ? (
                        <ListRow
                          title="Exercises, sets, reps and weights"
                          subtitle="Shown in the preview above"
                          icon="dumbbell"
                          iconTone="neutral"
                          chevron={false}
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
                          trailing={
                            <Icon
                              name={
                                includeWorkoutDetails ? "checkCircle" : "circle"
                              }
                              size={24}
                              color={
                                includeWorkoutDetails
                                  ? "primary"
                                  : "textTertiary"
                              }
                            />
                          }
                        />
                      ) : null}
                    </ListGroup>
                    {detailsNote}
                  </View>
                ) : (
                  detailsNote
                )}

                {/* Category */}
                <View style={styles.section}>
                  <ThemedText
                    type="caption"
                    themeColor="textSecondary"
                    style={styles.sectionLabel}
                  >
                    CATEGORY
                  </ThemedText>
                  <View style={styles.chips} accessibilityRole="radiogroup">
                    {(Object.keys(CATEGORY_LABELS) as WorkoutCategory[]).map(
                      (category) => {
                        const selectedCategory = preview?.category === category;
                        return (
                          <Chip
                            key={category}
                            label={CATEGORY_LABELS[category].short}
                            icon={CATEGORY_LABELS[category].icon}
                            selected={selectedCategory}
                            disabled={submitting}
                            accessibilityRole="radio"
                            accessibilityState={{
                              selected: selectedCategory,
                              disabled: submitting,
                            }}
                            onPress={() => {
                              publicationOperation.current = null;
                              setPreview((current) =>
                                current ? { ...current, category } : current,
                              );
                            }}
                          />
                        );
                      },
                    )}
                  </View>
                </View>

                {/* Day */}
                <View style={styles.section}>
                  <ThemedText
                    type="caption"
                    themeColor="textSecondary"
                    style={styles.sectionLabel}
                  >
                    DAY
                  </ThemedText>
                  <FormTextInput
                    value={preview?.sharedDay ?? ""}
                    accessibilityLabel="Shared calendar day YYYY-MM-DD"
                    placeholder="YYYY-MM-DD"
                    keyboardType="numbers-and-punctuation"
                    autoCorrect={false}
                    editable={!submitting}
                    onChangeText={(sharedDay) => {
                      publicationOperation.current = null;
                      setPreview((current) =>
                        current ? { ...current, sharedDay } : current,
                      );
                    }}
                  />
                </View>

                {/* Sharing disclosure */}
                <View style={styles.privacyBox}>
                  <View style={styles.privacyTitle}>
                    <Icon name="privacy" size={16} color="textSecondary" />
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      Your sharing choices
                    </ThemedText>
                  </View>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Your category and selected day are shared. Duration and
                    workout details are shared only when selected above. Workout
                    titles, notes, health integrations, Coach context and
                    unselected fields stay private.
                  </ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Audience: current and future approved followers.{" "}
                    {followerCount} currently approved. Already viewed or copied
                    content cannot be recalled. Updating clears encouragement
                    reactions.
                  </ThemedText>
                </View>

                {isUpdate && (
                  <Button
                    block
                    variant="destructive"
                    icon="trash"
                    label="Unpublish workout"
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
                  />
                )}
              </View>
            )}
          </ScrollView>

          {/* Pinned actions */}
          {showForm ? (
            <View style={styles.footer}>
              <Button
                block
                icon="share"
                label={
                  preview?.existingActivity?.revokedAt
                    ? "Share again"
                    : effectiveActivityId
                      ? "Update shared workout"
                      : "Publish workout"
                }
                onPress={handlePublish}
                loading={submitting}
                disabled={
                  submitting || !preview || preview.workoutId !== workoutId
                }
              />
              <Button
                block
                variant="plain"
                label={effectiveActivityId ? "Cancel" : "Keep private"}
                onPress={onDismiss}
                disabled={submitting}
              />
            </View>
          ) : null}
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
    },
    card: {
      backgroundColor: colors.background,
      flex: 1,
    },
    content: {
      paddingHorizontal: PageGutter,
      paddingTop: Spacing.two,
      paddingBottom: Spacing.four,
      gap: Spacing.three,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: Spacing.two,
      paddingHorizontal: PageGutter,
      paddingTop: Spacing.three,
      paddingBottom: Spacing.two,
    },
    headerText: { flex: 1, gap: 2 },
    stack: { gap: Spacing.three },
    sections: { gap: Spacing.four },
    section: { gap: Spacing.two },
    sectionLabel: {
      paddingHorizontal: Spacing.three,
      letterSpacing: 0.5,
    },
    sectionFootnote: { paddingHorizontal: Spacing.three },
    previewCard: {
      gap: Spacing.three,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    authorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.two + 2,
    },
    authorTextCol: { flex: 1 },
    previewDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
    },
    activityRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.three - 4,
    },
    activityText: { flex: 1, gap: 2 },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: Spacing.one,
    },
    metaGap: { marginLeft: Spacing.two },
    previewDetails: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
      paddingTop: Spacing.three,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.two,
    },
    privacyBox: {
      gap: Spacing.two,
      padding: Spacing.three,
      borderRadius: Radius.lg,
      borderCurve: "continuous",
      backgroundColor: colors.backgroundSelected,
    },
    privacyTitle: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.one + 2,
    },
    footer: {
      gap: Spacing.one,
      paddingHorizontal: PageGutter,
      paddingTop: Spacing.three,
      paddingBottom: Spacing.two,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
      backgroundColor: colors.backgroundElement,
    },
    centerBox: {
      padding: Spacing.five,
      gap: Spacing.three,
      alignItems: "center",
      justifyContent: "center",
    },
  });
