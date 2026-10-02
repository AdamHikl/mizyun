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
import { MaxContentWidth } from "@/constants/theme";
import { CommunityIntro, useCommunityPalette } from "../community-presentation";
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
  const palette = useCommunityPalette();
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
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: "Community inbox" }} />
      <CommunityIntro
        icon="💬"
        title="Your Community inbox"
        description="Follow requests, little cheers and important updates, all in one place."
        tone="blue"
      />
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
            state.busy ? "Checking updates…" : "Refresh inbox",
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
            <View style={[styles.empty, { backgroundColor: palette.blue }]}>
              <Text accessible={false} style={styles.emptyIcon}>
                🙌
              </Text>
              <ThemedText
                style={[styles.emptyTitle, { color: palette.blueText }]}
              >
                A little encouragement goes a long way
              </ThemedText>
              <ThemedText style={{ color: palette.blueText }}>
                Requests and reactions will appear here when friends connect
                with you.
              </ThemedText>
            </View>
          )}
          {state.items.map((item) => (
            <View
              key={item.id}
              style={[
                styles.record,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text accessible={false} style={styles.emptyIcon}>
                {
                  {
                    request: "👋",
                    approval: "🤝",
                    reaction: "🙌",
                    moderation: "🛡️",
                  }[item.kind]
                }
              </Text>
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
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  empty: { padding: 24, gap: 10, borderRadius: 20 },
  emptyIcon: { fontSize: 28 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  action: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    justifyContent: "center",
  },
  record: { gap: 8, borderWidth: 1, borderRadius: 18, padding: 16 },
});
