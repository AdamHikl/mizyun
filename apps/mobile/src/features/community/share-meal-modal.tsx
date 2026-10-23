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
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  SectionHeader,
} from "@/components/ui";
import { NativeDatePicker } from "@/components/ui/native-date-time-picker";
import {
  fromDateInputValue,
  toDateInputValue,
  todayLocalDate,
} from "@/components/ui/native-date-time-values";
import { PageGutter, Spacing } from "@/constants/theme";
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
  // The preview is the owner's own meal, so it has no display deadline
  // (Adam, 2026-10-23). It still retires on background, account or token
  // change, and the server rechecks Community access when publishing.
  const previewAuthority = useRef<{
    principal: string | null;
    token: string | null;
  } | null>(null);
  const preview =
    previewState?.mealId === mealId &&
    (!existingActivityId ||
      previewState.existingActivity?.id === existingActivityId) &&
    previewAuthority.current?.principal === principalKey &&
    previewAuthority.current.token === accessToken &&
    foreground.current
      ? previewState
      : null;
  const [includeNutrition, setIncludeNutrition] = useState(false);

  useEffect(() => {
    let active = true;
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
      const revision = selectionRevision.current;
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
      previewAuthority.current === null ||
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
      previewAuthority.current === null
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
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.headerRow}>
              <ThemedText type="subtitle" accessibilityRole="header">
                Share meal
              </ThemedText>
              <IconButton
                icon="close"
                onPress={onDismiss}
                accessibilityLabel="Close"
              />
            </View>

            {!principalKey ? (
              <Notice tone="warning" message="Sign in to share a meal." />
            ) : !foreground.current ||
              loading ||
              profileStatus === "loading" ||
              profileStatus === "idle" ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <ThemedText themeColor="textSecondary">
                  Preparing meal preview...
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
                  message="Join Community to share meals with your approved followers."
                />
                <Button
                  block
                  variant="plain"
                  label="Close"
                  onPress={onDismiss}
                />
              </View>
            ) : error || !preview ? (
              <View style={styles.stack}>
                <Notice
                  tone="danger"
                  message={error ?? "Reload the meal preview to continue."}
                />
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
                    label="Reload meal preview"
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

                  {sharedDetails ? (
                    <SharedMealDetails details={sharedDetails} />
                  ) : null}
                  <ThemedText type="small" themeColor="textSecondary">
                    {preview?.sharedDay}
                  </ThemedText>
                </Card>

                <NativeDatePicker
                  label="Selected calendar day"
                  value={
                    fromDateInputValue(preview?.sharedDay ?? "") ??
                    todayLocalDate()
                  }
                  disabled={submitting}
                  onChange={(day) => {
                    if (!selectionIsCurrent() || inFlight.current || !preview)
                      return;
                    const sharedDay = toDateInputValue(day);
                    publicationOperation.current = null;
                    setPreview((current) =>
                      current ? { ...current, sharedDay } : current,
                    );
                  }}
                />

                <ListGroup>
                  <ListRow
                    title="Include calories and macros"
                    chevron={false}
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
                    trailing={
                      <Icon
                        name={includeNutrition ? "checkCircle" : "circle"}
                        size={22}
                        color={includeNutrition ? "primary" : "textTertiary"}
                      />
                    }
                  />
                </ListGroup>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Check the meal name before sharing. Names can contain personal
                  information.
                </ThemedText>
                {/* Sharing disclosure */}
                <Notice
                  tone="info"
                  title="Your sharing choices"
                  message="Your meal name and selected day are shared. Calories and macros are shared only when selected above. Photos, notes, AI metadata, and unselected fields stay private. Updating clears encouragement reactions."
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
                          ? "Update shared meal"
                          : "Publish meal"
                    }
                    onPress={handlePublish}
                    loading={submitting}
                    disabled={
                      submitting || !preview || preview.mealId !== mealId
                    }
                  />

                  {effectiveActivityId &&
                    !preview?.existingActivity?.revokedAt && (
                      <Button
                        block
                        variant="destructive"
                        label="Unpublish meal"
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
