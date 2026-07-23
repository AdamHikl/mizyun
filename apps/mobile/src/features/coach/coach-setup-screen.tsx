import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  CoachConversation,
  CoachMessage,
  CoachProviderStatus,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  BottomTabInset,
  Colors,
  MaxContentWidth,
  Spacing,
} from "@/constants/theme";

import {
  createCoachConversation,
  deleteCoachConversation,
  loadCoach,
  loadCoachThread,
  sendCoachMessage,
} from "./coach-data";

export function CoachSetupScreen() {
  const [status, setStatus] = useState<CoachProviderStatus | null>(null);
  const [conversations, setConversations] = useState<
    readonly CoachConversation[]
  >([]);
  const [active, setActive] = useState<CoachConversation | null>(null);
  const [messages, setMessages] = useState<readonly CoachMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadCoach();
    if (!result.ok) {
      setMessage(result.message);
      setLoading(false);
      return;
    }
    setStatus(result.status);
    setConversations(result.conversations);
    setMessage(null);
    if (result.status.ready && result.conversations[0]) {
      const thread = await loadCoachThread(result.conversations[0].id);
      if (thread.ok) {
        setActive(thread.conversation);
        setMessages(thread.messages);
      } else {
        setMessage(thread.message);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() =>
        scrollRef.current?.scrollToEnd({ animated: true }),
      );
    }
  }, [messages]);

  const create = useCallback(async () => {
    setLoading(true);
    const result = await createCoachConversation();
    if (result.ok) {
      setActive(result.conversation);
      setMessages([]);
      setConversations((current) => [result.conversation, ...current]);
      setMessage(null);
    } else {
      setMessage(result.message);
    }
    setLoading(false);
  }, []);

  const send = useCallback(async () => {
    if (!active || draft.trim().length === 0 || sending) return;
    const text = draft.trim();
    setDraft("");
    setSending(true);
    setMessage(null);
    const result = await sendCoachMessage(active.id, text);
    if (result.ok) {
      setActive(result.conversation);
      setMessages((current) => [...current, ...result.messages]);
    } else {
      setDraft(text);
      setMessage(result.message);
    }
    setSending(false);
  }, [active, draft, sending]);

  const remove = useCallback(() => {
    if (!active) return;
    Alert.alert(
      "Delete conversation?",
      "This permanently deletes the conversation and its messages.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const result = await deleteCoachConversation(active.id);
              if (!result.ok) return setMessage(result.message);
              setActive(null);
              setMessages([]);
              setConversations((current) =>
                current.filter((item) => item.id !== active.id),
              );
            })();
          },
        },
      ],
    );
  }, [active]);

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <KeyboardAvoidingView
          style={styles.safeArea}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.header}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  status?.ready ? styles.readyDot : styles.disabledDot,
                ]}
              />
              <ThemedText type="smallBold">
                {status?.ready
                  ? `${status.provider} · ${status.model ?? "configured model"}`
                  : "AI access disabled"}
              </ThemedText>
            </View>
            <ThemedText type="subtitle">Coach</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              AI can be wrong. Mizyun uses confirmed records for general fitness
              and nutrition wellness—not diagnosis or treatment.
            </ThemedText>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Loading Coach…
              </ThemedText>
            </View>
          ) : status !== null && !status.ready ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Coach is safely off</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {status.reason}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refresh()}
                style={styles.secondaryButton}
              >
                <ThemedText type="smallBold">Check again</ThemedText>
              </Pressable>
            </ThemedView>
          ) : active === null ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Start a private check-in</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Coach can explain your confirmed goal, meals, training, and
                weight trend. It cannot change those records.
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => void create()}
                style={styles.primaryButton}
              >
                <ThemedText type="smallBold">New conversation</ThemedText>
              </Pressable>
            </ThemedView>
          ) : (
            <>
              <View style={styles.threadHeader}>
                <ThemedText type="smallBold">
                  {active.title ?? "Coach check-in"}
                </ThemedText>
                <Pressable accessibilityRole="button" onPress={remove}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Delete
                  </ThemedText>
                </Pressable>
              </View>
              <ScrollView
                ref={scrollRef}
                style={styles.thread}
                contentContainerStyle={styles.threadContent}
                keyboardShouldPersistTaps="handled"
              >
                {messages.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Ask about today’s confirmed nutrition, recent training,
                    active goal, or weight trend.
                  </ThemedText>
                ) : (
                  messages.map((item) => (
                    <MessageBubble key={item.id} message={item} />
                  ))
                )}
                {sending ? (
                  <View style={styles.pendingRow}>
                    <ActivityIndicator size="small" />
                    <ThemedText type="small" themeColor="textSecondary">
                      Reviewing confirmed records…
                    </ThemedText>
                  </View>
                ) : null}
              </ScrollView>
              {message ? (
                <View style={styles.alert} accessibilityRole="alert">
                  <ThemedText type="small">{message}</ThemedText>
                </View>
              ) : null}
              <View style={styles.composer}>
                <TextInput
                  accessibilityLabel="Message Coach"
                  multiline
                  maxLength={4_000}
                  placeholder="Ask about your confirmed progress…"
                  placeholderTextColor="#7B7B82"
                  value={draft}
                  onChangeText={setDraft}
                  style={styles.input}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: sending || draft.trim().length === 0,
                  }}
                  disabled={sending || draft.trim().length === 0}
                  onPress={() => void send()}
                  style={[
                    styles.sendButton,
                    (sending || draft.trim().length === 0) &&
                      styles.disabledButton,
                  ]}
                >
                  <ThemedText type="smallBold">Send</ThemedText>
                </Pressable>
              </View>
            </>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function MessageBubble({ message }: { readonly message: CoachMessage }) {
  const assistant = message.role === "assistant";
  return (
    <View
      style={[
        styles.bubble,
        assistant ? styles.assistantBubble : styles.userBubble,
      ]}
    >
      <ThemedText type="smallBold">
        {assistant ? "Mizyun Coach" : "You"}
      </ThemedText>
      <ThemedText>{message.text}</ThemedText>
      {assistant && message.evidenceKinds.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Used confirmed: {message.evidenceKinds.join(", ")}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  readyDot: { backgroundColor: "#2F9E69" },
  disabledDot: { backgroundColor: "#E8A230" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
  },
  card: {
    margin: Spacing.four,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Spacing.three,
    backgroundColor: "#3D7BFF",
    paddingHorizontal: Spacing.four,
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#7B7B82",
  },
  threadHeader: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  thread: { flex: 1 },
  threadContent: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.four,
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  bubble: {
    maxWidth: "90%",
    padding: Spacing.three,
    borderRadius: Spacing.four,
    gap: Spacing.two,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#315FAF",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: Colors.dark.backgroundElement,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  alert: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    borderLeftWidth: 3,
    borderLeftColor: "#E8A230",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  composer: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#7B7B82",
    color: "#F2F2F4",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  sendButton: {
    minWidth: 72,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Spacing.three,
    backgroundColor: "#3D7BFF",
  },
  disabledButton: { opacity: 0.45 },
});
