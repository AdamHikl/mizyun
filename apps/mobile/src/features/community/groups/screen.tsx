import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  type CommunityGroupRequest,
  type CommunityGroupResult,
  type RelationshipListItemDto,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { CommunityPage, CommunityIdentityLink } from "../ui";
import { scopeCommunityClient } from "../scoped-client";
import { ReportModal } from "../safety/report-modal";
import { createGroupMutationIntentStore } from "./mutation-intent";
import { fetchFollowing, humanizeCommunityError } from "../community-client";
import { groupAction } from "./client";
import {
  getCommunityReadDeadline,
  invalidateCommunityReads,
} from "../state/read-cache";

const hasControlCharacters = (value: string) =>
  /[\u0000-\u001f\u007f]/.test(value.trim());

export function GroupsScreen() {
  const { session } = useAuth();
  return (
    <Content
      key={session?.user.id ?? "signed-out"}
      principal={session?.user.id ?? null}
    />
  );
}
function Content({ principal }: { principal: string | null }) {
  const theme = useTheme();
  const router = useRouter();
  const lifetime = useRef({ active: true, focused: false, revision: 0 });
  const protectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const protectedRevision = useRef(0);
  const [result, setResult] = useState<CommunityGroupResult | null>(null);
  const [groups, setGroups] = useState<CommunityGroupResult["groups"]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [task, setTask] = useState<"list" | "create" | "join">("list");
  const [panel, setPanel] = useState<
    "posts" | "compose" | "members" | "manage"
  >("posts");
  const [name, setName] = useState("");
  const [rules, setRules] = useState("Be kind. Share only what you choose.");
  const [code, setCode] = useState("");
  const [issuedCode, setIssuedCode] = useState("");
  const [body, setBody] = useState("");
  const [friends, setFriends] = useState<RelationshipListItemDto[]>([]);
  const [events, setEvents] = useState<CommunityGroupResult["events"]>([]);
  const [report, setReport] = useState<{
    type: "group" | "group_post";
    id: string;
  } | null>(null);
  const intents = useRef(createGroupMutationIntentStore(Crypto.randomUUID));
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const discardProtected = useCallback(() => {
    if (protectedTimer.current !== null) clearTimeout(protectedTimer.current);
    protectedTimer.current = null;
    protectedRevision.current++;
    setResult(null);
    setGroups([]);
    setFriends([]);
    setEvents([]);
    setReport(null);
    setIssuedCode("");
    setRules("Be kind. Share only what you choose.");
    setConfirmed(false);
  }, []);
  useEffect(
    () => () => {
      lifetime.current.active = false;
      lifetime.current.revision++;
      discardProtected();
    },
    [discardProtected],
  );
  const load = useCallback(async () => {
    if (!principal || !lifetime.current.focused) {
      setBusy(false);
      return;
    }
    const revision = ++lifetime.current.revision;
    let expiresAt = Date.now() + 10_000;
    const valid = () =>
      lifetime.current.active &&
      lifetime.current.focused &&
      lifetime.current.revision === revision &&
      Date.now() < expiresAt;
    setBusy(true);
    discardProtected();
    const expire = () => {
      discardProtected();
      setBusy(false);
      setMessage("Refresh to check your current group access.");
    };
    const armTimer = () => {
      if (protectedTimer.current !== null) clearTimeout(protectedTimer.current);
      protectedTimer.current = setTimeout(
        expire,
        Math.max(0, expiresAt - Date.now()),
      );
    };
    const consumeDeadline = (value: unknown) => {
      expiresAt = Math.min(
        expiresAt,
        getCommunityReadDeadline(value) ?? expiresAt,
      );
      armTimer();
      if (!valid()) {
        expire();
        return false;
      }
      return true;
    };
    armTimer();
    const client = scopeCommunityClient(apiClient, principal, valid);
    const [list, inbox] = await Promise.all([
      groupAction(client, { operation: "list" }),
      groupAction(client, { operation: "inbox" }),
    ]);
    if (!valid()) return;
    if (!list.ok) {
      setMessage(humanizeCommunityError(list.error));
      setBusy(false);
      return;
    }
    if (!consumeDeadline(list.value)) return;
    if (inbox.ok && !consumeDeadline(inbox.value)) return;
    setGroups(list.value.groups);
    if (inbox.ok) setEvents(inbox.value.events);
    const group = list.value.groups.find(
      (item) => item.id === selectedRef.current,
    );
    if (group) {
      setResult({ ...list.value, group });
      setRules(group.rules);
    }
    if (group?.state === "member") {
      const [read, following] = await Promise.all([
        groupAction(client, { operation: "read", groupId: group.id }),
        group.role !== "member"
          ? fetchFollowing(client, { limit: 50 })
          : Promise.resolve(null),
      ]);
      if (!valid()) return;
      if (read.ok) {
        if (!consumeDeadline(read.value)) return;
        if (following?.ok && !consumeDeadline(following.value)) return;
        setResult(read.value);
        setRules(read.value.group?.rules ?? group.rules);
        if (following?.ok)
          setFriends(
            following.value.items.filter((item) => item.status === "approved"),
          );
      } else {
        setResult(null);
        setMessage(humanizeCommunityError(read.error));
      }
    }
    setBusy(false);
  }, [principal, discardProtected]);
  useFocusEffect(
    useCallback(() => {
      lifetime.current.active = true;
      lifetime.current.focused = AppState.currentState === "active";
      setMessage(null);
      void load();
      const sub = AppState.addEventListener("change", (state) => {
        const active = state === "active";
        if (lifetime.current.focused === active) return;
        lifetime.current.focused = active;
        lifetime.current.revision++;
        discardProtected();
        setResult(null);
        setGroups([]);
        setFriends([]);
        setEvents([]);
        setReport(null);
        setBusy(false);
        setBody("");
        setName("");
        setCode("");
        setReason("");
        setConfirmed(false);
        intents.current.clear();
        if (active) void load();
      });
      return () => {
        sub.remove();
        lifetime.current.focused = false;
        lifetime.current.revision++;
        discardProtected();
        setResult(null);
        setGroups([]);
        setFriends([]);
        setEvents([]);
        setReport(null);
        setBody("");
        setName("");
        setCode("");
        setReason("");
        setConfirmed(false);
        intents.current.clear();
      };
    }, [load, discardProtected]),
  );
  const selectGroup = (id: string | null) => {
    selectedRef.current = id;
    setSelected(id);
    setTask("list");
    setPanel("posts");
    setBody("");
    setReason("");
    setConfirmed(false);
    intents.current.clear();
    setMessage(null);
    void load();
  };
  const act = async (request: CommunityGroupRequest) => {
    if (busy || !principal || !lifetime.current.focused) return;
    const revision = ++lifetime.current.revision;
    const capturedProtectedRevision = protectedRevision.current;
    const valid = () =>
      lifetime.current.active &&
      lifetime.current.focused &&
      lifetime.current.revision === revision &&
      protectedRevision.current === capturedProtectedRevision;
    setBusy(true);
    setMessage(null);
    const response = await groupAction(
      scopeCommunityClient(apiClient, principal, valid),
      request,
    );
    if (!valid()) return;
    setBusy(false);
    if (!response.ok) {
      setMessage(humanizeCommunityError(response.error));
      setResult(null);
      return;
    }
    if (request.operation === "create" || request.operation === "post")
      intents.current.complete(request.operation);
    const invitationCode = response.value.inviteCode;
    const invitationDeadline = Date.now() + 10_000;
    if (response.value.group) {
      selectedRef.current = response.value.group.id;
      setSelected(response.value.group.id);
    }
    setBody("");
    setConfirmed(false);
    if (request.operation === "create") setName("");
    setTask("list");
    setPanel("posts");
    await load();
    if (
      invitationCode &&
      lifetime.current.active &&
      lifetime.current.focused &&
      lifetime.current.revision === revision + 1 &&
      Date.now() < invitationDeadline
    ) {
      setIssuedCode(invitationCode);
      setMessage(
        "This code expires in seven days. Requests still need approval.",
      );
    }
  };
  const confirmAction = (
    title: string,
    description: string,
    request: CommunityGroupRequest,
  ) => {
    const revision = lifetime.current.revision;
    const capturedProtectedRevision = protectedRevision.current;
    Alert.alert(title, description, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        style: "destructive",
        onPress: () => {
          if (
            lifetime.current.revision === revision &&
            protectedRevision.current === capturedProtectedRevision
          )
            void act(request);
        },
      },
    ]);
  };
  const group = result?.group;
  const base = group
    ? { groupId: group.id, membershipVersion: group.membershipVersion }
    : null;
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || disabled }}
      disabled={busy || disabled}
      onPress={action}
      style={{
        minHeight: 48,
        padding: 12,
        backgroundColor: "transparent",
        borderBottomWidth: 1,
        borderColor: theme.border,
        opacity: busy || disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
  const input = (
    label: string,
    value: string,
    change: (v: string) => void,
    maxLength: number,
  ) => (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.text, fontSize: 16 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        maxLength={maxLength}
        editable={!busy}
        multiline={label !== "Private invitation code" && maxLength > 60}
        submitBehavior="blurAndSubmit"
        autoCapitalize={
          label === "Private invitation code" ? "none" : "sentences"
        }
        autoCorrect={label !== "Private invitation code"}
        textAlignVertical="top"
        style={{
          color: theme.text,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: 12,
          padding: 12,
          minHeight: 48,
        }}
      />
      {hasControlCharacters(value) && (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.text }}>
          Use plain text without line breaks.
        </Text>
      )}
    </View>
  );
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <CommunityPage title="Private groups" backHref="/community/more">
        <Text style={{ color: theme.textSecondary }}>
          A separate space for small friend groups. Your workout diary stays
          private. New members see posts made after they join. Blocking hides
          shared-group content from that person.
        </Text>
        {!principal && (
          <Text style={{ color: theme.text }}>
            Sign in to manage your groups.
          </Text>
        )}
        {busy && (
          <ActivityIndicator accessibilityLabel="Checking current group access" />
        )}
        {message && (
          <Text accessibilityRole="alert" style={{ color: theme.text }}>
            {message}
          </Text>
        )}
        {issuedCode && (
          <Text selectable style={{ color: theme.text }}>
            Invitation code: {issuedCode}
          </Text>
        )}
        {!selected && task === "list" && events.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={{ color: theme.text }}>
              Group updates
            </Text>
            {events.slice(0, 10).map((event) => (
              <Text key={event.id} style={{ color: theme.text }}>
                {(
                  {
                    invitation: "You have a private group invitation.",
                    join_request: "A group join request needs review.",
                    membership_changed: "A group membership changed.",
                    owner_transfer: "You now own a group.",
                    owner_recovered: "Group ownership was recovered to you.",
                    appeal: "A group appeal needs review.",
                    appeal_decision: "Your group appeal has a decision.",
                  } as Record<string, string>
                )[event.kind] ?? "A group update is available."}
              </Text>
            ))}
          </View>
        )}
        {!selected &&
          task === "list" &&
          groups.map((item) => (
            <View key={item.id} style={{ gap: 6 }}>
              {button(`${item.name} · ${item.state}`, () =>
                selectGroup(item.id),
              )}
            </View>
          ))}
        {button(
          "Refresh groups",
          () => {
            invalidateCommunityReads();
            setMessage(null);
            void load();
          },
          !principal,
        )}
        {selected && button("Back to all groups", () => selectGroup(null))}
        {!selected &&
          task === "list" &&
          !busy &&
          !message &&
          groups.length === 0 &&
          principal && (
            <Text style={{ color: theme.textSecondary }}>
              You have no groups yet. Create one or use a private invitation
              code.
            </Text>
          )}
        {!selected && task === "list" && (
          <>
            {button("Create a group", () => setTask("create"), !principal)}
            {button(
              "Join with a private code",
              () => setTask("join"),
              !principal,
            )}
          </>
        )}
        {!selected &&
          task !== "list" &&
          button("Cancel group task", () => {
            setTask("list");
            setName("");
            setCode("");
            intents.current.clear();
          })}
        {!selected && task === "create" && (
          <>
            <Text
              accessibilityRole="header"
              style={{ fontSize: 20, fontWeight: "600", color: theme.text }}
            >
              Create a group
            </Text>
            {input("Group name", name, setName, 60)}
            {input("Group rules", rules, setRules, 1000)}
            {button(
              "Create a private group",
              () =>
                void act({
                  operation: "create",
                  name,
                  rules,
                  operationId: intents.current.operationId("create", {
                    name: name.trim(),
                    rules: rules.trim(),
                  }),
                }),
              !name.trim() ||
                !rules.trim() ||
                hasControlCharacters(name) ||
                hasControlCharacters(rules) ||
                !principal,
            )}
          </>
        )}
        {!selected && task === "join" && (
          <>
            <Text
              accessibilityRole="header"
              style={{ fontSize: 20, fontWeight: "600", color: theme.text }}
            >
              Join a group
            </Text>
            {input(
              "Private invitation code",
              code,
              (value) => setCode(value.trim().toLowerCase()),
              64,
            )}
            {button(
              "Request to join",
              () => void act({ operation: "request", token: code.trim() }),
              !/^[a-f0-9]{32}$/.test(code) || !principal,
            )}
          </>
        )}
        {group && base && (
          <>
            <Text
              accessibilityRole="header"
              style={{ fontSize: 22, color: theme.text }}
            >
              {group.name}
            </Text>
            <Text style={{ color: theme.text }}>{group.rules}</Text>
            {group.role !== "owner" &&
              button("Report group or moderator abuse", () =>
                setReport({ type: "group", id: group.id }),
              )}
            {group.state === "invited" &&
              button(
                "Accept this invitation",
                () => void act({ operation: "join", ...base }),
              )}
            {button(
              group.role === "owner"
                ? "Leave (transfer ownership first if members remain)"
                : "Leave group",
              () =>
                confirmAction(
                  "Leave this group?",
                  "You will lose access to this group and its posts.",
                  { operation: "leave", ...base },
                ),
            )}
            {group.state === "member" && (
              <>
                <Text style={{ color: theme.text }}>
                  Posts go only to this group. There is no automatic workout
                  sharing. Removing a post cannot retract copies already seen.
                </Text>
                {button("Cooperative goals · add progress yourself", () =>
                  router.push(
                    `/community/challenges?groupId=${encodeURIComponent(group.id)}` as Href,
                  ),
                )}
                {panel === "posts" &&
                  button("Write a group post", () => setPanel("compose"))}
                {button(
                  panel === "members"
                    ? "Back to group posts"
                    : "Members and requests",
                  () => setPanel(panel === "members" ? "posts" : "members"),
                )}
                {group.role !== "member" &&
                  button(
                    panel === "manage"
                      ? "Back to group posts"
                      : "Manage this group",
                    () => setPanel(panel === "manage" ? "posts" : "manage"),
                  )}
                {panel === "compose" && (
                  <>
                    {button("Cancel group post", () => {
                      setPanel("posts");
                      setBody("");
                      setConfirmed(false);
                      intents.current.clear();
                    })}
                    {input(
                      "Your group post",
                      body,
                      (value) => {
                        setBody(value);
                        setConfirmed(false);
                      },
                      1000,
                    )}
                    {button(
                      confirmed
                        ? "Group audience confirmed ✓"
                        : "Confirm this text is for the current group members",
                      () => setConfirmed(!confirmed),
                    )}
                    {button(
                      "Publish this group post",
                      () =>
                        void act({
                          operation: "post",
                          ...base,
                          body,
                          acceptedAudience: true,
                          operationId: intents.current.operationId("post", {
                            ...base,
                            body: body.trim(),
                          }),
                        }),
                      !confirmed || !body.trim() || hasControlCharacters(body),
                    )}
                  </>
                )}
                {panel === "posts" && (
                  <>
                    <Text
                      accessibilityRole="header"
                      style={{
                        fontSize: 20,
                        fontWeight: "600",
                        color: theme.text,
                      }}
                    >
                      Group posts
                    </Text>
                    {result?.posts.length === 0 && (
                      <Text style={{ color: theme.textSecondary }}>
                        No posts are visible in your current membership.
                      </Text>
                    )}
                    {(result?.posts ?? []).map((post) => (
                      <View
                        key={post.id}
                        style={{
                          paddingVertical: 16,
                          gap: 8,
                          borderBottomWidth: 1,
                          borderColor: theme.border,
                        }}
                      >
                        <CommunityIdentityLink
                          userId={post.userId}
                          displayName={post.displayName}
                        />
                        <Text style={{ color: theme.text }}>{post.body}</Text>
                        {post.userId !== principal &&
                          button("Report post", () =>
                            setReport({ type: "group_post", id: post.id }),
                          )}
                        {(post.userId === principal ||
                          group.role !== "member") &&
                          button("Remove post", () =>
                            confirmAction(
                              "Remove this post?",
                              "The post will disappear from this group.",
                              {
                                operation: "deletePost",
                                ...base,
                                postId: post.id,
                              },
                            ),
                          )}
                      </View>
                    ))}
                  </>
                )}
                {panel === "manage" && group.role !== "member" && (
                  <>
                    <Text style={{ color: theme.text }}>
                      Invite someone you already follow. They choose whether to
                      join.
                    </Text>
                    {friends.map((friend) => (
                      <View key={friend.user.userId}>
                        {button(
                          `Invite ${friend.user.displayName} (@${friend.user.handle})`,
                          () =>
                            void act({
                              operation: "invite",
                              ...base,
                              targetUserId: friend.user.userId,
                            }),
                        )}
                      </View>
                    ))}
                    {friends.length === 0 && (
                      <Text style={{ color: theme.text }}>
                        Follow a friend before inviting them to this group.
                      </Text>
                    )}
                    {button(
                      "Create a seven-day request code",
                      () => void act({ operation: "code", ...base }),
                    )}
                  </>
                )}
                {panel === "manage" && group.role === "owner" && (
                  <>
                    {input("Updated group rules", rules, setRules, 1000)}
                    {button(
                      "Save group rules",
                      () => void act({ operation: "rules", ...base, rules }),
                      !rules.trim() || hasControlCharacters(rules),
                    )}
                  </>
                )}
                {panel === "members" && (
                  <>
                    <Text
                      accessibilityRole="header"
                      style={{
                        fontSize: 20,
                        fontWeight: "600",
                        color: theme.text,
                      }}
                    >
                      Members and requests
                    </Text>
                    {(result?.members ?? []).map((member) => (
                      <View key={member.userId} style={{ gap: 6 }}>
                        <Text style={{ color: theme.text }}>
                          {member.displayName} · @{member.handle} ·{" "}
                          {member.role} · {member.state}
                        </Text>
                        {group.role !== "member" &&
                          member.userId !== principal &&
                          member.role !== "owner" && (
                            <>
                              {member.state === "pending" &&
                                button(
                                  "Approve request",
                                  () =>
                                    void act({
                                      operation: "approve",
                                      ...base,
                                      targetUserId: member.userId,
                                      targetMembershipVersion:
                                        member.membershipVersion,
                                    }),
                                )}
                              {member.state !== "banned" &&
                                button("Remove member", () =>
                                  confirmAction(
                                    "Remove this member?",
                                    "They lose access and their group posts are hidden.",
                                    {
                                      operation: "remove",
                                      ...base,
                                      targetUserId: member.userId,
                                      targetMembershipVersion:
                                        member.membershipVersion,
                                    },
                                  ),
                                )}
                              {member.state === "banned" &&
                                group.role === "owner" &&
                                button(
                                  "Lift group ban (fresh request required)",
                                  () =>
                                    void act({
                                      operation: "unban",
                                      ...base,
                                      targetUserId: member.userId,
                                      targetMembershipVersion:
                                        member.membershipVersion,
                                    }),
                                )}
                              {reason.trim() &&
                                !hasControlCharacters(reason) &&
                                button("Ban with the reason below", () =>
                                  confirmAction(
                                    "Ban this member?",
                                    "They cannot request access until this ban is lifted.",
                                    {
                                      operation: "ban",
                                      ...base,
                                      targetUserId: member.userId,
                                      targetMembershipVersion:
                                        member.membershipVersion,
                                      reason,
                                    },
                                  ),
                                )}
                              {group.role === "owner" &&
                                member.state === "member" && (
                                  <>
                                    {button(
                                      member.role === "moderator"
                                        ? "Make member"
                                        : "Make moderator",
                                      () =>
                                        void act({
                                          operation: "role",
                                          ...base,
                                          targetUserId: member.userId,
                                          targetMembershipVersion:
                                            member.membershipVersion,
                                          role:
                                            member.role === "moderator"
                                              ? "member"
                                              : "moderator",
                                        }),
                                    )}
                                    {button(
                                      "Transfer ownership to this member",
                                      () =>
                                        confirmAction(
                                          "Transfer group ownership?",
                                          "This member will control the group. You become a regular member.",
                                          {
                                            operation: "transfer",
                                            ...base,
                                            targetUserId: member.userId,
                                            targetMembershipVersion:
                                              member.membershipVersion,
                                          },
                                        ),
                                    )}
                                  </>
                                )}
                            </>
                          )}
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
            {(((panel === "members" || panel === "manage") &&
              group.role !== "member") ||
              group.state === "banned" ||
              group.state === "removed") &&
              input(
                group.state === "banned" || group.state === "removed"
                  ? "Appeal reason"
                  : "Moderation or appeal decision reason",
                reason,
                setReason,
                500,
              )}
            {group.state === "pending" && (
              <Text style={{ color: theme.textSecondary }}>
                Your request is waiting for a group moderator to approve it.
              </Text>
            )}
            {group.state === "invited" && (
              <Text style={{ color: theme.textSecondary }}>
                Review the group rules before accepting the invitation.
              </Text>
            )}
            {(group.state === "banned" || group.state === "removed") &&
              button(
                "Appeal membership removal",
                () => void act({ operation: "appeal", ...base, reason }),
                !reason.trim() || hasControlCharacters(reason),
              )}
            {(panel === "manage" ||
              group.state === "banned" ||
              group.state === "removed") &&
              (result?.appeals ?? [])
                .filter((appeal) => appeal.groupId === group.id)
                .map((appeal) => (
                  <View key={appeal.id}>
                    <Text style={{ color: theme.text }}>
                      {appeal.reason} · {appeal.status}
                    </Text>
                    {group.role === "owner" && appeal.status === "pending" && (
                      <>
                        {button(
                          "Approve appeal (fresh request required)",
                          () =>
                            void act({
                              operation: "resolveAppeal",
                              ...base,
                              appealId: appeal.id,
                              appealMembershipVersion: appeal.membershipVersion,
                              decision: "approved",
                              reason,
                            }),
                          !reason.trim() || hasControlCharacters(reason),
                        )}
                        {button(
                          "Reject appeal",
                          () =>
                            void act({
                              operation: "resolveAppeal",
                              ...base,
                              appealId: appeal.id,
                              appealMembershipVersion: appeal.membershipVersion,
                              decision: "rejected",
                              reason,
                            }),
                          !reason.trim() || hasControlCharacters(reason),
                        )}
                      </>
                    )}
                  </View>
                ))}
            {panel === "manage" &&
              group.role === "owner" &&
              button("Disband this group and remove its posts", () =>
                confirmAction(
                  "Disband this group?",
                  "All memberships and group posts will be removed.",
                  { operation: "disband", ...base },
                ),
              )}
          </>
        )}
      </CommunityPage>
      {report && (
        <ReportModal
          visible
          targetType={report.type}
          targetId={report.id}
          principalKey={principal}
          onClose={() => setReport(null)}
          onSuccess={() => {
            setMessage("Report submitted.");
            setReport(null);
            void load();
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}
