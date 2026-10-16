import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
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
import { PageGutter, Spacing } from "@/constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
import type {
  AuthorSharedActivityDto,
  BoulderingSharePreviewDto,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import {
  fetchBoulderingSharePreview,
  unpublishActivity,
} from "./community-client";
import { InitialsAvatar } from "./initials-avatar";
import { useCommunityProfile } from "./use-community-profile";
import {
  humanizeBoulderingShareError,
  retiresBoulderingPreview,
  saveBoulderingShare,
  selectedBoulderingProjection,
} from "./share-bouldering-actions";
import {
  SharedBoulderingDetails,
  boulderingCardTitle,
} from "./shared-bouldering-details";
import { scopeCommunityClient } from "./scoped-client";
import { useAuth } from "@/features/auth/auth-context";
import {
  COMMUNITY_READ_LIFETIME_MS,
  getCommunityReadEpoch,
} from "./state/read-cache";
import { formatSharedDay } from "./feed/formatters";

const RELOAD_MESSAGE =
  "Reload the session preview to check your current Community access.";

export interface ShareBoulderingModalProps {
  readonly visible: boolean;
  /** The finished bouldering session (a `workouts` row id). */
  readonly sessionId: string;
  readonly onDismiss: () => void;
  readonly onPublished?: (activity: AuthorSharedActivityDto) => void;
  readonly onRevoked?: () => void;
  readonly existingActivityId?: string | null;
}

/**
 * ADR-0067 share sheet for a finished bouldering session. The card preview is
 * always one of the two exact server projections; nothing is computed here.
 */
export function ShareBoulderingModal({
  visible,
  sessionId,
  onDismiss,
  onPublished,
  onRevoked,
  existingActivityId,
}: ShareBoulderingModalProps) {
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
    sessionId,
    visible,
    existingActivityId,
  });
  currentSelection.current = {
    principalKey,
    accessToken,
    sessionId,
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
          currentSelection.current.sessionId === sessionId &&
          currentSelection.current.visible === visible &&
          visible &&
          currentSelection.current.existingActivityId === existingActivityId,
      ),
    [principalKey, accessToken, sessionId, visible, existingActivityId],
  );
  const selectionRevision = useRef(0);
  /**
   * One operation id per deliberate choice: kept across lost-response retries
   * so the server replays, replaced when the choice or preview changes.
   */
  const publicationOperation = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<"publish" | "revoke">(
    "publish",
  );
  const [previewState, setPreview] = useState<BoulderingSharePreviewDto | null>(
    null,
  );
  const previewAuthority = useRef<{
    principal: string | null;
    token: string | null;
    epoch: number;
    expiresAt: number;
  } | null>(null);
  const preview =
    previewState?.sessionId === sessionId &&
    (!existingActivityId ||
      previewState.existingActivity?.id === existingActivityId) &&
    previewAuthority.current?.principal === principalKey &&
    previewAuthority.current.token === accessToken &&
    previewAuthority.current.epoch === getCommunityReadEpoch() &&
    Date.now() < previewAuthority.current.expiresAt &&
    foreground.current
      ? previewState
      : null;
  const [includeGradeBreakdown, setIncludeGradeBreakdown] = useState(false);

  useEffect(() => {
    let active = true;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    selectionRevision.current += 1;
    publicationOperation.current = null;
    previewAuthority.current = null;
    setPreview(null);
    setError(null);
    setIncludeGradeBreakdown(false);
    setSubmitting(false);
    inFlight.current = false;
    if (!visible || !sessionId || !principalKey || !foreground.current) return;
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
          setError(RELOAD_MESSAGE);
        },
        Math.max(0, expiresAt - Date.now()),
      );
      const res = await fetchBoulderingSharePreview(scopedClient, sessionId);
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
        setError(RELOAD_MESSAGE);
        return;
      }
      if (!res.ok) {
        setError(
          humanizeBoulderingShareError(
            res.error,
            "Could not load the session preview.",
          ),
        );
      } else if (
        existingActivityId &&
        res.value.existingActivity?.id !== existingActivityId
      ) {
        setError(
          "The shared card changed. Reopen the session before updating it.",
        );
      } else {
        previewAuthority.current = {
          principal: principalKey,
          token: accessToken,
          epoch,
          expiresAt,
        };
        const existing = res.value.existingActivity;
        setPreview(res.value);
        // A live card keeps its current choice; a new or revoked one starts off.
        setIncludeGradeBreakdown(
          Boolean(
            existing &&
            !existing.revokedAt &&
            existing.boulderingDetails?.gradeBreakdown,
          ),
        );
      }
    };
    void load().catch(() => {
      if (active) {
        setLoading(false);
        setError("Unable to load the session preview.");
      }
    });
    return () => {
      active = false;
      if (expiryTimer !== null) clearTimeout(expiryTimer);
      selectionRevision.current += 1;
    };
  }, [
    visible,
    sessionId,
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
      selection.sessionId === sessionId &&
      selection.existingActivityId === existingActivityId
    );
  };

  const previewIsFresh = () =>
    previewAuthority.current?.epoch === getCommunityReadEpoch() &&
    Date.now() < (previewAuthority.current?.expiresAt ?? 0);

  const effectiveActivityId =
    preview?.existingActivity?.id ?? existingActivityId;
  const liveCard = Boolean(
    effectiveActivityId && !preview?.existingActivity?.revokedAt,
  );

  const handlePublish = async () => {
    if (
      !preview ||
      !previewIsFresh() ||
      preview.sessionId !== sessionId ||
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
    publicationOperation.current ??= randomUUID();
    const res = await saveBoulderingShare(scopedClient, {
      sessionId,
      preview,
      includeGradeBreakdown,
      existingActivityId: effectiveActivityId,
      operationId: publicationOperation.current,
      enrollmentGeneration: preview.enrollmentGeneration,
    });
    if (!selectionIsCurrent() || revision !== selectionRevision.current) return;
    setSubmitting(false);
    inFlight.current = false;
    if (res.ok) {
      onPublished?.(res.value);
      onDismiss();
      return;
    }
    if (retiresBoulderingPreview(res.error)) {
      setPreview(null);
      publicationOperation.current = null;
    }
    setError(
      humanizeBoulderingShareError(res.error, "Failed to share the session."),
    );
  };

  const handleUnpublish = async () => {
    if (
      !preview ||
      !effectiveActivityId ||
      submitting ||
      inFlight.current ||
      !selectionIsCurrent() ||
      !previewIsFresh()
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
      preview.existingActivity?.version,
    );
    if (!selectionIsCurrent() || revision !== selectionRevision.current) return;
    setSubmitting(false);
    inFlight.current = false;
    if (res.ok) {
      onRevoked?.();
      onDismiss();
      return;
    }
    if (retiresBoulderingPreview(res.error)) {
      setPreview(null);
      publicationOperation.current = null;
    }
    setError(
      humanizeBoulderingShareError(
        res.error,
        "Failed to unpublish the session.",
      ),
    );
  };

  if (!visible) return null;

  const details = preview
    ? selectedBoulderingProjection(preview, includeGradeBreakdown)
    : null;
  const breakdownAvailable =
    (preview?.boulderingDetailsWithBreakdown.gradeBreakdown?.length ?? 0) > 0;

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
        <ScrollView style={styles.card} contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <ThemedText type="subtitle" accessibilityRole="header">
              Share session
            </ThemedText>
            <IconButton
              icon="close"
              onPress={onDismiss}
              accessibilityLabel="Close"
            />
          </View>

          {!principalKey ? (
            <Notice tone="warning" message="Sign in to share a session." />
          ) : !foreground.current ||
            loading ||
            profileStatus === "loading" ||
            profileStatus === "idle" ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <ThemedText themeColor="textSecondary">
                Preparing session preview...
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
                message="Join Community to share sessions with your approved followers."
              />
              <Button block variant="plain" label="Close" onPress={onDismiss} />
            </View>
          ) : error || !preview || !details ? (
            <View style={styles.stack}>
              <Notice tone="danger" message={error ?? RELOAD_MESSAGE} />
              {preview ? (
                <Button
                  block
                  label={
                    failedAction === "revoke"
                      ? "Retry unpublishing"
                      : "Retry sharing"
                  }
                  onPress={
                    failedAction === "revoke" ? handleUnpublish : handlePublish
                  }
                  disabled={submitting}
                />
              ) : (
                <Button
                  block
                  label="Reload session preview"
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
              <SectionHeader title="Preview for your approved followers" />

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
                <ThemedText type="headline" style={styles.cardTitle}>
                  {boulderingCardTitle(details)}
                </ThemedText>
                <View style={styles.metaRow}>
                  <Icon name="calendar" size={13} color="textSecondary" />
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {formatSharedDay(preview.sharedDay)}
                  </ThemedText>
                </View>
                <SharedBoulderingDetails details={details} />
              </Card>

              {breakdownAvailable ? (
                <ListGroup>
                  <ListRow
                    title="Include grade breakdown"
                    subtitle="Sends per grade, shown in the preview above"
                    chevron={false}
                    disabled={submitting}
                    onPress={() => {
                      if (!selectionIsCurrent() || inFlight.current) return;
                      publicationOperation.current = null;
                      setIncludeGradeBreakdown((value) => !value);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityLabel="Include grade breakdown"
                    accessibilityState={{
                      checked: includeGradeBreakdown,
                      disabled: submitting,
                    }}
                    trailing={
                      <Icon
                        name={includeGradeBreakdown ? "checkCircle" : "circle"}
                        size={22}
                        color={
                          includeGradeBreakdown ? "primary" : "textTertiary"
                        }
                      />
                    }
                  />
                </ListGroup>
              ) : null}

              <Notice
                tone="info"
                title="Your sharing choices"
                message="Shared: the session day, top grade, number of sends and flashes, and sends per grade only when selected above. Not shared: gym name, notes, photos, hold colours, attempts and times. Editing or deleting this session later removes the card. Updating clears encouragement reactions."
              />

              <ThemedText type="footnote" themeColor="textSecondary">
                Audience: current and future approved followers.{" "}
                {preview.followerCount} currently approved. Already viewed or
                copied content cannot be recalled.
              </ThemedText>

              <View style={styles.btnCol}>
                <Button
                  block
                  icon="share"
                  label={
                    preview.existingActivity?.revokedAt
                      ? "Share again"
                      : effectiveActivityId
                        ? "Update shared session"
                        : "Publish session"
                  }
                  onPress={handlePublish}
                  loading={submitting}
                  disabled={submitting || preview.sessionId !== sessionId}
                />
                {liveCard ? (
                  <Button
                    block
                    variant="destructive"
                    label="Unpublish session"
                    onPress={() =>
                      Alert.alert(
                        "Unpublish this card?",
                        "Friends lose access immediately. Copies they already made cannot be recalled. Your private session stays intact.",
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
                ) : null}
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
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
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
    cardTitle: { marginTop: Spacing.two },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.one,
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
