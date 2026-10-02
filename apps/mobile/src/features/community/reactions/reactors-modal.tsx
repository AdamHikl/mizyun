import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ReactorSummary } from "@mizyun/contracts";
import type { ScopedCommunityClient } from "../community-client";
import {
  getActivityReactions,
  humanizeCommunityError,
} from "../community-client";
import { InitialsAvatar } from "../initials-avatar";
import { useTheme } from "@/hooks/use-theme";
import { MaxContentWidth } from "@/constants/theme";
import { REACTION_EMOJIS, REACTION_LABELS } from "./constants";

export interface ReactorsModalProps {
  readonly visible: boolean;
  readonly activityId: string;
  readonly scopedClient?: ScopedCommunityClient;
  readonly initialReactors?: readonly ReactorSummary[];
  readonly onClose: () => void;
}

export function formatReactorTimestamp(isoString: string): string {
  try {
    const timestamp = new Date(isoString).getTime();
    if (Number.isNaN(timestamp)) return "";
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function ReactorsModal({
  visible,
  activityId,
  scopedClient,
  initialReactors,
  onClose,
}: ReactorsModalProps) {
  const colors = useTheme();
  const styles = createStyles(colors);
  const [reactors, setReactors] = useState<readonly ReactorSummary[]>(
    initialReactors ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReactors([]);
    setError(null);
    if (!visible) return;

    if (!scopedClient && initialReactors && initialReactors.length > 0) {
      setReactors(initialReactors);
      return;
    }

    if (!scopedClient) return;

    let active = true;
    setLoading(true);
    setError(null);

    const loadReactors = async () => {
      const res = await getActivityReactions(scopedClient, activityId);
      if (!active) return;
      setLoading(false);
      if (res.ok) {
        setReactors(res.value.reactors ?? []);
      } else {
        setError(
          humanizeCommunityError(res.error, "Could not load reactions."),
        );
      }
    };

    void loadReactors().catch(() => {
      if (active) {
        setLoading(false);
        setError("Could not load reactions.");
      }
    });

    return () => {
      active = false;
    };
  }, [visible, activityId, scopedClient, initialReactors]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="reactors-modal"
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              Reactions
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close reactions"
              testID="reactors-close-btn"
              style={{
                minWidth: 48,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
              hitSlop={8}
            >
              <Text style={styles.closeBtn}>✕</Text>
            </Pressable>
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.centerBox} testID="reactors-loading">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.statusText}>Loading reactions...</Text>
            </View>
          ) : error ? (
            <View style={styles.centerBox} testID="reactors-error">
              <Text accessibilityRole="alert" style={styles.errorText}>
                {error}
              </Text>
            </View>
          ) : reactors.length === 0 ? (
            <View style={styles.centerBox} testID="reactors-empty">
              <Text style={styles.emptyText}>No reactions yet.</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              testID="reactors-list"
            >
              {reactors.map((reactor) => {
                const emoji = REACTION_EMOJIS[reactor.reaction] ?? "👍";
                const label =
                  REACTION_LABELS[reactor.reaction] ?? reactor.reaction;
                const timeStr = formatReactorTimestamp(reactor.createdAt);

                return (
                  <View
                    key={`${reactor.userId}-${reactor.reaction}`}
                    style={styles.reactorRow}
                    testID={`reactor-item-${reactor.userId}`}
                    accessible
                    accessibilityRole="text"
                    accessibilityLabel={`${reactor.displayName}, @${reactor.handle}, reacted with ${label}${timeStr ? `, ${timeStr}` : ""}`}
                  >
                    <View style={styles.avatarWrapper}>
                      <InitialsAvatar
                        symbol={reactor.avatarSymbol}
                        seed={reactor.displayName}
                        size={36}
                      />
                      <View style={styles.reactionBadge}>
                        <Text style={styles.reactionBadgeEmoji}>{emoji}</Text>
                      </View>
                    </View>

                    <View style={styles.infoCol}>
                      <Text style={styles.displayName}>
                        {reactor.displayName}
                      </Text>
                      <Text style={styles.handle}>@{reactor.handle}</Text>
                    </View>

                    {timeStr ? (
                      <Text style={styles.timeText}>{timeStr}</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.55)",
      justifyContent: "flex-end",
    },
    card: {
      backgroundColor: colors.backgroundElement,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 32,
      maxHeight: "75%",
      minHeight: 220,
      width: "100%",
      maxWidth: MaxContentWidth,
      alignSelf: "center",
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
      flex: 1,
    },
    closeBtn: {
      color: colors.textSecondary,
      fontSize: 18,
      padding: 4,
    },
    centerBox: {
      paddingVertical: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    statusText: {
      color: colors.textSecondary,
      fontSize: 14,
      marginTop: 10,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 15,
    },
    errorText: {
      color: "#FF453A",
      fontSize: 14,
      textAlign: "center",
    },
    list: {
      flexGrow: 0,
    },
    listContent: {
      paddingVertical: 4,
      gap: 12,
    },
    reactorRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      rowGap: 8,
      paddingVertical: 6,
    },
    avatarWrapper: {
      position: "relative",
      marginRight: 12,
    },
    reactionBadge: {
      position: "absolute",
      bottom: -4,
      right: -4,
      backgroundColor: colors.backgroundSelected,
      borderRadius: 10,
      paddingHorizontal: 3,
      paddingVertical: 1,
      borderWidth: 1,
      borderColor: colors.border,
    },
    reactionBadgeEmoji: {
      fontSize: 11,
    },
    infoCol: {
      flex: 1,
      minWidth: 120,
      justifyContent: "center",
    },
    displayName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    handle: {
      color: colors.textSecondary,
      fontSize: 13,
      marginTop: 1,
    },
    timeText: {
      color: colors.textSecondary,
      fontSize: 12,
      marginLeft: 8,
      flexShrink: 1,
    },
  });
