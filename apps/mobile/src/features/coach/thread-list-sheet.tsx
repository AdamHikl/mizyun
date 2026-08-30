/**
 * AI-MOB-002 — Thread list sheet.
 *
 * Single-screen layout: the main Coach screen hosts the active
 * thread. Tapping the header title opens this sheet to switch
 * threads or start a new one. The sheet renders each
 * conversation as a tappable row with title + preview + relative
 * timestamp. The active row is marked with a high-contrast
 * border so the user always knows which thread they're in.
 */

import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Spacing } from "@/constants/theme";

import { previewFor, relativeLabel } from "./coach-data";

import type { CoachConversation, CoachMessage } from "@mizyun/contracts";

const PREVIEW_SAMPLE_LIMIT = 5;

const formatPreviewWindow = (
  conversation: CoachConversation,
  messagesByConversation: ReadonlyMap<string, readonly CoachMessage[]>,
): string => {
  const messages = messagesByConversation.get(conversation.id) ?? [];
  return previewFor(conversation, messages.slice(-PREVIEW_SAMPLE_LIMIT));
};

export interface ThreadListSheetProps {
  readonly visible: boolean;
  readonly conversations: readonly CoachConversation[];
  readonly activeId: string | null;
  readonly messagesByConversation: ReadonlyMap<string, readonly CoachMessage[]>;
  readonly now: Date;
  readonly onSelect: (conversationId: string) => void;
  readonly onNew: () => void;
  readonly onClose: () => void;
}

export function ThreadListSheet({
  visible,
  conversations,
  activeId,
  messagesByConversation,
  now,
  onSelect,
  onNew,
  onClose,
}: ThreadListSheetProps) {
  if (!visible) return null;
  return (
    <ThemedView
      type="background"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
      }}
      accessibilityViewIsModal
    >
      <SafeAreaView
        style={{ flex: 1 }}
        edges={["top", "bottom", "left", "right"]}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: Spacing.four,
            paddingVertical: Spacing.three,
            borderBottomColor: "rgba(148, 163, 184, 0.15)",
            borderBottomWidth: 1,
          }}
        >
          <View style={{ gap: 2 }}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              MIZYUN COACH
            </ThemedText>
            <ThemedText type="subtitle">Conversations</ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close thread list"
            onPress={onClose}
            hitSlop={8}
            style={{
              minHeight: 36,
              paddingHorizontal: Spacing.three,
              paddingVertical: Spacing.one,
              borderRadius: 10,
              backgroundColor: "rgba(148, 163, 184, 0.12)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <ThemedText type="smallBold">Close</ThemedText>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{
            padding: Spacing.four,
            gap: Spacing.two,
          }}
        >
          {conversations.length === 0 ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={{ paddingVertical: Spacing.four }}
            >
              No conversations yet. Start one below.
            </ThemedText>
          ) : (
            conversations.map((conversation) => {
              const isActive = conversation.id === activeId;
              const preview = formatPreviewWindow(
                conversation,
                messagesByConversation,
              );
              const timestamp = relativeLabel(conversation.updatedAt, now);
              return (
                <Pressable
                  key={conversation.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${conversation.title ?? "Coach check-in"}, last activity ${timestamp}`}
                  accessibilityState={{ selected: isActive }}
                  onPress={() => onSelect(conversation.id)}
                  style={({ pressed }) => [
                    {
                      borderRadius: 16,
                      padding: Spacing.three,
                      borderWidth: isActive ? 1.5 : 1,
                      borderColor: isActive
                        ? "#10B981"
                        : "rgba(148, 163, 184, 0.2)",
                      backgroundColor: isActive
                        ? "rgba(16, 185, 129, 0.08)"
                        : "rgba(148, 163, 184, 0.06)",
                      gap: Spacing.half,
                      minHeight: 64,
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <ThemedText type="smallBold">
                      {conversation.title ?? "Coach check-in"}
                    </ThemedText>
                    {isActive ? (
                      <View
                        style={{
                          backgroundColor: "rgba(16, 185, 129, 0.15)",
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 6,
                        }}
                      >
                        <ThemedText
                          type="smallBold"
                          style={{ color: "#10B981", fontSize: 11 }}
                        >
                          Active
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={2}
                  >
                    {preview}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {timestamp}
                  </ThemedText>
                </Pressable>
              );
            })
          )}
        </ScrollView>
        <View
          style={{
            padding: Spacing.four,
            borderTopColor: "rgba(148, 163, 184, 0.15)",
            borderTopWidth: 1,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new conversation"
            onPress={onNew}
            style={({ pressed }) => [
              {
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                backgroundColor: "#10B981",
              },
              pressed && { opacity: 0.8 },
            ]}
          >
            <ThemedText type="smallBold" style={{ color: "#FFFFFF" }}>
              ＋ New conversation
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

// React Native ships StyleSheet.hairlineWidth() at module scope;
// importing it would change the file's import order. The numeric
// default of 0.5 matches the platform default and is fine for our
// two-state active/inactive chip.
