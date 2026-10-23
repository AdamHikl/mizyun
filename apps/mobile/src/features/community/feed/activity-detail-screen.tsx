import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import {
  authorSharedActivityDtoSchema,
  type AuthorSharedActivityDto,
  type SharedActivityFeedItemDto,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useTheme } from "@/hooks/use-theme";
import {
  blockUser,
  communityErrorCause,
  isCommunityAccessDenial,
  fetchSharedActivity,
  humanizeCommunityError,
  setUserMuted,
} from "../community-client";
import { scopeCommunityClient } from "../scoped-client";
import {
  COMMUNITY_READ_LIFETIME_MS,
  COMMUNITY_READ_RENEWAL_RETRY_MS,
  canRetryCommunityRenewal,
  communityRenewalDelay,
  getCommunityReadDeadline,
} from "../state/read-cache";
import { VisibilityEpoch } from "../state/visibility-epoch";
import { SharedMealDetails } from "../shared-meal-details";
import { ShareMealModal } from "../share-meal-modal";
import { ShareBoulderingModal } from "../share-bouldering-modal";
import {
  SharedBoulderingDetails,
  boulderingCardTitle,
} from "../shared-bouldering-details";
import { SharedWorkoutDetails } from "../shared-workout-details";
import { CommunityIdentityLink, CommunityPage, CommunityButton } from "../ui";
import { ShareWorkoutModal } from "../share-workout-modal";
import { ReactionBar } from "../reactions";
import { ReportModal } from "../safety";
import { captureSafetyReceipt } from "../safety/safety-api";
import {
  formatCategory,
  formatDuration,
  formatPublishedAt,
  formatSharedDay,
} from "./formatters";

export interface ActivityDetailScreenProps {
  readonly activityId: string;
  readonly principalKey: string | null;
  readonly sessionToken?: string | null;
}

const REACTION_EMOJIS: Record<string, string> = {
  clap: "👏",
  fire: "🔥",
  high_five: "🙌",
  fist_bump: "👊",
  thumbs_up: "👍",
};

export function ActivityDetailScreen({
  activityId,
  principalKey,
  sessionToken,
}: ActivityDetailScreenProps) {
  const colors = useTheme();
  const router = useRouter();

  const identity = `${principalKey}:${activityId}`;
  const lifetime = useRef({ identity, sessionToken });
  if (
    lifetime.current.identity !== identity ||
    lifetime.current.sessionToken !== sessionToken
  )
    lifetime.current = { identity, sessionToken };
  const current = lifetime.current;
  const alive = useRef(true);
  const epoch = useRef(new VisibilityEpoch());
  const readDeadline = useRef(0);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renewRef = useRef<() => void>(() => {});
  const isCurrent = () =>
    alive.current &&
    lifetime.current === current &&
    Date.now() < readDeadline.current;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (expiryTimer.current !== null) clearTimeout(expiryTimer.current);
      if (renewTimer.current !== null) clearTimeout(renewTimer.current);
    };
  }, []);

  const [activity, setActivity] = useState<SharedActivityFeedItemDto | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [managed, setManaged] = useState<AuthorSharedActivityDto | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [receiptId, setReceiptId] = useState<string | undefined>();
  const [displayIdentity, setDisplayIdentity] = useState(current);
  if (displayIdentity !== current) {
    setDisplayIdentity(current);
    setActivity(null);
    setManaged(null);
    setReceiptId(undefined);
    setReportModalVisible(false);
    setLoading(true);
    setError(null);
  }

  const clear = useCallback(() => {
    alive.current = false;
    readDeadline.current = 0;
    if (expiryTimer.current !== null) clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
    if (renewTimer.current !== null) clearTimeout(renewTimer.current);
    renewTimer.current = null;
    epoch.current.invalidate();
    setActivity(null);
    setManaged(null);
    setReceiptId(undefined);
    setReportModalVisible(false);
    setLoading(false);
    setError("This activity is unavailable until access is checked again.");
  }, []);

  // Silent renewal runs shortly before the deadline; the expiry timer stays the fallback.
  // A retry follows a transient failure or a write that preempted the read.
  const armRenewal = useCallback((retry = false) => {
    if (renewTimer.current !== null) clearTimeout(renewTimer.current);
    renewTimer.current = null;
    if (retry && !canRetryCommunityRenewal(readDeadline.current)) return;
    renewTimer.current = setTimeout(
      () => renewRef.current(),
      retry
        ? COMMUNITY_READ_RENEWAL_RETRY_MS
        : communityRenewalDelay(readDeadline.current),
    );
  }, []);

  const loadActivity = useCallback(async () => {
    if (!principalKey) {
      setLoading(false);
      setError("Please sign in to view activity.");
      return;
    }

    alive.current = true;
    readDeadline.current = Date.now() + COMMUNITY_READ_LIFETIME_MS;
    if (expiryTimer.current !== null) clearTimeout(expiryTimer.current);
    expiryTimer.current = setTimeout(clear, COMMUNITY_READ_LIFETIME_MS);
    if (renewTimer.current !== null) clearTimeout(renewTimer.current);
    renewTimer.current = null;
    setLoading(true);
    setError(null);
    setActivity(null);
    setManaged(null);
    setReceiptId(undefined);
    setReportModalVisible(false);

    epoch.current.invalidate();
    const requestEpoch = epoch.current.capture();
    const requestCurrent = () => isCurrent() && requestEpoch();
    const scoped = scopeCommunityClient(
      apiClient,
      principalKey,
      requestCurrent,
    );
    const result = await fetchSharedActivity(scoped, activityId);

    if (!requestCurrent()) return;

    if (result.ok) {
      readDeadline.current = Math.min(
        readDeadline.current,
        getCommunityReadDeadline(result.value) ?? readDeadline.current,
      );
      if (!requestCurrent()) {
        clear();
        return;
      }
      if (expiryTimer.current !== null) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(
        clear,
        Math.max(0, readDeadline.current - Date.now()),
      );
      setActivity(result.value);
      armRenewal();
      void captureSafetyReceipt(scoped, "activity", activityId).then(
        (receipt) => {
          if (requestCurrent() && receipt.ok) setReceiptId(receipt.value.id);
        },
      );
    } else {
      // Neutral unavailable error if 404 or forbidden
      const cause = communityErrorCause(result.error);
      if (
        cause.kind === "http_error" &&
        (cause.status === 404 || cause.status === 403)
      ) {
        setError("This activity is unavailable.");
      } else {
        setError(humanizeCommunityError(result.error));
      }
    }
    setLoading(false);
  }, [activityId, principalKey, sessionToken, clear, armRenewal]);

  const reactionsClient = useMemo(() => {
    const requestEpoch = epoch.current.capture();
    return scopeCommunityClient(
      apiClient,
      principalKey,
      () => isCurrent() && requestEpoch(),
    );
  }, [principalKey, current, activity]);

  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");

  renewRef.current = async () => {
    renewTimer.current = null;
    if (
      !principalKey ||
      !focused.current ||
      !foreground.current ||
      !isCurrent()
    )
      return;
    const startedAt = Date.now();
    // No invalidate: the displayed content and in-flight intents stay valid.
    const requestEpoch = epoch.current.capture();
    const requestCurrent = () => isCurrent() && requestEpoch();
    const scoped = scopeCommunityClient(
      apiClient,
      principalKey,
      requestCurrent,
    );
    const result = await fetchSharedActivity(scoped, activityId);
    // An explicit load or clear superseded this renewal and arms its own.
    if (!requestCurrent()) return;
    if (!result.ok) {
      // Denial retires at once; any other failure is retried until the deadline.
      if (!isCommunityAccessDenial(result.error)) return armRenewal(true);
      const cause = communityErrorCause(result.error);
      clear();
      if (cause.kind === "http_error" && cause.status !== 401)
        setError("This activity is unavailable.");
      return;
    }
    const deadline = Math.min(
      startedAt + COMMUNITY_READ_LIFETIME_MS,
      getCommunityReadDeadline(result.value) ?? Infinity,
    );
    if (Date.now() >= deadline) return;
    readDeadline.current = deadline;
    if (expiryTimer.current !== null) clearTimeout(expiryTimer.current);
    expiryTimer.current = setTimeout(clear, Math.max(0, deadline - Date.now()));
    setActivity(result.value);
    armRenewal();
  };

  const resume = useCallback(() => {
    if (!focused.current || !foreground.current) return;
    alive.current = true;
    void loadActivity();
  }, [loadActivity]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      resume();
      return () => {
        focused.current = false;
        clear();
      };
    }, [resume, clear]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (foreground.current === (next === "active")) return;
      foreground.current = next === "active";
      if (next !== "active") clear();
      else resume();
    });
    return () => subscription.remove();
  }, [clear, resume]);

  const handleMute = () => {
    if (!activity || !principalKey) return;
    const intentEpoch = epoch.current.capture();
    Alert.alert(
      `Mute @${activity.authorHandle}?`,
      "Their future shared meals and workouts will not appear in your feed. They will not be notified.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mute",
          style: "destructive",
          onPress: async () => {
            const scoped = scopeCommunityClient(
              apiClient,
              principalKey,
              () => isCurrent() && intentEpoch(),
            );
            const res = await setUserMuted(scoped, activity.authorUserId, true);
            if (!isCurrent() || !intentEpoch()) return;
            if (res.ok) {
              Alert.alert("Muted", `@${activity.authorHandle} has been muted.`);
              router.back();
            } else {
              Alert.alert("Error", humanizeCommunityError(res.error));
            }
          },
        },
      ],
    );
  };

  const handleBlock = () => {
    if (!activity || !principalKey) return;
    const intentEpoch = epoch.current.capture();
    Alert.alert(
      `Block @${activity.authorHandle}?`,
      "You will lose both follow connections. They cannot view or interact with you through Community.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            const scoped = scopeCommunityClient(
              apiClient,
              principalKey,
              () => isCurrent() && intentEpoch(),
            );
            const res = await blockUser(scoped, activity.authorUserId);
            if (!isCurrent() || !intentEpoch()) return;
            if (res.ok) {
              Alert.alert(
                "Blocked",
                `@${activity.authorHandle} has been blocked.`,
              );
              router.back();
            } else {
              Alert.alert("Error", humanizeCommunityError(res.error));
            }
          },
        },
      ],
    );
  };

  const manageShare = async () => {
    if (!activity || activity.authorUserId !== principalKey) return;
    const requestEpoch = epoch.current.capture();
    const currentRequest = () => isCurrent() && requestEpoch();
    const scoped = scopeCommunityClient(
      apiClient,
      principalKey,
      currentRequest,
    );
    const result = await scoped.request<AuthorSharedActivityDto>({
      method: "GET",
      path: `/v1/community/activities/${encodeURIComponent(activity.id)}/manage`,
      schema: authorSharedActivityDtoSchema,
    });
    if (!currentRequest()) return;
    if (result.ok && result.value.authorUserId === principalKey) {
      setManageError(null);
      setManaged(result.value);
    } else
      setManageError(
        "This shared activity cannot be managed here right now. Check access again.",
      );
  };

  const handleReport = () => {
    setReportModalVisible(true);
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !activity) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text
          accessibilityRole="alert"
          style={[styles.unavailableTitle, { color: colors.text }]}
        >
          {error ?? "This activity is unavailable."}
        </Text>
        <Text style={[styles.unavailableSub, { color: colors.textSecondary }]}>
          The activity may have been unpublished, or access may have changed.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Check activity access again"
          onPress={resume}
          style={styles.backButton}
        >
          <Text style={{ color: colors.text }}>Check access again</Text>
        </Pressable>
        <Pressable
          style={[styles.backButton, { backgroundColor: colors.primary }]}
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(tabs)/community")
          }
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={[styles.backButtonText, { color: colors.background }]}>
            Go back
          </Text>
        </Pressable>
      </View>
    );
  }

  const isMeal = activity.activityKind === "meal";
  const isBouldering = activity.activityKind === "bouldering";
  // Every kind other than meal and bouldering keeps the workout presentation.
  const isWorkout = !isMeal && !isBouldering;
  const duration = isWorkout ? formatDuration(activity.durationSeconds) : null;
  const sharedDayLabel = formatSharedDay(activity.sharedDay);
  const publishedAtLabel = formatPublishedAt(activity.publishedAt);
  const categoryLabel = isMeal
    ? "Meal"
    : isBouldering
      ? boulderingCardTitle(activity.boulderingDetails)
      : formatCategory(activity.category);
  const isSelf = activity.authorUserId === principalKey;
  const kindNoun = isMeal ? "meal" : isBouldering ? "session" : "workout";

  return (
    <CommunityPage
      title={
        isMeal
          ? "Shared meal"
          : isBouldering
            ? "Shared bouldering session"
            : "Shared workout"
      }
    >
      {/* Author Card */}
      <View
        style={[
          styles.mainCard,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.authorHeader}>
          <View style={styles.authorDetails}>
            <CommunityIdentityLink
              userId={activity.authorUserId}
              displayName={activity.authorDisplayName}
              handle={activity.authorHandle}
              avatarKey={activity.authorAvatarSymbol}
            />
            {publishedAtLabel ? (
              <Text style={[styles.timestamp, { color: colors.textSecondary }]}>
                Shared {publishedAtLabel}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.separator} />

        {/* Activity Details */}
        <View style={styles.activityBody}>
          <Text style={[styles.categoryTitle, { color: colors.text }]}>
            {categoryLabel}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
              Day:
            </Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>
              {sharedDayLabel}
            </Text>
          </View>

          {duration ? (
            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
                Duration:
              </Text>
              <Text
                style={[styles.metaValue, { color: colors.text }]}
                accessibilityLabel={`Duration: ${duration.accessible}`}
              >
                {duration.text}
              </Text>
            </View>
          ) : null}
        </View>

        {isMeal && activity.mealDetails ? (
          <SharedMealDetails details={activity.mealDetails} />
        ) : null}
        {isBouldering && activity.boulderingDetails ? (
          <SharedBoulderingDetails details={activity.boulderingDetails} />
        ) : null}
        {isWorkout && activity.workoutDetails ? (
          <SharedWorkoutDetails details={activity.workoutDetails} />
        ) : null}

        {/* Reactions Section */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open comments and conversation choices"
          onPress={() =>
            router.push(
              `/community/comments?activityId=${encodeURIComponent(activity.id)}` as Href,
            )
          }
          style={{
            padding: 14,
            minHeight: 48,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: colors.text }}>
            Comments and conversation choices
          </Text>
        </Pressable>
        <View style={styles.reactionsSection}>
          <Text
            style={[styles.reactionsTitle, { color: colors.textSecondary }]}
          >
            Encouragements
          </Text>
          <ReactionBar
            activityId={activity.id}
            authorUserId={activity.authorUserId}
            viewerUserId={principalKey ?? ""}
            initialReactionCounts={activity.reactionCounts}
            initialViewerReaction={activity.viewerReaction}
            onUnavailable={clear}
            scopedClient={principalKey ? reactionsClient : undefined}
            onReactionChanged={(newViewerReaction, newCounts) => {
              setActivity((prev) =>
                prev
                  ? {
                      ...prev,
                      viewerReaction: newViewerReaction,
                      reactionCounts: newCounts,
                    }
                  : null,
              );
            }}
          />
        </View>
      </View>

      {isSelf ? (
        <>
          <CommunityButton
            label={`Edit or unpublish shared ${kindNoun}`}
            onPress={() => void manageShare()}
          />
          {manageError ? (
            <Text accessibilityRole="alert" style={{ color: colors.text }}>
              {manageError}
            </Text>
          ) : null}
          {managed?.activityKind === "meal" && managed.sourceMealId ? (
            <ShareMealModal
              visible
              mealId={managed.sourceMealId}
              existingActivityId={managed.id}
              onDismiss={() => setManaged(null)}
              onPublished={() => {
                setManaged(null);
                void loadActivity();
              }}
              onRevoked={() => {
                setManaged(null);
                clear();
              }}
            />
          ) : managed?.activityKind === "bouldering" &&
            managed.sourceWorkoutId ? (
            <ShareBoulderingModal
              visible
              sessionId={managed.sourceWorkoutId}
              existingActivityId={managed.id}
              onDismiss={() => setManaged(null)}
              onPublished={() => {
                setManaged(null);
                void loadActivity();
              }}
              onRevoked={() => {
                setManaged(null);
                clear();
              }}
            />
          ) : managed?.activityKind !== "bouldering" &&
            managed?.sourceWorkoutId ? (
            <ShareWorkoutModal
              visible
              workoutId={managed.sourceWorkoutId}
              existingActivityId={managed.id}
              onDismiss={() => setManaged(null)}
              onPublished={() => {
                setManaged(null);
                void loadActivity();
              }}
              onRevoked={() => {
                setManaged(null);
                clear();
              }}
            />
          ) : null}
        </>
      ) : null}

      {/* Action Options (only when viewing other authors) */}
      {!isSelf ? (
        <View style={styles.actionsContainer}>
          <Pressable
            style={[styles.actionRow, { borderColor: colors.border }]}
            onPress={handleMute}
            accessibilityRole="button"
            accessibilityLabel="Mute author"
          >
            <Text style={[styles.actionText, { color: colors.text }]}>
              Mute @{activity.authorHandle}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.actionRow, { borderColor: colors.border }]}
            onPress={handleBlock}
            accessibilityRole="button"
            accessibilityLabel="Block author"
          >
            <Text style={[styles.actionText, { color: colors.danger }]}>
              Block @{activity.authorHandle}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.actionRow, { borderColor: colors.border }]}
            onPress={handleReport}
            accessibilityRole="button"
            accessibilityLabel="Report activity"
          >
            <Text style={[styles.actionText, { color: colors.textSecondary }]}>
              Report this content
            </Text>
          </Pressable>
        </View>
      ) : null}

      {activity && (
        <ReportModal
          visible={reportModalVisible}
          targetType="activity"
          targetId={activity.id}
          targetHandle={activity.authorHandle}
          principalKey={principalKey}
          interactionReceiptId={receiptId}
          onClose={() => setReportModalVisible(false)}
          onSuccess={(_reportId, blocked) => {
            if (blocked) {
              router.back();
            }
          }}
        />
      )}
    </CommunityPage>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  unavailableTitle: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  unavailableSub: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 20,
  },
  backButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  mainCard: {
    borderRadius: 0,
    borderWidth: 0,
    paddingVertical: 12,
    marginBottom: 20,
  },
  authorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  authorDetails: {
    flex: 1,
  },
  displayName: {
    fontSize: 17,
    fontWeight: "600",
  },
  handle: {
    fontSize: 14,
    marginTop: 2,
  },
  timestamp: {
    fontSize: 12,
    marginTop: 4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(128,128,128,0.2)",
    marginVertical: 16,
  },
  activityBody: {
    gap: 10,
  },
  categoryTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  metaRow: {
    flexWrap: "wrap",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaLabel: {
    fontSize: 14,
    width: 70,
  },
  metaValue: {
    fontSize: 15,
    fontWeight: "500",
  },
  reactionsSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.2)",
  },
  reactionsTitle: {
    fontSize: 13,
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  reactionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  reactionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  reactionEmoji: {
    fontSize: 16,
  },
  reactionCount: {
    fontSize: 14,
  },
  actionsContainer: {
    gap: 10,
  },
  actionRow: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  actionText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
