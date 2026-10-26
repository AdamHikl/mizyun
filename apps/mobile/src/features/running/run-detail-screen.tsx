import {
  runDurationBasisLabel,
  runSourceLabel,
  spokenRunPace,
} from "@/features/running/presentation";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
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
import { useAuth } from "@/features/auth/auth-context";
import { apiClient, invalidateSessionReads } from "@/composition/api-client";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { runDraftStore, sendRunCommand } from "@/features/log-run";
import { formFromRun } from "@/features/log-run";
import { getRun } from "./running-data";
export function RunDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const owner = `${session?.user.id}:${session?.accessToken}:${id}`;
  const live = useRef(owner);
  live.current = owner;
  const theme = useTheme();
  const [storedRun, setRun] = useState<RunRecord | null>(null);
  const [runOwner, setRunOwner] = useState<string | null>(null);
  const run =
    runOwner === owner && storedRun?.userId === session?.user.id
      ? storedRun
      : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const unit = profile?.unitSystem === "imperial" ? "mi" : "km";
  const current = () => live.current === owner;
  const client: ApiClient = {
    status: () => apiClient.status(),
    request: (options) =>
      apiClient.request({
        ...options,
        expectedUserId: session?.user.id,
        isCurrent: current,
      }),
  };
  useEffect(() => {
    let active = true;
    setRun(null);
    setRunOwner(null);
    setError(null);
    setBusy(false);
    busyRef.current = false;
    void getRun(id, client).then((result) => {
      if (!active || !current()) return;
      if (result.ok && result.value.userId === session?.user.id) {
        setRun(result.value);
        setRunOwner(owner);
      } else
        setError(
          result.ok
            ? "This run is unavailable for this account."
            : result.message,
        );
    });
    return () => {
      active = false;
    };
  }, [id, owner]);
  const remove = async () => {
    if (
      !run ||
      !session ||
      !current() ||
      runOwner !== owner ||
      run.userId !== session.user.id ||
      busyRef.current
    )
      return;
    busyRef.current = true;
    setBusy(true);
    const draft = await runDraftStore.load(session.user.id).catch(() => {
      if (current()) {
        setBusy(false);
        busyRef.current = false;
        setError(
          "Your saved run draft could not be read. Reopen this screen to retry. Nothing was deleted.",
        );
      }
      return undefined;
    });
    if (draft === undefined) return;
    if (!current()) return;
    if (
      draft &&
      !(draft.editingRunId === run.id && draft.pending?.kind === "delete")
    ) {
      setError(
        "A run draft is waiting on this device. Resume or discard it before deleting a run.",
      );
      setBusy(false);
      busyRef.current = false;
      return;
    }
    const pending = draft ?? {
      version: 1 as const,
      form: formFromRun(run, unit),
      editingRunId: run.id,
      expectedRevision: run.summary.revision,
      pending: {
        kind: "delete" as const,
        runId: run.id,
        operationId: Crypto.randomUUID(),
      },
    };
    try {
      const result = await sendRunCommand(
        session.user.id,
        pending,
        client,
        current,
      );
      if (!current()) return;
      if (result.ok) {
        invalidateSessionReads();
        router.replace("/(tabs)/workouts" as Href);
      } else setError(result.message);
    } catch {
      if (current()) setError("Removal is pending. Retry Delete when online.");
    } finally {
      if (current()) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  };
  const action = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={() => {
        if (current()) onPress();
      }}
      style={[styles.button, { borderColor: theme.border }]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
  const pace = run
    ? formatRunPace(
        run.summary.durationSeconds,
        run.summary.distanceMeters,
        unit,
      )
    : null;
  return (
    <ThemedView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        {run ? (
          <>
            <ThemedText type="subtitle">{run.name}</ThemedText>
            <ThemedText>{run.summary.activityDate}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {run.summary.timePrecision === "day"
                ? "Date only · No start time recorded"
                : run.summary.startedAt
                  ? new Date(run.summary.startedAt).toLocaleString()
                  : "Start time unavailable"}
            </ThemedText>
            <ThemedText>
              Duration · {formatRunDuration(run.summary.durationSeconds)}
            </ThemedText>
            <ThemedText type="small">{runDurationBasisLabel(run)}</ThemedText>
            <ThemedText>
              {run.summary.distanceMeters === null
                ? "Distance not recorded"
                : `Distance · ${Number(distanceFromMetres(run.summary.distanceMeters, unit).toFixed(2))} ${unit}`}
            </ThemedText>
            <ThemedText accessibilityLabel={spokenRunPace(pace)}>
              {pace
                ? `Average pace · ${pace}`
                : "Average pace unavailable without distance"}
            </ThemedText>
            <ThemedText>
              Environment ·{" "}
              {run.summary.environment === "unspecified"
                ? "Not specified"
                : run.summary.environment}
            </ThemedText>
            {run.summary.perceivedExertion !== null ? (
              <ThemedText>
                Effort · {run.summary.perceivedExertion}/10
              </ThemedText>
            ) : null}
            {run.notes ? <ThemedText selectable>{run.notes}</ThemedText> : null}
            <ThemedText type="small">{runSourceLabel(run)}</ThemedText>
            {run.summary.origin.kind === "health_import" ? (
              <ThemedText type="small" themeColor="textSecondary">
                Date, time, duration and distance come from the source app and
                can't be edited here. Deleting this run doesn't change Health.
              </ThemedText>
            ) : run.summary.origin.kind === "file_import" ? (
              <ThemedText type="small" themeColor="textSecondary">
                Date, time, duration and distance come from the imported file
                and can't be edited here. Deleting this run doesn't change
                Strava.
              </ThemedText>
            ) : null}
            {action("Edit run", () =>
              router.push({
                pathname: "/log-run",
                params: { runId: run.id },
              } as Href),
            )}
            {action(busy ? "Deleting…" : "Delete run", () =>
              Alert.alert("Delete run?", "This permanently removes this run.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => void remove(),
                },
              ]),
            )}
          </>
        ) : !error ? (
          <ThemedText>Loading run…</ThemedText>
        ) : null}
        {error ? (
          <>
            <ThemedText accessibilityRole="alert">{error}</ThemedText>
            {action("Resume pending run", () =>
              router.push("/log-run" as Href),
            )}
          </>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: "100%",
    alignSelf: "center",
    paddingBottom: 64,
  },
  button: {
    minHeight: 48,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
