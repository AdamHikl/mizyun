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
  Text,
  TextInput,
  View,
} from "react-native";
import { BottomTabInset, MaxContentWidth } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CommunityRootHeader } from "../ui";
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
      "Approve someone to let them see your shared workouts. Following back is separate.",
    empty: "No follow requests",
    hint: "New requests will appear here for you to approve or decline.",
  },
  outgoing: {
    title: "Sent requests",
    description:
      "Waiting for their approval before you can see their shared workouts.",
    empty: "No requests waiting",
    hint: "Find a friend by their exact handle or share an invitation.",
  },
  following: {
    title: "Following",
    description: "People whose shared workouts you can see.",
    empty: "You're not following anyone yet",
    hint: "Find a friend and request to follow. They choose whether to approve.",
  },
  followers: {
    title: "Followers",
    description:
      "People you've approved to see your shared workouts, including past cards still shared.",
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
    primary = false,
    accessibilityLabel?: string,
    accessibilityHint?: string,
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={[
        styles.button,
        {
          borderColor: primary ? colors.primary : colors.border,
          backgroundColor: primary ? "#047857" : colors.backgroundElement,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: primary ? "#FFFFFF" : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
  const confirm = (action: RelationshipAction, row: RelationshipRow) => {
    const explanations: Partial<Record<RelationshipAction, string>> = {
      approve:
        "They can see your still-published workout cards, including past cards. This does not follow them back.",
      block:
        "Blocks interaction in both directions and removes both follows and pending requests. Unblocking restores nothing.",
      remove:
        "Removes their access to your shared workouts and prior interactions.",
      unfollow:
        "Stops following this person and ends your access to their shared workouts.",
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
  const safetyList = state.list === "muted" || state.list === "blocked";
  const requestsList = state.list === "incoming" || state.list === "outgoing";
  const select = (
    key: RelationshipList,
    label: string,
    selected: boolean,
    filter = false,
  ) => (
    <Pressable
      key={key}
      accessibilityRole={filter ? "button" : "tab"}
      accessibilityState={{
        selected,
        disabled:
          state.loading ||
          state.pending ||
          ((checkingMembership || !community.isEnrolled) &&
            key !== "blocked" &&
            key !== "muted"),
      }}
      disabled={
        state.loading ||
        state.pending ||
        ((checkingMembership || !community.isEnrolled) &&
          key !== "blocked" &&
          key !== "muted")
      }
      onPress={() => {
        setOptionsUser(null);
        if (key === "blocked" || key === "muted") {
          pendingGraph.current = null;
          controller.resume();
        }
        void controller.load(key);
      }}
      style={[
        filter ? styles.filter : styles.tab,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor:
            filter && selected ? colors.backgroundElement : colors.background,
          opacity: busy ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={[
          filter ? styles.filterText : styles.tabText,
          { color: selected ? colors.text : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
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
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(48, BottomTabInset) + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
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
        <CommunityRootHeader selected="people" />
        {community.isEnrolled && (
          <View style={styles.search}>
            <View style={styles.wrap}>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: colors.text }]}
              >
                Find a person
              </Text>
              <Link
                href={"/community/invite" as Href}
                style={[styles.findLink, { color: colors.primary }]}
              >
                Invite a friend
              </Link>
            </View>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Search their exact @handle. They choose whether to allow handle
              search.
            </Text>
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
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.border },
              ]}
            />
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
              busy || searchBusy || !query.trim(),
              true,
            )}
            {searchError && (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.textSecondary }}
              >
                {searchError}
              </Text>
            )}
            {searchResult && (
              <Link
                href={`/community/profile/${searchResult.userId}` as Href}
                accessibilityLabel={`View @${searchResult.handle} profile`}
                style={[styles.findLink, { color: colors.primary }]}
              >
                {searchResult.displayName} · @{searchResult.handle} →
              </Link>
            )}
          </View>
        )}
        <View style={styles.tabs} accessibilityRole="tablist">
          {select("incoming", "Requests", requestsList)}
          {select("following", "Following", state.list === "following")}
          {select("followers", "Followers", state.list === "followers")}
        </View>
        {requestsList && (
          <View style={styles.wrap} accessibilityLabel="Request direction">
            {select("incoming", "Received", state.list === "incoming", true)}
            {select("outgoing", "Sent", state.list === "outgoing", true)}
          </View>
        )}
        {!community.isEnrolled && !checkingMembership && (
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: colors.textSecondary }}
          >
            {community.error ??
              "Join Community to manage follows. Your safety lists remain available."}
          </Text>
        )}
        <View style={styles.section}>
          {safetyList && (
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.text }]}
            >
              {info.title}
            </Text>
          )}
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {info.description}
          </Text>
        </View>
        {state.notice && (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
            {state.notice}
          </Text>
        )}
        {state.error && (
          <Text accessibilityRole="alert" style={{ color: colors.text }}>
            {state.error}
          </Text>
        )}
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
          button("Try again", reload, busy || !principalKey)}
        {enabled && !busy && !state.error && state.rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {info.empty}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {info.hint}
            </Text>
            {community.isEnrolled &&
              ["incoming", "outgoing", "following"].includes(state.list) && (
                <Link
                  href={"/community/invite" as Href}
                  accessibilityRole="link"
                  style={[styles.findLink, { color: colors.primary }]}
                >
                  Find friends →
                </Link>
              )}
          </View>
        )}
        {enabled &&
          state.rows.map((row) => (
            <View
              key={row.user.userId}
              style={[
                styles.card,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.identity}>
                <InitialsAvatar
                  symbol={row.user.avatarSymbol}
                  seed={row.user.handle}
                  size={44}
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
                    <Text style={[styles.emptyTitle, { color: colors.text }]}>
                      {row.user.displayName}
                    </Text>
                    <Text style={{ color: colors.textSecondary }}>
                      @{row.user.handle}
                    </Text>
                  </Pressable>
                </Link>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Options for @${row.user.handle}`}
                  disabled={busy}
                  onPress={() =>
                    setOptionsUser(
                      optionsUser === row.user.userId ? null : row.user.userId,
                    )
                  }
                  accessibilityState={{
                    disabled: busy,
                    expanded: optionsUser === row.user.userId,
                  }}
                  style={styles.options}
                >
                  <Text
                    style={[styles.buttonText, { color: colors.textSecondary }]}
                  >
                    •••
                  </Text>
                </Pressable>
              </View>
              {state.list === "followers" && (
                <View style={styles.wrap}>
                  {row.outgoingFollowStatus === "none" &&
                    button(
                      "Follow back",
                      () => confirm("follow", row),
                      busy,
                      true,
                      `Follow back @${row.user.handle}`,
                      "Sends a follow request. They must approve before you can see their shared workouts.",
                    )}
                  {row.outgoingFollowStatus === "pending" && (
                    <Text
                      style={[
                        styles.buttonText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Requested · Waiting for approval
                    </Text>
                  )}
                  {row.outgoingFollowStatus === "approved" && (
                    <Text
                      style={[
                        styles.buttonText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Following
                    </Text>
                  )}
                </View>
              )}
              {optionsUser === row.user.userId && (
                <View
                  style={[
                    styles.wrap,
                    styles.rowOptions,
                    { borderColor: colors.border },
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
                    button("Block", () => confirm("block", row))}
                </View>
              )}
              {state.list === "incoming" && (
                <View style={styles.wrap}>
                  {button("Approve", () => confirm("approve", row), busy, true)}
                  {button("Decline", () => confirm("decline", row))}
                </View>
              )}
              {state.list === "outgoing" && (
                <View style={styles.wrap}>
                  {button("Cancel request", () => confirm("cancel", row))}
                </View>
              )}
              {state.list === "blocked" &&
                button("Unblock", () => confirm("unblock", row))}
              {state.list === "muted" &&
                button("Unmute", () => confirm("unmute", row))}
            </View>
          ))}
        {state.cursor &&
          button("Load more", () => void controller.load(state.list, true))}
        {safetyList ? (
          <Text style={[styles.buttonText, { color: colors.textSecondary }]}>
            Safety & preferences
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showSafety || safetyList }}
            onPress={() => {
              if (safetyList) {
                setShowSafety(true);
              } else setShowSafety(!showSafety);
            }}
            style={styles.safetyToggle}
          >
            <Text style={[styles.buttonText, { color: colors.textSecondary }]}>
              Safety & preferences {showSafety || safetyList ? "−" : "+"}
            </Text>
          </Pressable>
        )}
        {(showSafety || safetyList) && (
          <View style={[styles.safetyPanel, { borderColor: colors.border }]}>
            <View style={styles.wrap} accessibilityRole="tablist">
              {select("muted", "Muted", state.list === "muted")}
              {select("blocked", "Blocked", state.list === "blocked")}
            </View>
            <Link
              href={"/community/safety" as Href}
              accessibilityRole="link"
              style={[styles.findLink, { color: colors.primary }]}
            >
              Reports, appeals & safety contact →
            </Link>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 48,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  search: { gap: 10 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, padding: 12 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  title: { fontSize: 22, fontWeight: "700" },
  section: { gap: 6 },
  tabs: { flexDirection: "row", gap: 4 },
  tab: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: 2,
    justifyContent: "center",
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
  },
  tabText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
  filter: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 24,
    justifyContent: "center",
  },
  filterText: { fontSize: 13, fontWeight: "600" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  button: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: "center",
  },
  findLink: {
    fontSize: 15,
    fontWeight: "600",
    paddingVertical: 12,
    minHeight: 48,
  },
  safetyToggle: { minHeight: 48, justifyContent: "center" },
  safetyPanel: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  empty: { paddingVertical: 16, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  card: { paddingVertical: 14, borderBottomWidth: 1, gap: 10 },
  rowOptions: { borderTopWidth: 1, paddingTop: 12 },
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { flex: 1, gap: 4, minHeight: 48, justifyContent: "center" },
  options: {
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});

export const CommunityPeopleScreen = RelationshipsScreen;
