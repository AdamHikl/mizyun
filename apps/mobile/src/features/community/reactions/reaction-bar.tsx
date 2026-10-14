import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { CommunityReactionKind } from "@mizyun/contracts";
import type { ScopedCommunityClient } from "../community-client";
import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  REACTION_EMOJIS,
  REACTION_LABELS,
  SUPPORTED_REACTIONS,
} from "./constants";
import { ReactionBarController } from "./reaction-bar-controller";
import { ReactorsModal } from "./reactors-modal";

export interface ReactionBarProps {
  activityId: string;
  authorUserId: string;
  viewerUserId: string;
  initialReactionCounts?:
    | Partial<Record<CommunityReactionKind, number>>
    | Record<CommunityReactionKind, number>;
  initialViewerReaction: CommunityReactionKind | null;
  scopedClient?: ScopedCommunityClient;
  onReactionChanged?: (
    newViewerReaction: CommunityReactionKind | null,
    newCounts: Record<CommunityReactionKind, number>,
  ) => void;
  disabled?: boolean;
  onUnavailable?: () => void;
  compact?: boolean;
}

export function buildReactionAccessibilityLabel(options: {
  readonly kind: CommunityReactionKind;
  readonly label: string;
  readonly count: number;
  readonly isSelected: boolean;
  readonly isAuthor: boolean;
  readonly totalReactions: number;
}): string {
  const { label, count, isSelected, isAuthor, totalReactions } = options;
  const countLabel = `${count} ${count === 1 ? "reaction" : "reactions"}`;

  if (isAuthor) {
    if (totalReactions > 0) {
      return `${label}, ${countLabel}. Tap to view who reacted.`;
    }
    return `${label}, 0 reactions. Cannot react to your own activity.`;
  }

  if (isSelected) {
    return `${label}, ${countLabel}. Selected. Tap to remove reaction.`;
  }
  return `${label}, ${countLabel}. Tap to react.`;
}

export function ReactionBar(props: ReactionBarProps) {
  const { activityId, disabled = false } = props;
  const colors = useTheme();

  const controllerRef = useRef<ReactionBarController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ReactionBarController(props);
  } else {
    controllerRef.current.updateOptions(props);
  }
  const controller = controllerRef.current;

  const [state, setState] = useState(controller.state);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    controller.resume();
    const unsubscribe = controller.subscribe(setState);
    return () => {
      unsubscribe();
      controller.retire();
    };
  }, [controller]);

  const isAuthor = controller.isAuthor;
  const totalReactions = controller.totalReactions;
  const { viewerReaction, reactionCounts, isPending, error, isModalOpen } =
    state;

  return (
    <View style={styles.container} testID={`reaction-bar-${activityId}`}>
      <View style={styles.bar}>
        {props.compact ? (
          <>
            <Pressable
              testID="open-reaction-picker"
              accessibilityRole="button"
              accessibilityLabel={
                isAuthor
                  ? "View encouragement"
                  : "Choose an encouragement reaction"
              }
              accessibilityState={{
                expanded: pickerOpen,
                disabled:
                  disabled || isPending || (isAuthor && totalReactions === 0),
              }}
              disabled={
                disabled || isPending || (isAuthor && totalReactions === 0)
              }
              onPress={() =>
                isAuthor
                  ? controller.openReactorsModal()
                  : setPickerOpen(!pickerOpen)
              }
              style={styles.viewReactorsBtn}
            >
              <ThemedText type="smallBold" themeColor="primary">
                {isAuthor
                  ? "Encouragement"
                  : viewerReaction
                    ? `${REACTION_EMOJIS[viewerReaction]} ${REACTION_LABELS[viewerReaction]}`
                    : "Encourage"}
              </ThemedText>
            </Pressable>
            <ThemedText type="footnote" themeColor="textSecondary">
              {totalReactions} {totalReactions === 1 ? "reaction" : "reactions"}
            </ThemedText>
          </>
        ) : null}
        {(!props.compact || pickerOpen) &&
          SUPPORTED_REACTIONS.map((def) => {
            const kind = def.kind;
            const count = reactionCounts[kind] ?? 0;
            const isSelected = viewerReaction === kind;
            const emoji = REACTION_EMOJIS[kind] ?? def.emoji;
            const label = REACTION_LABELS[kind] ?? def.label;

            const buttonAccessibilityLabel = buildReactionAccessibilityLabel({
              kind,
              label,
              count,
              isSelected,
              isAuthor,
              totalReactions,
            });

            const isButtonDisabled =
              disabled || isPending || (isAuthor && totalReactions === 0);

            return (
              <Pressable
                key={kind}
                testID={`reaction-btn-${kind}`}
                onPress={() => {
                  setPickerOpen(false);
                  void controller.toggleReaction(kind);
                }}
                disabled={isButtonDisabled}
                accessibilityRole="button"
                accessibilityLabel={buttonAccessibilityLabel}
                accessibilityState={{
                  selected: isSelected,
                  disabled: isButtonDisabled,
                  busy: isPending && !isAuthor,
                }}
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: isSelected
                      ? colors.primaryLight
                      : colors.backgroundSelected,
                    borderColor: isSelected ? colors.primary : "transparent",
                    opacity: pressed
                      ? 0.75
                      : isButtonDisabled && isAuthor
                        ? 0.6
                        : 1,
                  },
                ]}
                hitSlop={4}
              >
                <ThemedText type="small">{emoji}</ThemedText>
                <ThemedText
                  type={isSelected ? "smallBold" : "small"}
                  themeColor={isSelected ? "primary" : "textSecondary"}
                >
                  {count}
                </ThemedText>
              </Pressable>
            );
          })}

        {/* If author has reactions, render view reactors badge button */}
        {!props.compact && isAuthor && totalReactions > 0 ? (
          <Pressable
            testID="author-view-reactors-btn"
            onPress={() => controller.openReactorsModal()}
            accessibilityRole="button"
            accessibilityLabel={`View all ${totalReactions} ${totalReactions === 1 ? "reactor" : "reactors"}`}
            style={({ pressed }) => [
              styles.viewReactorsBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <ThemedText type="smallBold" themeColor="primary">
              Who reacted ({totalReactions})
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {/* Error message if rollback occurred */}
      {error ? (
        <View style={styles.errorBox} testID="reaction-bar-error">
          <ThemedText
            type="footnote"
            themeColor="danger"
            accessibilityRole="alert"
          >
            {error}
          </ThemedText>
        </View>
      ) : null}

      {/* Author Reactors Modal */}
      <ReactorsModal
        key={`${props.viewerUserId}:${activityId}`}
        visible={isModalOpen}
        activityId={activityId}
        scopedClient={props.scopedClient}
        onClose={() => controller.closeReactorsModal()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  bar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  button: {
    minHeight: 48,
    minWidth: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
    paddingHorizontal: 10,
    paddingVertical: Spacing.one,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  viewReactorsBtn: {
    minHeight: 48,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    justifyContent: "center",
  },
  errorBox: {
    marginTop: 6,
    paddingHorizontal: Spacing.one,
  },
});
