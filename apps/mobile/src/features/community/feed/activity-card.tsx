import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type {
  CommunityReactionKind,
  SharedActivityFeedItemDto,
} from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { Card, Icon, IconButton } from "@/components/ui";
import { PageGutter, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { ScopedCommunityClient } from "../community-client";
import { SharedMealDetails } from "../shared-meal-details";
import { SharedWorkoutDetails } from "../shared-workout-details";
import { CommunityIdentityLink } from "../ui";
import { REACTION_EMOJIS, ReactionBar } from "../reactions";
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
    <Card
      testID={`activity-card-${item.id}`}
      style={styles.card}
      accessible={false}
    >
      <View style={styles.header}>
        <View style={styles.authorDetails}>
          <CommunityIdentityLink
            userId={item.authorUserId}
            displayName={item.authorDisplayName}
            handle={item.authorHandle}
            avatarKey={item.authorAvatarSymbol}
          />
          {publishedAtLabel ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              Shared {publishedAtLabel}
            </ThemedText>
          ) : null}
        </View>
        {onOpenActions && (
          <IconButton
            testID={`activity-actions-${item.id}`}
            icon="more"
            variant="plain"
            accessibilityLabel="Card options"
            onPress={(e) => {
              e.stopPropagation();
              onOpenActions();
            }}
          />
        )}
      </View>

      <Pressable
        style={({ pressed }) => [styles.content, pressed && styles.pressed]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${item.authorDisplayName} (@${item.authorHandle}) shared ${categoryLabel} on ${sharedDayLabel}${duration ? `, duration ${duration.accessible}` : ""}${!isMeal && item.workoutDetails ? `, ${item.workoutDetails.exercises.length} exercises, workout details shared` : ""}`}
        accessibilityHint={
          isMeal ? "Open shared meal details" : "Open shared workout details"
        }
      >
        <ThemedText type="headline">{categoryLabel}</ThemedText>
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Icon name="calendar" size={13} color="textSecondary" />
            <ThemedText type="footnote" themeColor="textSecondary">
              {sharedDayLabel}
            </ThemedText>
          </View>
          {duration ? (
            <View
              style={styles.metaItem}
              accessibilityLabel={`Duration: ${duration.accessible}`}
            >
              <Icon name="timer" size={13} color="textSecondary" />
              <ThemedText type="footnote" themeColor="textSecondary">
                {duration.text}
              </ThemedText>
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

      {viewerUserId && scopedClient ? (
        <View style={[styles.reactions, { borderTopColor: colors.separator }]}>
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
        </View>
      ) : (
        <View
          style={[
            styles.reactions,
            styles.reactionsBar,
            { borderTopColor: colors.separator },
          ]}
        >
          {Object.entries(item.reactionCounts).map(([kind, count]) => {
            // Reaction kinds are content (the same symbols as the live
            // reaction bar), not interface affordances.
            const symbol =
              REACTION_EMOJIS[kind as CommunityReactionKind] ?? kind;
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
                  },
                ]}
                accessibilityLabel={`${count} ${kind.replace("_", " ")} reactions`}
              >
                <ThemedText type="footnote">{symbol}</ThemedText>
                <ThemedText
                  type={isSelected ? "caption" : "footnote"}
                  themeColor={isSelected ? "primary" : "textSecondary"}
                >
                  {count}
                </ThemedText>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: PageGutter,
    marginBottom: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  authorDetails: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  content: {
    gap: Spacing.two,
  },
  pressed: { opacity: 0.6 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.three,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  reactions: {
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reactionsBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  reactionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.pill,
  },
});
