import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  CommunityReactionKind,
  SharedActivityFeedItemDto,
} from "@mizyun/contracts";
import { useTheme } from "@/hooks/use-theme";
import type { ScopedCommunityClient } from "../community-client";
import { SharedMealDetails } from "../shared-meal-details";
import { SharedWorkoutDetails } from "../shared-workout-details";
import { CommunityIdentityLink } from "../ui";
import { ReactionBar } from "../reactions";
import {
  formatCategory,
  formatDuration,
  formatPublishedAt,
  formatSharedDay,
} from "./formatters";

export interface ActivityCardProps {
  readonly item: SharedActivityFeedItemDto;
  readonly viewerUserId?: string;
  readonly scopedClient?: ScopedCommunityClient;
  readonly onPress?: () => void;
  readonly onOpenActions?: () => void;
  readonly onUnavailable?: () => void;
  readonly onReactionChanged?: (
    newViewerReaction: CommunityReactionKind | null,
    newCounts: Record<CommunityReactionKind, number>,
  ) => void;
}

const REACTION_EMOJIS: Record<string, string> = {
  clap: "👏",
  fire: "🔥",
  high_five: "🙌",
  fist_bump: "👊",
  thumbs_up: "👍",
};

export function ActivityCard({
  item,
  viewerUserId,
  scopedClient,
  onPress,
  onOpenActions,
  onReactionChanged,
  onUnavailable,
}: ActivityCardProps) {
  const colors = useTheme();
  const isMeal = item.activityKind === "meal";
  const duration = isMeal ? null : formatDuration(item.durationSeconds);
  const sharedDayLabel = formatSharedDay(item.sharedDay);
  const publishedAtLabel = formatPublishedAt(item.publishedAt);
  const categoryLabel = isMeal
    ? `Meal · ${item.mealDetails?.name ?? "Shared meal"}`
    : formatCategory(item.category);

  return (
    <View
      testID={`activity-card-${item.id}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
        },
      ]}
      accessible={false}
    >
      {/* Author Header */}
      <View style={styles.header}>
        <View style={styles.authorRow}>
          <View style={styles.authorDetails}>
            <CommunityIdentityLink
              userId={item.authorUserId}
              displayName={item.authorDisplayName}
              handle={item.authorHandle}
              avatarKey={item.authorAvatarSymbol}
            />
            {publishedAtLabel ? (
              <Text style={[styles.timestamp, { color: colors.textSecondary }]}>
                Shared {publishedAtLabel}
              </Text>
            ) : null}
          </View>
        </View>

        {onOpenActions && (
          <Pressable
            testID={`activity-actions-${item.id}`}
            style={({ pressed }) => [
              styles.actionsButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            onPress={(e) => {
              e.stopPropagation();
              onOpenActions();
            }}
            accessibilityRole="button"
            accessibilityLabel="Card options"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={[styles.actionsIcon, { color: colors.textSecondary }]}>
              •••
            </Text>
          </Pressable>
        )}
      </View>

      {/* Activity Content */}
      <Pressable
        style={styles.content}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${item.authorDisplayName} (@${item.authorHandle}) shared ${categoryLabel} on ${sharedDayLabel}${duration ? `, duration ${duration.accessible}` : ""}${!isMeal && item.workoutDetails ? `, ${item.workoutDetails.exercises.length} exercises, workout details shared` : ""}`}
        accessibilityHint={
          isMeal ? "Open shared meal details" : "Open shared workout details"
        }
      >
        <Text style={[styles.categoryTitle, { color: colors.text }]}>
          {categoryLabel}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            {sharedDayLabel}
          </Text>
          {duration ? (
            <View
              style={[
                styles.durationPill,
                { backgroundColor: colors.backgroundSelected },
              ]}
              accessibilityLabel={`Duration: ${duration.accessible}`}
            >
              <Text style={[styles.durationText, { color: colors.text }]}>
                {duration.text}
              </Text>
            </View>
          ) : null}
        </View>
        {isMeal && item.mealDetails ? (
          <SharedMealDetails details={item.mealDetails} compact />
        ) : null}
        {!isMeal && item.workoutDetails ? (
          <SharedWorkoutDetails details={item.workoutDetails} compact />
        ) : null}
      </Pressable>

      {/* Reactions Bar */}
      {viewerUserId && scopedClient ? (
        <ReactionBar
          compact
          activityId={item.id}
          authorUserId={item.authorUserId}
          viewerUserId={viewerUserId}
          initialReactionCounts={item.reactionCounts}
          initialViewerReaction={item.viewerReaction}
          scopedClient={scopedClient}
          onReactionChanged={onReactionChanged}
          onUnavailable={onUnavailable}
        />
      ) : (
        <View style={styles.reactionsBar}>
          {Object.entries(item.reactionCounts).map(([kind, count]) => {
            const emoji = REACTION_EMOJIS[kind] ?? kind;
            const isSelected = item.viewerReaction === kind;
            return (
              <View
                key={kind}
                style={[
                  styles.reactionBadge,
                  {
                    backgroundColor: isSelected
                      ? colors.primaryLight
                      : colors.backgroundSelected,
                    borderColor: isSelected ? colors.primary : "transparent",
                  },
                ]}
                accessibilityLabel={`${count} ${kind.replace("_", " ")} reactions`}
              >
                <Text style={styles.reactionEmoji}>{emoji}</Text>
                <Text
                  style={[
                    styles.reactionCount,
                    {
                      color: isSelected ? colors.primary : colors.textSecondary,
                      fontWeight: isSelected ? "600" : "400",
                    },
                  ]}
                >
                  {count}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 20,
    marginHorizontal: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  authorDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    flexWrap: "wrap",
  },
  displayName: {
    fontSize: 15,
    fontWeight: "600",
  },
  handle: {
    fontSize: 13,
  },
  timestamp: {
    fontSize: 12,
    marginTop: 2,
  },
  actionsButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  actionsIcon: {
    fontSize: 16,
    fontWeight: "bold",
    letterSpacing: 2,
  },
  content: {
    marginTop: 14,
    marginBottom: 12,
  },
  categoryTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  metaText: {
    fontSize: 13,
  },
  durationPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  durationText: {
    fontSize: 12,
    fontWeight: "500",
  },
  reactionsBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.2)",
  },
  reactionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    fontSize: 12,
  },
});
