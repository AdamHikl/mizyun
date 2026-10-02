import { invalidateCommunityReads } from "../state/read-cache";
import { useAuth } from "@/features/auth/auth-context";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import { communityMessagingResponseSchema } from "@mizyun/contracts";
import { useTheme } from "@/hooks/use-theme";
import { CommunityIntro } from "../community-presentation";
import {
  ExpansionButton,
  ExpansionInput,
  useExpansionCommand,
} from "../expansions";
import { apiClient } from "@/composition/api-client";
import { blockUser, humanizeCommunityError } from "../community-client";
import { scopeCommunityClient } from "../scoped-client";
import { ReportModal } from "../safety";
function CommunityMessagingScreenContent() {
  const state = useExpansionCommand(
    "/v1/community/messaging",
    communityMessagingResponseSchema,
  );
  const t = useTheme();
  const [peer, setPeer] = useState<string | null>(null);
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
  const [blockBusy, setBlockBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const actionLock = useRef<symbol | null>(null);
  const sendIntent = useRef<{
    id: string;
    text: string;
    peerId: string;
  } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      setPeer(null);
      setPrivacyMode(false);
      setBlockBusy(false);
      setNotice(null);
      actionLock.current = null;
      setText("");
      setEditing(null);
      setPending(null);
      sendIntent.current = null;
      void state.run({ operation: "preferences" });
      let foreground = AppState.currentState === "active";
      const sub = AppState.addEventListener("change", (next) => {
        if (foreground === (next === "active")) return;
        foreground = next === "active";
        setPeer(null);
        setPrivacyMode(false);
        setBlockBusy(false);
        setNotice(null);
        actionLock.current = null;
        setText("");
        setEditing(null);
        setPending(null);
        sendIntent.current = null;
        setReport(null);
      });
      return () => {
        sub.remove();
        setPeer(null);
        setPrivacyMode(false);
        setBlockBusy(false);
        setNotice(null);
        actionLock.current = null;
        setText("");
        setEditing(null);
        setPending(null);
        sendIntent.current = null;
        setReport(null);
      };
    }, [state.run]),
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
  const send = async () => {
    if (!peer || !text.trim() || state.busy || actionLock.current) return;
    if (editing) {
      if (
        !state.data?.messages?.some(
          (message) =>
            message.id === editing.id && message.version === editing.version,
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
        await state.run({ operation: "list", peerId: peer });
      }
      return;
    }
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
      await state.run({ operation: "list", peerId: peer });
    }
  };
  const listMine = () => {
    setPeer(null);
    setPrivacyMode(true);
    setText("");
    setEditing(null);
    setPending(null);
    sendIntent.current = null;
    setReport(null);
    void state.run({ operation: "listMine" });
  };
  const blockPeer = () => {
    if (!peer || !state.principal || state.busy || actionLock.current) return;
    const target = peer;
    const principal = state.principal;
    const current = state.capture();
    Alert.alert(
      "Block this friend?",
      "Both people lose access to this conversation. This also removes your follow relationship.",
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
                setNotice(
                  "Friend blocked. Manage blocks in Community safety lists.",
                );
                await state.run({ operation: "preferences" });
              } else setNotice(humanizeCommunityError(response.error));
            })();
          },
        },
      ],
    );
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: t.background }}
        contentContainerStyle={{
          padding: 20,
          gap: 16,
          backgroundColor: t.background,
        }}
      >
        <Stack.Screen options={{ title: "Messages" }} />
        <CommunityIntro
          icon="💬"
          title="Talk with a friend"
          description="Text only. Both friends approve each other and enable messages. Messages are stored by Mizyun for up to 90 days; they are not end-to-end encrypted. Delete removes your message for both people."
        />
        {state.error && (
          <Text accessibilityRole="alert" style={{ color: t.text }}>
            {state.error}
          </Text>
        )}
        {notice && (
          <Text accessibilityRole="alert" style={{ color: t.text }}>
            {notice}
          </Text>
        )}
        <ExpansionButton
          label="Manage my sent messages"
          disabled={state.busy || blockBusy}
          onPress={listMine}
        />
        {!peer && !privacyMode && (
          <>
            <ExpansionButton
              label="Refresh message choices"
              disabled={state.busy || blockBusy}
              onPress={() => {
                invalidateCommunityReads();
                void state.run({ operation: "preferences" });
              }}
            />
            {typeof state.data?.enabled === "boolean" && (
              <Text style={{ color: t.text }}>
                Messages: {state.data.enabled ? "on" : "off"}. Updates:{" "}
                {state.data.muted ? "muted" : "on"}.
              </Text>
            )}
            <ExpansionButton
              label="Enable messages from mutual friends"
              disabled={state.busy || blockBusy}
              onPress={() =>
                void state.run({ operation: "preferences", enabled: true })
              }
            />
            <ExpansionButton
              label="Turn messages off"
              disabled={state.busy || blockBusy}
              onPress={() =>
                void state.run({ operation: "preferences", enabled: false })
              }
            />
            <ExpansionButton
              label="Mute message updates"
              disabled={state.busy || blockBusy}
              onPress={() =>
                void state.run({ operation: "preferences", muted: true })
              }
            />
            <ExpansionButton
              label="Receive message updates"
              disabled={state.busy || blockBusy}
              onPress={() =>
                void state.run({ operation: "preferences", muted: false })
              }
            />
            <ExpansionButton
              label="Find mutual friends who enabled messages"
              disabled={state.busy || blockBusy}
              onPress={() => void state.run({ operation: "contacts" })}
            />
            {state.data?.contacts?.length === 0 && (
              <Text style={{ color: t.textSecondary }}>
                No mutual friends currently have messages enabled.
              </Text>
            )}
            {state.data?.contacts?.map((c) => (
              <ExpansionButton
                key={c.userId}
                label={c.displayName}
                disabled={state.busy || blockBusy}
                onPress={() => {
                  setPrivacyMode(false);
                  setPeer(c.userId);
                  void state.run({ operation: "list", peerId: c.userId });
                }}
              />
            ))}
          </>
        )}
        {privacyMode && (
          <>
            <Text style={{ color: t.text }}>
              Only your sent messages are shown here. You can remove them even
              when messaging is unavailable or a friendship has ended.
            </Text>
            <ExpansionButton
              label="Back to message choices"
              disabled={state.busy || blockBusy}
              onPress={() => {
                setPrivacyMode(false);
                void state.run({ operation: "preferences" });
              }}
            />
            {(state.data?.messages ?? [])
              .filter((message) => message.userId === state.principal)
              .map((message) => (
                <View key={message.id} style={{ gap: 8 }}>
                  <Text style={{ color: t.text }}>
                    {message.deleted ? "Message removed" : message.text}
                  </Text>
                  {!message.deleted && (
                    <ExpansionButton
                      label="Delete my message for both people"
                      disabled={state.busy || blockBusy}
                      onPress={() =>
                        void state
                          .run({ operation: "delete", id: message.id })
                          .then(
                            (result) =>
                              result && state.run({ operation: "listMine" }),
                          )
                      }
                    />
                  )}
                </View>
              ))}
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
            <ExpansionButton
              label="Back to message choices"
              disabled={state.busy || blockBusy}
              onPress={() => {
                setPeer(null);
                setText("");
                setEditing(null);
                setPending(null);
                sendIntent.current = null;
                void state.run({ operation: "preferences" });
              }}
            />
            <ExpansionButton
              label="Block this friend"
              disabled={state.busy || blockBusy}
              onPress={blockPeer}
            />
            <ExpansionButton
              label="Refresh conversation"
              disabled={state.busy || blockBusy}
              onPress={() => {
                invalidateCommunityReads();
                void state.run({ operation: "list", peerId: peer });
              }}
            />
            {state.data?.messages?.map((m) => (
              <View
                key={m.id}
                style={{
                  gap: 8,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: t.border,
                  borderRadius: 12,
                }}
              >
                <Text style={{ color: t.text }}>
                  {m.userId === state.principal ? "You" : "Friend"}:{" "}
                  {m.deleted ? "Message removed" : m.text}
                </Text>
                {!m.deleted &&
                  (m.userId === state.principal ? (
                    <>
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
                          void state
                            .run({ operation: "delete", id: m.id })
                            .then(
                              (result) =>
                                result &&
                                state.run({ operation: "list", peerId: peer }),
                            )
                        }
                      />
                    </>
                  ) : (
                    <ExpansionButton
                      label="Report message"
                      disabled={state.busy || blockBusy}
                      onPress={() => setReport(m.id)}
                    />
                  ))}
              </View>
            ))}
            {state.data?.nextCursor && (
              <ExpansionButton
                label="More messages"
                disabled={state.busy || blockBusy}
                onPress={() =>
                  void state.run({
                    operation: "list",
                    peerId: peer,
                    after: state.data?.nextCursor,
                  })
                }
              />
            )}
            {state.data?.messages?.length === 0 && (
              <Text style={{ color: t.textSecondary }}>
                No messages yet. Send a message to start the conversation.
              </Text>
            )}
            <ExpansionInput
              label={editing ? "Edit your message" : "Message"}
              editable={!state.busy && !blockBusy && !pending}
              value={editing && !state.data ? "" : text}
              onChange={(value) => {
                if (!pending) setText(value);
              }}
            />
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
            <ExpansionButton
              label={
                editing
                  ? "Save message changes"
                  : pending
                    ? "Retry the same message"
                    : "Send message"
              }
              disabled={state.busy || blockBusy || !text.trim()}
              onPress={() => void send()}
            />
          </>
        )}
        {report &&
          state.data?.messages?.some((message) => message.id === report) && (
            <ReportModal
              visible
              targetType="message"
              targetId={report}
              principalKey={state.principal}
              onClose={() => setReport(null)}
            />
          )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function CommunityMessagingScreen() {
  const { session } = useAuth();
  return (
    <CommunityMessagingScreenContent key={session?.user.id ?? "signed-out"} />
  );
}
