import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import {
  Stack,
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { CommunityPage, CommunityState } from "../ui";
import { apiClient } from "@/composition/api-client";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { InboxController, notificationDestinationPath } from "./controller";
import { invalidateCommunityReads } from "../state/read-cache";

const labels = {
  request: "New follow request",
  approval: "Follow request approved",
  reaction: "Someone cheered you on",
  moderation: "Community safety update",
};
export function CommunityInboxScreen() {
  const { session } = useAuth();
  return (
    <InboxContent
      key={session?.user.id ?? "signed-out"}
      principal={session?.user.id ?? null}
    />
  );
}
function InboxContent({ principal }: { principal: string | null }) {
  const theme = useTheme();
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const alive = useRef(true);
  const controller = useMemo(
    () => new InboxController(apiClient, principal, () => alive.current),
    [principal],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.reset();
    };
  }, [controller]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      let foreground = AppState.currentState === "active";
      if (AppState.currentState === "active") {
        controller.resume();
        void controller.load();
      } else controller.pause();
      const subscription = AppState.addEventListener("change", (value) => {
        if (!focused || foreground === (value === "active")) return;
        foreground = value === "active";
        controller.pause();
        if (value === "active") {
          controller.resume();
          void controller.load();
        }
      });
      return () => {
        focused = false;
        subscription.remove();
        controller.pause();
      };
    }, [controller]),
  );
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.action,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const open = async (id: string) => {
    const destination = await controller.open(id);
    if (!alive.current || !destination) return;
    const path = notificationDestinationPath(destination);
    if (path) router.push(path as Href);
  };
  return (
    <CommunityPage title="Updates">
      <Stack.Screen options={{ title: "Updates", headerShown: false }} />
      {notice === "read_unconfirmed" && (
        <ThemedText accessibilityLiveRegion="polite">
          The update was checked, but read status could not be saved. Refresh
          your updates and try again.
        </ThemedText>
      )}
      {notice === "unavailable" && (
        <ThemedText accessibilityLiveRegion="polite">
          That Community update is unavailable. This list shows currently
          accessible updates.
        </ThemedText>
      )}
      <ThemedText style={{ color: theme.textSecondary }}>
        You can read updates here without enabling phone notifications.
      </ThemedText>
      {action("Notification preferences", () =>
        router.push("/community/notifications" as Href),
      )}
      {action("Keep tracking privately", () => router.replace("/(tabs)"))}
      {principal ? (
        <>
          {action(
            state.busy ? "Checking updates…" : "Refresh updates",
            () => {
              invalidateCommunityReads();
              void controller.load();
            },
            state.busy,
          )}
          {state.error && (
            <ThemedText accessibilityLiveRegion="polite">
              {state.error}
            </ThemedText>
          )}
          {!state.busy && !state.error && state.items.length === 0 && (
            <CommunityState
              title="No Community updates"
              description="Follow requests, approvals, encouragement and safety updates will appear here."
            />
          )}
          {state.items.map((item) => (
            <View
              key={item.id}
              style={[
                styles.record,
                {
                  borderColor: theme.border,
                },
              ]}
            >
              <ThemedText>
                {item.readAt ? "Read" : "Unread"} ·{" "}
                {new Date(item.createdAt).toLocaleString()}
              </ThemedText>
              {action(labels[item.kind], () => void open(item.id), state.busy)}
            </View>
          ))}
          {state.nextCursor &&
            action(
              "Load more updates",
              () => void controller.load(true),
              state.busy,
            )}
        </>
      ) : (
        <ThemedText>Sign in to view your Community updates.</ThemedText>
      )}
    </CommunityPage>
  );
}
const styles = StyleSheet.create({
  action: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
    justifyContent: "center",
  },
  record: {
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
});
