import { useCallback, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  computeLoggingConsistency,
  type LoggingConsistency,
} from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { Card, Icon } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
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

/** What a load found: nothing to show, an unreadable history, or a result. */
export type LoggingConsistencyResolution =
  | { readonly kind: "hidden" }
  | { readonly kind: "unknown" }
  | {
      readonly kind: "shown";
      readonly day: string;
      readonly value: LoggingConsistency;
    };

/**
 * Resolve what the card should show. Hidden on purpose (turned off, or no
 * logging history yet) is distinct from unknown (the history read failed,
 * which at launch happens while reads are retired), so callers keep what is
 * shown on unknown instead of hiding the row.
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
): Promise<LoggingConsistencyResolution> {
  const preferences: LoggingConsistencyPreferences =
    await ports.loadPreferences(userId);
  if (preferences.hidden) return { kind: "hidden" };
  const history = await ports.loadHistory();
  if (history === null) return { kind: "unknown" };
  if (history.loggedDates.length === 0) return { kind: "hidden" };
  const value = computeLoggingConsistency({
    loggedDates: history.loggedDates,
    today: history.today,
    weeklyGoal: preferences.weeklyGoal,
  });
  return value === null
    ? { kind: "hidden" }
    : { kind: "shown", day: history.today, value };
}

// Last shown result, in memory only (health-derived, never persisted). Keyed by
// account and local day so another user or tomorrow never sees it.
let remembered: {
  readonly userId: string;
  readonly day: string;
  readonly value: LoggingConsistency;
} | null = null;

const localDay = (now: Date): string =>
  [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

const recall = (userId: string): LoggingConsistency | null => {
  const entry = remembered;
  return entry !== null &&
    entry.userId === userId &&
    entry.day === localDay(new Date())
    ? entry.value
    : null;
};

export function LoggingConsistencyCard({
  userId,
  refreshKey = 0,
}: {
  readonly userId: string;
  /** Changes when today's logging changes so the card reloads in place. */
  readonly refreshKey?: number;
}) {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const [state, setState] = useState<{
    readonly userId: string;
    readonly value: LoggingConsistency;
  } | null>(() => {
    const value = recall(userId);
    return value === null ? null : { userId, value };
  });

  // Reloads on focus, refreshKey, session token change and foreground return.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let run = 0;
      const load = () => {
        const current = ++run;
        void resolveLoggingConsistencyCard(userId)
          .then((result) => {
            if (!active || current !== run) return;
            if (result.kind === "unknown") return;
            if (result.kind === "hidden") {
              remembered = null;
              setState(null);
              return;
            }
            remembered = { userId, day: result.day, value: result.value };
            setState({ userId, value: result.value });
          })
          // A failed load keeps whatever is already shown.
          .catch(() => {});
      };
      load();
      let foreground = AppState.currentState === "active";
      const subscription = AppState.addEventListener("change", (next) => {
        const wasForeground = foreground;
        foreground = next === "active";
        if (foreground && !wasForeground) load();
      });
      return () => {
        active = false;
        subscription.remove();
      };
    }, [userId, refreshKey, accessToken]),
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
