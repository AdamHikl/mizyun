import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { generateAvatarSymbol } from "@mizyun/core";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  router,
  useFocusEffect,
  type Href,
  useLocalSearchParams,
} from "expo-router";
import { BottomTabInset, MaxContentWidth } from "@/constants/theme";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { COMMUNITY_ENROLLMENT_OPEN } from "@/composition/community-admission";
import { CommunityPage } from "./ui";
import { InitialsAvatar } from "./initials-avatar";
import { CommunityIntro, useCommunityPalette } from "./community-presentation";
import { useCommunityProfile } from "./use-community-profile";
import {
  communityProfileForm,
  validateCommunityEnrollment,
  validateCommunityProfileUpdate,
  type CommunityProfileForm,
} from "./profile-form";

interface CommunitySettingsScreenProps {
  /** Join within the Community tab; the tab provides its own header. */
  embedded?: boolean;
  /** Notifies verified membership, including recovery after an ambiguous save. */
  onJoined?: () => void;
}

export function CommunitySettingsScreen({
  embedded = false,
  onJoined,
}: CommunitySettingsScreenProps = {}) {
  const { session, profile } = useAuth();
  return (
    <SettingsContent
      key={session?.user.id ?? "signed-out"}
      principalKey={session?.user.id ?? null}
      birthYear={profile?.birthYear}
      embedded={embedded}
      onJoined={onJoined}
    />
  );
}

function SettingsContainer({
  embedded,
  children,
  title,
}: {
  embedded: boolean;
  children: ReactNode;
  title: string;
}) {
  return embedded ? (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingBottom: BottomTabInset + 40 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <CommunityPage title={title} backHref="/community/me">
      {children}
    </CommunityPage>
  );
}

function SettingsContent({
  principalKey,
  birthYear,
  embedded,
  onJoined,
}: {
  principalKey: string | null;
  birthYear?: number | null;
  embedded: boolean;
  onJoined?: () => void;
}) {
  const theme = useTheme();
  const { task } = useLocalSearchParams<{ task?: string }>();
  const [identityEditor, setIdentityEditor] = useState(task === "identity");
  const { state, actions } = useCommunityProfile({
    principalKey,
    birthYear,
    autoLoad: false,
  });
  const [message, setMessage] = useState<string | null>(null);
  // A failed request keeps the draft only in memory; a principal change remounts it.
  const [form, setForm] = useState<CommunityProfileForm>(() =>
    communityProfileForm(null),
  );
  const loadedIdentity = useRef<string | null>(null);
  const notifiedEnrollment = useRef(false);
  useEffect(() => {
    if (
      embedded &&
      state.status === "ready" &&
      state.isEnrolled &&
      !notifiedEnrollment.current
    ) {
      notifiedEnrollment.current = true;
      onJoined?.();
    }
  }, [embedded, state.status, state.isEnrolled, onJoined]);
  const { load } = actions;
  const foreground = useRef(AppState.currentState === "active");
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (foreground.current && principalKey !== null) void load();
      return () => {
        focused.current = false;
      };
    }, [load, principalKey]),
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) => {
      if (foreground.current === (next === "active")) return;
      foreground.current = next === "active";
      if (foreground.current && focused.current && principalKey !== null)
        void load();
    });
    return () => listener.remove();
  }, [load, principalKey]);
  useEffect(() => {
    const identity = state.profile
      ? `${state.profile.userId}:${state.profile.generation}:${state.profile.status}`
      : null;
    if (identity !== null && identity !== loadedIdentity.current) {
      setForm(communityProfileForm(state.profile));
      setMessage(null);
      loadedIdentity.current = identity;
    }
  }, [state.profile]);

  const editing = state.isEnrolled;
  const suspended = state.profile?.status === "suspended";
  const canEdit = state.status === "ready" && editing && !state.isSaving;
  const validation = editing
    ? validateCommunityProfileUpdate(form)
    : validateCommunityEnrollment(form);
  const canSubmit =
    state.status === "ready" &&
    !state.isSaving &&
    validation.success &&
    !suspended &&
    state.isAdultEligible &&
    (editing || COMMUNITY_ENROLLMENT_OPEN);
  const patch = <K extends keyof CommunityProfileForm>(
    field: K,
    value: CommunityProfileForm[K],
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage(null);
  };
  const save = async () => {
    if (!canSubmit) return;
    setMessage(null);
    if (editing) {
      const update = validateCommunityProfileUpdate(form);
      if (!update.success) return;
      const result = await actions.update(update.data);
      if (result.ok) {
        setMessage("Community profile saved.");
        setIdentityEditor(false);
      }
    } else {
      const enrollment = validateCommunityEnrollment(form);
      if (!enrollment.success) return;
      const result = await actions.enroll(enrollment.data);
      if (result.ok) {
        setMessage("You joined Community. No meals or workouts were shared.");
      }
    }
  };
  const confirmWithdrawal = () => {
    Alert.alert(
      "Leave Community?",
      "Your profile and shared cards become unavailable immediately. Follows, requests and invites end. Your handle stays reserved; returning requires a fresh choice and restores no social history. Your private tracking, Coach access and paid entitlement stay available.",
      [
        { text: "Keep Community", style: "cancel" },
        {
          text: "Leave Community",
          style: "destructive",
          onPress: () => {
            void actions.withdraw().then((result) => {
              if (result.ok)
                setMessage(
                  suspended
                    ? "Community participation ended. Your account restriction remains; private tracking stays available."
                    : "You left Community. Private tracking stays available.",
                );
            });
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SettingsContainer
        embedded={embedded}
        title={
          state.status !== "ready"
            ? "Community settings"
            : !editing
              ? state.isWithdrawn
                ? "Join again"
                : "Join Community"
              : identityEditor
                ? "Edit social identity"
                : "Community settings"
        }
      >
        {embedded && !editing && (
          <CommunityIntro
            title={
              editing
                ? identityEditor
                  ? "Edit social identity"
                  : "Community settings"
                : state.isWithdrawn
                  ? "Join again"
                  : "Join Community"
            }
            description={
              editing
                ? "Manage your independent Community choices."
                : "Create a separate social identity for the people you choose to connect with."
            }
          />
        )}
        {!editing && (
          <Section title="Always your choice">
            <ThemedText>
              Joining shares no saved meals or workouts and requests no
              notification permission. Your private tracking works without
              Community.
            </ThemedText>
            <ThemedText type="small">
              Community changes no analytics, AI or health permissions.
            </ThemedText>
            <ThemedText type="small">
              Create a separate social identity. Nothing is copied from your
              private profile. Your social name, handle and shared meal or
              workout day can identify you.
            </ThemedText>
          </Section>
        )}
        {editing ? (
          <Action
            label={
              identityEditor ? "Cancel identity editing" : "Back to my profile"
            }
            variant="link"
            disabled={state.isSaving}
            onPress={() => {
              if (identityEditor) {
                setForm(communityProfileForm(state.profile));
                setIdentityEditor(false);
                setMessage(null);
              } else router.push("/community/me" as Href);
            }}
          />
        ) : (
          <Action
            label="Keep tracking privately"
            variant="link"
            disabled={state.isSaving}
            onPress={() => router.replace("/(tabs)")}
          />
        )}

        {principalKey === null ? (
          <Section title="Sign in first">
            <ThemedText>Sign in to manage your Community choices.</ThemedText>
          </Section>
        ) : state.status === "idle" || state.status === "loading" ? (
          <Section title="Checking your Community status">
            <View accessibilityLabel="Loading Community settings" accessible>
              <ActivityIndicator />
              <ThemedText>Checking your Community status…</ThemedText>
            </View>
          </Section>
        ) : state.status === "error" ? (
          <Section title="We could not check your status">
            <ThemedText accessibilityLiveRegion="polite">
              {state.error ?? "Community is unavailable."}
            </ThemedText>
            <ThemedText>
              Changes are not confirmed. Check your status before trying again.
              Your private tracking stays available.
            </ThemedText>
            <Action
              label="Check Community status"
              variant="primary"
              onPress={() => void load()}
            />
          </Section>
        ) : (
          <>
            {!state.isAdultEligible && (
              <Section title="Eligibility check">
                <ThemedText>
                  We cannot confirm eligibility from your birth year. For this
                  check, you must have been born in{" "}
                  {new Date().getUTCFullYear() - 19} or earlier. If you were
                  born the following year, wait until the next UTC calendar
                  year. This does not verify identity or birthday.
                </ThemedText>
              </Section>
            )}
            {suspended || !state.isAdultEligible ? (
              <Section title="Community is unavailable">
                <ThemedText>
                  Private tracking and the account controls remain available.
                </ThemedText>
              </Section>
            ) : (
              <>
                {state.isWithdrawn && (
                  <Section title="A fresh start">
                    <ThemedText>
                      @{state.profile?.handle} stays reserved to your account.
                      Returning needs a fresh adult declaration and rules
                      consent. Previous follows, cards and invitations do not
                      return.
                    </ThemedText>
                  </Section>
                )}
                {(!editing || identityEditor) && (
                  <>
                    <Section title="How friends see you">
                      <ThemedText type="small" themeColor="textSecondary">
                        This is how friends will recognize you in Community.
                      </ThemedText>
                      <Field
                        label="Social display name"
                        value={form.displayName}
                        editable={
                          !state.isSaving &&
                          (editing ? canEdit : state.isAdultEligible)
                        }
                        onChange={(value) => patch("displayName", value)}
                      />
                      <Field
                        label="Handle"
                        value={form.handle}
                        editable={!state.profile && !state.isSaving}
                        onChange={(value) => patch("handle", value)}
                        handle
                      />
                      <ThemedText type="small" themeColor="textSecondary">
                        3–24 lowercase letters, digits or underscore. Your
                        handle cannot change during this pilot and stays
                        reserved when you leave.
                      </ThemedText>
                      {form.displayName.trim() !== "" && (
                        <View style={styles.profilePreview}>
                          <InitialsAvatar
                            symbol={
                              form.avatarSymbol.trim() ||
                              generateAvatarSymbol(form.displayName)
                            }
                            seed={form.handle}
                            accessibilityLabel={`Initials badge: ${form.avatarSymbol.trim() || generateAvatarSymbol(form.displayName)}`}
                          />
                          <View style={styles.flex}>
                            <ThemedText style={{ fontWeight: "700" }}>
                              {form.displayName.trim()}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                              {form.handle.trim()
                                ? `@${form.handle.trim()}`
                                : "Your Community badge"}
                            </ThemedText>
                          </View>
                        </View>
                      )}
                    </Section>
                    <Section title="A little about you">
                      <ThemedText type="small" themeColor="textSecondary">
                        Leave these blank if you prefer. Your badge uses your
                        display name's initials by default.
                      </ThemedText>
                      <Field
                        label="Initials (optional, 1–4 characters)"
                        value={form.avatarSymbol}
                        editable={
                          !state.isSaving &&
                          (editing ? canEdit : state.isAdultEligible)
                        }
                        onChange={(value) => patch("avatarSymbol", value)}
                      />
                      <Field
                        label="Bio (optional, up to 160 characters)"
                        value={form.bio}
                        editable={
                          !state.isSaving &&
                          (editing ? canEdit : state.isAdultEligible)
                        }
                        onChange={(value) => patch("bio", value)}
                        multiline
                      />
                      <ThemedText type="small" themeColor="textSecondary">
                        Keep sensitive health details, links, email addresses
                        and phone numbers out of your social profile.
                      </ThemedText>
                    </Section>
                  </>
                )}
                {editing && !identityEditor && (
                  <Section title="Social identity">
                    <View style={styles.profilePreview}>
                      <InitialsAvatar
                        symbol={
                          state.profile?.avatarSymbol ||
                          generateAvatarSymbol(state.profile?.displayName ?? "")
                        }
                        seed={state.profile?.handle ?? ""}
                      />
                      <View style={styles.flex}>
                        <ThemedText style={{ fontWeight: "700" }}>
                          {state.profile?.displayName}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          @{state.profile?.handle}
                        </ThemedText>
                      </View>
                    </View>
                    <Action
                      label="Edit social identity"
                      onPress={() => setIdentityEditor(true)}
                    />
                  </Section>
                )}
                {(!editing || !identityEditor) && (
                  <Section title="Let friends find you">
                    <Choice
                      label="Allow friends to find my exact handle"
                      checked={form.isSearchable}
                      disabled={state.isSaving || !state.isAdultEligible}
                      onChange={(value) => patch("isSearchable", value)}
                    />
                    <ThemedText type="small" themeColor="textSecondary">
                      An invitation can work with search off. Turning search off
                      does not end existing follows or invitations.
                    </ThemedText>
                    {editing && (
                      <ThemedText type="small" themeColor="textSecondary">
                        Saving changes no notification, analytics, AI or health
                        permissions.
                      </ThemedText>
                    )}
                  </Section>
                )}
                {(!editing || !identityEditor) && (
                  <Section
                    title={editing ? "Your sharing choices" : "Before you join"}
                  >
                    <ThemedText>
                      Only your currently approved followers see shared cards,
                      including earlier cards still shared. Follow approval is
                      directional: following someone does not let them follow
                      you.
                    </ThemedText>
                    {!editing && (
                      <ThemedText type="small" themeColor="textSecondary">
                        For our birth-year check, you must have been born in{" "}
                        {new Date().getUTCFullYear() - 19} or earlier. If you
                        were born the following year, wait until the next UTC
                        calendar year. This does not verify identity or
                        birthday.
                      </ThemedText>
                    )}
                    <Action
                      label="Read Community rules and privacy"
                      variant="link"
                      onPress={() => router.push("/community/rules" as Href)}
                    />
                    {!editing && (
                      <>
                        <Choice
                          label="I am 18 or older"
                          checked={form.adultDeclaration}
                          disabled={state.isSaving}
                          onChange={(value) => patch("adultDeclaration", value)}
                        />
                        <Choice
                          label="I accept the Community rules (2026-09-30)"
                          checked={form.acceptedTerms}
                          disabled={state.isSaving}
                          onChange={(value) => patch("acceptedTerms", value)}
                        />
                      </>
                    )}
                  </Section>
                )}
                <View style={styles.submitGroup}>
                  {!validation.success && (
                    <ThemedText accessibilityLiveRegion="polite" type="small">
                      {validation.error.issues[0]?.message}
                    </ThemedText>
                  )}
                  {!editing && !COMMUNITY_ENROLLMENT_OPEN && (
                    <ThemedText>Community is coming soon</ThemedText>
                  )}
                  <Action
                    label={
                      state.isSaving
                        ? "Saving…"
                        : editing
                          ? identityEditor
                            ? "Save Community profile"
                            : "Save discovery choice"
                          : "Join Community"
                    }
                    variant="primary"
                    disabled={!canSubmit}
                    onPress={() => void save()}
                  />
                </View>
              </>
            )}
          </>
        )}

        {state.status !== "error" && state.error && (
          <ThemedText accessibilityLiveRegion="polite">
            {state.error}
          </ThemedText>
        )}
        {message && (
          <ThemedText accessibilityLiveRegion="polite">{message}</ThemedText>
        )}
        {!embedded && principalKey !== null && !identityEditor && (
          <Section title="Communication">
            <Action
              label="Messages and messaging choices"
              onPress={() => router.push("/community/messages" as Href)}
            />
            <Action
              label="Community updates"
              onPress={() => router.push("/community/inbox" as Href)}
            />
            <Action
              label="Community notification preferences"
              onPress={() => router.push("/community/notifications" as Href)}
            />
            <Action
              label="Handle prefix discovery"
              onPress={() => router.push("/community/discover" as Href)}
            />
          </Section>
        )}
        {!embedded && principalKey !== null && !identityEditor && (
          <Section title="Connections and sharing">
            <Action
              label="Requests, followers and safety lists"
              onPress={() => router.push("/community/relationships" as Href)}
            />
            <Action
              label="Spaces and sharing choices"
              onPress={() => router.push("/community/more" as Href)}
            />
          </Section>
        )}
        {(!editing || !identityEditor) && (
          <Section title="Help & safety">
            <Action
              label="Community reports, appeals and safety contact"
              variant="link"
              onPress={() => router.push("/community/safety" as Href)}
            />
            <ThemedText type="small" themeColor="textSecondary">
              Community safety contact and appeal coverage are not verified yet.
              For imminent danger, contact your local emergency services.
            </ThemedText>
            {!embedded && (
              <>
                <Action
                  label="Account help and support"
                  variant="link"
                  onPress={() => router.push("/account-settings/legal" as Href)}
                />
                <Action
                  label="Account export and deletion"
                  variant="link"
                  onPress={() =>
                    router.push(
                      "/account-settings/account-data?anchor=export" as Href,
                    )
                  }
                />
                <Action
                  label="Account and sign out"
                  variant="link"
                  onPress={() =>
                    router.push("/account-settings/identity" as Href)
                  }
                />
              </>
            )}
          </Section>
        )}
        {!identityEditor &&
          principalKey !== null &&
          ((state.profile && state.profile.status !== "withdrawn") ||
            state.status === "error") && (
            <Section title="Take a step back">
              <ThemedText type="small" themeColor="textSecondary">
                Leaving ends Community participation. Your private tracking,
                Coach access and paid entitlement stay available.
              </ThemedText>
              <Action
                label="Leave Community"
                variant="destructive"
                disabled={state.isSaving}
                onPress={confirmWithdrawal}
              />
            </Section>
          )}
      </SettingsContainer>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { borderColor: theme.border }]}>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled = false,
  variant = "secondary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "link" | "destructive";
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        {
          borderColor:
            variant === "primary"
              ? theme.primary
              : variant === "link"
                ? "transparent"
                : theme.border,
          backgroundColor:
            variant === "primary" ? theme.primary : "transparent",
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <ThemedText
        style={[
          variant === "primary" && [
            styles.primaryLabel,
            { color: theme.onPrimary },
          ],
          variant === "destructive" && styles.destructiveLabel,
        ]}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Choice({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const palette = useCommunityPalette();
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={styles.choice}
    >
      <View
        style={[
          styles.checkMark,
          {
            backgroundColor: checked ? palette.mint : theme.backgroundElement,
            borderWidth: 1.5,
            borderColor: theme.textSecondary,
          },
        ]}
      >
        <ThemedText
          accessible={false}
          style={{
            color: checked ? palette.mintText : palette.blueText,
            fontWeight: "700",
          }}
        >
          {checked ? "✓" : ""}
        </ThemedText>
      </View>
      <ThemedText style={styles.flex} accessible={false}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  editable,
  handle = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  handle?: boolean;
  multiline?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText>{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={editable}
        multiline={multiline}
        autoCapitalize={handle ? "none" : "sentences"}
        autoCorrect={!handle}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.background,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    padding: 16,
    gap: 24,
    paddingBottom: 40,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  checkMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  section: { paddingBottom: 16, gap: 12, borderBottomWidth: 1 },
  sectionTitle: { fontSize: 18, lineHeight: 26, fontWeight: "700" },
  profilePreview: {
    gap: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  submitGroup: { gap: 12 },
  primaryLabel: { fontWeight: "700", textAlign: "center" },
  destructiveLabel: { fontWeight: "700" },
  action: {
    minHeight: 48,
    borderBottomWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    justifyContent: "center",
  },
  choice: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  flex: { flex: 1 },
  field: { gap: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
});
