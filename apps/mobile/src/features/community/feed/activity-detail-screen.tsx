import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useFocusEffect, useRouter } from "expo-router";
import type { SharedActivityFeedItemDto } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useTheme } from "@/hooks/use-theme";
import {
  blockUser,
  fetchSharedActivity,
  humanizeCommunityError,
  setUserMuted,
} from "../community-client";
import { scopeCommunityClient } from "../scoped-client";
import { VisibilityEpoch } from "../state/visibility-epoch";
import { InitialsAvatar } from "../initials-avatar";
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
}: ActivityDetailScreenProps) {
  const colors = useTheme();
  const router = useRouter();

  const identity = `${principalKey}:${activityId}`;
  const lifetime = useRef({ identity });
  if (lifetime.current.identity !== identity) lifetime.current = { identity };
  const current = lifetime.current;
  const alive = useRef(true);
  const epoch = useRef(new VisibilityEpoch());
  const isCurrent = () => alive.current && lifetime.current === current;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const [activity, setActivity] = useState<SharedActivityFeedItemDto | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [receiptId, setReceiptId] = useState<string | undefined>();
  const [displayIdentity, setDisplayIdentity] = useState(identity);
  if (displayIdentity !== identity) {
    setDisplayIdentity(identity);
    setActivity(null);
    setReceiptId(undefined);
    setReportModalVisible(false);
    setLoading(true);
    setError(null);
  }

  const loadActivity = useCallback(async () => {
    if (!principalKey) {
      setLoading(false);
      setError("Please sign in to view activity.");
      return;
    }

    setLoading(true);
    setError(null);
    setActivity(null);
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
      setActivity(result.value);
      void captureSafetyReceipt(scoped, "activity", activityId).then(
        (receipt) => {
          if (requestCurrent() && receipt.ok) setReceiptId(receipt.value.id);
        },
      );
    } else {
      // Neutral unavailable error if 404 or forbidden
      if (
        result.error.kind === "http_error" &&
        (result.error.status === 404 || result.error.status === 403)
      ) {
        setError("This activity is unavailable.");
      } else {
        setError(humanizeCommunityError(result.error));
      }
    }
    setLoading(false);
  }, [activityId, principalKey]);

  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const clear = useCallback(() => {
    alive.current = false;
    epoch.current.invalidate();
    setActivity(null);
    setReceiptId(undefined);
    setReportModalVisible(false);
    setLoading(false);
    setError("This activity is unavailable until access is checked again.");
  }, []);
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
      "Their future shared workouts will not appear in your feed. They will not be notified.",
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
          The workout may have been unpublished, or access may have changed.
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
          onPress={() => router.back()}
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

  const duration = formatDuration(activity.durationSeconds);
  const sharedDayLabel = formatSharedDay(activity.sharedDay);
  const publishedAtLabel = formatPublishedAt(activity.publishedAt);
  const categoryLabel = formatCategory(activity.category);
  const isSelf = activity.authorUserId === principalKey;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Author Card */}
      <View
        style={[
          styles.mainCard,
          {
            backgroundColor: colors.backgroundElement,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.authorHeader}>
          <InitialsAvatar
            seed={activity.authorDisplayName}
            symbol={activity.authorAvatarSymbol}
            size={52}
            accessibilityLabel={`${activity.authorDisplayName}'s avatar`}
          />
          <View style={styles.authorDetails}>
            <Text style={[styles.displayName, { color: colors.text }]}>
              {activity.authorDisplayName}
            </Text>
            <Text style={[styles.handle, { color: colors.textSecondary }]}>
              @{activity.authorHandle}
            </Text>
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

        {/* Reactions Section */}
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
            scopedClient={
              principalKey
                ? scopeCommunityClient(apiClient, principalKey, isCurrent)
                : undefined
            }
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
            <Text style={[styles.actionText, { color: "#DC2626" }]}>
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
    </ScrollView>
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
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
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
