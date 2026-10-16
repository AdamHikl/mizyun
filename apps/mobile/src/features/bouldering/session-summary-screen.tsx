import { router, Stack, useFocusEffect, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  BoulderAchievementRecord,
  BoulderAscentRecord,
  BoulderProjectRecord,
  BoulderSessionRecord,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button, Card, EmptyState, Icon, Notice } from "@/components/ui";
import { MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { apiClient } from "@/composition/api-client";
import { isBoulderingEnabled } from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import { useCommunityProfile } from "@/features/community";
import {
  getBoulderSession,
  listBoulderProjects,
  type BoulderFailure,
} from "./client";
import {
  ATTEMPTS_UNKNOWN_NOTE,
  achievementSpoken,
  achievementText,
  summaryStats,
} from "./presentation";
import { projectName, projectsSentInSession, sentAfterText } from "./progress";
import { recallFinish } from "./session-rows";
import { sessionGradeBars } from "./session-summary";
import { canShareBoulderingSession, shareBoulderingHref } from "./share-gate";

type Loaded = {
  session: BoulderSessionRecord;
  ascents: BoulderAscentRecord[];
  achievements: BoulderAchievementRecord[] | null;
};

/** Session summary (ADR-0066 sketch). Achievements come from the finish response. */
export function SessionSummaryScreen({ sessionId }: { sessionId: string }) {
  const theme = useTheme();
  const { session: auth, profile: accountProfile } = useAuth();
  const userId = auth?.user.id ?? "";
  const community = useCommunityProfile({
    principalKey: auth?.user.id ?? null,
    birthYear: accountProfile?.birthYear,
  });
  const ownerRef = useRef(userId);
  ownerRef.current = userId;
  const [data, setData] = useState<Loaded | null>(() => {
    const cached = userId ? recallFinish(userId, sessionId) : null;
    return cached
      ? {
          session: cached.session,
          ascents: cached.ascents,
          achievements: cached.achievements,
        }
      : null;
  });
  const [failure, setFailure] = useState<BoulderFailure | null>(null);
  const [sentProjects, setSentProjects] = useState<BoulderProjectRecord[]>([]);

  useEffect(() => {
    const cached = userId ? recallFinish(userId, sessionId) : null;
    setData(
      cached
        ? {
            session: cached.session,
            ascents: cached.ascents,
            achievements: cached.achievements,
          }
        : null,
    );
    setFailure(null);
    setSentProjects([]);
  }, [sessionId, userId]);

  // Best effort: "Sent after N sessions" for projects this session sent.
  const linkedSendIds = (data?.ascents ?? [])
    .filter((a) => a.projectId !== null && a.result !== "not_yet")
    .map((a) => a.id)
    .join(",");
  useEffect(() => {
    const owner = userId;
    if (!owner || linkedSendIds === "") return;
    const isCurrent = () => ownerRef.current === owner;
    void listBoulderProjects("sent", {
      status: () => apiClient.status(),
      request: (options) =>
        apiClient.request({ ...options, expectedUserId: owner, isCurrent }),
    }).then((result) => {
      if (isCurrent() && result.ok)
        setSentProjects(
          projectsSentInSession(result.value, linkedSendIds.split(",")),
        );
    });
  }, [linkedSendIds, userId]);

  const load = useCallback(async () => {
    const owner = userId;
    if (!owner || !isBoulderingEnabled()) return;
    if (recallFinish(owner, sessionId)) return;
    const isCurrent = () => ownerRef.current === owner;
    const result = await getBoulderSession(sessionId, {
      status: () => apiClient.status(),
      request: (options) =>
        apiClient.request({ ...options, expectedUserId: owner, isCurrent }),
    });
    if (!isCurrent()) return;
    if (result.ok)
      setData({
        session: result.value.session,
        ascents: result.value.ascents,
        achievements: null,
      });
    else setFailure(result.error);
  }, [sessionId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/workouts");
  };

  if (!data) {
    return (
      <ThemedView style={styles.page}>
        <Stack.Screen options={{ title: "Session summary" }} />
        <SafeAreaView style={styles.page} edges={["left", "right", "bottom"]}>
          <ScrollView contentContainerStyle={styles.content}>
            {failure ? (
              <Notice
                tone={failure.kind === "offline" ? "warning" : "danger"}
                message={failure.message}
                action={
                  <Button
                    label="Retry"
                    variant="plain"
                    size="small"
                    onPress={() => {
                      setFailure(null);
                      void load();
                    }}
                  />
                }
              />
            ) : !isBoulderingEnabled() ? (
              <EmptyState
                icon="info"
                title="Bouldering isn't available"
                message="Indoor bouldering is not turned on for this app yet."
              />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Loading summary…
              </ThemedText>
            )}
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const { session, ascents, achievements } = data;
  const stats = summaryStats(session.summary);
  const bars = sessionGradeBars(session, ascents);
  const title = session.completedAt
    ? `Session complete${session.session.gymName ? ` · ${session.session.gymName}` : ""}`
    : "Session in progress";

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Session summary" }} />
      <SafeAreaView style={styles.page} edges={["left", "right", "bottom"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title" accessibilityRole="header">
            {title}
          </ThemedText>

          {achievements && achievements.length > 0 ? (
            <Card
              accessible
              accessibilityRole="summary"
              accessibilityLabel={achievements
                .map(achievementSpoken)
                .join(". ")}
              style={{ backgroundColor: theme.primaryLight }}
            >
              {achievements.map((achievement) => (
                <View key={achievement.kind} style={styles.inline}>
                  <Icon name="starFill" size={18} color="primary" />
                  <ThemedText type="headline" themeColor="primary">
                    {achievementText(achievement)}
                  </ThemedText>
                </View>
              ))}
            </Card>
          ) : null}

          {sentProjects.length > 0 ? (
            <Card>
              {sentProjects.map((project) => (
                <View
                  key={project.id}
                  style={styles.inline}
                  accessible
                  accessibilityLabel={`Project ${projectName(project, true)} sent. ${sentAfterText(project.sentAfterSessions ?? 1)}`}
                >
                  <Icon name="target" size={18} color="primary" />
                  <ThemedText type="headline">
                    Project {projectName(project)} sent
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {sentAfterText(project.sentAfterSessions ?? 1)}
                  </ThemedText>
                </View>
              ))}
            </Card>
          ) : null}

          <Card>
            <View style={styles.stats}>
              {stats.map((stat) => (
                <View
                  key={stat.key}
                  style={styles.stat}
                  accessible
                  accessibilityLabel={stat.accessibilityLabel}
                >
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {stat.label}
                  </ThemedText>
                  <ThemedText type="title3">{stat.value}</ThemedText>
                </View>
              ))}
            </View>
            {!session.summary.attemptsComplete ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {ATTEMPTS_UNKNOWN_NOTE}
              </ThemedText>
            ) : null}
          </Card>

          {bars.length > 0 ? (
            <Card>
              <ThemedText type="headline">Sends by grade</ThemedText>
              {bars.map((bar) => (
                <View
                  key={bar.grade}
                  style={styles.barRow}
                  accessible
                  accessibilityLabel={bar.accessibilityLabel}
                >
                  <ThemedText type="smallBold" style={styles.barGrade}>
                    {bar.grade}
                  </ThemedText>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        {
                          width: `${Math.max(8, bar.fraction * 100)}%`,
                          backgroundColor: theme.primary,
                        },
                      ]}
                    />
                  </View>
                  <ThemedText type="small" style={styles.barCount}>
                    {bar.sends}
                  </ThemedText>
                </View>
              ))}
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon="mobility"
                title="No sends this time"
                message="Every attempt counts toward your projects."
              />
            </Card>
          )}

          {canShareBoulderingSession({
            boulderingEnabled: isBoulderingEnabled(),
            communityEnrolled: community.isEnrolled,
            completedAt: session.completedAt,
          }) ? (
            <Button
              label="Share session"
              icon="share"
              variant="secondary"
              block
              accessibilityHint="Preview the card before sharing it with your approved followers"
              onPress={() => router.push(shareBoulderingHref(session.id))}
            />
          ) : null}
          <Button
            label="View progress"
            icon="chart"
            variant="secondary"
            block
            onPress={() => router.push("/bouldering/progress" as Href)}
          />
          <Button label="Done" block onPress={done} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.three,
    gap: Spacing.three,
  },
  inline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: Spacing.three,
    columnGap: Spacing.four,
  },
  stat: { minWidth: 72, gap: Spacing.half },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 28,
  },
  barGrade: { minWidth: 40 },
  barTrack: { flex: 1, height: 14, justifyContent: "center" },
  bar: { height: 14, borderRadius: Radius.sm },
  barCount: { minWidth: 24, textAlign: "right" },
});
