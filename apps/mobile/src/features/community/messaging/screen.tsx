import { invalidateCommunityReads } from "../state/read-cache";
import { useAuth } from "@/features/auth/auth-context";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Stack,
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { communityMessagingResponseSchema } from "@mizyun/contracts";
import { useTheme } from "@/hooks/use-theme";
import { Button, Card } from "@/components/ui";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { ExpansionInput, useExpansionCommand } from "../expansions";
import {
  CommunityPage,
  CommunityButton as ExpansionButton,
  CommunityIdentityLink,
  CommunityRow,
  CommunityState,
} from "../ui";
import { apiClient } from "@/composition/api-client";
import { blockUser, humanizeCommunityError } from "../community-client";
import { scopeCommunityClient } from "../scoped-client";
import { ReportModal } from "../safety";

function CommunityMessagingScreenContent({
  initialPeer = null,
}: {
  initialPeer?: string | null;
}) {
  const state = useExpansionCommand(
    "/v1/community/messaging",
    communityMessagingResponseSchema,
  );
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [peer, setPeer] = useState<string | null>(initialPeer);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const [pending, setPending] = useState<{
    id: string;
    text: string;
    peerId: string;
  } | null>(null);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [settings, setSettings] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const actionLock = useRef<symbol | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const sendIntent = useRef<{
    id: string;
    text: string;
    peerId: string;
  } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [laterPage, setLaterPage] = useState(false);
  const [newMessage, setNewMessage] = useState(false);
  const loadChoices = useCallback(async () => {
    const result = await state.run({ operation: "preferences" });
    if (result?.enabled) await state.run({ operation: "threads" });
  }, [state.run]);
  useFocusEffect(
    useCallback(() => {
      const clear = () => {
        setPeer(initialPeer);
        setPrivacyMode(false);
        setSettings(false);
        setBlockBusy(false);
        setNotice(null);
        actionLock.current = null;
        setText("");
        setEditing(null);
        setPending(null);
        sendIntent.current = null;
        setReport(null);
        setLaterPage(false);
      };
      clear();
      if (initialPeer)
        void state.run({ operation: "latest", peerId: initialPeer });
      else void loadChoices();
      let foreground = AppState.currentState === "active";
      const sub = AppState.addEventListener("change", (next) => {
        if (foreground === (next === "active")) return;
        foreground = next === "active";
        clear();
      });
      return () => {
        sub.remove();
        clear();
      };
    }, [state.run, loadChoices, initialPeer]),
  );
  useEffect(() => {
    if (!state.data) {
      setReport(null);
      if (editing) {
        setEditing(null);
        setText("");
      }
    }
  }, [editing, state.data]);
  useEffect(() => {
    if (state.error?.startsWith("Refresh to check")) {
      setText("");
      setEditing(null);
      setPending(null);
      sendIntent.current = null;
    }
  }, [state.error]);
  useEffect(() => {
    if (state.authorityDenied) {
      setText("");
      setEditing(null);
      setPending(null);
      sendIntent.current = null;
      setReport(null);
      setPeer(null);
    }
  }, [state.authorityDenied]);
  const readConversation = (peerId: string) => {
    setLaterPage(false);
    return state.run({ operation: "latest", peerId });
  };
  const send = async () => {
    if (!peer || !text.trim() || state.busy || blockBusy || actionLock.current)
      return;
    if (editing) {
      if (
        !state.data?.messages?.some(
          (m) => m.id === editing.id && m.version === editing.version,
        )
      )
        return;
      const result = await state.run({
        operation: "edit",
        ...editing,
        text: text.trim(),
      });
      if (result) {
        setText("");
        setEditing(null);
        await readConversation(peer);
      }
      return;
    }
    // The same caller-bound operation and payload survive a lost response.
    const operation = sendIntent.current ?? {
      id: Crypto.randomUUID(),
      text: text.trim(),
      peerId: peer,
    };
    sendIntent.current = operation;
    setPending(operation);
    const result = await state.run({ operation: "send", ...operation });
    if (result) {
      setText("");
      setEditing(null);
      setPending(null);
      sendIntent.current = null;
      setNotice("Message sent.");
      await readConversation(peer);
    }
  };
  const listMine = () => {
    setPeer(null);
    setPrivacyMode(true);
    setSettings(false);
    setText("");
    setEditing(null);
    setPending(null);
    sendIntent.current = null;
    setReport(null);
    void state.run({ operation: "listMine" });
  };
  const blockPeer = () => {
    if (!peer || !state.principal || state.busy || actionLock.current) return;
    const target = peer,
      principal = state.principal,
      current = state.capture();
    Alert.alert(
      "Block this person?",
      "This ends both follow directions and removes conversation access for both people.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (!current() || actionLock.current) return;
              const actionToken = Symbol();
              actionLock.current = actionToken;
              setBlockBusy(true);
              setNotice(null);
              const response = await blockUser(
                scopeCommunityClient(apiClient, principal, current),
                target,
              );
              if (actionLock.current !== actionToken) return;
              actionLock.current = null;
              setBlockBusy(false);
              if (!current()) return;
              if (response.ok) {
                setPeer(null);
                setPrivacyMode(false);
                setText("");
                setEditing(null);
                setPending(null);
                sendIntent.current = null;
                setReport(null);
                invalidateCommunityReads();
                router.replace("/community/messages" as Href);
              } else setNotice(humanizeCommunityError(response.error));
            })();
          },
        },
      ],
    );
  };
  const backToChoices = () => {
    setPrivacyMode(false);
    setSettings(false);
    setText("");
    setEditing(null);
    setPending(null);
    sendIntent.current = null;
    setReport(null);
    void loadChoices();
  };
  const conversationUnavailable = !!initialPeer && !peer;
  const isRoot = !initialPeer && !peer && !privacyMode && !settings;
  const heading = conversationUnavailable
    ? "Conversation"
    : peer
      ? "Conversation"
      : privacyMode
        ? "My sent messages"
        : settings
          ? "Messaging settings"
          : "Messages";
  const newMessageDisabled =
    !state.principal ||
    state.busy ||
    !!state.error ||
    state.data?.enabled === false ||
    !state.data?.contacts;
  const visibleText =
    state.data?.messages ||
    (pending &&
      !state.authorityDenied &&
      !state.error?.startsWith("Refresh to check"))
      ? text
      : "";
  const composer = peer && (
    <View
      style={{
        padding: 16,
        paddingBottom: Math.max(insets.bottom, 16),
        borderTopWidth: 1,
        borderColor: t.border,
        gap: 8,
        backgroundColor: t.background,
      }}
    >
      {editing && (
        <ExpansionButton
          label="Cancel editing"
          disabled={state.busy || blockBusy}
          onPress={() => {
            setEditing(null);
            setText("");
          }}
        />
      )}
      <ExpansionInput
        label={editing ? "Edit your message" : "Message"}
        maxLength={1000}
        editable={
          !state.busy && !blockBusy && !pending && !!state.data?.messages
        }
        value={visibleText}
        onChange={(value) => {
          if (!pending) setText(value);
        }}
      />
      <Text style={{ color: t.textSecondary }}>
        {visibleText.length}/1,000 · Text only
      </Text>
      <ExpansionButton
        label={
          editing
            ? "Save message changes"
            : pending
              ? "Retry the same message"
              : "Send message"
        }
        tone="primary"
        disabled={
          state.busy ||
          blockBusy ||
          !visibleText.trim() ||
          (!pending && !state.data?.messages)
        }
        onPress={() => void send()}
      />
    </View>
  );
  return (
    <CommunityPage
      title={heading}
      destination={isRoot ? "messages" : undefined}
      backHref="/community/messages"
      scroll={false}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: t.background }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Stack.Screen options={{ title: heading, headerShown: false }} />
        <ScrollView
          ref={scrollRef}
          refreshControl={
            isRoot && state.principal ? (
              <RefreshControl
                refreshing={state.busy}
                tintColor={t.primary}
                onRefresh={() => {
                  invalidateCommunityReads();
                  void loadChoices();
                }}
              />
            ) : undefined
          }
          onContentSizeChange={() => {
            if (peer && state.data?.messages && !laterPage)
              scrollRef.current?.scrollToEnd({ animated: false });
          }}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: Spacing.two,
            gap: Spacing.three,
            width: "100%",
            maxWidth: MaxContentWidth,
            alignSelf: "center",
            paddingBottom: peer ? 24 : BottomTabInset + 24,
          }}
        >
          {isRoot && (
            // The segmented Community control already names this view, so
            // only the compose action sits above the list.
            <View style={styles.toolbar}>
              <Button
                variant="tinted"
                size="small"
                icon={newMessage ? "back" : "add"}
                label={newMessage ? "Conversations" : "New message"}
                accessibilityLabel={
                  newMessage ? "Back to conversations" : "New message"
                }
                disabled={newMessageDisabled}
                onPress={() => setNewMessage(!newMessage)}
              />
            </View>
          )}
          {!state.principal && (
            <CommunityState title="Sign in to use Messages" />
          )}
          {conversationUnavailable && (
            <CommunityState
              title="Conversation unavailable"
              description="Current access to this conversation is unavailable."
              action={
                <ExpansionButton
                  label="Back to Messages"
                  href="/community/messages"
                />
              }
            />
          )}
          {!isRoot && state.error && (
            <Text accessibilityRole="alert" style={{ color: t.text }}>
              {state.error}
            </Text>
          )}
          {notice && (
            <Text accessibilityRole="alert" style={{ color: t.text }}>
              {notice}
            </Text>
          )}
          {isRoot && (
            <>
              {state.principal &&
                (state.busy ? (
                  <CommunityState title="Checking messages…" busy />
                ) : state.error ? (
                  <CommunityState
                    title="Messages unavailable"
                    description={state.error}
                    action={
                      <ExpansionButton
                        label="Retry messages"
                        onPress={() => {
                          invalidateCommunityReads();
                          void loadChoices();
                        }}
                      />
                    }
                  />
                ) : state.data?.enabled === false ? (
                  <CommunityState
                    title="Messages are off"
                    description="Enable messages in Messaging settings to talk with mutual connections."
                  />
                ) : newMessage && state.data?.contacts ? (
                  <>
                    {state.data.contacts.length === 0 ? (
                      <CommunityState
                        title="No eligible contacts"
                        description="Both people must follow each other and enable messages."
                        action={
                          <ExpansionButton
                            label="Find people"
                            href="/community/relationships"
                          />
                        }
                      />
                    ) : (
                      <Card style={styles.list}>
                        <View style={styles.clipLastSeparator}>
                          {state.data.contacts.map((c) => (
                            <View key={c.userId} style={styles.listItem}>
                              <CommunityIdentityLink
                                userId={c.userId}
                                displayName={c.displayName}
                              />
                              <CommunityRow
                                title={`Message ${c.displayName}`}
                                onPress={() =>
                                  router.push(
                                    `/community/conversation/${c.userId}` as Href,
                                  )
                                }
                              />
                            </View>
                          ))}
                        </View>
                      </Card>
                    )}
                  </>
                ) : !newMessage && state.data?.threads ? (
                  <>
                    {state.data.threads.length === 0 ? (
                      <CommunityState
                        title="No conversations available"
                        description="Choose New message to start one. Messages expire after 90 days."
                      />
                    ) : (
                      <Card style={styles.list}>
                        <View style={styles.clipLastSeparator}>
                          {state.data.threads.map((thread) => (
                            <View key={thread.userId} style={styles.listItem}>
                              <CommunityIdentityLink
                                userId={thread.userId}
                                displayName={thread.displayName}
                              />
                              <CommunityRow
                                title={`Conversation with ${thread.displayName}`}
                                description={`${thread.latestMessage.deleted ? "Message removed" : (thread.latestMessage.text ?? "")} · ${new Date(thread.latestMessage.createdAt).toLocaleString()}`}
                                href={
                                  `/community/conversation/${thread.userId}` as Href
                                }
                              />
                            </View>
                          ))}
                        </View>
                      </Card>
                    )}
                    {state.data.nextBefore && (
                      <ExpansionButton
                        label="Next page of conversations"
                        onPress={() =>
                          void state.run({
                            operation: "threads",
                            before: state.data?.nextBefore,
                          })
                        }
                      />
                    )}
                  </>
                ) : (
                  <CommunityState title="Checking messages…" busy />
                ))}
              {/* Clip the last row's hairline so separators sit between rows. */}
              <Card style={styles.list}>
                <View style={styles.clipLastSeparator}>
                  <CommunityRow
                    title="Messaging settings"
                    description="Message permissions and update preferences"
                    disabled={!state.principal || blockBusy}
                    onPress={() => {
                      setSettings(true);
                      void state.run({ operation: "preferences" });
                    }}
                  />
                  <CommunityRow
                    title="Manage my sent messages"
                    description="View or remove messages you sent"
                    disabled={!state.principal || blockBusy}
                    onPress={listMine}
                  />
                </View>
              </Card>
            </>
          )}
          {!peer && settings && (
            <>
              <Text style={{ color: t.textSecondary }}>
                Both people must approve each other and enable messages.
                Messages are stored for up to 90 days and are not end-to-end
                encrypted. Removing your message removes it for both people.
              </Text>
              <ExpansionButton
                label="Back to messages"
                disabled={state.busy || blockBusy}
                onPress={backToChoices}
              />
              {typeof state.data?.enabled === "boolean" && (
                <Text style={{ color: t.text }}>
                  Messages: {state.data.enabled ? "on" : "off"}. Message
                  updates: {state.data.muted ? "muted" : "on"}.
                </Text>
              )}
              <ExpansionButton
                label={
                  state.data?.enabled
                    ? "Turn messages off"
                    : "Enable messages from mutual friends"
                }
                disabled={
                  state.busy || typeof state.data?.enabled !== "boolean"
                }
                onPress={() =>
                  void state.run({
                    operation: "preferences",
                    enabled: !state.data?.enabled,
                  })
                }
              />
              <ExpansionButton
                label={
                  state.data?.muted
                    ? "Receive message updates"
                    : "Mute message updates"
                }
                disabled={state.busy || typeof state.data?.muted !== "boolean"}
                onPress={() =>
                  void state.run({
                    operation: "preferences",
                    muted: !state.data?.muted,
                  })
                }
              />
              <Text style={{ color: t.textSecondary }}>
                Message-update muting applies to all conversations.
              </Text>
              <ExpansionButton
                label="Refresh messaging settings"
                disabled={state.busy}
                onPress={() => void state.run({ operation: "preferences" })}
              />
              <ExpansionButton
                label="Manage my sent messages"
                disabled={state.busy || blockBusy}
                onPress={listMine}
              />
            </>
          )}
          {privacyMode && (
            <>
              <Text style={{ color: t.textSecondary }}>
                Only your sent messages are shown. Remove them even after
                turning messages off or losing conversation access.
              </Text>
              <ExpansionButton
                label="Back to messages"
                disabled={state.busy || blockBusy}
                onPress={backToChoices}
              />
              <ExpansionButton
                label="Refresh my sent messages"
                disabled={state.busy}
                onPress={() => void state.run({ operation: "listMine" })}
              />
              {(state.data?.messages ?? [])
                .filter((m) => m.userId === state.principal)
                .map((m) => (
                  <View
                    key={m.id}
                    style={{
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderColor: t.border,
                      gap: 8,
                    }}
                  >
                    <Text selectable style={{ color: t.text }}>
                      {m.deleted ? "Message removed" : m.text}
                    </Text>
                    <Text style={{ color: t.textSecondary }}>
                      {new Date(m.createdAt).toLocaleString()}
                    </Text>
                    {!m.deleted && (
                      <ExpansionButton
                        label="Delete my message for both people"
                        disabled={state.busy || blockBusy}
                        onPress={() =>
                          Alert.alert(
                            "Delete this message?",
                            "This removes your message for both people. This cannot be undone.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Delete",
                                style: "destructive",
                                onPress: () =>
                                  void state
                                    .run({ operation: "delete", id: m.id })
                                    .then(
                                      (result) =>
                                        result &&
                                        state.run({ operation: "listMine" }),
                                    ),
                              },
                            ],
                          )
                        }
                      />
                    )}
                  </View>
                ))}
              {state.data?.messages?.length === 0 && (
                <Text style={{ color: t.textSecondary }}>
                  No sent messages are available.
                </Text>
              )}
              {state.data?.nextCursor && (
                <ExpansionButton
                  label="Next page of my sent messages"
                  disabled={state.busy || blockBusy}
                  onPress={() =>
                    void state.run({
                      operation: "listMine",
                      after: state.data?.nextCursor,
                    })
                  }
                />
              )}
            </>
          )}
          {peer && (
            <>
              {state.data?.peer && (
                <CommunityIdentityLink
                  userId={state.data.peer.userId}
                  displayName={state.data.peer.displayName}
                />
              )}
              <Text style={{ color: t.textSecondary }}>
                {laterPage
                  ? "Older messages · up to 50 per page."
                  : "Most recent messages · up to 50 per page."}{" "}
                Messages expire after 90 days.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <ExpansionButton
                  label="Refresh recent messages"
                  disabled={state.busy || blockBusy}
                  onPress={() => {
                    invalidateCommunityReads();
                    void readConversation(peer);
                  }}
                />
                <ExpansionButton
                  label="Block this person"
                  disabled={state.busy || blockBusy || !state.data?.messages}
                  onPress={blockPeer}
                />
              </View>
              {state.data?.messages?.map((m, index) => (
                <React.Fragment key={m.id}>
                  {(index === 0 ||
                    new Date(m.createdAt).toDateString() !==
                      new Date(
                        state.data!.messages![index - 1]!.createdAt,
                      ).toDateString()) && (
                    <Text
                      style={{
                        color: t.textSecondary,
                        textAlign: "center",
                        paddingVertical: 8,
                      }}
                    >
                      {new Date(m.createdAt).toLocaleDateString()}
                    </Text>
                  )}
                  <View
                    style={{
                      alignSelf:
                        m.userId === state.principal
                          ? "flex-end"
                          : "flex-start",
                      maxWidth: "90%",
                      gap: 6,
                    }}
                  >
                    <View
                      style={{
                        padding: 12,
                        borderRadius: 16,
                        backgroundColor:
                          m.userId === state.principal
                            ? t.primaryLight
                            : t.backgroundElement,
                      }}
                    >
                      <Text selectable style={{ color: t.text }}>
                        {m.deleted ? "Message removed" : m.text}
                      </Text>
                      <Text
                        style={{
                          color: t.textSecondary,
                          fontSize: 12,
                          marginTop: 6,
                        }}
                      >
                        {m.userId === state.principal
                          ? "You"
                          : state.data?.peer?.displayName || "Connection"}{" "}
                        · {new Date(m.createdAt).toLocaleString()}
                        {m.editedAt ? " · Edited" : ""}
                      </Text>
                    </View>
                    {!m.deleted &&
                      (m.userId === state.principal ? (
                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: 8,
                          }}
                        >
                          <ExpansionButton
                            label="Edit message"
                            disabled={state.busy || blockBusy || !!pending}
                            onPress={() => {
                              setEditing({ id: m.id, version: m.version });
                              setText(m.text ?? "");
                            }}
                          />
                          <ExpansionButton
                            label="Delete for both people"
                            disabled={state.busy || blockBusy}
                            onPress={() =>
                              Alert.alert(
                                "Delete this message?",
                                "This removes your message for both people. This cannot be undone.",
                                [
                                  { text: "Cancel", style: "cancel" },
                                  {
                                    text: "Delete",
                                    style: "destructive",
                                    onPress: () =>
                                      void state
                                        .run({ operation: "delete", id: m.id })
                                        .then(
                                          (result) =>
                                            result && readConversation(peer),
                                        ),
                                  },
                                ],
                              )
                            }
                          />
                        </View>
                      ) : (
                        <ExpansionButton
                          label="Report message"
                          disabled={state.busy || blockBusy}
                          onPress={() => setReport(m.id)}
                        />
                      ))}
                  </View>
                </React.Fragment>
              ))}
              {state.data?.nextBefore && (
                <ExpansionButton
                  label="Load older messages"
                  disabled={state.busy || blockBusy}
                  onPress={() => {
                    setEditing(null);
                    setText("");
                    setLaterPage(true);
                    void state.run({
                      operation: "latest",
                      peerId: peer,
                      before: state.data?.nextBefore,
                    });
                  }}
                />
              )}
              {state.data?.messages?.length === 0 && (
                <Text style={{ color: t.textSecondary }}>
                  {laterPage
                    ? "No further messages are available on this page."
                    : "No messages are available. Send a message to start the conversation."}
                </Text>
              )}
              {!state.data?.messages && (
                <Text style={{ color: t.textSecondary }}>
                  Refresh to check whether this conversation is available.
                </Text>
              )}
            </>
          )}
          {report && state.data?.messages?.some((m) => m.id === report) && (
            <ReportModal
              visible
              targetType="message"
              targetId={report}
              principalKey={state.principal}
              onClose={() => {
                setReport(null);
                setText("");
                setEditing(null);
                setPending(null);
                sendIntent.current = null;
                if (peer) void readConversation(peer);
              }}
            />
          )}
        </ScrollView>
        {composer}
      </KeyboardAvoidingView>
    </CommunityPage>
  );
}
export function CommunityMessagingScreen() {
  const { session } = useAuth();
  return (
    <CommunityMessagingScreenContent
      key={`${session?.user.id ?? "signed-out"}:${session?.accessToken ?? ""}`}
    />
  );
}
export function CommunityConversationScreen() {
  const { session } = useAuth();
  const { userId } = useLocalSearchParams<{ userId?: string | string[] }>();
  const peer =
    typeof userId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
      ? userId
      : null;
  if (!peer)
    return (
      <CommunityPage title="Conversation" backHref="/community/messages">
        <Stack.Screen options={{ headerShown: false }} />
        <CommunityState
          title="Conversation unavailable"
          description="This conversation link is unavailable. Return to Messages to check current choices."
        />
      </CommunityPage>
    );
  return (
    <CommunityMessagingScreenContent
      key={`${session?.user.id ?? "signed-out"}:${session?.accessToken ?? ""}:${peer ?? "unavailable"}`}
      initialPeer={peer}
    />
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  list: {
    paddingVertical: 0,
    overflow: "hidden",
  },
  listItem: {
    paddingTop: Spacing.two,
  },
  clipLastSeparator: {
    marginBottom: -StyleSheet.hairlineWidth,
  },
});
