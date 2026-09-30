import { useFocusEffect } from "expo-router";
import React, {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  AppState,
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { useCommunityProfile } from "../use-community-profile";
import {
  RelationshipsController,
  type RelationshipList,
  type RelationshipRow,
  type RelationshipAction,
} from "./controller";

const lists: ReadonlyArray<{ key: RelationshipList; label: string }> = [
  { key: "incoming", label: "Requests for you" },
  { key: "outgoing", label: "Requests you sent" },
  { key: "followers", label: "Your followers" },
  { key: "following", label: "You follow" },
  { key: "blocked", label: "Blocked" },
  { key: "muted", label: "Muted" },
];
export function RelationshipsScreen() {
  const { session, profile } = useAuth();
  return (
    <OwnerRelationships
      key={session?.user.id ?? "signed-out"}
      principalKey={session?.user.id ?? null}
      birthYear={profile?.birthYear}
    />
  );
}
function OwnerRelationships({
  principalKey,
  birthYear,
}: {
  principalKey: string | null;
  birthYear?: number | null;
}) {
  const colors = useTheme();
  const community = useCommunityProfile({ principalKey, birthYear });
  const alive = useRef(true);
  const controller = useMemo(
    () =>
      new RelationshipsController(apiClient, principalKey, () => alive.current),
    [principalKey],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const enrolled = useRef(community.isEnrolled);
  enrolled.current = community.isEnrolled;
  const reload = useCallback(() => {
    if (!focused.current || !foreground.current) return;
    alive.current = true;
    controller.resume();
    const list = controller.getState().list;
    if (enrolled.current || list === "blocked" || list === "muted")
      void controller.load(list);
  }, [controller]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      reload();
      return () => {
        focused.current = false;
        alive.current = false;
        controller.pause();
      };
    }, [controller, reload]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      foreground.current = next === "active";
      if (next !== "active") {
        alive.current = false;
        controller.pause();
      } else reload();
    });
    return () => subscription.remove();
  }, [controller, reload]);
  useEffect(() => {
    controller.pause();
    reload();
  }, [controller, reload, community.isEnrolled, community.profile?.generation]);
  const enabled =
    community.isEnrolled || state.list === "blocked" || state.list === "muted";
  const busy = state.loading || state.pending;
  const button = (label: string, onPress: () => void, disabled = busy) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[
        styles.button,
        { borderColor: colors.border, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Text style={{ color: colors.text }}>{label}</Text>
    </Pressable>
  );
  const confirm = (action: RelationshipAction, row: RelationshipRow) => {
    const explanations: Partial<Record<RelationshipAction, string>> = {
      approve:
        "They can see your still-published workout cards, including past cards. This does not follow them back.",
      block:
        "Blocks interaction in both directions and removes both follows and pending requests. Unblocking restores nothing.",
      remove:
        "Removes their access to your shared workouts and prior interactions.",
      unfollow:
        "Stops following this person and ends your access to their shared workouts.",
      unblock: "Previous follows and requests will not be restored.",
    };
    const message = explanations[action];
    if (!message) {
      void controller.act(action, row);
      return;
    }
    Alert.alert(
      `${action === "approve" ? "Approve" : action === "remove" ? "Remove follower" : action === "unfollow" ? "Unfollow" : action === "block" ? "Block" : "Unblock"} @${row.user.handle}?`,
      message,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            if (alive.current) void controller.act(action, row);
          },
        },
      ],
    );
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: colors.text }]}>Your friends</Text>
      <Text style={{ color: colors.textSecondary }}>
        Following is directional. Approval lets that person see your shared
        cards; it does not follow them back. Muting changes your feed
        preference, without changing access.
      </Text>
      {!community.isEnrolled && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {community.error ??
            "Join Mizyun Friends to manage follows. Your safety lists stay available."}
        </Text>
      )}
      <View style={styles.wrap}>
        {lists.map((list) =>
          button(
            list.label,
            () => void controller.load(list.key),
            busy ||
              (!community.isEnrolled &&
                list.key !== "blocked" &&
                list.key !== "muted"),
          ),
        )}
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        {lists.find((list) => list.key === state.list)?.label}
      </Text>
      {state.notice && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {state.notice}
        </Text>
      )}
      {state.error && (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {state.error}
        </Text>
      )}
      {state.loading && (
        <ActivityIndicator
          accessibilityLabel="Loading your friends"
          color={colors.primary}
        />
      )}
      {enabled && button("Refresh", () => void controller.load(), busy)}
      {enabled && !busy && !state.error && state.rows.length === 0 && (
        <Text style={{ color: colors.textSecondary }}>
          No people in this list.
        </Text>
      )}
      {enabled &&
        state.rows.map((row) => (
          <View
            key={row.user.userId}
            style={[styles.card, { backgroundColor: colors.backgroundElement }]}
          >
            <Text style={{ color: colors.text, fontSize: 18 }}>
              {row.user.displayName}
            </Text>
            <Text style={{ color: colors.textSecondary }}>
              @{row.user.handle}
            </Text>
            <View style={styles.wrap}>
              {state.list === "incoming" && [
                button("Approve", () => confirm("approve", row)),
                button("Decline", () => confirm("decline", row)),
              ]}
              {state.list === "outgoing" &&
                button("Cancel request", () => confirm("cancel", row))}
              {state.list === "followers" &&
                button("Remove follower", () => confirm("remove", row))}
              {state.list === "following" && [
                button("Unfollow", () => confirm("unfollow", row)),
                button("Mute", () => confirm("mute", row)),
              ]}
              {state.list === "muted" &&
                button("Unmute", () => confirm("unmute", row))}
              {state.list === "blocked"
                ? button("Unblock", () => confirm("unblock", row))
                : button("Block", () => confirm("block", row))}
            </View>
          </View>
        ))}
      {state.cursor &&
        button("Load more", () => void controller.load(state.list, true))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: "600" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: "center",
  },
  card: { padding: 16, borderRadius: 14, gap: 8 },
});
