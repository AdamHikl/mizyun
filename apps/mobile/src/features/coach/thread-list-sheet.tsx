/**
 * AI-MOB-002 — Thread list sheet.
 *
 * Single-screen layout: the main Coach screen hosts the active
 * thread. Tapping the header title opens this sheet to switch
 * threads or start a new one. The sheet renders each
 * conversation as a tappable row with title + preview + relative
 * timestamp. The active row carries a checkmark and the selected
 * accessibility state so the user always knows which thread they're in.
 */

import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button, Icon, ListGroup, ListRow } from "@/components/ui";
import { MaxContentWidth, PageGutter, Spacing } from "@/constants/theme";

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
      style={styles.overlay}
      accessibilityViewIsModal
    >
      <SafeAreaView
        style={styles.safeArea}
        edges={["top", "bottom", "left", "right"]}
      >
        <View style={styles.header}>
          <ThemedText
            type="subtitle"
            accessibilityRole="header"
            style={styles.title}
          >
            Conversations
          </ThemedText>
          <Button
            label="Close"
            variant="plain"
            size="small"
            accessibilityLabel="Close thread list"
            onPress={onClose}
          />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {conversations.length === 0 ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.empty}
            >
              No conversations yet. Start one below.
            </ThemedText>
          ) : (
            <ListGroup>
              {conversations.map((conversation) => {
                const isActive = conversation.id === activeId;
                const title = conversation.title ?? "Coach check-in";
                const preview = formatPreviewWindow(
                  conversation,
                  messagesByConversation,
                );
                const timestamp = relativeLabel(conversation.updatedAt, now);
                return (
                  <ListRow
                    key={conversation.id}
                    title={title}
                    subtitle={preview === title ? undefined : preview}
                    value={timestamp}
                    trailing={
                      isActive ? (
                        <Icon name="check" size={17} color="primary" />
                      ) : undefined
                    }
                    accessibilityLabel={`Open ${title}, last activity ${timestamp}`}
                    accessibilityState={{ selected: isActive }}
                    onPress={() => onSelect(conversation.id)}
                  />
                );
              })}
            </ListGroup>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <Button
            label="New conversation"
            icon="add"
            block
            accessibilityLabel="Start a new conversation"
            onPress={onNew}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  safeArea: { flex: 1 },
  header: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: { flexShrink: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  empty: { paddingVertical: Spacing.four },
  footer: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingVertical: Spacing.three,
  },
});
