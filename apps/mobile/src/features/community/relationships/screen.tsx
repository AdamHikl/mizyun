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
  View,
} from "react-native";
import { MaxContentWidth } from "@/constants/theme";
import { CommunityIntro, useCommunityPalette } from "../community-presentation";
import { InitialsAvatar } from "../initials-avatar";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { useCommunityProfile } from "../use-community-profile";
import { ReportModal } from "../safety";
import { captureSafetyReceipt } from "../safety/safety-api";
import { scopeCommunityClient } from "../scoped-client";
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
  const { list } = useLocalSearchParams<{ list?: string }>();
  const initialList: RelationshipList =
    list === "blocked" || list === "muted" ? list : "incoming";
  return (
    <OwnerRelationships
      key={`${session?.user.id ?? "signed-out"}:${initialList}`}
      principalKey={session?.user.id ?? null}
      birthYear={profile?.birthYear}
      initialList={initialList}
    />
  );
}
function OwnerRelationships({
  principalKey,
  birthYear,
  initialList,
}: {
  principalKey: string | null;
  birthYear?: number | null;
  initialList: RelationshipList;
}) {
  const colors = useTheme();
  const palette = useCommunityPalette();
  const community = useCommunityProfile({ principalKey, birthYear });
  const alive = useRef(true);
  const [optionsUser, setOptionsUser] = useState<string | null>(null);
  const [showSafety, setShowSafety] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    row: RelationshipRow;
    receiptId?: string;
  } | null>(null);
  const openReport = async (row: RelationshipRow) => {
    const intentCurrent = controller.captureIntent();
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
    if (
      principalKey &&
      ["block", "remove", "unfollow", "cancel", "decline"].includes(action)
    ) {
      await captureSafetyReceipt(
        scopeCommunityClient(
          apiClient,
          principalKey,
          () => alive.current && intentCurrent(),
        ),
        "profile",
        row.user.userId,
      );
    }
    if (alive.current && intentCurrent()) await controller.act(action, row);
  };
  const controller = useMemo(
    () =>
      new RelationshipsController(
        apiClient,
        principalKey,
        () => alive.current,
        initialList,
      ),
    [principalKey, initialList],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const enrolled = useRef(community.isEnrolled);
  enrolled.current = community.isEnrolled;
  const reload = useCallback(() => {
    if (!focused.current || !foreground.current) return;
    alive.current = true;
    controller.resume();
    const list = controller.getState().list;
    if (enrolled.current || list === "blocked" || list === "muted")
      void controller.load(list);
  }, [controller]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      reload();
      return () => {
        focused.current = false;
        alive.current = false;
        controller.pause();
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
        alive.current = false;
        controller.pause();
        setReportTarget(null);
        setOptionsUser(null);
      } else reload();
    });
    return () => subscription.remove();
  }, [controller, reload]);
  useEffect(() => {
    controller.pause();
    reload();
  }, [controller, reload, community.isEnrolled, community.profile?.generation]);
  const enabled =
    community.isEnrolled || state.list === "blocked" || state.list === "muted";
  const busy = state.loading || state.pending;
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
          },
        },
      ],
    );
  };
  const info = listInfo[state.list];
  const safetyList = state.list === "muted" || state.list === "blocked";
  const requestsList = state.list === "incoming" || state.list === "outgoing";
  const select = (key: RelationshipList, label: string, selected: boolean) => (
    <Pressable
      key={key}
      accessibilityRole="tab"
      accessibilityState={{
        selected,
        disabled:
          busy ||
          (!community.isEnrolled && key !== "blocked" && key !== "muted"),
      }}
      disabled={
        busy || (!community.isEnrolled && key !== "blocked" && key !== "muted")
      }
      onPress={() => {
        setOptionsUser(null);
        void controller.load(key);
      }}
      style={[
        styles.tab,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? palette.purple : colors.background,
          opacity: busy ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: selected ? colors.text : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={state.loading}
          onRefresh={() => {
            if (enabled && !busy) void controller.load();
          }}
          enabled={enabled && !busy}
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
          onClose={() => setReportTarget(null)}
          onSuccess={(_id, blocked) => {
            if (blocked) {
              setReportTarget(null);
              setOptionsUser(null);
              reload();
            }
          }}
        />
      )}
      <View style={styles.intro}>
        <CommunityIntro
          icon="👥"
          title="Friends & requests"
          description="Choose who you follow and who sees your shared workouts."
          tone="purple"
        />
        {community.isEnrolled && (
          <Link
            href={"/community/invite" as Href}
            style={[styles.findLink, { color: colors.primary }]}
            accessibilityRole="link"
          >
            Find friends →
          </Link>
        )}
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {select("incoming", "Requests", requestsList)}
        {select("following", "Following", state.list === "following")}
        {select("followers", "Followers", state.list === "followers")}
      </View>
      {requestsList && (
        <View style={styles.wrap} accessibilityRole="tablist">
          {select("incoming", "Received", state.list === "incoming")}
          {select("outgoing", "Sent", state.list === "outgoing")}
        </View>
      )}
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
      {!community.isEnrolled && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.textSecondary }}
        >
          {community.error ??
            "Join Community to manage follows. Your safety lists remain available."}
        </Text>
      )}
      <View style={styles.section}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          {info.title}
        </Text>
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
      {state.loading && (
        <ActivityIndicator
          accessibilityLabel="Loading your friends"
          color={colors.primary}
        />
      )}
      {enabled &&
        state.error &&
        button("Try again", () => void controller.load(), busy)}
      {enabled && !busy && !state.error && state.rows.length === 0 && (
        <View style={[styles.empty, { backgroundColor: palette.purple }]}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {info.empty}
          </Text>
          <Text style={[styles.subtitle, { color: palette.purpleText }]}>
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
                backgroundColor: colors.backgroundElement,
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
              <View style={styles.name}>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  {row.user.displayName}
                </Text>
                <Text style={{ color: colors.textSecondary }}>
                  @{row.user.handle}
                </Text>
              </View>
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
                    style={[styles.buttonText, { color: colors.textSecondary }]}
                  >
                    Requested · Waiting for approval
                  </Text>
                )}
                {row.outgoingFollowStatus === "approved" && (
                  <Text
                    style={[styles.buttonText, { color: colors.textSecondary }]}
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
                {button("Report profile or handle", () => void openReport(row))}
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
    </ScrollView>
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
  intro: { gap: 8 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  title: { fontSize: 22, fontWeight: "700" },
  section: { gap: 6 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tab: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderRadius: 10,
    justifyContent: "center",
    flexGrow: 1,
  },
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
  empty: { padding: 24, borderRadius: 18, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 14 },
  rowOptions: { borderTopWidth: 1, paddingTop: 12 },
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { flex: 1, gap: 4 },
  options: {
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
