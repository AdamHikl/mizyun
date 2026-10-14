import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import type { ReactorSummary } from "@mizyun/contracts";
import type { ScopedCommunityClient } from "../community-client";
import {
  getActivityReactions,
  humanizeCommunityError,
} from "../community-client";
import { CommunityIdentityLink } from "../ui";
import { ThemedText } from "@/components/themed-text";
import { IconButton } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import {
  MaxContentWidth,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
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
            <ThemedText
              type="title3"
              accessibilityRole="header"
              style={styles.title}
            >
              Reactions
            </ThemedText>
            <IconButton
              icon="close"
              onPress={onClose}
              accessibilityLabel="Close reactions"
              testID="reactors-close-btn"
            />
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.centerBox} testID="reactors-loading">
              <ActivityIndicator size="small" color={colors.primary} />
              <ThemedText type="small" themeColor="textSecondary">
                Loading reactions…
              </ThemedText>
            </View>
          ) : error ? (
            <View style={styles.centerBox} testID="reactors-error">
              <ThemedText
                type="small"
                themeColor="danger"
                accessibilityRole="alert"
                style={styles.center}
              >
                {error}
              </ThemedText>
            </View>
          ) : reactors.length === 0 ? (
            <View style={styles.centerBox} testID="reactors-empty">
              <ThemedText type="small" themeColor="textSecondary">
                No reactions yet.
              </ThemedText>
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
                    accessible={false}
                    accessibilityLabel={`${reactor.displayName}, @${reactor.handle}, reacted with ${label}${timeStr ? `, ${timeStr}` : ""}`}
                  >
                    <View style={styles.infoCol}>
                      <CommunityIdentityLink
                        userId={reactor.userId}
                        displayName={reactor.displayName}
                        handle={reactor.handle}
                        avatarKey={reactor.avatarSymbol}
                        onPress={onClose}
                      />
                    </View>
                    <ThemedText
                      type="footnote"
                      themeColor="textSecondary"
                      style={styles.timeText}
                      accessibilityLabel={`Reacted with ${label}${timeStr ? `, ${timeStr}` : ""}`}
                    >
                      {emoji}
                      {timeStr ? ` · ${timeStr}` : ""}
                    </ThemedText>
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
      backgroundColor: colors.overlay,
      justifyContent: "flex-end",
    },
    card: {
      backgroundColor: colors.backgroundElement,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      paddingHorizontal: PageGutter,
      paddingTop: Spacing.two,
      paddingBottom: Spacing.five,
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
      marginBottom: Spacing.two,
      paddingBottom: Spacing.one,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    title: {
      flex: 1,
    },
    centerBox: {
      paddingVertical: Spacing.five,
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.two,
    },
    center: {
      textAlign: "center",
    },
    list: {
      flexGrow: 0,
    },
    listContent: {
      paddingVertical: Spacing.one,
      gap: 12,
    },
    reactorRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      rowGap: Spacing.two,
      paddingVertical: 6,
    },
    infoCol: {
      flex: 1,
      minWidth: 120,
      justifyContent: "center",
    },
    timeText: {
      marginLeft: Spacing.two,
      flexShrink: 1,
    },
  });
