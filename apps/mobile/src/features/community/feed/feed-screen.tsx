import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, type Href, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { AccountHeaderActions } from "@/components/account-header-button";
import type { SharedActivityFeedItemDto } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { useCommunityProfile } from "../use-community-profile";
import { CommunitySettingsScreen } from "../community-settings-screen";
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
  const community = useCommunityProfile({
    principalKey,
    birthYear,
    autoLoad: false,
  });
  const [membershipVerified, setMembershipVerified] = useState(false);
  const membershipRevision = useRef(0);

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
    if (!focused.current || !foreground.current || !membershipVerified) return;
    alive.current = true;
    controller.resume();
    if (enrolled.current) void controller.refresh();
  }, [controller, membershipVerified]);
  const revalidateMembership = useCallback(async () => {
    const revision = ++membershipRevision.current;
    setMembershipVerified(false);
    alive.current = false;
    controller.pause();
    await community.actions.load();
    if (
      revision !== membershipRevision.current ||
      !focused.current ||
      !foreground.current
    )
      return;
    setMembershipVerified(true);
  }, [controller, community.actions.load]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void revalidateMembership();
      return () => {
        membershipRevision.current += 1;
        focused.current = false;
        alive.current = false;
        controller.pause();
      };
    }, [controller, revalidateMembership]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      foreground.current = next === "active";
      if (next !== "active") {
        membershipRevision.current += 1;
        setMembershipVerified(false);
        alive.current = false;
        controller.pause();
      } else if (focused.current) void revalidateMembership();
    });
    return () => subscription.remove();
  }, [controller, revalidateMembership]);
  useEffect(() => {
    controller.pause();
    loadFeed();
  }, [
    controller,
    loadFeed,
    community.isEnrolled,
    community.profile?.generation,
    membershipVerified,
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

  // Opening Community never enrolls or shares on the user's behalf.
  if (!membershipVerified || !community.isEnrolled) {
    const checking =
      !membershipVerified ||
      community.status === "loading" ||
      community.status === "idle";

    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={styles.accountHeader}>
          <AccountHeaderActions />
        </View>
        {checking ? (
          <ScrollView contentContainerStyle={styles.centered}>
            <Text
              accessibilityRole="header"
              style={[styles.notEnrolledTitle, { color: colors.text }]}
            >
              Community
            </Text>
            <ActivityIndicator color={colors.primary} />
            <Link href="/" asChild>
              <Pressable
                style={styles.privateButton}
                accessibilityRole="button"
                accessibilityLabel="Keep tracking privately"
              >
                <Text
                  style={[styles.primaryButtonText, { color: colors.primary }]}
                >
                  Keep tracking privately
                </Text>
              </Pressable>
            </Link>
          </ScrollView>
        ) : (
          <CommunitySettingsScreen embedded onJoined={revalidateMembership} />
        )}
      </SafeAreaView>
    );
  }

  // Header quick links
  const headerComponent = (
    <View style={styles.headerBar}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: colors.text }]}
      >
        Community
      </Text>
      <View style={styles.quickLinks}>
        <Link href={"/community/invite" as Href} asChild>
          <Pressable
            style={[styles.quickLinkPill, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Find Friends"
          >
            <Text style={[styles.quickLinkText, { color: colors.text }]}>
              Find friends
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
              Requests
            </Text>
          </Pressable>
        </Link>
        <Link href={"/community/inbox" as Href} asChild>
          <Pressable
            style={[styles.quickLinkPill, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Community inbox"
          >
            <Text style={[styles.quickLinkText, { color: colors.text }]}>
              Inbox
            </Text>
          </Pressable>
        </Link>
        <Link href={"/community/settings" as Href} asChild>
          <Pressable
            style={[styles.quickLinkPill, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="My Community profile and settings"
          >
            <Text style={[styles.quickLinkText, { color: colors.text }]}>
              My profile
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
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={styles.accountHeader}>
        <AccountHeaderActions />
      </View>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === "web" ? 80 : 0,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  accountHeader: {
    alignItems: "flex-end",
    paddingHorizontal: 16,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    marginHorizontal: 16,
    marginBottom: 16,
  },
  privateButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
    marginTop: 12,
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
    flexGrow: 1,
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
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
