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
            borderBottomColor: Colors.dark.backgroundElement,
            borderBottomWidth: 1,
          }}
        >
          <ThemedText type="subtitle">Coach conversations</ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close thread list"
            onPress={onClose}
            hitSlop={8}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText type="smallBold" themeColor="textSecondary">
              Close
            </ThemedText>
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
                  style={{
                    borderRadius: Spacing.three,
                    padding: Spacing.three,
                    backgroundColor: Colors.dark.backgroundElement,
                    borderWidth: isActive ? 2 : 0.5,
                    borderColor: isActive
                      ? Colors.dark.text
                      : Colors.dark.backgroundElement,
                    gap: Spacing.one,
                    minHeight: 64,
                  }}
                >
                  <ThemedText type="smallBold">
                    {conversation.title ?? "Coach check-in"}
                  </ThemedText>
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
            borderTopColor: Colors.dark.backgroundElement,
            borderTopWidth: 1,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new conversation"
            onPress={onNew}
            style={{
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: Spacing.three,
              backgroundColor: "#3D7BFF",
            }}
          >
            <ThemedText type="smallBold">New conversation</ThemedText>
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
