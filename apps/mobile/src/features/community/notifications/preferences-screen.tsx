import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { MaxContentWidth } from "@/constants/theme";
import { CommunityPage } from "../ui";
import { apiClient } from "@/composition/api-client";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { scopeCommunityClient } from "../scoped-client";
import { humanizeCommunityError } from "../community-client";
import {
  fetchCommunityNotificationPreferences,
  saveCommunityNotificationPreferences,
  type CommunityNotificationPreferences,
} from "./notification-client";
import { parseQuietHour, formatQuietHour } from "./quiet-hours";
import { CommunityDeviceAlertsControl } from "./device-alerts-control";

export function CommunityNotificationPreferencesScreen() {
  const { session } = useAuth();
  return (
    <PreferencesContent
      key={session?.user.id ?? "signed-out"}
      principal={session?.user.id ?? null}
    />
  );
}
function PreferencesContent({ principal }: { principal: string | null }) {
  const theme = useTheme();
  const lifetime = useRef({ active: true, foreground: false, revision: 0 });
  const [preferences, setPreferences] =
    useState<CommunityNotificationPreferences | null>(null);
  const [start, setStart] = useState("22:00");
  const [end, setEnd] = useState("08:00");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    lifetime.current.active = true;
    return () => {
      lifetime.current.active = false;
      lifetime.current.revision++;
    };
  }, []);
  const load = useCallback(async () => {
    if (!principal || !lifetime.current.active || !lifetime.current.foreground)
      return;
    const revision = ++lifetime.current.revision;
    const valid = () =>
      lifetime.current.active &&
      lifetime.current.foreground &&
      lifetime.current.revision === revision;
    setPreferences(null);
    setMessage(null);
    setBusy(true);
    const result = await fetchCommunityNotificationPreferences(
      scopeCommunityClient(apiClient, principal, valid),
    );
    if (!valid()) return;
    setBusy(false);
    if (result.ok) {
      setPreferences(result.value);
      setStart(formatQuietHour(result.value.quietHours?.startMinutes ?? 1320));
      setEnd(formatQuietHour(result.value.quietHours?.endMinutes ?? 480));
    } else setMessage(humanizeCommunityError(result.error));
  }, [principal]);
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      lifetime.current.foreground = AppState.currentState === "active";
      void load();
      const subscription = AppState.addEventListener("change", (value) => {
        if (!focused || lifetime.current.foreground === (value === "active"))
          return;
        lifetime.current.foreground = value === "active";
        lifetime.current.revision++;
        setPreferences(null);
        setMessage(null);
        setBusy(false);
        if (value === "active") void load();
      });
      return () => {
        focused = false;
        subscription.remove();
        lifetime.current.foreground = false;
        lifetime.current.revision++;
        setPreferences(null);
      };
    }, [load]),
  );
  const save = async () => {
    if (
      !preferences ||
      busy ||
      !lifetime.current.active ||
      !lifetime.current.foreground
    )
      return;
    let quietHours = preferences.quietHours;
    if (quietHours) {
      const startMinutes = parseQuietHour(start),
        endMinutes = parseQuietHour(end);
      if (
        startMinutes === null ||
        endMinutes === null ||
        startMinutes === endMinutes
      ) {
        setMessage("Enter two different times in 24-hour HH:MM format.");
        return;
      }
      quietHours = { startMinutes, endMinutes };
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: preferences.timezone });
    } catch {
      setMessage("Enter a valid timezone, such as Europe/Bratislava.");
      return;
    }
    const revision = ++lifetime.current.revision;
    const valid = () =>
      lifetime.current.active &&
      lifetime.current.foreground &&
      lifetime.current.revision === revision;
    setBusy(true);
    setMessage(null);
    const result = await saveCommunityNotificationPreferences(
      scopeCommunityClient(apiClient, principal, valid),
      { ...preferences, quietHours },
    );
    if (!valid()) return;
    setBusy(false);
    if (result.ok) {
      setPreferences(result.value);
      setMessage("Notification preferences saved.");
    } else
      setMessage(
        `Preferences not confirmed. ${humanizeCommunityError(result.error)}`,
      );
  };
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[
        styles.action,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const toggle = (
    label: string,
    value: boolean,
    onChange: (value: boolean) => void,
  ) => (
    <View style={[styles.toggle, { borderColor: theme.border }]}>
      <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={busy}
      />
    </View>
  );
  const input = (
    label: string,
    value: string,
    change: (value: string) => void,
  ) => (
    <View style={{ gap: 8 }}>
      <ThemedText>{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: theme.text, borderColor: theme.border }]}
      />
    </View>
  );
  return (
    <CommunityPage
      title="Update preferences"
      backHref="/community/inbox"
      scroll={false}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.background }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Stack.Screen
            options={{ title: "Update preferences", headerShown: false }}
          />
          <ThemedText>
            Phone notifications are not enabled yet. Your updates and private
            tracking work without notification permission.
          </ThemedText>
          {action("Keep tracking privately", () => router.replace("/(tabs)"))}
          {message && (
            <ThemedText accessibilityLiveRegion="polite">{message}</ThemedText>
          )}
          <CommunityDeviceAlertsControl
            isCurrent={() =>
              lifetime.current.active && lifetime.current.foreground
            }
          />
          {!principal ? (
            <ThemedText>
              Sign in to manage your Community notification preferences.
            </ThemedText>
          ) : preferences ? (
            <>
              {(
                [
                  ["requests", "Follow requests and approvals"],
                  ["reactions", "Encouragement reactions"],
                  ["moderation", "Community moderation outcomes"],
                  ["muted", "Mute Community notifications"],
                ] as const
              ).map(([key, label]) => (
                <React.Fragment key={key}>
                  {toggle(label, preferences[key], (value) =>
                    setPreferences({ ...preferences, [key]: value }),
                  )}
                </React.Fragment>
              ))}
              {toggle("Quiet hours", !!preferences.quietHours, (value) =>
                setPreferences({
                  ...preferences,
                  quietHours: value
                    ? { startMinutes: 1320, endMinutes: 480 }
                    : null,
                }),
              )}
              {input(
                "Your timezone (e.g. Europe/Bratislava)",
                preferences.timezone,
                (timezone) => setPreferences({ ...preferences, timezone }),
              )}
              {preferences.quietHours && (
                <>
                  {input("Quiet hours start (HH:MM)", start, setStart)}
                  {input("Quiet hours end (HH:MM)", end, setEnd)}
                  <ThemedText>
                    Times use your chosen timezone. Quiet hours can continue
                    past midnight.
                  </ThemedText>
                </>
              )}
              {action(
                busy ? "Saving…" : "Save preferences",
                () => void save(),
                busy,
              )}
            </>
          ) : (
            <>
              {busy && <ThemedText>Loading preferences…</ThemedText>}
              {action("Retry loading preferences", () => void load(), busy)}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </CommunityPage>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  action: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    justifyContent: "center",
  },
  toggle: {
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 14, padding: 12 },
});
