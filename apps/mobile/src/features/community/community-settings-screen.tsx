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
  View,
} from "react-native";
import {
  router,
  useFocusEffect,
  type Href,
  useLocalSearchParams,
} from "expo-router";
import {
  BottomTabInset,
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  FormField,
  FormStatus,
  FormTextInput,
  Icon,
  ListGroup,
  ListRow,
  Notice,
  SectionHeader,
  type IconName,
} from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { COMMUNITY_ENROLLMENT_OPEN } from "@/composition/community-admission";
import { CommunityPage } from "./ui";
import { InitialsAvatar } from "./initials-avatar";
import { CommunityIntro } from "./community-presentation";
import { COMMUNITY_CONTEXT_CHANGED_MESSAGE } from "./community-client";
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
  // Which request an error state follows: a failed save or leave is
  // unconfirmed, while a failed status check confirms nothing either way.
  const [errorOrigin, setErrorOrigin] = useState<"load" | "save" | "leave">(
    "load",
  );
  const [showOptional, setShowOptional] = useState(false);
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
  const { load: loadProfile } = actions;
  const load = useCallback(() => {
    setErrorOrigin("load");
    return loadProfile();
  }, [loadProfile]);
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
    setErrorOrigin("save");
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
            setErrorOrigin("leave");
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

  const ready = state.status === "ready";
  const blocked = suspended || !state.isAdultEligible;
  const showLeave =
    !identityEditor &&
    principalKey !== null &&
    ((state.profile && state.profile.status !== "withdrawn") ||
      state.status === "error");
  const birthYearRule = `For our birth-year check, you must have been born in ${new Date().getUTCFullYear() - 19} or earlier. If you were born the following year, wait until the next UTC calendar year. This does not verify identity or birthday.`;
  const optionalOpen =
    identityEditor ||
    showOptional ||
    form.avatarSymbol.trim() !== "" ||
    form.bio.trim() !== "";
  const avatarSymbol =
    form.avatarSymbol.trim() || generateAvatarSymbol(form.displayName);
  const privateExit = !editing && (
    <Button
      label="Keep tracking privately"
      variant="plain"
      disabled={state.isSaving}
      onPress={() => router.replace("/(tabs)")}
    />
  );

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SettingsContainer
        embedded={embedded}
        title={
          !ready
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
        {embedded && !editing && ready && !blocked && (
          <CommunityIntro
            title={state.isWithdrawn ? "Join again" : "Join Community"}
            description="Create a separate social identity for the people you choose to connect with."
          />
        )}
        {editing && (
          <InlineLink
            label={
              identityEditor ? "Cancel identity editing" : "Back to my profile"
            }
            icon={identityEditor ? "close" : "back"}
            disabled={state.isSaving}
            onPress={() => {
              if (identityEditor) {
                setForm(communityProfileForm(state.profile));
                setIdentityEditor(false);
                setMessage(null);
              } else router.push("/community/me" as Href);
            }}
          />
        )}

        {principalKey === null ? (
          <Notice
            title="Sign in first"
            message="Sign in to manage your Community choices."
          />
        ) : state.status === "idle" || state.status === "loading" ? (
          <>
            <Card
              style={styles.loading}
              accessibilityLabel="Loading Community settings"
              accessible
            >
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Checking your Community status…
              </ThemedText>
            </Card>
            {privateExit}
          </>
        ) : state.status === "error" ? (
          <>
            <StatusError
              origin={errorOrigin}
              error={state.error}
              onRetry={() => void load()}
            />
            {privateExit}
          </>
        ) : blocked ? (
          <>
            <Notice
              tone="warning"
              title="Community is unavailable"
              message={
                !state.isAdultEligible
                  ? `We cannot confirm eligibility from your birth year. ${birthYearRule} Private tracking and the account controls remain available.`
                  : "Private tracking and the account controls remain available."
              }
            />
            {privateExit}
          </>
        ) : (
          <>
            {state.isWithdrawn && (
              <Notice
                title="A fresh start"
                message={`@${state.profile?.handle} stays reserved to your account. Returning needs a fresh adult declaration and rules consent. Previous follows, cards and invitations do not return.`}
              />
            )}
            {!editing && (
              <Card accessibilityRole="summary">
                <ThemedText type="smallBold">Always your choice</ThemedText>
                <Assurance icon="privacy">
                  Joining shares no saved meals or workouts and requests no
                  notification permission. Your private tracking works without
                  Community.
                </Assurance>
                <Assurance icon="settings">
                  Community changes no analytics, AI or health permissions.
                </Assurance>
                <Assurance icon="person">
                  Create a separate social identity. Nothing is copied from your
                  private profile. Your social name, handle and shared meal or
                  workout day can identify you.
                </Assurance>
              </Card>
            )}
            {(!editing || identityEditor) && (
              <>
                <SectionHeader title="How friends see you" />
                <Card style={styles.formCard}>
                  <View style={styles.profilePreview}>
                    <InitialsAvatar
                      symbol={avatarSymbol}
                      seed={form.handle}
                      accessibilityLabel={`Initials badge: ${avatarSymbol}`}
                    />
                    <View style={styles.flex}>
                      <ThemedText type="headline">
                        {form.displayName.trim() || "Your social name"}
                      </ThemedText>
                      <ThemedText type="footnote" themeColor="textSecondary">
                        {form.handle.trim()
                          ? `@${form.handle.trim()}`
                          : "Your Community badge"}
                      </ThemedText>
                    </View>
                  </View>
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
                    hint="3–24 lowercase letters, digits or underscore. Your handle cannot be changed later and stays reserved when you leave."
                    handle
                  />
                  {!identityEditor && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add initials or a bio (optional)"
                      accessibilityState={{ expanded: optionalOpen }}
                      onPress={() => setShowOptional(!optionalOpen)}
                      style={styles.disclosure}
                    >
                      <ThemedText type="small" themeColor="primary">
                        Add initials or a bio (optional)
                      </ThemedText>
                      <Icon
                        name={optionalOpen ? "chevronUp" : "chevronDown"}
                        size={14}
                        color="primary"
                      />
                    </Pressable>
                  )}
                  {optionalOpen && (
                    <>
                      <ThemedText type="footnote" themeColor="textSecondary">
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
                      <ThemedText type="footnote" themeColor="textSecondary">
                        Keep sensitive health details, links, email addresses
                        and phone numbers out of your social profile.
                      </ThemedText>
                    </>
                  )}
                </Card>
              </>
            )}
            {editing && !identityEditor && (
              <>
                <SectionHeader title="Social identity" />
                <Card>
                  <View style={styles.profilePreview}>
                    <InitialsAvatar
                      symbol={
                        state.profile?.avatarSymbol ||
                        generateAvatarSymbol(state.profile?.displayName ?? "")
                      }
                      seed={state.profile?.handle ?? ""}
                    />
                    <View style={styles.flex}>
                      <ThemedText type="headline">
                        {state.profile?.displayName}
                      </ThemedText>
                      <ThemedText type="footnote" themeColor="textSecondary">
                        @{state.profile?.handle}
                      </ThemedText>
                    </View>
                  </View>
                  <Button
                    label="Edit social identity"
                    variant="tinted"
                    icon="edit"
                    onPress={() => setIdentityEditor(true)}
                  />
                </Card>
              </>
            )}
            {(!editing || !identityEditor) && (
              <>
                <SectionHeader title="Let friends find you" />
                <Card>
                  <Choice
                    label="Allow friends to find my exact handle"
                    checked={form.isSearchable}
                    disabled={state.isSaving || !state.isAdultEligible}
                    onChange={(value) => patch("isSearchable", value)}
                  />
                  <ThemedText type="footnote" themeColor="textSecondary">
                    An invitation can work with search off. Turning search off
                    does not end existing follows or invitations.
                  </ThemedText>
                  {editing && (
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Saving changes no notification, analytics, AI or health
                      permissions.
                    </ThemedText>
                  )}
                </Card>
                <SectionHeader
                  title={editing ? "Your sharing choices" : "Before you join"}
                />
                <Card>
                  <ThemedText type="small">
                    Only your currently approved followers see shared cards,
                    including earlier cards still shared. Follow approval is
                    directional: following someone does not let them follow you.
                  </ThemedText>
                  {!editing && (
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {birthYearRule}
                    </ThemedText>
                  )}
                  <InlineLink
                    label="Read Community rules and privacy"
                    icon="book"
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
                </Card>
              </>
            )}
            <View style={styles.submitGroup}>
              {!validation.success && (
                <ThemedText
                  accessibilityLiveRegion="polite"
                  type="footnote"
                  themeColor="textSecondary"
                >
                  {validation.error.issues[0]?.message}
                </ThemedText>
              )}
              {!editing && !COMMUNITY_ENROLLMENT_OPEN && (
                <Notice message="Community is coming soon" />
              )}
              <Button
                label={
                  editing
                    ? identityEditor
                      ? "Save Community profile"
                      : "Save discovery choice"
                    : "Join Community"
                }
                block
                loading={state.isSaving}
                disabled={!canSubmit}
                onPress={() => void save()}
              />
              {privateExit}
            </View>
          </>
        )}

        {state.status !== "error" && state.error && (
          <View accessibilityLiveRegion="polite">
            <FormStatus tone="error">{state.error}</FormStatus>
          </View>
        )}
        {message && (
          <View accessibilityLiveRegion="polite">
            <Notice tone="success" message={message} />
          </View>
        )}
        {!embedded && principalKey !== null && !identityEditor && (
          <>
            <SectionHeader title="Communication" />
            <ListGroup>
              <ListRow
                icon="chat"
                title="Messages and messaging choices"
                onPress={() => router.push("/community/messages" as Href)}
              />
              <ListRow
                icon="bell"
                title="Community updates"
                onPress={() => router.push("/community/inbox" as Href)}
              />
              <ListRow
                icon="settings"
                title="Community notification preferences"
                onPress={() => router.push("/community/notifications" as Href)}
              />
              <ListRow
                icon="search"
                title="Handle prefix discovery"
                onPress={() => router.push("/community/discover" as Href)}
              />
            </ListGroup>
            <SectionHeader title="Connections and sharing" />
            <ListGroup>
              <ListRow
                icon="person"
                title="Requests, followers and safety lists"
                onPress={() => router.push("/community/relationships" as Href)}
              />
              <ListRow
                icon="share"
                title="Spaces and sharing choices"
                onPress={() => router.push("/community/more" as Href)}
              />
            </ListGroup>
          </>
        )}
        {(!editing || !identityEditor) && (
          <>
            <SectionHeader title="Help & safety" />
            <ListGroup>
              <ListRow
                icon="privacy"
                iconTone="info"
                title="Community reports, appeals and safety contact"
                onPress={() => router.push("/community/safety" as Href)}
              />
              {!embedded && (
                <ListRow
                  icon="info"
                  iconTone="neutral"
                  title="Account help and support"
                  onPress={() => router.push("/account-settings/legal" as Href)}
                />
              )}
              {!embedded && (
                <ListRow
                  icon="history"
                  iconTone="neutral"
                  title="Account export and deletion"
                  onPress={() =>
                    router.push(
                      "/account-settings/account-data?anchor=export" as Href,
                    )
                  }
                />
              )}
              {!embedded && (
                <ListRow
                  icon="person"
                  iconTone="neutral"
                  title="Account and sign out"
                  onPress={() =>
                    router.push("/account-settings/identity" as Href)
                  }
                />
              )}
            </ListGroup>
            <ThemedText type="footnote" themeColor="textSecondary">
              Report anything that breaks the Community rules from its menu. For
              imminent danger, contact your local emergency services.
            </ThemedText>
          </>
        )}
        {showLeave && (
          <>
            <SectionHeader title="Take a step back" />
            <ListGroup>
              <ListRow
                icon="close"
                iconTone="danger"
                title="Leave Community"
                destructive
                chevron={false}
                disabled={state.isSaving}
                onPress={confirmWithdrawal}
              />
            </ListGroup>
            <ThemedText type="footnote" themeColor="textSecondary">
              Leaving ends Community participation. Your private tracking, Coach
              access and paid entitlement stay available.
            </ThemedText>
          </>
        )}
      </SettingsContainer>
    </KeyboardAvoidingView>
  );
}

/**
 * Leads with recovery. A failed check confirms nothing, while a failed save or
 * leave may still have reached the server, so those ask for a fresh check.
 */
function StatusError({
  origin,
  error,
  onRetry,
}: {
  origin: "load" | "save" | "leave";
  error: string | null;
  onRetry: () => void;
}) {
  const interrupted = error === COMMUNITY_CONTEXT_CHANGED_MESSAGE;
  const cause =
    origin === "load" && interrupted
      ? "Your status check was interrupted."
      : (error ?? "Community is unavailable.");
  return (
    <View accessibilityLiveRegion="polite">
      <Notice
        tone="danger"
        title={
          origin === "load"
            ? "We could not check your status"
            : origin === "save"
              ? "Your changes are not confirmed"
              : "Leaving is not confirmed"
        }
        message={
          origin === "load"
            ? `${cause} Your private tracking stays available.`
            : `${cause} Check your status before trying again. Your private tracking stays available.`
        }
        action={
          <Button
            label="Check Community status"
            icon="repeat"
            block
            style={styles.noticeAction}
            onPress={onRetry}
          />
        }
      />
    </View>
  );
}

function Assurance({
  icon,
  children,
}: {
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <View style={styles.promise}>
      <Icon name={icon} size={18} color="primary" style={styles.promiseIcon} />
      <ThemedText type="small" style={styles.flex}>
        {children}
      </ThemedText>
    </View>
  );
}

function InlineLink({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.inlineLink, disabled && styles.disabled]}
    >
      <Icon name={icon} size={16} color="primary" />
      <ThemedText type="small" themeColor="primary" style={styles.flex}>
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
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[styles.choice, disabled && styles.disabled]}
    >
      <View
        style={[
          styles.checkMark,
          checked
            ? { backgroundColor: theme.primary, borderColor: theme.primary }
            : { borderColor: theme.textSecondary },
        ]}
      >
        {checked ? (
          <Icon name="check" size={14} tintColor={theme.onPrimary} />
        ) : null}
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
  hint,
  handle = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  hint?: string;
  handle?: boolean;
  multiline?: boolean;
}) {
  return (
    <FormField label={label}>
      <FormTextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChange}
        editable={editable}
        multiline={multiline}
        autoCapitalize={handle ? "none" : "sentences"}
        autoCorrect={!handle}
        style={multiline && styles.multiline}
      />
      {hint ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </FormField>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.two,
    gap: Spacing.three,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  inlineLink: {
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  formCard: { gap: Spacing.three },
  promise: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
    paddingVertical: Spacing.one,
  },
  promiseIcon: { marginTop: 2 },
  checkMark: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
  },
  profilePreview: {
    gap: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  disclosure: {
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  submitGroup: { gap: Spacing.two, marginTop: Spacing.two },
  noticeAction: { marginTop: Spacing.two },
  disabled: { opacity: 0.5 },
  choice: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  flex: { flex: 1 },
});
