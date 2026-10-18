import React, { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { noteTrainingSaved } from "@/features/evening-stretch/public-data";
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import type { ApiClient } from "@mizyun/api-client";
import type { RunRecord } from "@mizyun/contracts";
import {
  distanceFromMetres,
  formatRunDuration,
  formatRunPace,
} from "@mizyun/core";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button, Notice } from "@/components/ui";
import { MaxContentWidth, MinTouchTarget, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/features/auth/auth-context";
import { apiClient, invalidateSessionReads } from "@/composition/api-client";
import { getAppVariant } from "@/composition/app-variant";
import { importRun, listRuns } from "@/features/running/client";
import { spokenRunPace } from "@/features/running/presentation";
import {
  availabilityAsync,
  invalidateAsync,
  readPageAsync,
  requestReadPermissionAsync,
} from "../../../modules/mizyun-health-connections";
import type { RunImportCandidate } from "./run-import-candidates";
import { RunImportSession, type RunImportReader } from "./run-import-session";

const nativeReader: RunImportReader = {
  availabilityAsync,
  requestReadPermissionAsync,
  readPageAsync,
  invalidateAsync,
};
const MAX_EXISTING_PAGES = 4;

export const runImportAvailable = (): boolean =>
  getAppVariant() === "dev" &&
  (Platform.OS === "ios" || Platform.OS === "android");

export function RunImportScreen() {
  const { session } = useAuth();
  if (!session || !runImportAvailable())
    return (
      <ThemedView style={styles.fill}>
        <View style={styles.content}>
          <ThemedText>Importing runs isn't available in this build.</ThemedText>
        </View>
      </ThemedView>
    );
  return <RunImportContent key={session.user.id} userId={session.user.id} />;
}

function RunImportContent({ userId }: { userId: string }) {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const unit = profile?.unitSystem === "imperial" ? "mi" : "km";
  const provider = Platform.OS === "ios" ? "apple_health" : "health_connect";
  const source =
    provider === "apple_health" ? "Apple Health" : "Health Connect";
  // Keyed on the account, not the access token: routine token refreshes
  // (e.g. after the permission sheet) must not discard the list mid-save.
  const live = useRef(session?.user.id);
  live.current = session?.user.id;
  const session_ = useMemo(() => {
    const isCurrent = () => live.current === userId;
    const client: ApiClient = {
      status: () => apiClient.status(),
      request: (options) =>
        apiClient.request({ ...options, expectedUserId: userId, isCurrent }),
    };
    return new RunImportSession({
      reader: nativeReader,
      provider,
      operationId: () => Crypto.randomUUID(),
      deviceTimezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      importRun: (body) => importRun(body, client),
      loadExistingRuns: async (from) => {
        const runs: RunRecord[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_EXISTING_PAGES; page++) {
          const result = await listRuns(client, { from, cursor });
          if (!result.ok) return null;
          runs.push(...result.value.runs.filter((r) => r.userId === userId));
          if (!result.value.nextCursor) return runs;
          cursor = result.value.nextCursor;
        }
        // Too many runs to check exhaustively; refuse rather than miss duplicates.
        return null;
      },
    });
  }, [userId, provider]);
  const state = useSyncExternalStore(
    session_.subscribe,
    session_.getSnapshot,
    session_.getSnapshot,
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) =>
      // iOS "inactive" (Control Center, permission sheets) is not backgrounding.
      session_.setActive(next !== "background"),
    );
    return () => {
      listener.remove();
      session_.destroy();
    };
  }, [session_]);
  useFocusEffect(React.useCallback(() => () => session_.clear(), [session_]));
  const busy =
    state.phase === "authorizing" ||
    state.phase === "reading" ||
    state.phase === "saving";
  const added = [...state.outcomes.values()].filter(
    (o) => o === "added",
  ).length;
  const existing = [...state.outcomes.values()].filter(
    (o) => o === "existing",
  ).length;
  // Once per finished import (also when leaving by the back gesture), not per run.
  const settledAdded = state.phase === "saving" ? 0 : added;
  useEffect(() => {
    if (settledAdded > 0) noteTrainingSaved();
  }, [settledAdded]);
  const selectable = state.candidates.filter(
    (c) => !c.alreadyImported && state.outcomes.get(c.key) !== "added",
  );

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          Choose runs from the last 30 days in {source} to add to Mizyun. Only
          the runs you select are saved to your account: their date, time,
          duration, distance and treadmill/outdoor setting, plus the source app
          and its workout ID so the same run isn't added twice. They count in
          your running history but aren't sent to Coach. Health itself is never
          changed.
        </ThemedText>
        {state.phase === "idle" || state.phase === "error" ? (
          <Button
            label={`Read runs from ${source}`}
            onPress={() => void session_.read()}
          />
        ) : null}
        {state.phase === "authorizing" || state.phase === "reading" ? (
          <ThemedText accessibilityRole="alert">
            {state.phase === "authorizing"
              ? "Checking Health access…"
              : "Reading runs…"}
          </ThemedText>
        ) : null}
        {state.message ? (
          <Notice
            tone={state.phase === "error" ? "warning" : "info"}
            message={state.message}
          />
        ) : null}
        {state.partial && state.candidates.length ? (
          <Notice
            tone="info"
            message="Some Health records couldn't be read or were incomplete, so this list may be missing runs."
          />
        ) : null}
        {state.phase === "done" ? (
          <>
            <Notice
              tone="success"
              message={
                added
                  ? `${added} ${added === 1 ? "run" : "runs"} added${existing ? ` · ${existing} already in Mizyun` : ""}`
                  : "These runs were already in Mizyun"
              }
            />
            <Button
              label="Done"
              onPress={() => {
                invalidateSessionReads();
                router.replace("/(tabs)/workouts" as Href);
              }}
            />
          </>
        ) : null}
        {state.candidates.map((candidate) => (
          <CandidateRow
            key={candidate.key}
            candidate={candidate}
            unit={unit}
            selected={state.selected.has(candidate.key)}
            added={state.outcomes.get(candidate.key) === "added"}
            failed={state.outcomes.get(candidate.key) === "failed"}
            disabled={state.phase !== "ready"}
            borderColor={theme.border}
            onToggle={() => session_.toggle(candidate.key)}
          />
        ))}
        {state.phase === "ready" || state.phase === "saving" ? (
          selectable.length ? (
            <Button
              label={
                state.phase === "saving"
                  ? "Adding runs…"
                  : state.selected.size
                    ? `Add ${state.selected.size} ${state.selected.size === 1 ? "run" : "runs"}`
                    : "Select runs to add"
              }
              disabled={busy || state.selected.size === 0}
              onPress={() => void session_.save()}
            />
          ) : null
        ) : null}
        {state.phase !== "idle" && !busy ? (
          <Button
            label="Clear and stop reading"
            variant="secondary"
            onPress={() => session_.clear()}
          />
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          The list stays on this screen only and is cleared when you leave or
          switch apps. To revoke access, change Mizyun's permissions in your
          device health settings.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function CandidateRow({
  candidate,
  unit,
  selected,
  added,
  failed,
  disabled,
  borderColor,
  onToggle,
}: {
  candidate: RunImportCandidate;
  unit: "km" | "mi";
  selected: boolean;
  added: boolean;
  failed: boolean;
  disabled: boolean;
  borderColor: string;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const locked = candidate.alreadyImported || added;
  const distance =
    candidate.distanceMeters === null
      ? "No distance"
      : `${Number(distanceFromMetres(candidate.distanceMeters, unit).toFixed(2))} ${unit}`;
  const pace = formatRunPace(
    candidate.durationSeconds,
    candidate.distanceMeters,
    unit,
  );
  const when = new Date(candidate.startedAt).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: candidate.recordingTimezone,
  });
  const status = candidate.alreadyImported
    ? "Already in Mizyun"
    : added
      ? "Added"
      : failed
        ? "Couldn't add · tap Add to retry"
        : candidate.possibleDuplicate
          ? "Possible duplicate · overlaps another run"
          : null;
  const label = `${when}, ${distance}, ${formatRunDuration(candidate.durationSeconds)}${pace ? `, ${spokenRunPace(pace)}` : ""}${status ? `, ${status}` : ""}`;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{
        checked: locked ? true : selected,
        disabled: disabled || locked,
      }}
      disabled={disabled || locked}
      onPress={onToggle}
      style={[styles.row, { borderColor }, locked && styles.locked]}
    >
      <View
        style={[
          styles.check,
          { borderColor: theme.primary },
          (selected || locked) && { backgroundColor: theme.primary },
        ]}
      >
        {selected || locked ? (
          <ThemedText type="smallBold" style={styles.checkMark}>
            ✓
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.rowText}>
        <ThemedText type="smallBold">{when}</ThemedText>
        <ThemedText type="small">
          {distance} · {formatRunDuration(candidate.durationSeconds)}
          {pace ? ` · ${pace}` : ""}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {candidate.sourceAppName ?? candidate.sourceAppId}
          {candidate.environment === "treadmill" ? " · Treadmill" : ""}
        </ThemedText>
        {status ? (
          <ThemedText
            type="footnote"
            themeColor={
              failed || candidate.possibleDuplicate ? "text" : "textSecondary"
            }
          >
            {status}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: "100%",
    alignSelf: "center",
    paddingBottom: 64,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: MinTouchTarget,
    alignItems: "flex-start",
  },
  locked: { opacity: 0.6 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkMark: { color: "#FFFFFF", lineHeight: 18 },
  rowText: { flex: 1, gap: 2 },
});
