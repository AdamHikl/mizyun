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
  FormField,
  FormTextInput,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  SectionHeader,
} from "@/components/ui";
import { PageGutter, Spacing } from "@/constants/theme";
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

const CATEGORY_LABELS: Record<WorkoutCategory, { label: string }> = {
  strength: { label: "Strength Workout" },
  running: { label: "Running Workout" },
  cycling: { label: "Cycling Workout" },
  hiit: { label: "HIIT Workout" },
  mobility: { label: "Mobility & Stretch" },
  walking: { label: "Walk Workout" },
  other: { label: "Completed Workout" },
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
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.headerRow}>
              <ThemedText type="subtitle" accessibilityRole="header">
                Share workout
              </ThemedText>
              <IconButton
                icon="close"
                onPress={onDismiss}
                accessibilityLabel="Close"
              />
            </View>

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
              <View style={styles.stack}>
                <ThemedText themeColor="textSecondary">
                  Choose what to include
                </ThemedText>
                <SectionHeader title="Preview for your approved followers" />

                {/* Shared Card Preview Box */}
                <Card>
                  <View style={styles.authorRow}>
                    <InitialsAvatar
                      symbol={profile?.avatarSymbol ?? "ME"}
                      seed={profile?.displayName ?? "You"}
                      accessibilityLabel={profile?.displayName ?? "You"}
                      size={38}
                    />
                    <View style={styles.authorTextCol}>
                      <ThemedText type="smallBold">
                        {profile?.displayName ?? "You"}
                      </ThemedText>
                      <ThemedText type="footnote" themeColor="textSecondary">
                        @{profile?.handle ?? "handle"}
                      </ThemedText>
                    </View>
                  </View>

                  <ThemedText type="headline">{categoryMeta.label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {includeDuration && durationMin !== null
                      ? `${durationMin} min · ${preview?.sharedDay}`
                      : preview?.sharedDay}
                  </ThemedText>
                </Card>

                <FormField label="Selected calendar day">
                  <FormTextInput
                    value={preview?.sharedDay ?? ""}
                    accessibilityLabel="Shared calendar day YYYY-MM-DD"
                    placeholder="YYYY-MM-DD"
                    editable={!submitting}
                    onChangeText={(sharedDay) => {
                      publicationOperation.current = null;
                      setPreview((current) =>
                        current ? { ...current, sharedDay } : current,
                      );
                    }}
                  />
                </FormField>
                <FormField label="Generic workout category">
                  <View style={styles.chips}>
                    {(Object.keys(CATEGORY_LABELS) as WorkoutCategory[]).map(
                      (category) => {
                        const selectedCategory = preview?.category === category;
                        return (
                          <Chip
                            key={category}
                            label={CATEGORY_LABELS[category].label}
                            icon={selectedCategory ? "check" : undefined}
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
                </FormField>

                {durationMin !== null || preview?.workoutDetails ? (
                  <ListGroup>
                    {/* Duration toggle checkbox */}
                    {durationMin !== null && (
                      <ListRow
                        title={`Include duration (${durationMin} min)`}
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
                            size={22}
                            color={includeDuration ? "primary" : "textTertiary"}
                          />
                        }
                      />
                    )}
                    {preview?.workoutDetails ? (
                      <ListRow
                        title="Include exercises, sets, reps and weights"
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
                            size={22}
                            color={
                              includeWorkoutDetails ? "primary" : "textTertiary"
                            }
                          />
                        }
                      />
                    ) : null}
                  </ListGroup>
                ) : null}
                {includeWorkoutDetails && preview?.workoutDetails ? (
                  <Card>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      These workout details will be shared
                    </ThemedText>
                    <SharedWorkoutDetails details={preview.workoutDetails} />
                  </Card>
                ) : null}

                {preview?.workoutDetails ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Check every exercise name before sharing. Custom names can
                    contain personal information.
                  </ThemedText>
                ) : preview?.existingActivity?.workoutDetails ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Current workout details are unavailable. Confirming this
                    update removes the previously shared exercise and set
                    details.
                  </ThemedText>
                ) : null}
                {/* Sharing disclosure */}
                <Notice
                  tone="info"
                  title="Your sharing choices"
                  message="Your category and selected day are shared. Duration and workout details are shared only when selected above. Workout titles, notes, health integrations, Coach context and unselected fields stay private. Updating clears encouragement reactions."
                />

                {/* Audience badge */}
                <ThemedText type="footnote" themeColor="textSecondary">
                  Audience: current and future approved followers.{" "}
                  {preview?.followerCount ?? 0} currently approved. Already
                  viewed or copied content cannot be recalled.
                </ThemedText>

                {/* Action buttons */}
                <View style={styles.btnCol}>
                  <Button
                    block
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

                  {effectiveActivityId &&
                    !preview?.existingActivity?.revokedAt && (
                      <Button
                        block
                        variant="destructive"
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

                  <Button
                    block
                    variant="plain"
                    label={effectiveActivityId ? "Cancel" : "Keep private"}
                    onPress={onDismiss}
                    disabled={submitting}
                  />
                </View>
              </View>
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
      flex: 1,
    },
    content: {
      paddingHorizontal: PageGutter,
      paddingTop: Spacing.three,
      paddingBottom: Spacing.five,
      gap: Spacing.three,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    stack: { gap: Spacing.three },
    authorRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    authorTextCol: {
      marginLeft: Spacing.three - 4,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.two,
    },
    btnCol: {
      gap: Spacing.two,
    },
    centerBox: {
      padding: Spacing.five,
      gap: Spacing.three,
      alignItems: "center",
      justifyContent: "center",
    },
  });
