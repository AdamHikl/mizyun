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
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  type Href,
  useFocusEffect,
  useRouter,
  useLocalSearchParams,
  Redirect,
} from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  BottomTabInset,
  MaxContentWidth,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
import { TabHeader, useTabHeaderLayout } from "@/components/tab-header";
import { ThemedText } from "@/components/themed-text";
import { Card, EmptyState, Icon, Notice } from "@/components/ui";
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
      <TabHeader title="Community" onLayout={onHeaderLayout} />
      <ScrollView
        style={{ marginTop: -headerHeight }}
        contentContainerStyle={[
          styles.centered,
          {
            paddingTop: headerHeight + Spacing.four,
            paddingBottom: BottomTabInset + Spacing.four,
          },
        ]}
      >
        <Icon name="chat" size={30} color="textTertiary" />
        <ThemedText
          type="headline"
          accessibilityRole="header"
          accessibilityLabel="Community is coming soon"
          style={styles.centerText}
        >
          Community is coming soon
        </ThemedText>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.centerText}
        >
          Keep tracking privately while we prepare Community.
        </ThemedText>
        <CommunityButton label="Keep tracking privately" href="/" />
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
        <TabHeader title="Community" onLayout={onHeaderLayout} />
        {checking ? (
          <ScrollView
            style={{ marginTop: -headerHeight }}
            contentContainerStyle={[
              styles.centered,
              { paddingTop: headerHeight + Spacing.four },
            ]}
          >
            <ActivityIndicator
              color={colors.primary}
              accessibilityLabel="Checking Community membership"
            />
            <CommunityButton label="Keep tracking privately" href="/" />
          </ScrollView>
        ) : (
          <CommunitySettingsScreen embedded onJoined={revalidateMembership} />
        )}
      </SafeAreaView>
    );
  }

  const headerComponent = (
    <View style={styles.headerBar}>
      <View style={styles.feedActions}>
        {/* Equal-weight quick actions as compact pills that wrap. */}
        <CommunityButton
          label="Share workout"
          href={"/community/share" as Href}
          size="small"
        />
        <CommunityButton
          label="Share meal"
          href={"/community/share-meal" as Href}
          size="small"
        />
        <CommunityButton label="Spaces" href="/community/more" size="small" />
      </View>
      {state.error ? (
        <Notice
          tone="danger"
          message={state.error}
          action={
            <CommunityButton
              label="Retry loading feed"
              onPress={handleRefresh}
            />
          }
        />
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
      <Card
        accessibilityLabel="Checking shared activity"
        accessibilityState={{ busy: true }}
        style={styles.activityPlaceholder}
      >
        {(["45%", "70%", "90%"] as const).map((width) => (
          <View
            key={width}
            accessible={false}
            style={[
              styles.placeholderLine,
              { backgroundColor: colors.backgroundSelected, width },
            ]}
          />
        ))}
      </Card>
    ) : (
      <Card style={styles.emptyCard}>
        <EmptyState
          icon={state.error ? "warning" : "chat"}
          title={
            state.error ? "Activity is unavailable" : "No shared activity yet"
          }
          message={
            state.error
              ? "Retry to check again. Your private tracking stays available."
              : "Meals and workouts people choose to share appear here after they approve your follow request."
          }
          action={
            !state.error ? (
              <CommunityButton
                label="Find people"
                href={"/community/people" as Href}
              />
            ) : undefined
          }
        />
      </Card>
    );

  const footerComponent = (
    <View style={styles.footerContainer}>
      {state.status === "loading_more" ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : membershipVerified && state.items.length > 0 && !state.hasMore ? (
        <ThemedText
          type="footnote"
          themeColor="textSecondary"
          style={styles.centerText}
        >
          You're all caught up
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <CommunityRootHeader selected="feed" onLayout={onHeaderLayout} />
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
    padding: PageGutter,
    gap: Spacing.four,
    marginHorizontal: PageGutter,
    marginTop: Spacing.three,
    marginBottom: Spacing.three,
  },
  placeholderLine: { height: Spacing.three, borderRadius: Radius.sm },
  container: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: BottomTabInset + Spacing.four,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  feedActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  headerBar: {
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.three,
  },
  emptyCard: {
    marginHorizontal: PageGutter,
    marginTop: Spacing.three,
  },
  footerContainer: {
    paddingVertical: Spacing.four,
    gap: Spacing.four,
  },
  centerText: { textAlign: "center" },
  centered: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
