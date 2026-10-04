import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { apiClient } from "@/composition/api-client";

import {
  aiUsageResponseSchema,
  type AiUsageResponse,
  type BetaProStatusResponse,
} from "@mizyun/contracts";
import {
  fetchBetaProStatus,
  requestBetaProPass,
} from "@/features/beta-pro/beta-pro-client";

type CardState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly usage: AiUsageResponse;
      readonly betaPro: BetaProStatusResponse;
    };

/**
 * Settings card that shows the user's AI budget consumption
 * (coach tokens, photo drafts) and their Beta Pro pass status
 * with the ability to request a pass if eligible.
 */
export function AiUsageCard() {
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [requesting, setRequesting] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const [usageResult, betaResult] = await Promise.all([
      apiClient.request<AiUsageResponse>({
        method: "GET",
        path: "/v1/ai/usage",
        schema: aiUsageResponseSchema,
      }),
      fetchBetaProStatus(apiClient),
    ]);

    if (!mountedRef.current) return;

    if (!usageResult.ok) {
      setState({
        kind: "error",
        message: "Could not load AI usage data.",
      });
      return;
    }
    if (!betaResult.ok) {
      setState({
        kind: "error",
        message: "Could not load Launch Pro Pass status.",
      });
      return;
    }
    setState({
      kind: "ready",
      usage: usageResult.value,
      betaPro: betaResult.value,
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const requestBetaPro = useCallback(async () => {
    setRequesting(true);
    try {
      const result = await requestBetaProPass(apiClient);
      if (!mountedRef.current) return;

      if (result.ok) {
        await refresh();
        Alert.alert(
          "Request Sent",
          "Your Launch Pro Pass request has been submitted. You'll be notified when it's reviewed.",
        );
      } else {
        Alert.alert(
          "Request Failed",
          "Could not submit Launch Pro Pass request. Try again later.",
        );
      }
    } catch {
      if (mountedRef.current) {
        Alert.alert(
          "Request Failed",
          "Could not submit Launch Pro Pass request. Try again later.",
        );
      }
    } finally {
      if (mountedRef.current) {
        setRequesting(false);
      }
    }
  }, [refresh]);

  if (state.kind === "loading") {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.center}>
          <ActivityIndicator />
          <ThemedText type="small" themeColor="textSecondary">
            Loading AI usage…
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (state.kind === "error") {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          {state.message}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading AI usage"
          onPress={() => {
            setState({ kind: "loading" });
            void refresh();
          }}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold">Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const { usage, betaPro } = state;
  const isPaid = usage.planTier === "paid";

  const coachPercent =
    usage.coach.dailyTokenBudget > 0
      ? Math.min(
          100,
          Math.round(
            (usage.coach.tokensUsed / usage.coach.dailyTokenBudget) * 100,
          ),
        )
      : 0;

  const photosPercent =
    usage.photos.dailyLimit > 0
      ? Math.min(
          100,
          Math.round((usage.photos.draftsUsed / usage.photos.dailyLimit) * 100),
        )
      : 0;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerIconBox}>
          <ThemedText style={styles.headerIcon}>📊</ThemedText>
        </View>
        <View style={styles.headerTextBlock}>
          <ThemedText type="smallBold" style={styles.headerTitle}>
            AI Usage & Limits
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Daily budget consumption
          </ThemedText>
        </View>
      </View>

      {/* Tier Badge */}
      <View style={styles.tierRow}>
        {isPaid || betaPro.status === "approved" ? (
          <View style={[styles.tierBadge, styles.tierBadgePro]}>
            <ThemedText type="smallBold" style={styles.tierBadgeProText}>
              ✨ Launch Pro Pass
            </ThemedText>
          </View>
        ) : (
          <View style={[styles.tierBadge, styles.tierBadgeFree]}>
            <ThemedText type="smallBold" style={styles.tierBadgeFreeText}>
              Free Plan
            </ThemedText>
          </View>
        )}
      </View>

      {/* Coach Chat Usage */}
      <View style={styles.usageSection}>
        <View style={styles.usageLabelRow}>
          <ThemedText type="smallBold">💬 Coach Chat</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {coachPercent}%
          </ThemedText>
        </View>
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${coachPercent}%` as `${number}%`,
              },
              coachPercent >= 90 && styles.progressBarFillDanger,
            ]}
          />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {usage.coach.tokensUsed.toLocaleString()} /{" "}
          {usage.coach.dailyTokenBudget.toLocaleString()} tokens
        </ThemedText>
      </View>

      {/* Photo Drafts Usage */}
      <View style={styles.usageSection}>
        <View style={styles.usageLabelRow}>
          <ThemedText type="smallBold">📷 Photo Drafts</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {photosPercent}%
          </ThemedText>
        </View>
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${photosPercent}%` as `${number}%`,
              },
              photosPercent >= 90 && styles.progressBarFillDanger,
            ]}
          />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {usage.photos.draftsUsed} / {usage.photos.dailyLimit} scans
        </ThemedText>
      </View>

      {/* Reset Note */}
      <ThemedText
        type="small"
        themeColor="textSecondary"
        style={styles.resetNote}
      >
        Resets at midnight UTC
      </ThemedText>

      {/* Beta Pro CTA */}
      {!isPaid && betaPro.status === "none" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Request free Pro access with Launch Pro Pass"
          accessibilityState={{ disabled: requesting, busy: requesting }}
          disabled={requesting}
          onPress={() => void requestBetaPro()}
          style={({ pressed }) => [
            styles.requestButton,
            pressed && styles.pressed,
            requesting && styles.requestButtonDisabled,
          ]}
        >
          {requesting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <ThemedText type="smallBold" style={styles.requestButtonText}>
              Request Free Pro Access
            </ThemedText>
          )}
        </Pressable>
      ) : null}

      {!isPaid && betaPro.status === "pending" ? (
        <View style={styles.pendingBadge}>
          <ThemedText type="smallBold" style={styles.pendingBadgeText}>
            ⏳ Request Pending
          </ThemedText>
        </View>
      ) : null}

      {betaPro.status === "approved" && !isPaid ? (
        <View style={styles.approvedBadge}>
          <ThemedText type="smallBold" style={styles.approvedBadgeText}>
            ✨ Launch Pro Pass Active
          </ThemedText>
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    gap: Spacing.three,
  },
  center: {
    alignItems: "center",
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  headerIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerIcon: {
    fontSize: 18,
  },
  headerTextBlock: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: 15,
  },
  tierRow: {
    flexDirection: "row",
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  tierBadgePro: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  tierBadgeProText: {
    color: "#059669",
    fontSize: 12,
  },
  tierBadgeFree: {
    backgroundColor: "rgba(148, 163, 184, 0.1)",
  },
  tierBadgeFreeText: {
    fontSize: 12,
  },
  usageSection: {
    gap: Spacing.one,
  },
  usageLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    overflow: "hidden",
  },
  progressBarFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
    minWidth: 2,
  },
  progressBarFillDanger: {
    backgroundColor: "#EF4444",
  },
  resetNote: {
    textAlign: "center",
    fontStyle: "italic",
  },
  requestButton: {
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#10B981",
  },
  requestButtonText: {
    color: "#ffffff",
  },
  requestButtonDisabled: {
    opacity: 0.6,
  },
  pendingBadge: {
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.35)",
    backgroundColor: "rgba(234, 179, 8, 0.08)",
  },
  pendingBadgeText: {
    color: "#CA8A04",
    fontSize: 13,
  },
  approvedBadge: {
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  approvedBadgeText: {
    color: "#059669",
    fontSize: 13,
  },
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.25)",
    alignSelf: "center",
  },
  pressed: { opacity: 0.75 },
});
