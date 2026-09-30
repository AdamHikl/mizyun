import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, type Href, useFocusEffect, useRouter } from "expo-router";
import type { SharedActivityFeedItemDto } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { useCommunityProfile } from "../use-community-profile";
import { scopeCommunityClient } from "../scoped-client";
import { FeedController } from "./controller";
import { ActivityCard } from "./activity-card";

export function FeedScreen() {
  const { session, profile } = useAuth();
  const principalKey = session?.user.id ?? null;
  const birthYear = profile?.birthYear;

  return (
    <FeedScreenContent
      key={principalKey ?? "signed-out"}
      principalKey={principalKey}
      birthYear={birthYear}
    />
  );
}

function FeedScreenContent({
  principalKey,
  birthYear,
}: {
  readonly principalKey: string | null;
  readonly birthYear?: number | null;
}) {
  const colors = useTheme();
  const router = useRouter();
  const community = useCommunityProfile({ principalKey, birthYear });

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const controller = useMemo(
    () => new FeedController(apiClient, principalKey, () => alive.current),
    [principalKey],
  );

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );

  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const enrolled = useRef(community.isEnrolled);
  enrolled.current = community.isEnrolled;
  const loadFeed = useCallback(() => {
    if (!focused.current || !foreground.current) return;
    alive.current = true;
    controller.resume();
    if (enrolled.current) void controller.refresh();
  }, [controller]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      loadFeed();
      return () => {
        focused.current = false;
        alive.current = false;
        controller.pause();
      };
    }, [controller, loadFeed]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      foreground.current = next === "active";
      if (next !== "active") {
        alive.current = false;
        controller.pause();
      } else loadFeed();
    });
    return () => subscription.remove();
  }, [controller, loadFeed]);
  useEffect(() => {
    controller.pause();
    loadFeed();
  }, [
    controller,
    loadFeed,
    community.isEnrolled,
    community.profile?.generation,
  ]);

  const handleRefresh = useCallback(() => {
    void controller.refresh();
  }, [controller]);

  const handleEndReached = useCallback(() => {
    if (state.hasMore && state.status === "idle") {
      void controller.loadMore();
    }
  }, [controller, state.hasMore, state.status]);

  const scopedClient = useMemo(
    () =>
      principalKey
        ? scopeCommunityClient(apiClient, principalKey, () => alive.current)
        : undefined,
    [principalKey],
  );

  const renderItem = useCallback(
    ({ item }: { item: SharedActivityFeedItemDto }) => (
      <ActivityCard
        item={item}
        viewerUserId={principalKey ?? ""}
        scopedClient={scopedClient}
        onUnavailable={() => {
          controller.pause();
          loadFeed();
        }}
        onPress={() => {
          router.push(`/community/activity/${item.id}` as Href);
        }}
        onOpenActions={() => {
          router.push(`/community/activity/${item.id}` as Href);
        }}
      />
    ),
    [principalKey, router, scopedClient, controller, loadFeed],
  );

  // If user is not enrolled in Community
  if (community.status !== "loading" && !community.isEnrolled) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.notEnrolledTitle, { color: colors.text }]}>
          Mizyun Friends
        </Text>
        <Text style={[styles.notEnrolledBody, { color: colors.textSecondary }]}>
          Share workout progress with approved friends privately.
        </Text>
        <Link href={"/community/settings" as Href} asChild>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Join Community"
          >
            <Text
              style={[styles.primaryButtonText, { color: colors.background }]}
            >
              Join Community
            </Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  // Header quick links
  const headerComponent = (
    <View style={styles.headerBar}>
      <View style={styles.quickLinks}>
        <Link href={"/community/invite" as Href} asChild>
          <Pressable
            style={[styles.quickLinkPill, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Find Friends"
          >
            <Text style={[styles.quickLinkText, { color: colors.text }]}>
              🔍 Find friends
            </Text>
          </Pressable>
        </Link>
        <Link href={"/community/relationships" as Href} asChild>
          <Pressable
            style={[styles.quickLinkPill, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Your friends and requests"
          >
            <Text style={[styles.quickLinkText, { color: colors.text }]}>
              👥 Requests
            </Text>
          </Pressable>
        </Link>
        <Link href={"/community/settings" as Href} asChild>
          <Pressable
            style={[styles.quickLinkPill, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Community settings"
          >
            <Text style={[styles.quickLinkText, { color: colors.text }]}>
              ⚙️ Settings
            </Text>
          </Pressable>
        </Link>
      </View>

      {state.error ? (
        <View style={[styles.errorBanner, { backgroundColor: "#DC262615" }]}>
          <Text
            accessibilityRole="alert"
            style={[styles.errorText, { color: "#DC2626" }]}
          >
            {state.error}
          </Text>
          <Pressable
            onPress={handleRefresh}
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry loading feed"
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  // Empty state
  const emptyComponent = (
    <View style={styles.emptyContainer}>
      {state.status === "loading" ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No shared workouts yet
          </Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Find a friend to see their activity, or keep tracking workouts
            privately.
          </Text>
          <Link href={"/community/invite" as Href} asChild>
            <Pressable
              style={[styles.inviteButton, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Find a friend"
            >
              <Text
                style={[styles.inviteButtonText, { color: colors.background }]}
              >
                Find a friend
              </Text>
            </Pressable>
          </Link>
        </>
      )}
    </View>
  );

  // Footer component (pagination loading or caught up indicator)
  const footerComponent = (
    <View style={styles.footerContainer}>
      {state.status === "loading_more" ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : state.items.length > 0 && !state.hasMore ? (
        <Text style={[styles.caughtUpText, { color: colors.textSecondary }]}>
          You're all caught up
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={
          (community.isEnrolled
            ? state.items
            : []) as SharedActivityFeedItemDto[]
        }
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={headerComponent}
        ListEmptyComponent={emptyComponent}
        ListFooterComponent={footerComponent}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={state.status === "refreshing"}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  headerBar: {
    paddingVertical: 12,
  },
  quickLinks: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    flexWrap: "wrap",
  },
  quickLinkPill: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickLinkText: {
    fontSize: 13,
    fontWeight: "500",
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  errorText: {
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  retryButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  retryText: {
    fontSize: 13,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 64,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 24,
  },
  inviteButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  inviteButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  footerContainer: {
    paddingVertical: 20,
    alignItems: "center",
  },
  caughtUpText: {
    fontSize: 13,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  notEnrolledTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 10,
  },
  notEnrolledBody: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
