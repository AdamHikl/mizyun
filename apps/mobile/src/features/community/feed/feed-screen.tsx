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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Link,
  type Href,
  useFocusEffect,
  useRouter,
  useLocalSearchParams,
  Redirect,
} from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomTabInset, MaxContentWidth } from "@/constants/theme";
import { TabHeader, useTabHeaderLayout } from "@/components/tab-header";
import type { SharedActivityFeedItemDto } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { COMMUNITY_ENROLLMENT_OPEN } from "@/composition/community-admission";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { useCommunityProfile } from "../use-community-profile";
import { CommunitySettingsScreen } from "../community-settings-screen";
import { scopeCommunityClient } from "../scoped-client";
import { CommunityRootHeader, CommunityButton } from "../ui";
import { FeedController } from "./controller";
import { ActivityCard } from "./activity-card";
import {
  getCommunityReadDeadline,
  getCommunityReadEpoch,
  getCommunityResponseEpoch,
  invalidateCommunityReads,
} from "../state/read-cache";

export function FeedScreen() {
  const { destination, list } = useLocalSearchParams<{
    destination?: string;
    list?: string;
  }>();
  if (!COMMUNITY_ENROLLMENT_OPEN) return <CommunityComingSoonScreen />;
  if (destination && ["people", "messages", "me"].includes(destination))
    return (
      <Redirect
        href={
          `/(tabs)/community/${destination}${list ? `?list=${encodeURIComponent(list)}` : ""}` as Href
        }
      />
    );
  return <OpenCommunityFeedScreen />;
}

function CommunityComingSoonScreen() {
  const { headerHeight, onHeaderLayout } = useTabHeaderLayout();
  const colors = useTheme();
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <TabHeader onLayout={onHeaderLayout} />
      <ScrollView
        style={{ marginTop: -headerHeight }}
        contentContainerStyle={[
          styles.centered,
          {
            paddingTop: headerHeight + 24,
            paddingBottom: BottomTabInset + 24,
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          accessibilityLabel="Community is coming soon"
          style={[
            styles.notEnrolledTitle,
            { color: colors.text, textAlign: "center" },
          ]}
        >
          Community is coming soon
        </Text>
        <Text style={[styles.notEnrolledBody, { color: colors.textSecondary }]}>
          Keep tracking privately while we prepare Community.
        </Text>
        <Link href="/" asChild>
          <Pressable
            style={styles.primaryButton}
            accessibilityRole="button"
            accessibilityLabel="Keep tracking privately"
          >
            <Text style={[styles.primaryButtonText, { color: colors.primary }]}>
              Keep tracking privately
            </Text>
          </Pressable>
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}

function OpenCommunityFeedScreen() {
  const { session, profile } = useAuth();
  const principalKey = session?.user.id ?? null;
  const birthYear = profile?.birthYear;

  return (
    <FeedScreenContent
      key={principalKey ?? "signed-out"}
      principalKey={principalKey}
      birthYear={birthYear}
      accessToken={session?.accessToken ?? null}
    />
  );
}

function FeedScreenContent({
  principalKey,
  birthYear,
  accessToken,
}: {
  readonly principalKey: string | null;
  readonly birthYear?: number | null;
  readonly accessToken: string | null;
}) {
  const { headerHeight, onHeaderLayout } = useTabHeaderLayout();
  const colors = useTheme();
  const router = useRouter();
  const community = useCommunityProfile({
    principalKey,
    accessToken,
    birthYear,
    autoLoad: false,
  });
  const initialDeadline = getCommunityReadDeadline(community.profile);
  const initialMembership =
    principalKey !== null &&
    accessToken !== null &&
    AppState.currentState === "active" &&
    community.isAdultEligible &&
    community.status === "ready" &&
    community.isEnrolled &&
    !community.isSaving &&
    initialDeadline !== undefined &&
    initialDeadline > Date.now() &&
    getCommunityResponseEpoch(community.profile) === getCommunityReadEpoch();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const controller = useMemo(
    () =>
      new FeedController(
        apiClient,
        principalKey,
        () => alive.current,
        community.isAdultEligible ? accessToken : null,
      ),
    [principalKey, accessToken, community.isAdultEligible],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );

  const [storedMembershipVerified, setMembershipVerified] =
    useState(initialMembership);
  const membershipRevision = useRef(0);
  const lateInitialSnapshot =
    !storedMembershipVerified &&
    membershipRevision.current === 0 &&
    initialMembership &&
    controller.canRetainForNavigation();
  const membershipVerified = storedMembershipVerified || lateInitialSnapshot;
  const membershipIdentity = useRef({ accessToken, birthYear });
  const [, setNavigationRevision] = useState(0);
  const retainedMembership = useRef<{
    deadline: number;
    epoch: number;
    token: string | null;
    birthYear: number | null | undefined;
    generation: number | undefined;
  } | null>(
    initialMembership
      ? {
          deadline: initialDeadline!,
          epoch: getCommunityReadEpoch(),
          token: accessToken,
          birthYear,
          generation: community.profile?.generation,
        }
      : null,
  );
  // Remembers presentation only, never permission or protected feed content.
  const hasShownHub = useRef(initialMembership);
  const prefetchedFeed = useRef<{ generation: number | undefined } | null>(
    initialMembership ? { generation: community.profile?.generation } : null,
  );
  const verifiedGeneration = useRef<number | undefined>(
    initialMembership ? community.profile?.generation : undefined,
  );
  const [manualRefreshing, setManualRefreshing] = useState(false);
  if (lateInitialSnapshot) {
    retainedMembership.current = {
      deadline: initialDeadline!,
      epoch: getCommunityReadEpoch(),
      token: accessToken,
      birthYear,
      generation: community.profile?.generation,
    };
    hasShownHub.current = true;
    prefetchedFeed.current = { generation: community.profile?.generation };
    verifiedGeneration.current = community.profile?.generation;
  }
  useEffect(() => {
    if (lateInitialSnapshot) setMembershipVerified(true);
  }, [lateInitialSnapshot]);
  useEffect(() => {
    if (membershipVerified)
      hasShownHub.current =
        community.status === "ready" && community.isEnrolled;
    if (membershipVerified && community.status === "ready")
      verifiedGeneration.current = community.profile?.generation;
  }, [
    membershipVerified,
    community.status,
    community.isEnrolled,
    community.profile?.generation,
  ]);

  const canRetain = useCallback(() => {
    const retained = retainedMembership.current;
    return (
      retained !== null &&
      retained.deadline > Date.now() &&
      retained.epoch === getCommunityReadEpoch() &&
      retained.token === accessToken &&
      retained.birthYear === birthYear &&
      retained.generation === community.profile?.generation &&
      community.status === "ready" &&
      community.isEnrolled &&
      controller.canRetainForNavigation()
    );
  }, [
    accessToken,
    birthYear,
    community.status,
    community.isEnrolled,
    community.profile?.generation,
    controller,
  ]);
  // Record original read deadlines; navigation never extends them.
  useEffect(() => {
    const deadline = getCommunityReadDeadline(community.profile);
    if (
      membershipVerified &&
      community.isEnrolled &&
      deadline !== undefined &&
      getCommunityResponseEpoch(community.profile) ===
        getCommunityReadEpoch() &&
      membershipIdentity.current.accessToken === accessToken &&
      membershipIdentity.current.birthYear === birthYear &&
      controller.canRetainForNavigation()
    ) {
      retainedMembership.current = {
        deadline,
        epoch: getCommunityReadEpoch(),
        token: accessToken,
        birthYear,
        generation: community.profile?.generation,
      };
    }
  }, [
    membershipVerified,
    community.profile,
    community.isEnrolled,
    accessToken,
    birthYear,
    controller,
    state,
  ]);

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
    retainedMembership.current = null;
    membershipIdentity.current = { accessToken, birthYear };
    const revision = ++membershipRevision.current;
    setMembershipVerified(false);
    setManualRefreshing(false);
    alive.current = false;
    controller.pause();
    // The feed endpoint checks its own audience authority. Overlap the two
    // reads on a returning hub, but reveal nothing until both have settled.
    prefetchedFeed.current =
      hasShownHub.current && principalKey !== null
        ? { generation: verifiedGeneration.current }
        : null;
    const feedRead = prefetchedFeed.current
      ? (() => {
          alive.current = true;
          controller.resume();
          return controller.refresh();
        })()
      : Promise.resolve();
    await Promise.all([community.actions.load(), feedRead]);
    if (
      revision !== membershipRevision.current ||
      !focused.current ||
      !foreground.current
    )
      return;
    setMembershipVerified(true);
  }, [
    controller,
    community.actions.load,
    principalKey,
    accessToken,
    birthYear,
  ]);
  const retainNavigation = useRef(canRetain);
  retainNavigation.current = canRetain;
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setNavigationRevision(membershipRevision.current);
      if (retainNavigation.current()) {
        alive.current = true;
        controller.resume();
      } else void revalidateMembership();
      return () => {
        membershipRevision.current += 1;
        focused.current = false;
        const retain = retainNavigation.current();
        if (!retain) {
          retainedMembership.current = null;
          setMembershipVerified(false);
        }
        setManualRefreshing(false);
        alive.current = false;
        if (retain) controller.suspend();
        else controller.pause();
      };
    }, [controller, revalidateMembership]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (foreground.current === (next === "active")) return;
      foreground.current = next === "active";
      if (next !== "active") {
        retainedMembership.current = null;
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
    if (!membershipVerified) return;
    if (!community.isEnrolled) {
      prefetchedFeed.current = null;
      controller.pause();
      return;
    }
    if (prefetchedFeed.current) {
      const sameGeneration =
        prefetchedFeed.current.generation === community.profile?.generation;
      prefetchedFeed.current = null;
      if (sameGeneration) return;
    }
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
    invalidateCommunityReads();
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

  const feedGenerationMatches =
    !prefetchedFeed.current ||
    prefetchedFeed.current.generation === community.profile?.generation;

  const visibleRevision = membershipRevision.current;
  const scopedClient = useMemo(() => {
    const revision = visibleRevision;
    return principalKey
      ? scopeCommunityClient(
          apiClient,
          principalKey,
          () =>
            alive.current &&
            focused.current &&
            foreground.current &&
            membershipVerified &&
            revision === membershipRevision.current,
        )
      : undefined;
  }, [principalKey, membershipVerified, visibleRevision]);

  const renderItem = useCallback(
    ({ item }: { item: SharedActivityFeedItemDto }) => (
      <ActivityCard
        item={item}
        viewerUserId={principalKey ?? ""}
        scopedClient={scopedClient}
        onUnavailable={() => {
          invalidateCommunityReads();
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
    membershipIdentity.current.accessToken !== accessToken ||
    membershipIdentity.current.birthYear !== birthYear ||
    (!focused.current && !canRetain()) ||
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
        <TabHeader onLayout={onHeaderLayout} />
        {checking ? (
          <ScrollView
            style={{ marginTop: -headerHeight }}
            contentContainerStyle={[
              styles.centered,
              { paddingTop: headerHeight + 24 },
            ]}
          >
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

  const headerComponent = (
    <View style={styles.headerBar}>
      <CommunityRootHeader selected="feed" />
      <View style={styles.feedActions}>
        <CommunityButton
          label="Share workout"
          href={"/community/share" as Href}
          tone="primary"
        />
        <CommunityButton
          label="Share meal"
          href={"/community/share-meal" as Href}
        />
        <CommunityButton label="Spaces" href="/community/more" />
      </View>
      {state.error ? (
        <View
          style={[
            styles.errorBanner,
            { backgroundColor: colors.backgroundElement },
          ]}
        >
          <Text
            accessibilityRole="alert"
            style={[styles.errorText, { color: colors.text }]}
          >
            {state.error}
          </Text>
          <CommunityButton label="Retry loading feed" onPress={handleRefresh} />
        </View>
      ) : null}
    </View>
  );

  // A reset/unread feed is not an empty feed. Only a completed read can
  // establish the encouragement state, including the frame before refocus.
  const checkingActivity =
    !feedGenerationMatches ||
    checkingMembership ||
    (state.status !== "idle" && state.status !== "error");
  const emptyComponent =
    checkingActivity && !state.error ? (
      <View
        accessibilityLabel="Checking shared activity"
        accessibilityState={{ busy: true }}
        style={[
          styles.activityPlaceholder,
          {
            backgroundColor: colors.backgroundElement,
            borderColor: colors.border,
          },
        ]}
      >
        <View
          accessible={false}
          style={[
            styles.placeholderLine,
            { backgroundColor: colors.border, width: "45%" },
          ]}
        />
        <View
          accessible={false}
          style={[
            styles.placeholderLine,
            { backgroundColor: colors.border, width: "70%" },
          ]}
        />
        <View
          accessible={false}
          style={[
            styles.placeholderLine,
            { backgroundColor: colors.border, width: "90%" },
          ]}
        />
      </View>
    ) : (
      <View style={styles.emptyContainer}>
        <Text
          accessibilityRole="header"
          style={[styles.emptyTitle, { color: colors.text }]}
        >
          {state.error ? "Activity is unavailable" : "No shared activity yet"}
        </Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          {state.error
            ? "Retry to check again. Your private tracking stays available."
            : "Meals and workouts people choose to share appear here after they approve your follow request."}
        </Text>
        {!state.error ? (
          <CommunityButton
            label="Find people"
            href={"/community/people" as Href}
          />
        ) : null}
      </View>
    );

  const footerComponent = (
    <View style={styles.footerContainer}>
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
      <TabHeader onLayout={onHeaderLayout} />
      <FlatList
        data={
          (!checkingMembership && feedGenerationMatches && community.isEnrolled
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
            progressViewOffset={headerHeight}
            refreshing={manualRefreshing && state.status === "refreshing"}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        style={{ marginTop: -headerHeight }}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerHeight },
        ]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  activityPlaceholder: {
    minHeight: 320,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 24,
    marginTop: 24,
    marginBottom: 16,
  },
  placeholderLine: { height: 16, borderRadius: 8 },
  container: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: BottomTabInset + 24,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
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
  feedActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingTop: 8,
  },
  headerBar: {
    paddingHorizontal: 20,
    paddingBottom: 8,
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
