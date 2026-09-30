import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { communityPushLifecycle } from "./push-native";

export function CommunityDeviceAlertsControl({
  isCurrent,
}: {
  isCurrent: () => boolean;
}) {
  const { session } = useAuth();
  const theme = useTheme();
  const identity = useRef(session?.user.id);
  identity.current = session?.user.id;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const enable = async () => {
    if (!session || busy || !isCurrent()) return;
    const id = session.user.id;
    setBusy(true);
    setMessage(null);
    try {
      await communityPushLifecycle.setPrincipal(session);
    } catch {
      if (mounted.current) {
        setBusy(false);
        setMessage("Device registration is unavailable. Retry when connected.");
      }
      return;
    }
    if (!mounted.current || identity.current !== id) return;
    if (!isCurrent()) {
      setBusy(false);
      return;
    }
    const result = await communityPushLifecycle.registerExplicit(id);
    if (!mounted.current || identity.current !== id) return;
    setBusy(false);
    if (!isCurrent()) return;
    setMessage(
      result === "registered"
        ? "This device is registered for this account. Device alerts are not available yet."
        : result === "denied"
          ? "Device permission was denied. Your inbox and private tracking remain available."
          : "Device registration was not confirmed. Check your connection and notification settings, then retry.",
    );
  };
  const disable = async () => {
    if (!session || busy || !isCurrent()) return;
    const id = session.user.id;
    setBusy(true);
    const result = await communityPushLifecycle.deregister(session);
    if (!mounted.current || identity.current !== id) return;
    setBusy(false);
    if (!isCurrent()) return;
    setMessage(
      result
        ? "Community device alerts turned off."
        : "Local opt-in cleared. Server removal could not be confirmed; retry when connected or sign out to revoke this session.",
    );
  };
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="subtitle">Optional device alerts</ThemedText>
      <ThemedText>
        Register this device separately for your current account. Alerts use
        generic text. Permission is requested only when you choose to register.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !session }}
        disabled={busy || !session}
        onPress={() => void enable()}
        style={[styles.button, { borderColor: theme.border }]}
      >
        <ThemedText>Register this device for Community alerts</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !session }}
        disabled={busy || !session}
        onPress={() => void disable()}
        style={[styles.button, { borderColor: theme.border }]}
      >
        <ThemedText>Turn off Community device alerts</ThemedText>
      </Pressable>
      {message && (
        <ThemedText accessibilityLiveRegion="polite">{message}</ThemedText>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    justifyContent: "center",
  },
});
