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
import { BrandWordmark } from "@/components/brand-wordmark";
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
  // Remembers presentation only, never permission or protected feed content.
  const hasShownHub = useRef(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  useEffect(() => {
    if (membershipVerified)
      hasShownHub.current =
        community.status === "ready" && community.isEnrolled;
  }, [membershipVerified, community.status, community.isEnrolled]);

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
    setManualRefreshing(false);
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
        setManualRefreshing(false);
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
        setManualRefreshing(false);
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

  const handleRefresh = useCallback(async () => {
    if (
      !membershipVerified ||
      !enrolled.current ||
      !focused.current ||
      !foreground.current
    )
      return;
    const revision = membershipRevision.current;
    setManualRefreshing(true);
    try {
      await controller.refresh();
    } finally {
      if (
        focused.current &&
        foreground.current &&
        revision === membershipRevision.current
      )
        setManualRefreshing(false);
    }
  }, [controller, membershipVerified]);

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
  const checkingMembership =
    !membershipVerified ||
    community.status === "loading" ||
    community.status === "idle";
  const showPublicHub = checkingMembership && hasShownHub.current;
  if ((!membershipVerified || !community.isEnrolled) && !showPublicHub) {
    const checking = checkingMembership;

    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={styles.accountHeader}>
          <BrandWordmark />
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

  // Color belongs to navigation and encouragement, never permission/status.
  const accents =
    colors.background === "#0B0F12"
      ? {
          mint: "#12392F",
          mintText: "#C5F5DE",
          purple: "#2C2441",
          purpleText: "#E1D4FF",
          blue: "#17334A",
          blueText: "#C6E8FF",
          peach: "#3E2C24",
          peachText: "#FFDDC5",
        }
      : {
          mint: "#D7F5E5",
          mintText: "#14543B",
          purple: "#EEE6FF",
          purpleText: "#4C327A",
          blue: "#E0F1FF",
          blueText: "#244D72",
          peach: "#FFEBDD",
          peachText: "#74442A",
        };
  const updatingEmpty =
    !membershipVerified ||
    state.status === "loading" ||
    state.status === "refreshing";
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
        A little encouragement, together.
      </Text>
      <View style={styles.quickLinks}>
        {[
          {
            href: "/community/invite",
            label: "Find friends",
            description: "Search a handle or send an invite",
            caption:
              "A little support goes a long way. Search a handle or invite a friend.",
            icon: "👋",
            surface: accents.mint,
            ink: accents.mintText,
            primary: true,
            accessibilityLabel: "Find Friends",
          },
          {
            href: "/community/relationships",
            label: "Friends",
            description: "Approve requests and manage follows",
            caption: "Following & requests",
            icon: "👥",
            surface: accents.purple,
            ink: accents.purpleText,
            primary: false,
            accessibilityLabel: "Your friends and requests",
          },
          {
            href: "/community/inbox",
            label: "Inbox",
            description: "Updates about your shared activity",
            caption: "Community updates",
            icon: "💬",
            surface: accents.blue,
            ink: accents.blueText,
            primary: false,
            accessibilityLabel: "Community inbox",
          },
          {
            href: "/community/settings",
            label: "Profile",
            description: "Your social profile and Community choices",
            caption: "Your Community choices",
            icon: "🌿",
            surface: accents.peach,
            ink: accents.peachText,
            primary: false,
            accessibilityLabel: "My Community profile and settings",
          },
        ].map((destination) => (
          <Link key={destination.href} href={destination.href as Href} asChild>
            <Pressable
              style={StyleSheet.flatten([
                styles.navigationCard,
                destination.primary
                  ? styles.findFriendsCard
                  : styles.shortcutCard,
                {
                  borderColor: destination.surface,
                  backgroundColor: destination.surface,
                },
              ])}
              accessibilityRole="button"
              accessibilityLabel={destination.accessibilityLabel}
              accessibilityHint={destination.description}
            >
              <View
                style={
                  destination.primary
                    ? styles.navigationTopRow
                    : styles.shortcutTopRow
                }
              >
                <Text
                  accessible={false}
                  importantForAccessibility="no"
                  style={styles.navigationIcon}
                >
                  {destination.icon}
                </Text>
                <Text
                  style={[
                    styles.navigationTitle,
                    !destination.primary && styles.shortcutTitle,
                    { color: destination.ink },
                  ]}
                >
                  {destination.label}
                </Text>
                {destination.primary && (
                  <Text
                    accessible={false}
                    style={[styles.navigationArrow, { color: destination.ink }]}
                  >
                    ›
                  </Text>
                )}
              </View>
              {destination.primary && (
                <Text
                  style={[
                    styles.navigationDescription,
                    { color: destination.ink },
                  ]}
                >
                  {destination.caption}
                </Text>
              )}
            </Pressable>
          </Link>
        ))}
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.feedHeading, { color: colors.text }]}
      >
        Friends’ activity
      </Text>
      <Text style={[styles.feedDescription, { color: colors.textSecondary }]}>
        Shared workouts from friends you follow.
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
    <View
      style={[
        updatingEmpty ? styles.updatingSpace : styles.emptyContainer,
        {
          backgroundColor: updatingEmpty ? "transparent" : accents.mint,
          borderColor: "transparent",
        },
      ]}
    >
      {updatingEmpty ? (
        <View accessible accessibilityLabel="Updating shared activity" />
      ) : state.error ? (
        <>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Activity is unavailable
          </Text>
          <Text style={[styles.emptyBody, { color: accents.mintText }]}>
            Use Retry above to check again. Your private tracking stays
            available.
          </Text>
        </>
      ) : (
        <>
          <View
            style={styles.encouragementArt}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            <Text
              style={[styles.artBubble, { backgroundColor: accents.purple }]}
            >
              👏
            </Text>
            <Text
              style={[styles.artBubble, { backgroundColor: accents.peach }]}
            >
              🙌
            </Text>
            <Text style={[styles.artBubble, { backgroundColor: accents.blue }]}>
              💪
            </Text>
          </View>
          <Text style={[styles.emptyTitle, { color: accents.mintText }]}>
            No shared workouts yet
          </Text>
          <Text style={[styles.emptyBody, { color: accents.mintText }]}>
            A place to cheer each other on. Follow a friend; after they approve,
            the workouts they choose to share will appear here.
          </Text>
          <Link href={"/community/invite" as Href} asChild>
            <Pressable
              style={StyleSheet.flatten([
                styles.inviteButton,
                { backgroundColor: "#047857" },
              ])}
              accessibilityRole="button"
              accessibilityLabel="Find a friend"
            >
              <Text style={[styles.inviteButtonText, { color: "#FFFFFF" }]}>
                Find friends
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
      <View
        style={[
          styles.sharingNote,
          {
            backgroundColor: accents.purple,
            borderColor: accents.purple,
          },
        ]}
      >
        <Text style={[styles.noteTitle, { color: accents.purpleText }]}>
          Your workout. Your choice.
        </Text>
        <Text style={[styles.noteBody, { color: accents.purpleText }]}>
          Choose a saved workout and preview before sharing. Only category,
          selected day and optional duration are shared. Details stay private.
        </Text>
        <Link href={"/workouts" as Href} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open saved workouts"
            style={styles.noteAction}
          >
            <Text
              style={[
                styles.noteTitle,
                styles.noteActionLabel,
                { color: colors.text },
              ]}
            >
              Open saved workouts
            </Text>
            <Text
              accessible={false}
              style={[styles.navigationArrow, { color: colors.textSecondary }]}
            >
              ›
            </Text>
          </Pressable>
        </Link>
      </View>
      {state.status === "loading_more" ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : membershipVerified && state.items.length > 0 && !state.hasMore ? (
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
        <BrandWordmark />
        <AccountHeaderActions />
      </View>
      <FlatList
        data={
          (membershipVerified && community.isEnrolled
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
            refreshing={manualRefreshing && state.status === "refreshing"}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
  },
  heading: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: "600",
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
    fontSize: 14,
    lineHeight: 20,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  quickLinks: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 24,
    flexWrap: "wrap",
  },
  findFriendsCard: { flexBasis: "100%", padding: 18 },
  shortcutCard: { flexBasis: "28%", minWidth: 88 },
  shortcutTopRow: { alignItems: "center", gap: 6 },
  shortcutTitle: { textAlign: "center", flex: 0 },
  navigationIcon: { fontSize: 26, marginBottom: 4 },
  navigationCard: {
    flexGrow: 1,
    minHeight: 80,
    padding: 12,
    gap: 4,
    borderRadius: 16,
    borderWidth: 1,
  },
  navigationTopRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  navigationTitle: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  navigationArrow: { fontSize: 24, lineHeight: 28 },
  navigationDescription: { fontSize: 14, lineHeight: 20 },
  sharingNote: {
    marginHorizontal: 16,
    padding: 16,
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  noteTitle: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  noteBody: { fontSize: 14, lineHeight: 21 },
  noteAction: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  noteActionLabel: { flex: 1, flexShrink: 1 },
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
  updatingSpace: { height: 0 },
  encouragementArt: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    maxWidth: "100%",
    gap: 10,
    marginBottom: 16,
  },
  artBubble: {
    fontSize: 28,
    padding: 12,
    borderRadius: 28,
    overflow: "hidden",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 16,
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
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
    gap: 20,
  },
  caughtUpText: {
    textAlign: "center",
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
