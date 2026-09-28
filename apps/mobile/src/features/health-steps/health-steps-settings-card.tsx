import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

import {
  connectHealthSteps,
  loadHealthStepsEnabled,
  setHealthStepsEnabled,
} from "./health-steps";

export function HealthStepsSettingsCard({
  userId,
}: {
  readonly userId: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const currentUserId = useRef(userId);
  currentUserId.current = userId;
  const source = Platform.OS === "ios" ? "Apple Health" : "Health Connect";

  useEffect(() => {
    let active = true;
    setEnabled(false);
    setMessage(null);
    setBusy(true);
    void loadHealthStepsEnabled(userId).then((saved) => {
      if (!active) return;
      setEnabled(saved);
      setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const connect = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const result = await connectHealthSteps(userId);
    if (currentUserId.current !== userId) return;
    if (result === "connected") {
      setEnabled(true);
      setMessage(
        Platform.OS === "ios"
          ? "Steps are enabled. If none appear, check Mizyun's Steps access in Apple Health."
          : "Steps are enabled for your dashboard.",
      );
    } else if (result === "install_required") {
      setMessage("Install or update Health Connect, then try again.");
    } else if (result === "permission_denied") {
      setMessage("Step access was not granted. You can try again anytime.");
    } else if (result === "unavailable") {
      setMessage("Step access is unavailable on this device or build.");
    } else {
      setMessage("Could not enable steps. Please try again.");
    }
    setBusy(false);
  }, [userId]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await setHealthStepsEnabled(userId, false);
      if (currentUserId.current !== userId) return;
      setEnabled(false);
      setMessage(
        "Mizyun has stopped reading steps. You can also revoke access in device settings.",
      );
    } catch {
      if (currentUserId.current !== userId) return;
      setMessage("Could not save this change. Please try again.");
    } finally {
      if (currentUserId.current === userId) setBusy(false);
    }
  }, [userId]);

  return (
    <View style={styles.content}>
      <ThemedText type="small" themeColor="textSecondary">
        Optionally show today&apos;s steps from {source} on your dashboard.
        Mizyun reads only steps, on this device. Steps do not change your
        calorie target or get sent to Mizyun&apos;s server.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          enabled
            ? `Stop reading steps from ${source}`
            : `Enable steps from ${source}`
        }
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void (enabled ? disconnect() : connect())}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          busy && styles.disabled,
        ]}
      >
        <ThemedText type="smallBold" style={styles.buttonText}>
          {busy
            ? "Checking…"
            : enabled
              ? "Stop reading steps"
              : `Enable ${source} steps`}
        </ThemedText>
      </Pressable>
      {message ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
        >
          {message}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three },
  button: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: "#0C70ED",
  },
  buttonText: { color: "#FFFFFF" },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
