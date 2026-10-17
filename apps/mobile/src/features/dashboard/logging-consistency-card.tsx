import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  computeLoggingConsistency,
  type LoggingConsistency,
} from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { Card, Icon } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { loadLoggingHistory } from "./logging-consistency-data";
import {
  loadLoggingConsistencyPreferences,
  type LoggingConsistencyPreferences,
} from "./logging-consistency-preferences";
import {
  presentLoggingConsistency,
  type LoggingConsistencyPresentation,
} from "./logging-consistency-presentation";

/**
 * Resolve what the card should show: null (render nothing) when the card is
 * hidden, the history is unknown, or the user has no logging history yet.
 */
export async function resolveLoggingConsistencyCard(
  userId: string,
  ports: {
    readonly loadPreferences: typeof loadLoggingConsistencyPreferences;
    readonly loadHistory: typeof loadLoggingHistory;
  } = {
    loadPreferences: loadLoggingConsistencyPreferences,
    loadHistory: loadLoggingHistory,
  },
): Promise<LoggingConsistency | null> {
  const preferences: LoggingConsistencyPreferences =
    await ports.loadPreferences(userId);
  if (preferences.hidden) return null;
  const history = await ports.loadHistory();
  if (history === null || history.loggedDates.length === 0) return null;
  return computeLoggingConsistency({
    loggedDates: history.loggedDates,
    today: history.today,
    weeklyGoal: preferences.weeklyGoal,
  });
}

export function LoggingConsistencyCard({
  userId,
  refreshKey = 0,
}: {
  readonly userId: string;
  /** Changes when today's logging changes so the card reloads in place. */
  readonly refreshKey?: number;
}) {
  const [state, setState] = useState<{
    readonly userId: string;
    readonly value: LoggingConsistency;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void resolveLoggingConsistencyCard(userId)
        .then((value) => {
          if (active) setState(value === null ? null : { userId, value });
        })
        .catch(() => {
          if (active) setState(null);
        });
      return () => {
        active = false;
      };
    }, [userId, refreshKey]),
  );

  if (state === null || state.userId !== userId) return null;
  return (
    <LoggingConsistencyView
      presentation={presentLoggingConsistency(state.value)}
    />
  );
}

/**
 * Display only. On a day without meals the existing first-meal card directly
 * below owns the logging actions, so welcome-back adds no competing buttons.
 */
export function LoggingConsistencyView({
  presentation,
}: {
  readonly presentation: LoggingConsistencyPresentation;
}) {
  const theme = useTheme();
  return (
    <Card testID="logging-consistency-card">
      <View
        accessible
        accessibilityLabel={presentation.accessibilityLabel}
        style={styles.header}
      >
        <View style={styles.headerText}>
          <ThemedText type="headline">{presentation.title}</ThemedText>
          {presentation.message !== null ? (
            <ThemedText type="small" themeColor="textSecondary">
              {presentation.message}
            </ThemedText>
          ) : null}
        </View>
        {presentation.kind === "goal-met" ? (
          <Icon name="checkCircle" size={22} color="success" />
        ) : null}
      </View>

      <View style={styles.dots}>
        {presentation.dots.map((dot) => (
          <View
            key={dot.date}
            accessible
            accessibilityLabel={dot.accessibilityLabel}
            style={styles.dotColumn}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: dot.logged
                    ? theme.primary
                    : theme.backgroundSelected,
                  borderColor: dot.isToday ? theme.primary : "transparent",
                },
              ]}
            >
              {dot.logged ? (
                <Icon name="check" size={12} color="onPrimary" />
              ) : null}
            </View>
            <ThemedText type="footnote" themeColor="textSecondary">
              {dot.letter}
            </ThemedText>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  headerText: { flex: 1, gap: Spacing.half },
  dots: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.three,
  },
  dotColumn: { alignItems: "center", gap: Spacing.one, minWidth: 28 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
