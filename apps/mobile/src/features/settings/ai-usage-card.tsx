import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  Chip,
  Icon,
  Notice,
  type IconName,
} from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { apiClient } from "@/composition/api-client";
import { localResetTime } from "@/lib/ai-allowance";

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
      <Card>
        <View style={styles.center}>
          <ActivityIndicator />
          <ThemedText type="footnote" themeColor="textSecondary">
            Loading AI usage…
          </ThemedText>
        </View>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Notice
        tone="warning"
        message={state.message}
        action={
          <Button
            label="Retry"
            variant="plain"
            size="small"
            icon="repeat"
            accessibilityLabel="Retry loading AI usage"
            onPress={() => {
              setState({ kind: "loading" });
              void refresh();
            }}
          />
        }
      />
    );
  }

  const { usage, betaPro } = state;
  const isPaid = usage.planTier === "paid";

  // Coach is metered in messages (ADR-0085). An older server only reports
  // its token ceiling, which is shown as a share, never as tokens.
  const coachMessages =
    usage.coach.dailyMessageLimit !== undefined &&
    usage.coach.messagesUsed !== undefined
      ? {
          used: Math.min(
            usage.coach.messagesUsed,
            usage.coach.dailyMessageLimit,
          ),
          limit: usage.coach.dailyMessageLimit,
        }
      : null;
  const coachPercent = coachMessages
    ? coachMessages.limit > 0
      ? Math.round((coachMessages.used / coachMessages.limit) * 100)
      : 0
    : usage.coach.dailyTokenBudget > 0
      ? Math.min(
          100,
          Math.round(
            (usage.coach.tokensUsed / usage.coach.dailyTokenBudget) * 100,
          ),
        )
      : 0;
  const resetTime = localResetTime(usage.resetsAt);

  const photosPercent =
    usage.photos.dailyLimit > 0
      ? Math.min(
          100,
          Math.round((usage.photos.draftsUsed / usage.photos.dailyLimit) * 100),
        )
      : 0;

  const hasPro = isPaid || betaPro.status === "approved";

  return (
    <View style={styles.page}>
      <Card style={styles.usageCard}>
        <View style={styles.headerRow}>
          <ThemedText type="headline" style={styles.flex}>
            Daily AI usage
          </ThemedText>
          <Chip
            label={hasPro ? "Launch Pro Pass" : "Free Plan"}
            icon={hasPro ? "sparkles" : undefined}
            tone={hasPro ? "primary" : "neutral"}
          />
        </View>

        <UsageMeter
          icon="chat"
          title="Coach Chat"
          percent={coachPercent}
          detail={
            coachMessages
              ? `${coachMessages.used} / ${coachMessages.limit} messages`
              : `${coachPercent}% used`
          }
        />
        <UsageMeter
          icon="camera"
          title="Photo Drafts"
          percent={photosPercent}
          detail={`${usage.photos.draftsUsed} / ${usage.photos.dailyLimit} scans`}
        />
      </Card>
      <ThemedText type="footnote" themeColor="textSecondary">
        {resetTime ? `Resets daily at ${resetTime}` : "Resets daily"}
      </ThemedText>

      {!isPaid && betaPro.status === "none" ? (
        <Button
          label="Request Free Pro Access"
          icon="sparkles"
          block
          loading={requesting}
          accessibilityLabel="Request free Pro access with Launch Pro Pass"
          onPress={() => void requestBetaPro()}
        />
      ) : null}

      {!isPaid && betaPro.status === "pending" ? (
        <Notice tone="warning" message="Launch Pro Pass request pending" />
      ) : null}

      {betaPro.status === "approved" && !isPaid ? (
        <Notice tone="success" message="Launch Pro Pass active" />
      ) : null}
    </View>
  );
}

function UsageMeter({
  icon,
  title,
  percent,
  detail,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly percent: number;
  readonly detail: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={styles.usageSection}
      accessible
      accessibilityLabel={`${title}, ${percent}% used, ${detail}`}
    >
      <View style={styles.usageLabelRow}>
        <Icon name={icon} size={16} color="textSecondary" />
        <ThemedText type="smallBold" style={styles.flex}>
          {title}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {percent}%
        </ThemedText>
      </View>
      <View
        style={[
          styles.progressBarTrack,
          { backgroundColor: theme.backgroundSelected },
        ]}
      >
        <View
          style={[
            styles.progressBarFill,
            {
              width: `${percent}%` as `${number}%`,
              backgroundColor: percent >= 90 ? theme.danger : theme.primary,
            },
          ]}
        />
      </View>
      <ThemedText type="footnote" themeColor="textSecondary">
        {detail}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: Spacing.two,
  },
  usageCard: {
    gap: Spacing.three,
  },
  center: {
    alignItems: "center",
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  flex: { flex: 1 },
  usageSection: {
    gap: Spacing.one,
  },
  usageLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  progressBarTrack: {
    height: 8,
    borderRadius: Radius.pill,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 8,
    borderRadius: Radius.pill,
    minWidth: 2,
  },
});
