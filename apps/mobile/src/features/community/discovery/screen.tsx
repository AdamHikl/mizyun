import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, Stack, type Href, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
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
import { MaxContentWidth } from "@/constants/theme";
import { useCommunityProfile } from "../use-community-profile";
import { buildCommunityInvitationLink } from "../invitation-links";
import { InitialsAvatar } from "../initials-avatar";
import { useCommunityPalette } from "../community-presentation";
import { DiscoveryController } from "./controller";
import { DiscoveryAccessGate } from "./access-gate";
import { invitationQrMatrix } from "./qr-matrix";
import { ReportModal } from "../safety";
import { captureSafetyReceipt } from "../safety/safety-api";
import { scopeCommunityClient } from "../scoped-client";
import { invalidateCommunityReads } from "../state/read-cache";

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
  const insets = useSafeAreaInsets();
  const palette = useCommunityPalette();
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
      if (foreground.current === (next === "active")) return;
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
    primary = false,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: primary ? "transparent" : colors.border,
          backgroundColor: primary ? palette.mint : "transparent",
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: primary ? palette.mintText : colors.text,
          fontWeight: primary ? "700" : "500",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const userCard = (
    user: PublicCommunityProfileDto,
    fromInvitation: boolean,
  ) => (
    <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
      <Link href={`/community/profile/${user.userId}` as Href} asChild>
        <Pressable
          style={styles.identityRow}
          accessibilityRole="link"
          accessibilityLabel={`View @${user.handle} profile`}
        >
          <InitialsAvatar
            symbol={user.avatarSymbol}
            seed={user.displayName}
            accessibilityLabel={user.displayName}
          />
          <View style={styles.identityCopy}>
            <Text style={[styles.subtitle, { color: colors.text }]}>
              {user.displayName}
            </Text>
            <Text style={{ color: colors.textSecondary }}>@{user.handle}</Text>
          </View>
        </Pressable>
      </Link>
      {user.userId === principalKey ? (
        <Text style={{ color: colors.text }}>This is your profile.</Text>
      ) : ["following", "mutual"].includes(
          user.relationshipWithViewer ?? "",
        ) ? (
        <Text style={{ color: colors.text }}>Following</Text>
      ) : user.relationshipWithViewer === "pending_outgoing" ? (
        <Text style={{ color: colors.text }}>Request pending</Text>
      ) : (
        button(
          "Request to follow",
          () =>
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
                    else if (
                      focused.current &&
                      foreground.current &&
                      currentController.current === controller
                    )
                      Alert.alert(
                        "Profile needs refreshing",
                        "No request was sent. Refresh the profile or search again, then request to follow again.",
                      );
                  },
                },
              ],
            ),
          state.busy,
          true,
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
    <KeyboardAvoidingView
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 48 + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Stack.Screen
          options={{ title: token ? "Friend invitation" : "Find friends" }}
        />
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
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: colors.text }]}
        >
          {token ? "Friend invitation" : "Find and invite"}
        </Text>
        <Text style={{ color: colors.textSecondary }}>
          Connect deliberately by exact handle or invitation. Follow approval is
          separate in each direction.
        </Text>
        {accessFresh && community.isEnrolled && community.status === "ready" ? (
          <>
            <View style={styles.contextRow}>
              <Text
                style={[styles.contextCopy, { color: colors.textSecondary }]}
              >
                Connecting as @{community.profile?.handle}
              </Text>
              <Link
                href={"/community/relationships" as Href}
                style={{ color: colors.primary, fontWeight: "600" }}
              >
                Your friends →
              </Link>
            </View>
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
                        Invitation unavailable. Ask your friend for a fresh
                        link.
                      </Text>
                    )}
              </>
            )}
            <View
              style={[styles.section, { backgroundColor: colors.background }]}
            >
              <View style={styles.sectionHeading}>
                <Text
                  accessibilityRole="header"
                  style={[
                    styles.subtitle,
                    styles.identityCopy,
                    { color: colors.text },
                  ]}
                >
                  Search a handle
                </Text>
              </View>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                Ask your friend for their exact @handle. They need to allow
                handle search in their profile.
              </Text>
              <TextInput
                accessibilityLabel="Exact friend handle"
                placeholder="@handle"
                placeholderTextColor={colors.textSecondary}
                autoCorrect={false}
                autoCapitalize="none"
                maxLength={25}
                returnKeyType="search"
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
              {button(
                "Find exact handle",
                () => void controller.search(query),
                state.busy,
                true,
              )}
              {state.result
                ? userCard(state.result, false)
                : state.searched && (
                    <Text style={{ color: colors.text }}>
                      No discoverable profile is available for that handle.
                    </Text>
                  )}
              <Text style={[styles.smallCopy, { color: colors.textSecondary }]}>
                No contact uploads, email lookup or suggested strangers.
              </Text>
            </View>
            <View
              style={[styles.section, { backgroundColor: colors.background }]}
            >
              <View style={styles.sectionHeading}>
                <Text
                  accessibilityRole="header"
                  style={[
                    styles.subtitle,
                    styles.identityCopy,
                    { color: colors.text },
                  ]}
                >
                  Invite a friend
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary }}>
                Send a link or show a QR code, even with handle search off. Your
                friend still chooses to request a follow, and you approve it.
              </Text>
              {button(
                "Create invitation",
                () => void controller.create(),
                state.busy,
                true,
              )}
              <Text style={[styles.smallCopy, { color: colors.textSecondary }]}>
                Links work for up to seven days. Anyone with a link can see your
                name, handle and initials. Turning search off does not revoke
                links; revoke each one here.
              </Text>
              {link && matrix && (
                <View
                  style={[styles.card, { backgroundColor: colors.background }]}
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
                      controller.getState().displayedInvitation ===
                        invitation &&
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
              {state.invitations.length > 0 && (
                <Text
                  accessibilityRole="header"
                  style={[styles.subtitle, { color: colors.text }]}
                >
                  Your invitations
                </Text>
              )}
              {state.invitations.map((item, index) => {
                const available =
                  !item.revokedAt && Date.parse(item.expiresAt) > Date.now();
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.card,
                      { backgroundColor: colors.background },
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
            </View>
            <View style={[styles.footer, { borderColor: colors.border }]}>
              {button("Refresh friends and invitations", () => {
                invalidateCommunityReads();
                revalidate();
              })}
            </View>
          </>
        ) : (
          <>
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.text }}
            >
              {community.status === "loading" ||
              (community.isEnrolled && !accessFresh)
                ? "Checking your Community access…"
                : (community.error ??
                  (principalKey
                    ? "Join Community before viewing this invitation. Participation requires admission during this pilot. Your private tracking stays available."
                    : "Sign in before viewing an invitation. Your friend's identity is hidden until Community access is checked."))}
            </Text>
            <Link href={"/account" as Href} style={{ color: colors.primary }}>
              Return to Account
            </Link>
            {principalKey && (
              <Link
                href={"/community" as Href}
                style={{ color: colors.primary }}
              >
                Open Community to join
              </Link>
            )}
            {principalKey &&
              button(
                "Check access again",
                revalidate,
                community.status === "loading",
              )}
            <Text style={{ color: colors.textSecondary }}>
              This invitation stays only in memory during this app session.
              After restarting, reopen the original link; it will be checked
              again.
            </Text>
          </>
        )}
        <Link
          href={"/community/safety" as Href}
          style={{ color: colors.primary, paddingVertical: 12 }}
        >
          Reports, appeals and safety contact
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 20,
    paddingBottom: 48,
    maxWidth: MaxContentWidth,
    width: "100%",
    alignSelf: "center",
  },
  contextRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
  },
  contextCopy: { flexShrink: 1, lineHeight: 22 },
  identityRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  identityCopy: { flex: 1, gap: 4 },
  heading: { fontSize: 25, fontWeight: "700" },
  section: { paddingVertical: 12, gap: 14 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { fontSize: 22 },
  body: { lineHeight: 23 },
  smallCopy: { fontSize: 13, lineHeight: 20 },
  footer: { borderTopWidth: 1, paddingTop: 20 },
  subtitle: { fontSize: 18, fontWeight: "600" },
  button: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    justifyContent: "center",
  },
  card: { paddingVertical: 14, gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, padding: 12 },
});
