import { useAuth } from "@/features/auth/auth-context";
import React, { useCallback, useRef, useState } from "react";
import { Alert, AppState, ScrollView, Text } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { communityBroaderDiscoveryResponseSchema } from "@mizyun/contracts";
import * as Crypto from "expo-crypto";
import { apiClient } from "@/composition/api-client";
import { requestFollow, humanizeCommunityError } from "../community-client";
import { scopeCommunityClient } from "../scoped-client";
import { useTheme } from "@/hooks/use-theme";
import { CommunityIntro } from "../community-presentation";
import {
  ExpansionButton,
  ExpansionInput,
  useExpansionCommand,
} from "../expansions";
function CommunityBroaderDiscoveryScreenContent() {
  const state = useExpansionCommand(
    "/v1/community/broader-discovery",
    communityBroaderDiscoveryResponseSchema,
  );
  const t = useTheme();
  const [prefix, setPrefix] = useState("");
  const [followBusy, setFollowBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pendingFollow = useRef<{ userId: string; operationId: string } | null>(
    null,
  );
  const actionLock = useRef<symbol | null>(null);
  useFocusEffect(
    useCallback(() => {
      setPrefix("");
      setMessage(null);
      setFollowBusy(false);
      pendingFollow.current = null;
      actionLock.current = null;
      void state.run({ operation: "preferences" });
      const sub = AppState.addEventListener("change", () => {
        setPrefix("");
        setMessage(null);
        setFollowBusy(false);
        pendingFollow.current = null;
        actionLock.current = null;
      });
      return () => {
        sub.remove();
        setPrefix("");
        setMessage(null);
        setFollowBusy(false);
        pendingFollow.current = null;
        actionLock.current = null;
      };
    }, [state.run]),
  );
  const follow = (userId: string, handle: string) => {
    if (state.busy || followBusy || actionLock.current || !state.principal)
      return;
    const current = state.capture();
    const principal = state.principal;
    Alert.alert(
      `Request to follow @${handle}?`,
      "They choose whether to approve your request. This does not share your diary.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send request",
          onPress: () => {
            void (async () => {
              if (!current() || actionLock.current) return;
              const actionToken = Symbol();
              actionLock.current = actionToken;
              setFollowBusy(true);
              setMessage(null);
              const intent =
                pendingFollow.current?.userId === userId
                  ? pendingFollow.current
                  : { userId, operationId: Crypto.randomUUID() };
              pendingFollow.current = intent;
              const response = await requestFollow(
                scopeCommunityClient(apiClient, principal, current),
                userId,
                undefined,
                intent.operationId,
              );
              if (actionLock.current !== actionToken) return;
              actionLock.current = null;
              setFollowBusy(false);
              if (!current()) return;
              if (response.ok) {
                pendingFollow.current = null;
                setMessage(
                  response.value.status === "approved"
                    ? "You already follow this person."
                    : "Follow request sent. They choose whether to approve it.",
                );
              } else setMessage(humanizeCommunityError(response.error));
            })();
          },
        },
      ],
    );
  };
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        gap: 16,
        backgroundColor: t.background,
      }}
    >
      <Stack.Screen options={{ title: "Discover friends" }} />
      <CommunityIntro
        icon="👋"
        title="A wider search, by choice"
        description="Let admitted Community members find your handle from three or more characters. This adds no public cards and never uploads your contacts. Your existing posts still need approved followers."
      />
      {state.error && (
        <Text accessibilityRole="alert" style={{ color: t.text }}>
          {state.error}
        </Text>
      )}
      {message && (
        <Text accessibilityRole="alert" style={{ color: t.text }}>
          {message}
        </Text>
      )}
      <Text style={{ color: t.text }}>
        Handle prefix discovery:{" "}
        {state.data?.enabled ? "on" : "off or not loaded"}
      </Text>
      <ExpansionButton
        label="Let members find my handle prefix"
        disabled={state.busy || followBusy}
        onPress={() =>
          void state.run({ operation: "preferences", enabled: true })
        }
      />
      <ExpansionButton
        label="Turn prefix discovery off"
        disabled={state.busy || followBusy}
        onPress={() =>
          void state.run({ operation: "preferences", enabled: false })
        }
      />
      <ExpansionInput
        label="First characters of a friend's handle"
        value={prefix}
        onChange={setPrefix}
        maxLength={24}
      />
      <ExpansionButton
        label="Search consenting members"
        disabled={state.busy || followBusy || prefix.trim().length < 3}
        onPress={() =>
          void state.run({
            operation: "search",
            prefix: prefix.trim().toLowerCase(),
          })
        }
      />
      {state.data?.profiles?.map((p) => (
        <ExpansionButton
          key={p.userId}
          label={`Request to follow @${p.handle} · ${p.displayName}`}
          disabled={state.busy || followBusy}
          onPress={() => follow(p.userId, p.handle)}
        />
      ))}
    </ScrollView>
  );
}

export function CommunityBroaderDiscoveryScreen() {
  const { session } = useAuth();
  return (
    <CommunityBroaderDiscoveryScreenContent
      key={session?.user.id ?? "signed-out"}
    />
  );
}
