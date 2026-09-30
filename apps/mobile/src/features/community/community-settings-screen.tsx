import { useCallback, useEffect, useRef, useState } from "react";
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
import { router, Stack, useFocusEffect, type Href } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { InitialsAvatar } from "./initials-avatar";
import { useCommunityProfile } from "./use-community-profile";
import {
  COMMUNITY_ENROLLMENT_OPEN,
  communityProfileForm,
  validateCommunityEnrollment,
  validateCommunityProfileUpdate,
  type CommunityProfileForm,
} from "./profile-form";

export function CommunitySettingsScreen() {
  const { session, profile } = useAuth();
  return (
    <SettingsContent
      key={session?.user.id ?? "signed-out"}
      principalKey={session?.user.id ?? null}
      birthYear={profile?.birthYear}
    />
  );
}

function SettingsContent({
  principalKey,
  birthYear,
}: {
  principalKey: string | null;
  birthYear?: number | null;
}) {
  const theme = useTheme();
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
  const { load } = actions;
  useFocusEffect(
    useCallback(() => {
      if (principalKey !== null) void load();
    }, [load, principalKey]),
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active" && principalKey !== null) void load();
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
      if (result.ok) setMessage("Community profile saved.");
    } else {
      const enrollment = validateCommunityEnrollment(form);
      if (!enrollment.success) return;
      const result = await actions.enroll(enrollment.data);
      if (result.ok)
        setMessage("You joined Community. No workouts were shared.");
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
      <Stack.Screen options={{ title: "Community" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText type="subtitle">Community</ThemedText>
        <ThemedText>
          Encourage friends with workouts that you choose to share. Your private
          tracking works without this.
        </ThemedText>
        <Action
          label="Keep tracking privately"
          onPress={() => router.replace("/(tabs)")}
        />
        {principalKey !== null && (
          <Action
            label="Requests, followers and safety lists"
            onPress={() => router.push("/community/relationships" as Href)}
          />
        )}
        {principalKey === null ? (
          <ThemedText>Sign in to manage your Community choices.</ThemedText>
        ) : state.status === "idle" || state.status === "loading" ? (
          <View accessibilityLabel="Loading Community settings" accessible>
            <ActivityIndicator />
            <ThemedText>Checking your Community status…</ThemedText>
          </View>
        ) : state.status === "error" ? (
          <>
            <ThemedText accessibilityLiveRegion="polite">
              {state.error ?? "Community is unavailable."}
            </ThemedText>
            <ThemedText>
              Changes are not confirmed. Check your status before trying again.
              Your private tracking stays available.
            </ThemedText>
            <Action
              label="Check Community status"
              onPress={() => void load()}
            />
          </>
        ) : (
          <>
            {!state.isAdultEligible && (
              <ThemedText>
                We cannot confirm eligibility from your birth year. Community is
                available when this check passes. Your private tracking stays
                available. With birth year only, eligibility requires a whole
                birth year of {new Date().getUTCFullYear() - 19} or earlier.
                Someone born the following year must wait until the next UTC
                calendar year. This check does not verify identity or birthday.
              </ThemedText>
            )}
            {suspended || !state.isAdultEligible ? (
              <ThemedText>
                Community is unavailable. Private tracking and the account
                controls below remain available.
              </ThemedText>
            ) : (
              <>
                {state.isWithdrawn && (
                  <ThemedText>
                    You left Community. @{state.profile?.handle} stays reserved
                    to your account. Returning needs fresh adult declaration and
                    rules consent; follows, cards and invitations do not return.
                  </ThemedText>
                )}
                {!editing && (
                  <>
                    <ThemedText>
                      Only your currently approved followers see shared cards,
                      including earlier cards still shared. Follow approval is
                      directional. Joining shares no saved workouts and requests
                      no notification permission.
                    </ThemedText>
                    <ThemedText>
                      Your social name, handle and workout day can identify you.
                      Enter a separate social identity; nothing is copied from
                      your private profile.
                    </ThemedText>
                    <ThemedText>
                      Birth year check: a whole year of{" "}
                      {new Date().getUTCFullYear() - 19} or earlier is eligible.
                      The following birth year must wait until the next UTC
                      calendar year. This is not identity verification.
                    </ThemedText>
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
                <Action
                  label="Read Community rules and privacy"
                  onPress={() => router.push("/community/rules" as Href)}
                />
                <Field
                  label="Handle"
                  value={form.handle}
                  editable={!state.profile && !state.isSaving}
                  onChange={(value) => patch("handle", value)}
                  handle
                />
                <ThemedText type="small">
                  3–24 lowercase letters, digits or underscore. Your handle
                  cannot change during this pilot and stays reserved when you
                  leave.
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
                  label="Initials (optional, 1–4 characters)"
                  value={form.avatarSymbol}
                  editable={
                    !state.isSaving &&
                    (editing ? canEdit : state.isAdultEligible)
                  }
                  onChange={(value) => patch("avatarSymbol", value)}
                />
                {form.displayName.trim() !== "" && (
                  <InitialsAvatar
                    symbol={
                      form.avatarSymbol.trim() ||
                      generateAvatarSymbol(form.displayName)
                    }
                    seed={form.handle}
                    accessibilityLabel={`Initials badge: ${form.avatarSymbol.trim() || generateAvatarSymbol(form.displayName)}`}
                  />
                )}
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
                <ThemedText type="small">
                  Keep sensitive health details, links, email addresses and
                  phone numbers out of your social profile.
                </ThemedText>
                <Choice
                  label="Allow friends to find my exact handle"
                  checked={form.isSearchable}
                  disabled={state.isSaving || !state.isAdultEligible}
                  onChange={(value) => patch("isSearchable", value)}
                />
                <ThemedText type="small">
                  An invite can work with search off. Turning search off does
                  not end existing follows or invites. Saving changes no
                  notification, analytics, AI or health permissions.
                </ThemedText>
                {!validation.success && (
                  <ThemedText accessibilityLiveRegion="polite" type="small">
                    {validation.error.issues[0]?.message}
                  </ThemedText>
                )}
                {!editing && !COMMUNITY_ENROLLMENT_OPEN && (
                  <ThemedText>
                    Community enrollment is not open yet. A verified safety
                    contact, legal review and pilot acceptance are still
                    pending.
                  </ThemedText>
                )}
                <Action
                  label={
                    state.isSaving
                      ? "Saving…"
                      : editing
                        ? "Save Community profile"
                        : "Join Community"
                  }
                  disabled={!canSubmit}
                  onPress={() => void save()}
                />
                {!editing && (
                  <Action
                    label="Not now"
                    disabled={state.isSaving}
                    onPress={() => router.replace("/(tabs)")}
                  />
                )}
              </>
            )}
          </>
        )}
        {principalKey !== null &&
          ((state.profile && state.profile.status !== "withdrawn") ||
            state.status === "error") && (
            <Action
              label="Leave Community"
              disabled={state.isSaving}
              onPress={confirmWithdrawal}
            />
          )}
        {state.status !== "error" && state.error && (
          <ThemedText accessibilityLiveRegion="polite">
            {state.error}
          </ThemedText>
        )}
        {message && (
          <ThemedText accessibilityLiveRegion="polite">{message}</ThemedText>
        )}
        <ThemedText type="small">
          Community safety contact and appeal coverage are not verified yet. For
          imminent danger, contact your local emergency services.
        </ThemedText>
        <Action
          label="Account help and support"
          onPress={() => router.push("/account-settings/legal" as Href)}
        />
        <Action
          label="Account export and deletion"
          onPress={() =>
            router.push("/account-settings/account-data?anchor=export" as Href)
          }
        />
        <Action
          label="Account and sign out"
          onPress={() => router.push("/account-settings/identity" as Href)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
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
        { borderColor: theme.border, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <ThemedText>{label}</ThemedText>
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
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={styles.choice}
    >
      <ThemedText accessible={false}>{checked ? "☑" : "☐"}</ThemedText>
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
            backgroundColor: theme.backgroundElement,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  action: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
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
