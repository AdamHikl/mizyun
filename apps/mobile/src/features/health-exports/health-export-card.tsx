import React, { useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { getAppVariant } from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import type { HealthExportOutboxState } from "./export-outbox";
import { healthExportOutbox } from "./native-writer";

function statusMessage(state: HealthExportOutboxState): string {
  if (state.errorCode === "storage_full")
    return "The Dev export limit is full. No additional records can be exported on this installation.";
  if (
    state.errorCode === "storage_failed" ||
    state.errorCode === "storage_invalid"
  )
    return "Export tracking could not be saved safely. Exports have paused; pending records are not confirmed as exported.";
  switch (state.phase) {
    case "disabled":
      return "Exports are off for categories you have not enabled this session.";
    case "ready":
      return "Enabled categories can export eligible new saves while the app is open.";
    case "authorizing":
      return "Checking access for the category you chose…";
    case "writing":
      return "Saving an eligible record to Health…";
    case "partial":
      return "Some export components are incomplete. Check health permissions, then retry the pending category.";
    case "permission_required":
      return "Write access was not granted. Review Mizyun’s permissions in your device health settings, then enable the category again.";
    case "install_required":
      return "Install or update Health Connect before enabling exports.";
    case "unavailable":
      return "Health exports are unavailable on this device or app build.";
    case "error":
      return "An export could not be confirmed. Pending records remain available for an explicit retry.";
  }
}

export function HealthExportCard() {
  const theme = useTheme();
  const { session } = useAuth();
  const state = useSyncExternalStore(
    healthExportOutbox.subscribe,
    healthExportOutbox.getSnapshot,
    healthExportOutbox.getSnapshot,
  );
  const source = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
  const allowed =
    getAppVariant() === "dev" &&
    Boolean(session?.accessToken && session.accessToken !== "preview-token");
  const busy = state.phase === "authorizing" || state.phase === "writing";
  if (!allowed)
    return (
      <View style={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          Health exports are available only when signed in to Mizyun Dev. They
          are disabled in Production and app previews.
        </ThemedText>
      </View>
    );

  return (
    <View style={styles.content}>
      <ThemedText type="small" themeColor="textSecondary">
        Export to {source} only after choosing a category below. Each choice
        confirms that this phone’s health profile is yours and requests only
        that category’s write access. Confirm your choices again each app
        session.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Nutrition exports include energy, protein, carbs and fat from new,
        explicitly confirmed manual Mizyun meals. Workout exports include only
        the start and end interval of a newly completed standalone workout. AI
        estimates, imported records, date-only records and historical saves are
        excluded. There is no automatic history export or background sync.
      </ThemedText>
      {(["nutrition", "workout"] as const).map((category) => {
        const label = category === "nutrition" ? "nutrition" : "workouts";
        const enabled = state.enabled[category];
        const pending = state.pending[category];
        return (
          <View
            key={category}
            style={[styles.category, { borderColor: theme.border }]}
          >
            <ThemedText type="smallBold">
              {category === "nutrition" ? "Nutrition" : "Workouts"} ·{" "}
              {enabled ? "On this session" : "Off"}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {pending} pending {pending === 1 ? "record" : "records"}
              {!enabled && pending > 0
                ? " · Enable this category before retrying."
                : ""}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Enable ${label} exports`}
              accessibilityState={{ disabled: busy || enabled }}
              disabled={busy || enabled}
              onPress={() => {
                if (allowed && !busy && !enabled)
                  void healthExportOutbox.enable(category);
              }}
              style={[
                styles.button,
                { backgroundColor: theme.primary },
                (busy || enabled) && styles.disabled,
              ]}
            >
              <ThemedText type="smallBold" style={styles.buttonText}>
                Enable {label} exports
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Turn off ${label} exports`}
              accessibilityState={{ disabled: !enabled }}
              disabled={!enabled}
              onPress={() => {
                if (allowed && enabled) healthExportOutbox.disable(category);
              }}
              style={[
                styles.button,
                { borderColor: theme.border, borderWidth: 1 },
                !enabled && styles.disabled,
              ]}
            >
              <ThemedText type="smallBold">Turn off {label} exports</ThemedText>
            </Pressable>
            {pending > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Retry pending ${label} exports`}
                accessibilityState={{ disabled: busy || !enabled }}
                disabled={busy || !enabled}
                onPress={() => {
                  if (allowed && !busy && enabled)
                    void healthExportOutbox.retry(category);
                }}
                style={[
                  styles.button,
                  { borderColor: theme.border, borderWidth: 1 },
                  (busy || !enabled) && styles.disabled,
                ]}
              >
                <ThemedText type="smallBold">Retry pending {label}</ThemedText>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <ThemedText
        type="small"
        themeColor="textSecondary"
        accessibilityRole="alert"
      >
        {statusMessage(state)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        This Dev trial tracks at most 40 exported records across accounts on
        this installation. Eligible edits or deletions update only records
        exported by this Mizyun installation while their category is enabled;
        pending changes need an explicit retry after a failure.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Turning exports off stops future writes. Copies already in {source}
        remain when exports are off or your Mizyun account is deleted. Manage
        those copies and revoke Mizyun’s access in your device health settings.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  category: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 10 },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "#FFFFFF" },
  disabled: { opacity: 0.5 },
});
