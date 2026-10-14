import {
  Link,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import React, {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
} from "react";
import {
  AppState,
  Alert,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useTabHeaderLayout } from "@/components/tab-header";
import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  Notice,
  SectionHeader,
  type ButtonVariant,
} from "@/components/ui";
import {
  BottomTabInset,
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CommunityButton, CommunityRootHeader, CommunityRow } from "../ui";
import { InitialsAvatar } from "../initials-avatar";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { useCommunityProfile } from "../use-community-profile";
import { ReportModal } from "../safety";
import { captureSafetyReceipt } from "../safety/safety-api";
import { scopeCommunityClient } from "../scoped-client";
import {
  searchCommunityProfiles,
  humanizeCommunityError,
} from "../community-client";
import type { PublicCommunityProfileDto } from "@mizyun/contracts";
import { invalidateCommunityReads } from "../state/read-cache";
import {
  RelationshipsController,
  type RelationshipList,
  type RelationshipRow,
  type RelationshipAction,
} from "./controller";

const listInfo: Record<
  RelationshipList,
  { title: string; description: string; empty: string; hint: string }
> = {
  incoming: {
    title: "Received requests",
    description:
      "Approve someone to let them see your shared meals and workouts. Following back is separate.",
    empty: "No follow requests",
    hint: "New requests will appear here for you to approve or decline.",
  },
  outgoing: {
    title: "Sent requests",
    description:
      "Waiting for their approval before you can see their shared meals and workouts.",
    empty: "No requests waiting",
    hint: "Find a friend by their exact handle or share an invitation.",
  },
  following: {
    title: "Following",
    description: "People whose shared meals and workouts you can see.",
    empty: "You're not following anyone yet",
    hint: "Find a friend and request to follow. They choose whether to approve.",
  },
  followers: {
    title: "Followers",
    description:
      "People you've approved to see your shared meals and workouts, including past cards still shared.",
    empty: "No followers yet",
    hint: "When someone requests to follow you, approve them from Requests.",
  },
  muted: {
    title: "Muted people",
    description:
      "Hidden from your feed. Muting keeps following and access unchanged.",
    empty: "No muted people",
    hint: "You can mute someone from the options in Following.",
  },
  blocked: {
    title: "Blocked people",
    description:
      "Interaction is blocked in both directions. Unblocking restores no follows or requests.",
    empty: "No blocked people",
    hint: "People you block will appear here. You can unblock them at any time.",
  },
};
export function RelationshipsScreen() {
  const { session, profile } = useAuth();
  const token = session?.accessToken ?? null;
  const lifetime = useRef({ token, revision: 0 });
  if (lifetime.current.token !== token)
    lifetime.current = { token, revision: lifetime.current.revision + 1 };
  const revision = lifetime.current.revision;
  const isLifetimeCurrent = useCallback(
    () => lifetime.current.revision === revision,
    [revision],
  );
  const { list } = useLocalSearchParams<{ list?: string }>();
  const initialList: RelationshipList =
    list === "blocked" ||
    list === "muted" ||
    list === "following" ||
    list === "followers" ||
    list === "outgoing"
      ? list
      : "incoming";
  return (
    <OwnerRelationships
      key={`${session?.user.id ?? "signed-out"}:${initialList}:${revision}`}
      principalKey={session?.user.id ?? null}
      birthYear={profile?.birthYear}
      initialList={initialList}
      isLifetimeCurrent={isLifetimeCurrent}
    />
  );
}
function OwnerRelationships({
  principalKey,
  birthYear,
  initialList,
  isLifetimeCurrent,
}: {
  principalKey: string | null;
  birthYear?: number | null;
  initialList: RelationshipList;
  isLifetimeCurrent: () => boolean;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { headerHeight, onHeaderLayout } = useTabHeaderLayout();

  const community = useCommunityProfile({
    principalKey,
    birthYear,
    autoLoad: false,
  });
  const loadMembership = community.actions.load;
  const alive = useRef(true);
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] =
    useState<PublicCommunityProfileDto | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchRevision = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const clearSearch = useCallback(() => {
    searchRevision.current++;
    clearTimeout(searchTimer.current);
    setSearchResult(null);
    setSearchError(null);
    setSearchBusy(false);
  }, []);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  const [optionsUser, setOptionsUser] = useState<string | null>(null);
  const [showSafety, setShowSafety] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    row: RelationshipRow;
    receiptId?: string;
  } | null>(null);
  const openReport = async (row: RelationshipRow) => {
    const intentCurrent = controller.captureReceiptIntent();
    if (!principalKey || !alive.current || !intentCurrent()) return;
    const receipt = await captureSafetyReceipt(
      scopeCommunityClient(
        apiClient,
        principalKey,
        () => alive.current && intentCurrent(),
      ),
      "profile",
      row.user.userId,
    );
    if (alive.current && intentCurrent())
      setReportTarget({
        row,
        ...(receipt.ok ? { receiptId: receipt.value.id } : {}),
      });
  };
  const perform = async (action: RelationshipAction, row: RelationshipRow) => {
    const intentCurrent = controller.captureIntent();
    if (!alive.current || !intentCurrent()) return;
    if (alive.current && intentCurrent()) await controller.act(action, row);
  };
  const controller = useMemo(
    () =>
      new RelationshipsController(
        apiClient,
        principalKey,
        () => alive.current && isLifetimeCurrent(),
        initialList,
      ),
    [principalKey, initialList, isLifetimeCurrent],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const membershipRevision = useRef(0);
  const pendingGraph = useRef<number | null>(null);
  const [membershipPending, setMembershipPending] = useState(false);
  const [membershipComplete, setMembershipComplete] = useState(0);
  const reload = useCallback(() => {
    const revision = ++membershipRevision.current;
    pendingGraph.current = null;
    controller.pause();
    setReportTarget(null);
    setOptionsUser(null);
    if (!focused.current || !foreground.current || !isLifetimeCurrent()) return;
    clearSearch();
    alive.current = true;
    const list = controller.getState().list;
    if (list === "blocked" || list === "muted") {
      controller.resume();
      void controller.load(list);
    } else pendingGraph.current = revision;
    setMembershipPending(true);
    void loadMembership().then(() => {
      if (
        revision !== membershipRevision.current ||
        !focused.current ||
        !foreground.current ||
        !isLifetimeCurrent()
      )
        return;
      setMembershipComplete(revision);
      setMembershipPending(false);
    });
  }, [controller, clearSearch, isLifetimeCurrent, loadMembership]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      reload();
      return () => {
        focused.current = false;
        membershipRevision.current++;
        pendingGraph.current = null;
        alive.current = false;
        controller.pause();
        clearSearch();
        setReportTarget(null);
        setOptionsUser(null);
      };
    }, [controller, reload]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (foreground.current === (next === "active")) return;
      foreground.current = next === "active";
      if (next !== "active") {
        membershipRevision.current++;
        pendingGraph.current = null;
        alive.current = false;
        controller.pause();
        clearSearch();
        setReportTarget(null);
        setOptionsUser(null);
      } else reload();
    });
    return () => subscription.remove();
  }, [controller, reload]);
  useEffect(() => {
    if (
      membershipPending ||
      membershipComplete === 0 ||
      pendingGraph.current !== membershipComplete ||
      community.status === "loading" ||
      community.status === "idle"
    )
      return;
    pendingGraph.current = null;
    if (!focused.current || !foreground.current || !isLifetimeCurrent()) return;
    if (community.status === "ready" && community.isEnrolled) {
      controller.resume();
      void controller.load();
    } else controller.pause();
  }, [
    controller,
    isLifetimeCurrent,
    membershipPending,
    membershipComplete,
    community.status,
    community.isEnrolled,
  ]);
  const enabled =
    (!membershipPending && community.isEnrolled) ||
    state.list === "blocked" ||
    state.list === "muted";
  const checkingMembership =
    membershipPending && state.list !== "blocked" && state.list !== "muted";
  const busy = state.loading || state.pending || checkingMembership;
  const button = (
    label: string,
    onPress: () => void,
    disabled = busy,
    variant: ButtonVariant = "secondary",
    accessibilityLabel?: string,
    accessibilityHint?: string,
  ) => (
    <Button
      key={label}
      label={label}
      size="small"
      variant={variant}
      onPress={onPress}
      disabled={disabled}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      {...(accessibilityHint ? { accessibilityHint } : {})}
    />
  );
  const confirm = (action: RelationshipAction, row: RelationshipRow) => {
    const explanations: Partial<Record<RelationshipAction, string>> = {
      approve:
        "They can see your still-published meal and workout cards, including past cards. This does not follow them back.",
      block:
        "Blocks interaction in both directions and removes both follows and pending requests. Unblocking restores nothing.",
      remove:
        "Removes their access to your shared meals and workouts and prior interactions.",
      unfollow:
        "Stops following this person and ends your access to their shared meals and workouts.",
      unblock: "Previous follows and requests will not be restored.",
    };
    const intentCurrent = controller.captureIntent();
    const message = explanations[action];
    if (!message) {
      void perform(action, row);
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
            if (alive.current && intentCurrent()) void perform(action, row);
            else if (
              alive.current &&
              focused.current &&
              foreground.current &&
              isLifetimeCurrent()
            )
              Alert.alert(
                "Relationship needs refreshing",
                "No action was sent. Refresh the list, then review and confirm your choice again.",
              );
          },
        },
      ],
    );
  };
  const info = listInfo[state.list];
  const findDisabled = busy || searchBusy || !query.trim();
  const safetyList = state.list === "muted" || state.list === "blocked";
  const requestsList = state.list === "incoming" || state.list === "outgoing";
  const select = (
    key: RelationshipList,
    label: string,
    selected: boolean,
    filter = false,
  ) => {
    const disabled =
      state.loading ||
      state.pending ||
      ((checkingMembership || !community.isEnrolled) &&
        key !== "blocked" &&
        key !== "muted");
    const onPress = () => {
      setOptionsUser(null);
      if (key === "blocked" || key === "muted") {
        pendingGraph.current = null;
        controller.resume();
      }
      void controller.load(key);
    };
    if (filter)
      return (
        <Chip
          key={key}
          label={label}
          selected={selected}
          accessibilityRole="button"
          accessibilityState={{ selected, disabled }}
          disabled={disabled}
          onPress={onPress}
          style={busy ? styles.inactive : undefined}
        />
      );
    // Segment of a local segmented control: the shared `SegmentedControl`
    // has no per-option disabled state, which safety lists depend on.
    return (
      <Pressable
        key={key}
        accessibilityRole="tab"
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.segment,
          selected && [
            styles.segmentSelected,
            {
              backgroundColor: colors.backgroundElement,
              shadowColor: colors.text,
            },
          ],
          busy && styles.inactive,
        ]}
      >
        <ThemedText
          type="footnote"
          themeColor={selected ? "text" : "textSecondary"}
          style={styles.segmentText}
        >
          {label}
        </ThemedText>
      </Pressable>
    );
  };
  const segmented = (children: React.ReactNode) => (
    <View
      accessibilityRole="tablist"
      style={[styles.segmented, { backgroundColor: colors.backgroundSelected }]}
    >
      {children}
    </View>
  );
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {/* Fixed tab header; content scrolls beneath its feathered edge. */}
      <CommunityRootHeader selected="people" onLayout={onHeaderLayout} />
      <ScrollView
        style={{ flex: 1, marginTop: -headerHeight }}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.two,
            paddingBottom: Math.max(48, BottomTabInset) + insets.bottom,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            progressViewOffset={headerHeight}
            refreshing={state.loading || checkingMembership}
            onRefresh={() => {
              if (principalKey && !busy) {
                invalidateCommunityReads();
                reload();
              }
            }}
            enabled={!!principalKey && !busy}
            tintColor={colors.primary}
          />
        }
      >
        {reportTarget && (
          <ReportModal
            visible
            targetType="profile"
            targetId={reportTarget.row.user.userId}
            targetHandle={reportTarget.row.user.handle}
            principalKey={principalKey}
            interactionReceiptId={reportTarget.receiptId}
            onClose={reload}
            onSuccess={(_id, blocked) => {
              if (blocked) {
                setReportTarget(null);
                setOptionsUser(null);
                reload();
              }
            }}
          />
        )}
        {community.isEnrolled && (
          <View style={styles.search}>
            <SectionHeader
              title="Find a person"
              action={
                <CommunityButton
                  label="Invite a friend"
                  href={"/community/invite" as Href}
                  size="small"
                />
              }
            />
            <ThemedText type="footnote" themeColor="textSecondary">
              Search their exact @handle. They choose whether to allow handle
              search.
            </ThemedText>
            <View
              style={[
                styles.field,
                { backgroundColor: colors.backgroundSelected },
              ]}
            >
              <Icon name="search" size={17} color="textSecondary" />
              <TextInput
                accessibilityLabel="Exact friend handle"
                placeholder="@handle"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={25}
                value={query}
                editable={!searchBusy}
                onChangeText={(value) => {
                  setQuery(value);
                  clearSearch();
                }}
                style={[styles.input, { color: colors.text }]}
              />
            </View>
            {button(
              "Find exact handle",
              () => {
                void (async () => {
                  clearSearch();
                  const revision = searchRevision.current;
                  const intent = controller.captureIntent();
                  const deadline = Date.now() + 10_000;
                  const current = () =>
                    alive.current &&
                    intent() &&
                    revision === searchRevision.current &&
                    Date.now() < deadline;
                  if (!current() || !principalKey) return;
                  setSearchBusy(true);
                  const result = await searchCommunityProfiles(
                    scopeCommunityClient(apiClient, principalKey, current),
                    query,
                    1,
                  );
                  if (!current()) {
                    if (revision === searchRevision.current) {
                      setSearchBusy(false);
                      setSearchError("Profile access changed. Search again.");
                    }
                    return;
                  }
                  setSearchBusy(false);
                  if (!result.ok)
                    setSearchError(humanizeCommunityError(result.error));
                  else {
                    setSearchResult(result.value.profiles[0] ?? null);
                    if (!result.value.profiles.length)
                      setSearchError(
                        "No discoverable profile is available for that handle.",
                      );
                  }
                  searchTimer.current = setTimeout(
                    clearSearch,
                    Math.max(0, deadline - Date.now()),
                  );
                })();
              },
              findDisabled,
              findDisabled ? "tinted" : "primary",
            )}
            {searchError && (
              <ThemedText
                type="footnote"
                themeColor="textSecondary"
                accessibilityLiveRegion="polite"
              >
                {searchError}
              </ThemedText>
            )}
            {searchResult && (
              <Card padded={false}>
                <Link
                  href={`/community/profile/${searchResult.userId}` as Href}
                  accessibilityLabel={`View @${searchResult.handle} profile`}
                  asChild
                >
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`View @${searchResult.handle} profile`}
                    style={styles.resultRow}
                  >
                    <InitialsAvatar
                      symbol={searchResult.avatarSymbol}
                      seed={searchResult.handle}
                      size={40}
                    />
                    <View style={styles.name}>
                      <ThemedText type="default">
                        {searchResult.displayName}
                      </ThemedText>
                      <ThemedText type="footnote" themeColor="textSecondary">
                        @{searchResult.handle}
                      </ThemedText>
                    </View>
                    <Icon name="chevronRight" size={14} color="textTertiary" />
                  </Pressable>
                </Link>
              </Card>
            )}
          </View>
        )}
        {segmented([
          select("incoming", "Requests", requestsList),
          select("following", "Following", state.list === "following"),
          select("followers", "Followers", state.list === "followers"),
        ])}
        {requestsList && (
          <View style={styles.wrap} accessibilityLabel="Request direction">
            {select("incoming", "Received", state.list === "incoming", true)}
            {select("outgoing", "Sent", state.list === "outgoing", true)}
          </View>
        )}
        {!community.isEnrolled && !checkingMembership && (
          <ThemedText
            type="footnote"
            themeColor="textSecondary"
            accessibilityLiveRegion="polite"
          >
            {community.error ??
              "Join Community to manage follows. Your safety lists remain available."}
          </ThemedText>
        )}
        <View style={styles.section}>
          {safetyList && <SectionHeader title={info.title} />}
          <ThemedText type="footnote" themeColor="textSecondary">
            {info.description}
          </ThemedText>
        </View>
        {state.notice && (
          <ThemedText type="small" accessibilityLiveRegion="polite">
            {state.notice}
          </ThemedText>
        )}
        {state.error && <Notice tone="danger" message={state.error} />}
        {(state.loading || checkingMembership) && (
          <ActivityIndicator
            accessibilityLabel={
              checkingMembership
                ? "Checking Community access"
                : "Loading your friends"
            }
            color={colors.primary}
          />
        )}
        {(state.error || community.status === "error") &&
          button("Try again", reload, busy || !principalKey, "tinted")}
        {enabled && !busy && !state.error && state.rows.length === 0 && (
          <Card>
            <EmptyState
              icon="person"
              title={info.empty}
              message={info.hint}
              action={
                community.isEnrolled &&
                ["incoming", "outgoing", "following"].includes(state.list) ? (
                  <CommunityButton
                    label="Find friends"
                    href={"/community/invite" as Href}
                    size="small"
                  />
                ) : undefined
              }
            />
          </Card>
        )}
        {enabled && state.rows.length > 0 && (
          <Card padded={false} style={styles.list}>
            {state.rows.map((row, index) => (
              <View
                key={row.user.userId}
                style={[
                  styles.person,
                  index > 0 && {
                    borderTopColor: colors.separator,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.identity}>
                  <InitialsAvatar
                    symbol={row.user.avatarSymbol}
                    seed={row.user.handle}
                    size={40}
                  />
                  <Link
                    href={`/community/profile/${row.user.userId}` as Href}
                    asChild
                    disabled={busy || state.list === "blocked"}
                  >
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`View @${row.user.handle} profile`}
                      disabled={busy || state.list === "blocked"}
                      style={styles.name}
                    >
                      <ThemedText type="default">
                        {row.user.displayName}
                      </ThemedText>
                      <ThemedText type="footnote" themeColor="textSecondary">
                        @{row.user.handle}
                      </ThemedText>
                    </Pressable>
                  </Link>
                  <IconButton
                    icon="more"
                    variant="plain"
                    accessibilityLabel={`Options for @${row.user.handle}`}
                    selected={optionsUser === row.user.userId}
                    disabled={busy}
                    onPress={() =>
                      setOptionsUser(
                        optionsUser === row.user.userId
                          ? null
                          : row.user.userId,
                      )
                    }
                    accessibilityState={{
                      disabled: busy,
                      expanded: optionsUser === row.user.userId,
                    }}
                  />
                </View>
                {state.list === "followers" && (
                  <View style={[styles.wrap, styles.indented]}>
                    {row.outgoingFollowStatus === "none" &&
                      button(
                        "Follow back",
                        () => confirm("follow", row),
                        busy,
                        "tinted",
                        `Follow back @${row.user.handle}`,
                        "Sends a follow request. They must approve before you can see their shared meals and workouts.",
                      )}
                    {row.outgoingFollowStatus === "pending" && (
                      <ThemedText type="footnote" themeColor="textSecondary">
                        Requested · Waiting for approval
                      </ThemedText>
                    )}
                    {row.outgoingFollowStatus === "approved" && (
                      <ThemedText type="footnote" themeColor="textSecondary">
                        Following
                      </ThemedText>
                    )}
                  </View>
                )}
                {optionsUser === row.user.userId && (
                  <View
                    style={[
                      styles.wrap,
                      styles.indented,
                      styles.rowOptions,
                      { borderTopColor: colors.separator },
                    ]}
                  >
                    {state.list === "following" && [
                      button("Mute", () => confirm("mute", row)),
                      button("Unfollow", () => confirm("unfollow", row)),
                    ]}
                    {state.list === "followers" &&
                      button("Remove follower", () => confirm("remove", row))}
                    {button(
                      "Report profile or handle",
                      () => void openReport(row),
                    )}
                    {state.list !== "blocked" &&
                      button(
                        "Block",
                        () => confirm("block", row),
                        busy,
                        "destructive",
                      )}
                  </View>
                )}
                {state.list === "incoming" && (
                  <View style={[styles.wrap, styles.indented]}>
                    {button(
                      "Approve",
                      () => confirm("approve", row),
                      busy,
                      "tinted",
                    )}
                    {button("Decline", () => confirm("decline", row))}
                  </View>
                )}
                {state.list === "outgoing" && (
                  <View style={[styles.wrap, styles.indented]}>
                    {button("Cancel request", () => confirm("cancel", row))}
                  </View>
                )}
                {state.list === "blocked" && (
                  <View style={[styles.wrap, styles.indented]}>
                    {button("Unblock", () => confirm("unblock", row))}
                  </View>
                )}
                {state.list === "muted" && (
                  <View style={[styles.wrap, styles.indented]}>
                    {button("Unmute", () => confirm("unmute", row))}
                  </View>
                )}
              </View>
            ))}
          </Card>
        )}
        {state.cursor &&
          button(
            "Load more",
            () => void controller.load(state.list, true),
            busy,
            "plain",
          )}
        {safetyList ? (
          <SectionHeader title="Safety & preferences" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Safety & preferences"
            accessibilityState={{ expanded: showSafety || safetyList }}
            onPress={() => {
              if (safetyList) {
                setShowSafety(true);
              } else setShowSafety(!showSafety);
            }}
            style={styles.safetyToggle}
          >
            <ThemedText type="title3" style={styles.flex}>
              Safety & preferences
            </ThemedText>
            <Icon
              name={showSafety ? "chevronUp" : "chevronDown"}
              size={15}
              color="textSecondary"
            />
          </Pressable>
        )}
        {(showSafety || safetyList) && (
          <Card padded={false} style={styles.list}>
            <View style={styles.safetyPanel}>
              {segmented([
                select("muted", "Muted", state.list === "muted"),
                select("blocked", "Blocked", state.list === "blocked"),
              ])}
            </View>
            <View
              style={[styles.hairline, { backgroundColor: colors.separator }]}
            />
            <CommunityRow
              title="Reports, appeals & safety contact"
              href={"/community/safety" as Href}
              icon="privacy"
            />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  content: {
    paddingHorizontal: PageGutter,
    gap: Spacing.three,
    paddingBottom: 48,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  search: { gap: Spacing.two },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
  },
  input: {
    flex: 1,
    minHeight: MinTouchTarget,
    paddingVertical: Spacing.two,
    fontSize: 17,
  },
  section: { gap: Spacing.one },
  segmented: {
    flexDirection: "row",
    borderRadius: Radius.md,
    padding: 2,
    gap: 2,
  },
  segment: {
    minHeight: 48,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: Radius.sm + 2,
    alignItems: "center",
    justifyContent: "center",
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
  },
  segmentSelected: {
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontWeight: "600", textAlign: "center" },
  inactive: { opacity: 0.45 },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  list: { overflow: "hidden" },
  person: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    gap: Spacing.two,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  // Aligns actions with the name column (40pt avatar + 12pt gap).
  indented: { marginLeft: 52 },
  rowOptions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { flex: 1, gap: 1, minHeight: 48, justifyContent: "center" },
  safetyToggle: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  safetyPanel: { padding: Spacing.three },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  flex: { flex: 1 },
});

export const CommunityPeopleScreen = RelationshipsScreen;
