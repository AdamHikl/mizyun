import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  reserveAnalyticsReminder,
  stopAnalyticsReminders,
} from "./consent-reminder-preferences";

interface AnalyticsConsentReminderProps {
  readonly ownerId: string | null;
  readonly sessionKey: string | null;
  readonly canPrompt: boolean;
  readonly readConsent: () => Promise<"unknown" | "granted" | "denied" | null>;
  readonly openSettings: () => void;
}

export function AnalyticsConsentReminder({
  ownerId,
  sessionKey,
  canPrompt,
  readConsent,
  openSettings,
}: AnalyticsConsentReminderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [visibleFor, setVisibleFor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = useRef({ ownerId, sessionKey, canPrompt, foreground });
  current.current = { ownerId, sessionKey, canPrompt, foreground };

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setVisibleFor(null);
    setMessage(null);
    setSaving(false);
    if (!ownerId || !sessionKey || !canPrompt || !foreground) return;
    let cancelled = false;
    const isCurrent = () =>
      !cancelled &&
      current.current.ownerId === ownerId &&
      current.current.sessionKey === sessionKey &&
      current.current.canPrompt &&
      current.current.foreground;
    // Only Home can mount the dialog; a route change cancels this quiet delay.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (
            !isCurrent() ||
            (await readConsent()) !== "unknown" ||
            !isCurrent()
          )
            return;
          if (
            await reserveAnalyticsReminder(
              ownerId,
              undefined,
              Date.now(),
              isCurrent,
            )
          ) {
            if (isCurrent()) setVisibleFor(sessionKey);
          }
        } catch {
          // Consent/network/storage failures must never interrupt core use.
        }
      })();
    }, 8000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ownerId, sessionKey, canPrompt, foreground, readConsent]);

  const visible = Boolean(
    ownerId &&
    sessionKey &&
    visibleFor === sessionKey &&
    canPrompt &&
    foreground,
  );
  const dismiss = () => setVisibleFor(null);
  const stopAsking = async () => {
    if (!visible || !ownerId || saving) return;
    const capturedSession = sessionKey;
    setSaving(true);
    try {
      await stopAnalyticsReminders(ownerId);
      if (current.current.sessionKey === capturedSession) dismiss();
    } catch {
      if (current.current.sessionKey === capturedSession) {
        setMessage(
          "The reminder preference could not be saved. Try again, or choose Remind me in 2 weeks.",
        );
      }
    } finally {
      if (current.current.sessionKey === capturedSession) setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      <View
        style={[
          styles.backdrop,
          {
            paddingTop: insets.top + Spacing.four,
            paddingBottom: insets.bottom + Spacing.four,
          },
        ]}
      >
        <ThemedView
          type="backgroundElement"
          style={styles.card}
          accessibilityViewIsModal
        >
          <ScrollView contentContainerStyle={styles.content}>
            <ThemedText type="smallBold" accessibilityRole="header">
              Help improve Mizyun
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Optional usage analytics helps us see which screens work well and
              where actions fail. It is separate from AI consent.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              If you allow it, coarse usage events go to Mizyun’s servers,
              linked to your account and retained for up to 30 days. They
              exclude health values, food names, photos, messages and typed
              content. You can turn it off and clear it anytime.
            </ThemedText>
            <ThemedText type="small">
              Mizyun works the same either way. Review the choice before
              enabling it.
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (!visible) return;
                dismiss();
                openSettings();
              }}
              style={[styles.button, { borderColor: theme.textSecondary }]}
            >
              <ThemedText type="smallBold">Review analytics</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={dismiss}
              style={styles.button}
            >
              <ThemedText type="smallBold">Remind me in 2 weeks</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              accessibilityState={{ disabled: saving }}
              onPress={() => void stopAsking()}
              style={styles.button}
            >
              <ThemedText type="smallBold">Don’t ask again</ThemedText>
            </Pressable>
            {message ? (
              <ThemedText type="small" accessibilityRole="alert">
                {message}
              </ThemedText>
            ) : null}
          </ScrollView>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  card: { width: "100%", maxWidth: 480, maxHeight: "100%", borderRadius: 16 },
  content: { padding: Spacing.four, gap: Spacing.three },
  button: {
    minHeight: 44,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
});
