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
import { BottomTabInset, MaxContentWidth } from "@/constants/theme";
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
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Encourage friends, one shared workout at a time.
      </Text>
      <View style={styles.quickLinks}>
        {[
          {
            href: "/community/invite",
            label: "Find friends",
            description: "Search a handle or send an invite",
            accessibilityLabel: "Find Friends",
          },
          {
            href: "/community/relationships",
            label: "Friends & requests",
            description: "Approve requests and manage follows",
            accessibilityLabel: "Your friends and requests",
          },
          {
            href: "/community/inbox",
            label: "Inbox",
            description: "Updates about your shared activity",
            accessibilityLabel: "Community inbox",
          },
          {
            href: "/community/settings",
            label: "Profile & privacy",
            description: "Your social profile and Community choices",
            accessibilityLabel: "My Community profile and settings",
          },
        ].map((destination) => (
          <Link key={destination.href} href={destination.href as Href} asChild>
            <Pressable
              style={[
                styles.navigationCard,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={destination.accessibilityLabel}
              accessibilityHint={destination.description}
            >
              <Text style={[styles.navigationTitle, { color: colors.text }]}>
                {destination.label}
              </Text>
              <Text
                style={[
                  styles.navigationDescription,
                  { color: colors.textSecondary },
                ]}
              >
                {destination.description}
              </Text>
            </Pressable>
          </Link>
        ))}
      </View>
      <View
        style={[styles.sharingNote, { backgroundColor: colors.primaryLight }]}
      >
        <Text style={[styles.noteTitle, { color: colors.text }]}>
          Sharing is your choice
        </Text>
        <Text style={[styles.noteBody, { color: colors.text }]}>
          From a saved workout, preview a card before sharing. Cards show only a
          category, your selected day and optional duration. Your workout
          details stay private.
        </Text>
        <Link href={"/workouts" as Href} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open saved workouts"
            style={styles.noteAction}
          >
            <Text style={[styles.noteTitle, { color: colors.text }]}>
              Open saved workouts →
            </Text>
          </Pressable>
        </Link>
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.feedHeading, { color: colors.text }]}
      >
        Following feed
      </Text>
      <Text style={[styles.feedDescription, { color: colors.textSecondary }]}>
        Workouts shared by friends who approved your follow request.
      </Text>

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
      ) : state.error ? (
        <>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Activity is unavailable
          </Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Use Retry above to check again. Your private tracking stays
            available.
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No shared workouts yet
          </Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Follow a friend and wait for their approval. Workouts they choose to
            share will appear here. Your own workouts stay private until you
            choose to share.
          </Text>
          <Link href={"/community/invite" as Href} asChild>
            <Pressable
              style={[
                styles.inviteButton,
                { backgroundColor: colors.primaryLight },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Find a friend"
            >
              <Text style={[styles.inviteButtonText, { color: colors.text }]}>
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
    paddingBottom: BottomTabInset + 24,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  accountHeader: {
    alignItems: "flex-end",
    paddingHorizontal: 16,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    marginHorizontal: 16,
    marginBottom: 4,
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
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    marginHorizontal: 16,
    marginBottom: 20,
  },
  quickLinks: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    flexWrap: "wrap",
  },
  navigationCard: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 140,
    minHeight: 96,
    padding: 16,
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  navigationTitle: { fontSize: 16, lineHeight: 23, fontWeight: "700" },
  navigationDescription: { fontSize: 14, lineHeight: 20 },
  sharingNote: { margin: 16, padding: 16, gap: 6, borderRadius: 16 },
  noteTitle: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  noteBody: { fontSize: 14, lineHeight: 21 },
  noteAction: { minHeight: 48, justifyContent: "center" },
  feedHeading: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "700",
    marginHorizontal: 16,
  },
  feedDescription: {
    fontSize: 14,
    lineHeight: 21,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
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
    paddingTop: 32,
    paddingBottom: 24,
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
    minHeight: 48,
    justifyContent: "center",
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
