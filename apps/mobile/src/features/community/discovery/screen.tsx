import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, type Href, useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { PublicCommunityProfileDto } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { getAppVariant } from "@/composition/app-variant";
import { useTheme } from "@/hooks/use-theme";
import { useCommunityProfile } from "../use-community-profile";
import { buildCommunityInvitationLink } from "../invitation-links";
import { InitialsAvatar } from "../initials-avatar";
import { DiscoveryController } from "./controller";
import { DiscoveryAccessGate } from "./access-gate";
import { invitationQrMatrix } from "./qr-matrix";
import { ReportModal } from "../safety";
import { captureSafetyReceipt } from "../safety/safety-api";
import { scopeCommunityClient } from "../scoped-client";

export function DiscoveryScreen({
  token,
  principalKey,
  birthYear,
}: {
  token?: string;
  principalKey: string | null;
  birthYear?: number | null;
}) {
  const colors = useTheme();
  const community = useCommunityProfile({
    principalKey,
    birthYear,
    autoLoad: false,
  });
  const loadProfile = community.actions.load;
  const alive = useRef(false);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const controller = useMemo(
    () =>
      new DiscoveryController(
        apiClient,
        principalKey,
        token,
        () => alive.current,
      ),
    [principalKey, token],
  );
  const currentController = useRef(controller);
  currentController.current = controller;
  const [reportTarget, setReportTarget] = useState<{
    user: PublicCommunityProfileDto;
    receiptId?: string;
    controller: DiscoveryController;
  } | null>(null);
  const openReport = async (user: PublicCommunityProfileDto) => {
    const intentCurrent = controller.captureIntent();
    const valid = () =>
      alive.current &&
      currentController.current === controller &&
      intentCurrent();
    if (!principalKey || !valid()) return;
    const receipt = await captureSafetyReceipt(
      scopeCommunityClient(apiClient, principalKey, valid),
      "profile",
      user.userId,
    );
    if (valid())
      setReportTarget({
        user,
        controller,
        ...(receipt.ok ? { receiptId: receipt.value.id } : {}),
      });
  };
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const accessGate = useMemo(() => new DiscoveryAccessGate(), [controller]);
  const accessFresh = useSyncExternalStore(
    accessGate.subscribe,
    accessGate.getState,
    accessGate.getState,
  );
  const [query, setQuery] = useState("");
  const revalidate = useCallback(() => {
    alive.current = false;
    controller.pause();
    accessGate.invalidate();
    setQuery("");
    setReportTarget(null);
    if (focused.current && foreground.current && principalKey)
      void accessGate.revalidate(loadProfile);
  }, [controller, accessGate, loadProfile, principalKey]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      revalidate();
      return () => {
        focused.current = false;
        alive.current = false;
        controller.pause();
        accessGate.invalidate();
        setQuery("");
        setReportTarget(null);
      };
    }, [controller, accessGate, revalidate]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      foreground.current = next === "active";
      revalidate();
    });
    return () => subscription.remove();
  }, [revalidate]);
  useEffect(() => {
    alive.current = false;
    controller.pause();
    if (
      focused.current &&
      foreground.current &&
      accessFresh &&
      community.status === "ready" &&
      community.isEnrolled
    ) {
      alive.current = true;
      void controller.resume();
    }
  }, [
    controller,
    accessFresh,
    community.status,
    community.isEnrolled,
    community.profile?.generation,
  ]);
  const invitation = state.displayedInvitation;
  const link =
    invitation &&
    !invitation.revokedAt &&
    Date.parse(invitation.expiresAt) > Date.now()
      ? buildCommunityInvitationLink(
          invitation.token,
          getAppVariant() === "dev" ? "mizyun-dev" : "mizyun",
        )
      : null;
  useEffect(() => {
    if (!invitation || invitation.revokedAt) return;
    const remaining = Date.parse(invitation.expiresAt) - Date.now();
    if (remaining <= 0) {
      revalidate();
      return;
    }
    const timer = setTimeout(revalidate, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [invitation, revalidate]);
  const matrix = useMemo(
    () => (link ? invitationQrMatrix(link) : null),
    [link],
  );
  const renderIntent = controller.captureIntent();
  const button = (
    label: string,
    onPress: () => void,
    disabled = state.busy,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { borderColor: colors.border, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Text style={{ color: colors.text }}>{label}</Text>
    </Pressable>
  );
  const userCard = (
    user: PublicCommunityProfileDto,
    fromInvitation: boolean,
  ) => (
    <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
      <InitialsAvatar
        symbol={user.avatarSymbol}
        seed={user.displayName}
        accessibilityLabel={user.displayName}
      />
      <Text style={[styles.subtitle, { color: colors.text }]}>
        {user.displayName}
      </Text>
      <Text style={{ color: colors.textSecondary }}>@{user.handle}</Text>
      {user.userId === principalKey ? (
        <Text style={{ color: colors.text }}>This is your profile.</Text>
      ) : ["following", "mutual"].includes(
          user.relationshipWithViewer ?? "",
        ) ? (
        <Text style={{ color: colors.text }}>Following</Text>
      ) : user.relationshipWithViewer === "pending_outgoing" ? (
        <Text style={{ color: colors.text }}>Request pending</Text>
      ) : (
        button("Request to follow", () =>
          Alert.alert(
            `Follow @${user.handle}?`,
            `Request as @${community.profile?.handle}. They must approve before you can see their shared workouts. This does not give them access to yours.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Send request",
                onPress: () => {
                  if (alive.current && renderIntent())
                    void controller.follow(user, fromInvitation);
                },
              },
            ],
          ),
        )
      )}
      {user.userId !== principalKey &&
        button(
          fromInvitation
            ? "Report invitation or inviter"
            : "Report profile or handle",
          () => void openReport(user),
        )}
    </View>
  );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      {reportTarget && reportTarget.controller === controller && (
        <ReportModal
          visible
          targetType="profile"
          targetId={reportTarget.user.userId}
          targetHandle={reportTarget.user.handle}
          principalKey={principalKey}
          interactionReceiptId={reportTarget.receiptId}
          onClose={() => setReportTarget(null)}
          onSuccess={(_id, blocked) => {
            if (blocked) revalidate();
          }}
        />
      )}
      <Link
        href={"/community/safety" as Href}
        style={{ color: colors.primary }}
      >
        Reports, appeals and safety contact
      </Link>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        Find a friend
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        Invitations reveal only your friend's name, handle and initials. They
        never join or follow automatically.
      </Text>
      {accessFresh && community.isEnrolled && community.status === "ready" ? (
        <>
          <Text style={{ color: colors.text }}>
            You are using @{community.profile?.handle} (
            {community.profile?.displayName}).
          </Text>
          <Link
            href={"/community/relationships" as Href}
            style={{ color: colors.primary }}
          >
            Manage your friends and requests
          </Link>
          {state.busy && (
            <ActivityIndicator
              color={colors.primary}
              accessibilityLabel="Checking friends and invitations"
            />
          )}
          {state.error && (
            <Text accessibilityRole="alert" style={{ color: colors.text }}>
              {state.error}
            </Text>
          )}
          {state.notice && (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.text }}
            >
              {state.notice}
            </Text>
          )}
          {token && (
            <>
              <Text style={[styles.subtitle, { color: colors.text }]}>
                Invited by
              </Text>
              {state.inviter
                ? userCard(state.inviter, true)
                : !state.busy && (
                    <Text style={{ color: colors.text }}>
                      Invitation unavailable. Ask your friend for a fresh link.
                    </Text>
                  )}
            </>
          )}
          {button("Refresh", revalidate)}
          <Text style={[styles.subtitle, { color: colors.text }]}>
            Exact handle
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            Only friends who enabled handle search can appear. No suggestions,
            contact uploads or email lookup.
          </Text>
          <TextInput
            accessibilityLabel="Exact friend handle"
            placeholder="@handle"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="none"
            value={query}
            editable={!state.busy}
            onChangeText={(value) => {
              setQuery(value);
              controller.clearSearch();
            }}
            onSubmitEditing={() => void controller.search(query)}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border },
            ]}
          />
          {button("Find exact handle", () => void controller.search(query))}
          {state.result
            ? userCard(state.result, false)
            : state.searched && (
                <Text style={{ color: colors.text }}>
                  No discoverable profile is available for that handle.
                </Text>
              )}
          <Text style={[styles.subtitle, { color: colors.text }]}>
            Your invitations
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            Reusable for up to seven days. Anyone holding a link can see your
            minimal identity and request to follow. Turning handle search off
            does not revoke links; revoke each invitation here.
          </Text>
          {button("Create invitation", () => void controller.create())}
          {link && matrix && (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.backgroundElement },
              ]}
            >
              <Text style={{ color: colors.text }}>
                Invitation QR — expires{" "}
                {new Date(invitation!.expiresAt).toLocaleString()}
              </Text>
              <View
                accessible
                accessibilityLabel="Invitation QR code. Use Share invitation as an accessible alternative."
                style={{ alignSelf: "center", backgroundColor: "white" }}
              >
                {matrix.map((row, index) => (
                  <View key={index} style={{ flexDirection: "row" }}>
                    {row.map((dark, column) => (
                      <View
                        key={column}
                        style={{
                          width: 5,
                          height: 5,
                          backgroundColor: dark ? "black" : "white",
                        }}
                      />
                    ))}
                  </View>
                ))}
              </View>
              {button("Share invitation", () => {
                if (
                  alive.current &&
                  controller.getState().displayedInvitation === invitation &&
                  Date.parse(invitation!.expiresAt) > Date.now()
                )
                  void Share.share({
                    message: `Connect with me on Mizyun: ${link}`,
                    url: link,
                  }).catch(() => {
                    if (alive.current && renderIntent())
                      Alert.alert("Could not share", "Try sharing again.");
                  });
              })}
            </View>
          )}
          {state.invitations.map((item, index) => {
            const available =
              !item.revokedAt && Date.parse(item.expiresAt) > Date.now();
            return (
              <View
                key={item.id}
                style={[
                  styles.card,
                  { backgroundColor: colors.backgroundElement },
                ]}
              >
                <Text style={{ color: colors.text }}>
                  Invitation {index + 1} —{" "}
                  {item.revokedAt
                    ? "Revoked"
                    : available
                      ? "Active"
                      : "Expired"}
                </Text>
                <Text style={{ color: colors.textSecondary }}>
                  Expires {new Date(item.expiresAt).toLocaleString()}
                </Text>
                {available && (
                  <View style={styles.row}>
                    {button("Show QR and share", () =>
                      controller.show(item.id),
                    )}
                    {button("Revoke", () =>
                      Alert.alert(
                        "Revoke invitation?",
                        "This link and QR will stop working. Existing follows are unchanged.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Revoke",
                            style: "destructive",
                            onPress: () => {
                              if (alive.current && renderIntent())
                                void controller.revoke(item.id);
                            },
                          },
                        ],
                      ),
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </>
      ) : (
        <>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
            {community.status === "loading" ||
            (community.isEnrolled && !accessFresh)
              ? "Checking your Friends access…"
              : (community.error ??
                (principalKey
                  ? "Join Mizyun Friends separately before viewing this invitation. Pilot admission stays closed until approved. Private tracking stays available."
                  : "Sign in before viewing an invitation. Your friend's identity is hidden until Friends access is checked."))}
          </Text>
          <Link href={"/account" as Href} style={{ color: colors.primary }}>
            Return to Account
          </Link>
          {principalKey && (
            <Link
              href={"/community/settings" as Href}
              style={{ color: colors.primary }}
            >
              Friends profile and enrollment
            </Link>
          )}
          {principalKey &&
            button(
              "Check access again",
              revalidate,
              community.status === "loading",
            )}
          <Text style={{ color: colors.textSecondary }}>
            This invitation stays only in memory during this app session. After
            restarting, reopen the original link; it will be checked again.
          </Text>
        </>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: "600" },
  subtitle: { fontSize: 18, fontWeight: "600" },
  button: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    justifyContent: "center",
  },
  card: { padding: 16, borderRadius: 14, gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, padding: 12 },
});
