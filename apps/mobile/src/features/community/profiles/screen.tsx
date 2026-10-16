import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Alert, AppState, StyleSheet, View } from "react-native";
import { useFocusEffect, type Href } from "expo-router";
import type { CommunityProfileViewDto } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { InitialsAvatar } from "../initials-avatar";
import {
  CommunityPage,
  CommunityButton,
  CommunityRow,
  CommunitySection,
  CommunityState,
} from "../ui";
import { ReportModal } from "../safety";
import { activityRowSummary } from "../activity-row-summary";
import { captureSafetyReceipt } from "../safety/safety-api";
import { scopeCommunityClient } from "../scoped-client";
import { invalidateCommunityReads } from "../state/read-cache";
import { ProfileViewController, type ProfileAction } from "./controller";

export function CommunityMyProfileScreen() {
  const { session } = useAuth();
  return <CommunityPersonProfileScreen userId={session?.user.id ?? ""} own />;
}
export function CommunityPersonProfileScreen({
  userId,
  own = false,
}: {
  userId: string;
  own?: boolean;
}) {
  const { session } = useAuth();
  const principal = session?.user.id ?? null;
  const token = session?.accessToken ?? null;
  const lifetime = useRef({ token, revision: 0 });
  if (lifetime.current.token !== token)
    lifetime.current = { token, revision: lifetime.current.revision + 1 };
  const revision = lifetime.current.revision;
  const isLifetimeCurrent = useCallback(
    () => lifetime.current.revision === revision,
    [revision],
  );
  return (
    <PersonProfile
      key={`${principal}:${userId}:${revision}`}
      principal={principal}
      userId={userId}
      own={own}
      isLifetimeCurrent={isLifetimeCurrent}
    />
  );
}
function PersonProfile({
  principal,
  userId,
  own,
  isLifetimeCurrent,
}: {
  principal: string | null;
  userId: string;
  own: boolean;
  isLifetimeCurrent: () => boolean;
}) {
  const alive = useRef(false);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const controller = useMemo(
    () =>
      new ProfileViewController(
        apiClient,
        principal,
        userId,
        () => alive.current && isLifetimeCurrent(),
      ),
    [principal, userId, isLifetimeCurrent],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const [options, setOptions] = useState(false);
  const [report, setReport] = useState<{
    profile: CommunityProfileViewDto;
    receiptId?: string;
  } | null>(null);
  const reload = useCallback(() => {
    controller.pause();
    setReport(null);
    setOptions(false);
    alive.current =
      focused.current && foreground.current && isLifetimeCurrent();
    if (alive.current) {
      controller.resume();
      void controller.load();
    }
  }, [controller, isLifetimeCurrent]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      reload();
      return () => {
        focused.current = false;
        alive.current = false;
        controller.pause();
        setReport(null);
        setOptions(false);
      };
    }, [controller, reload]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (foreground.current === (next === "active")) return;
      foreground.current = next === "active";
      reload();
    });
    return () => sub.remove();
  }, [reload]);
  const profile = state.profile;
  const isSelf = profile?.relationshipWithViewer === "self";
  const outgoing = profile?.relationshipContext.outgoing;
  const incoming = profile?.relationshipContext.incoming;
  const act = (action: ProfileAction) => {
    if (!profile) return;
    const current = controller.captureIntent();
    const perform = () => {
      if (current()) {
        void controller.act(action, profile);
      } else if (
        alive.current &&
        focused.current &&
        foreground.current &&
        isLifetimeCurrent()
      ) {
        Alert.alert(
          "Profile needs refreshing",
          action === "follow"
            ? "No request was sent. Refresh the profile, then request to follow again."
            : "No action was sent. Refresh the profile and review your choice again.",
        );
      }
    };
    const explanation: Partial<Record<ProfileAction, string>> = {
      follow:
        "They must approve before you can see their shared meals and workouts. This does not give them access to yours.",
      approve:
        "They can see your still-published meal and workout cards, including past cards. This does not follow them back.",
      remove:
        "Removes their access to your shared meals and workouts and prior interactions.",
      unfollow: "Ends your access to their shared meals and workouts.",
      block:
        "Blocks interaction in both directions and removes both follows and requests. Unblocking restores nothing.",
    };
    if (!explanation[action]) {
      perform();
      return;
    }
    Alert.alert(
      `${action === "follow" ? "Request to follow" : action === "remove" ? "Remove follower" : action[0]!.toUpperCase() + action.slice(1)} @${profile.handle}?`,
      explanation[action],
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: perform },
      ],
    );
  };
  const openReport = async () => {
    if (!profile || !principal) return;
    const current = controller.captureReceiptIntent();
    const receipt = await captureSafetyReceipt(
      scopeCommunityClient(apiClient, principal, current),
      "profile",
      profile.userId,
    );
    if (current())
      setReport({
        profile,
        ...(receipt.ok ? { receiptId: receipt.value.id } : {}),
      });
  };
  return (
    <CommunityPage
      title={own ? "My profile" : "Profile"}
      destination={own ? "me" : undefined}
      backHref={"/community/people" as Href}
    >
      {state.loading || state.pending ? (
        <CommunityState
          title={state.pending ? "Saving…" : "Checking profile access…"}
          busy
        />
      ) : null}
      {state.error && !state.loading && !state.pending && (
        <View style={styles.failure}>
          <ThemedText type="small" accessibilityRole="alert">
            {state.error}
          </ThemedText>
          <CommunityButton label="Try again" onPress={reload} />
        </View>
      )}
      {state.notice && (
        <ThemedText type="small" accessibilityLiveRegion="polite">
          {state.notice}
        </ThemedText>
      )}
      {profile && (
        <>
          <Card style={styles.summary}>
            <View style={styles.identity}>
              <InitialsAvatar
                symbol={profile.avatarSymbol}
                seed={profile.handle}
                size={64}
              />
              <View style={styles.identityCopy}>
                <ThemedText type="title3" accessibilityRole="header">
                  {profile.displayName}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  @{profile.handle}
                </ThemedText>
              </View>
            </View>
            {profile.bio && <ThemedText type="small">{profile.bio}</ThemedText>}
            {!isSelf && (
              <ThemedText type="footnote" themeColor="textSecondary">
                {outgoing?.status === "approved"
                  ? incoming?.status === "approved"
                    ? "You follow each other"
                    : "Following"
                  : outgoing?.status === "pending"
                    ? "Request sent · waiting for approval"
                    : incoming?.status === "approved"
                      ? "Follows you"
                      : "Approval is required to see shared meals and workouts"}
              </ThemedText>
            )}
            {isSelf ? (
              <View style={styles.actions}>
                <CommunityButton
                  label="Edit profile"
                  href={"/community/settings?task=identity" as Href}
                />
                <CommunityButton
                  label="Invite"
                  href={"/community/invite" as Href}
                />
              </View>
            ) : (
              <View style={styles.actions}>
                {!outgoing && (
                  <CommunityButton
                    label={
                      incoming?.status === "approved"
                        ? "Follow back"
                        : "Request to follow"
                    }
                    onPress={() => act("follow")}
                    tone="primary"
                  />
                )}
                {outgoing?.status === "pending" && (
                  <CommunityButton
                    label="Cancel request"
                    onPress={() => act("cancel")}
                  />
                )}
                {state.canMessage && (
                  <CommunityButton
                    label="Message"
                    href={`/community/conversation/${profile.userId}` as Href}
                  />
                )}
                <CommunityButton
                  label={options ? "Close options" : "Options"}
                  onPress={() => setOptions(!options)}
                />
              </View>
            )}
          </Card>
          {isSelf ? (
            <>
              <CommunitySection title="People">
                <CommunityRow
                  title="Following"
                  icon="person"
                  href={"/(tabs)/community/people?list=following" as Href}
                />
                <CommunityRow
                  title="Followers"
                  icon="person"
                  href={"/(tabs)/community/people?list=followers" as Href}
                />
              </CommunitySection>
              <CommunitySection title="Sharing">
                <CommunityRow
                  title="Share a completed workout"
                  icon="dumbbell"
                  href="/community/share"
                />
                <CommunityRow
                  title="Share a saved meal"
                  icon="fork"
                  href={"/community/share-meal" as Href}
                />
                <CommunityRow
                  title="Shared routines and photos"
                  icon="photo"
                  href="/community/more"
                />
              </CommunitySection>
            </>
          ) : (
            <>
              {incoming?.status === "pending" && (
                <CommunitySection
                  title="They requested to follow you"
                  description="Approving lets them see your shared meals and workouts. Following back is separate."
                >
                  <View style={styles.actions}>
                    <CommunityButton
                      label="Approve"
                      onPress={() => act("approve")}
                      tone="primary"
                    />
                    <CommunityButton
                      label="Decline"
                      onPress={() => act("decline")}
                    />
                  </View>
                </CommunitySection>
              )}
              {!state.canMessage && (
                <ThemedText type="footnote" themeColor="textSecondary">
                  Messages need mutual following, both people's opt-in and
                  current access.
                </ThemedText>
              )}
              {options && (
                <CommunitySection title="Profile options">
                  {outgoing?.status === "approved" && (
                    <CommunityRow
                      title="Unfollow"
                      onPress={() => act("unfollow")}
                    />
                  )}
                  {outgoing?.status === "approved" && (
                    <CommunityRow
                      title="Mute in feed"
                      onPress={() => act("mute")}
                    />
                  )}
                  {incoming?.status === "approved" && (
                    <CommunityRow
                      title="Remove follower"
                      onPress={() => act("remove")}
                    />
                  )}
                  <CommunityRow
                    title="Report profile or handle"
                    onPress={() => void openReport()}
                  />
                  <CommunityRow
                    title="Block person"
                    danger
                    onPress={() => act("block")}
                  />
                </CommunitySection>
              )}
            </>
          )}
          <CommunitySection title="Shared meals and workouts">
            {state.activityError ? (
              <CommunityState
                title="Shared activities unavailable"
                description={state.activityError}
                action={
                  <CommunityButton label="Check again" onPress={reload} />
                }
              />
            ) : isSelf || outgoing?.status === "approved" ? (
              <>
                {state.activities.length === 0 && (
                  <CommunityState
                    title="No shared meals and workouts"
                    description={
                      isSelf
                        ? "Choose Share meal or Share a completed workout to preview and publish."
                        : "There are no currently available shared meals and workouts."
                    }
                  />
                )}
                {state.activities.map((item) => (
                  <CommunityRow
                    key={item.id}
                    {...activityRowSummary(item)}
                    href={`/community/activity/${item.id}` as Href}
                  />
                ))}
                {state.nextCursor && (
                  <CommunityButton
                    label="Load more shared meals and workouts"
                    onPress={() => void controller.load(true)}
                  />
                )}
              </>
            ) : (
              <CommunityState
                title="Shared meals and workouts need their approval"
                description="A follow request gives no access until approved."
              />
            )}
          </CommunitySection>
          {report?.profile === profile && (
            <ReportModal
              visible
              principalKey={principal}
              targetType="profile"
              targetId={profile.userId}
              targetHandle={profile.handle}
              interactionReceiptId={report.receiptId}
              onClose={reload}
              onSuccess={(_id, blocked) => {
                if (blocked) reload();
              }}
            />
          )}
        </>
      )}
      {(own || isSelf) && (
        <CommunitySection title="Settings">
          <CommunityRow
            title="Privacy, preferences and account"
            icon="settings"
            href={"/community/settings" as Href}
          />
          <CommunityRow
            title="Reports, appeals and safety contact"
            icon="privacy"
            href={"/community/safety" as Href}
          />
        </CommunitySection>
      )}
      {profile &&
        !state.error &&
        !state.activityError &&
        !state.loading &&
        !state.pending && (
          <CommunityButton
            label="Refresh profile"
            onPress={() => {
              invalidateCommunityReads();
              reload();
            }}
          />
        )}
    </CommunityPage>
  );
}
const styles = StyleSheet.create({
  failure: { gap: Spacing.two },
  summary: { gap: 12 },
  identity: { flexDirection: "row", gap: Spacing.three, alignItems: "center" },
  identityCopy: { flex: 1, gap: Spacing.half },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
});
