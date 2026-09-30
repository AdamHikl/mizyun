import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  Stack,
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { apiClient } from "@/composition/api-client";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { InboxController, notificationDestinationPath } from "./controller";

const labels = {
  request: "A follow request was received",
  approval: "A follow request was approved",
  reaction: "An encouragement was received",
  moderation: "A Community safety update is available",
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
      if (AppState.currentState === "active") {
        controller.resume();
        void controller.load();
      } else controller.pause();
      const subscription = AppState.addEventListener("change", (value) => {
        if (!focused) return;
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
      style={[styles.action, { borderColor: theme.border }]}
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
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: "Community inbox" }} />
      <ThemedText type="subtitle">Community inbox</ThemedText>
      {notice === "read_unconfirmed" && (
        <ThemedText accessibilityLiveRegion="polite">
          The update was checked, but read status could not be saved. Refresh
          your inbox and try again.
        </ThemedText>
      )}
      {notice === "unavailable" && (
        <ThemedText accessibilityLiveRegion="polite">
          That Community update is unavailable. Your inbox shows currently
          accessible updates.
        </ThemedText>
      )}
      <ThemedText>
        Updates are shown after checking current access. No device notification
        permission is needed.
      </ThemedText>
      {action("Notification preferences", () =>
        router.push("/community/notifications" as Href),
      )}
      {action("Keep tracking privately", () => router.replace("/(tabs)"))}
      {principal ? (
        <>
          {action(
            state.busy ? "Checking updates…" : "Refresh inbox",
            () => void controller.load(),
            state.busy,
          )}
          {state.error && (
            <ThemedText accessibilityLiveRegion="polite">
              {state.error}
            </ThemedText>
          )}
          {!state.busy && !state.error && state.items.length === 0 && (
            <ThemedText>No Community updates.</ThemedText>
          )}
          {state.items.map((item) => (
            <View key={item.id} style={styles.record}>
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
        <ThemedText>Sign in to view your Community inbox.</ThemedText>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  action: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    justifyContent: "center",
  },
  record: { gap: 8 },
});
