import { router, Stack, useFocusEffect, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ApiClient } from "@mizyun/api-client";
import type {
  BoulderProgressResponse,
  BoulderProgressWindowValue,
  BoulderProjectRecord,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Card,
  EmptyState,
  Notice,
  SegmentedControl,
} from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { apiClient } from "@/composition/api-client";
import { isBoulderingEnabled } from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import {
  archiveBoulderProject,
  getBoulderProgress,
  listBoulderProjects,
  type BoulderFailure,
} from "./client";
import { GradePyramid } from "./grade-pyramid";
import { HardestSendTimeline } from "./hardest-send-timeline";
import {
  GYM_GRADES_NOTE,
  PROGRESS_HELP_TEXT,
  PROGRESS_WINDOWS,
  replaceProject,
  windowPhrase,
} from "./progress";
import { ProjectsList } from "./projects-list";

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "disabled" }
  | { kind: "error"; failure: BoulderFailure };

/** Bouldering progress (BLD-04): grade pyramid, hardest-send timeline, projects. */
export function BoulderingProgressScreen() {
  const { session: auth } = useAuth();
  const userId = auth?.user.id ?? "";
  const ownerRef = useRef(userId);
  ownerRef.current = userId;
  const [range, setRange] = useState<BoulderProgressWindowValue>("90d");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [progress, setProgress] = useState<BoulderProgressResponse | null>(
    null,
  );
  const [projects, setProjects] = useState<BoulderProjectRecord[] | null>(null);
  const [projectsFailure, setProjectsFailure] = useState<BoulderFailure | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latestRequest = useRef(0);

  // An account switch never shows the previous account's progress.
  useEffect(() => {
    setStatus({ kind: "loading" });
    setProgress(null);
    setProjects(null);
    setProjectsFailure(null);
    setNotice(null);
    setBusyId(null);
  }, [userId]);

  const client = useCallback((): {
    client: ApiClient;
    isCurrent: () => boolean;
  } => {
    const owner = userId;
    const isCurrent = () => ownerRef.current === owner && owner !== "";
    return {
      isCurrent,
      client: {
        status: () => apiClient.status(),
        request: (options) =>
          apiClient.request({ ...options, expectedUserId: owner, isCurrent }),
      },
    };
  }, [userId]);

  const loadProjects = useCallback(async () => {
    const { client: c, isCurrent } = client();
    if (!isCurrent()) return;
    const result = await listBoulderProjects("all", c);
    if (!isCurrent()) return;
    if (result.ok) {
      setProjects(result.value);
      setProjectsFailure(null);
    } else setProjectsFailure(result.error);
  }, [client]);

  const load = useCallback(
    async (target: BoulderProgressWindowValue) => {
      if (!isBoulderingEnabled()) {
        setStatus({ kind: "disabled" });
        return;
      }
      const { client: c, isCurrent } = client();
      if (!isCurrent()) return;
      // Only the newest request may update the screen (fast range switches).
      const request = ++latestRequest.current;
      const [result] = await Promise.all([
        getBoulderProgress(target, c),
        loadProjects(),
      ]);
      if (!isCurrent() || request !== latestRequest.current) return;
      if (result.ok) {
        setProgress(result.value);
        setStatus({ kind: "ready" });
      } else if (result.error.kind === "disabled")
        setStatus({ kind: "disabled" });
      else setStatus({ kind: "error", failure: result.error });
    },
    [client, loadProjects],
  );

  // Reloads on focus and whenever the range changes.
  useFocusEffect(
    useCallback(() => {
      void load(range);
    }, [load, range]),
  );

  const chooseWindow = (next: BoulderProgressWindowValue) => {
    if (next === range) return;
    setStatus({ kind: "loading" });
    setRange(next);
  };

  const archive = async (project: BoulderProjectRecord, archived: boolean) => {
    if (busyId) return;
    const { client: c, isCurrent } = client();
    setBusyId(project.id);
    setNotice(null);
    const outcome = await archiveBoulderProject(project.id, archived, c);
    if (!isCurrent()) return;
    setBusyId(null);
    if (outcome.kind === "ok")
      setProjects((current) =>
        current ? replaceProject(current, outcome.project) : current,
      );
    else if (outcome.kind === "sent") {
      setNotice(outcome.message);
      void loadProjects();
    } else setNotice(outcome.failure.message);
  };

  const showRetry = status.kind === "error";

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Bouldering progress" }} />
      <SafeAreaView style={styles.page} edges={["left", "right", "bottom"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(range).finally(() => setRefreshing(false));
              }}
            />
          }
        >
          {status.kind === "disabled" ? (
            <Card>
              <EmptyState
                icon="info"
                title="Bouldering isn't available"
                message="Indoor bouldering is not turned on for this app yet."
              />
            </Card>
          ) : (
            <>
              <SegmentedControl<BoulderProgressWindowValue>
                accessibilityLabel="Time range"
                value={range}
                onChange={chooseWindow}
                options={PROGRESS_WINDOWS}
              />
              <ThemedText type="footnote" themeColor="textSecondary">
                {PROGRESS_HELP_TEXT} {GYM_GRADES_NOTE}
              </ThemedText>

              {showRetry ? (
                <View accessibilityRole="alert">
                  <Notice
                    tone={
                      status.failure.kind === "offline" ? "warning" : "danger"
                    }
                    title={
                      status.failure.kind === "offline"
                        ? "You're offline"
                        : "Couldn't load progress"
                    }
                    message={
                      status.failure.kind === "offline"
                        ? "Progress needs a connection. Boulders saved on this device still sync later."
                        : status.failure.message
                    }
                    action={
                      <Button
                        label="Retry"
                        variant="plain"
                        size="small"
                        onPress={() => {
                          setStatus({ kind: "loading" });
                          void load(range);
                        }}
                      />
                    }
                  />
                </View>
              ) : null}

              {status.kind === "loading" ? (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  accessibilityLiveRegion="polite"
                >
                  Loading progress…
                </ThemedText>
              ) : null}

              {status.kind === "ready" && progress ? (
                <>
                  <Card>
                    <ThemedText type="headline" accessibilityRole="header">
                      Sends by grade
                    </ThemedText>
                    {progress.pyramid.some((row) => row.sends > 0) ? (
                      <GradePyramid
                        pyramid={progress.pyramid}
                        onSelectGrade={(grade) =>
                          router.push(
                            `/bouldering/grade?grade=${encodeURIComponent(grade)}&window=${progress.window}` as Href,
                          )
                        }
                      />
                    ) : (
                      <EmptyState
                        icon="mobility"
                        title={`No sends ${windowPhrase(progress.window)}`}
                        message="Sends you log in bouldering sessions appear here."
                      />
                    )}
                  </Card>

                  <Card>
                    <ThemedText type="headline" accessibilityRole="header">
                      Hardest send per session
                    </ThemedText>
                    {progress.timeline.length > 0 ? (
                      <HardestSendTimeline timeline={progress.timeline} />
                    ) : (
                      <EmptyState
                        icon="history"
                        title={`No finished sessions ${windowPhrase(progress.window)}`}
                        message="Finish a bouldering session to see it here."
                      />
                    )}
                  </Card>
                </>
              ) : null}

              <Card>
                <ThemedText type="headline" accessibilityRole="header">
                  Projects
                </ThemedText>
                {notice ? (
                  <View accessibilityRole="alert">
                    <Notice
                      tone="info"
                      message={notice}
                      action={
                        <Button
                          label="Dismiss"
                          variant="plain"
                          size="small"
                          onPress={() => setNotice(null)}
                        />
                      }
                    />
                  </View>
                ) : null}
                {projects ? (
                  <ProjectsList
                    projects={projects}
                    busyId={busyId}
                    archivedOpen={archivedOpen}
                    onToggleArchived={() => setArchivedOpen((open) => !open)}
                    onArchive={(project, archived) =>
                      void archive(project, archived)
                    }
                  />
                ) : projectsFailure ? (
                  <Notice
                    tone={
                      projectsFailure.kind === "offline" ? "warning" : "danger"
                    }
                    message={projectsFailure.message}
                    action={
                      <Button
                        label="Retry"
                        variant="plain"
                        size="small"
                        onPress={() => void loadProjects()}
                      />
                    }
                  />
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    Loading projects…
                  </ThemedText>
                )}
              </Card>
            </>
          )}
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
});
