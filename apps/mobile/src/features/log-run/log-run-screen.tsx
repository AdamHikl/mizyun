import { spokenRunPace } from "@/features/running/presentation";
import { noteTrainingSaved } from "@/features/evening-stretch/public-data";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  router,
  Stack,
  useLocalSearchParams,
  useNavigation,
  type Href,
} from "expo-router";
import * as Crypto from "expo-crypto";
import {
  distancePatch,
  formFromRun,
  lastRunPatch,
  parseRunForm,
  quickDistances,
} from "./run-form";
import {
  runningDate,
  metresFromDistance,
  distanceFromMetres,
  formatRunPace,
  formatRunDuration,
} from "@mizyun/core";
import type { RunRecord } from "@mizyun/contracts";
import type { ApiClient } from "@mizyun/api-client";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { NativeDatePicker } from "@/components/ui/native-date-time-picker";
import {
  fromDateInputValue,
  toDateInputValue,
} from "@/components/ui/native-date-time-values";
import { useAuth } from "@/features/auth/auth-context";
import { apiClient, invalidateSessionReads } from "@/composition/api-client";
import { useTheme } from "@/hooks/use-theme";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { getRun, listRuns } from "@/features/running/client";
import { useAnnouncement } from "@/lib/announce";
import {
  runDraftStore,
  hasRunDraftContent,
  sendRunCommand,
  type RunDraft,
  type RunForm,
} from "./run-draft";
const emptyForm = (unit: "km" | "mi", zone: string): RunForm => ({
  activityDate: runningDate(new Date(), zone),
  recordingTimezone: zone,
  minutes: "",
  seconds: "",
  distance: "",
  unit,
  environment: "unspecified",
  effort: "",
  notes: "",
});
export function LogRunScreen() {
  const { session, profile } = useAuth();
  const params = useLocalSearchParams<{ runId?: string }>();
  const runId = typeof params.runId === "string" ? params.runId : null;
  const userId = session?.user.id ?? null;
  const principal = `${userId}:${session?.accessToken ?? ""}`;
  const hydrationOwner = `${principal}:${runId ?? "new"}`;
  const current = useRef(hydrationOwner);
  current.current = hydrationOwner;
  const navigation = useNavigation();
  const theme = useTheme();
  const bypassBack = useRef(false);
  const busyRef = useRef(false);
  const requestGeneration = useRef(0);
  const [draft, setDraft] = useState<RunDraft | null>(null);
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
  const live = useRef(draft);
  live.current = draftOwner === hydrationOwner ? draft : null;
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useAnnouncement(error);
  const [conflict, setConflict] = useState(false);
  const [more, setMore] = useState(false);
  const [otherDraft, setOtherDraft] = useState(false);
  const [lastRun, setLastRun] = useState<RunRecord | null>(null);
  const unit = profile?.unitSystem === "imperial" ? "mi" : "km";
  const isCurrent = () => current.current === hydrationOwner;
  const draftBelongsHere = loaded && draftOwner === hydrationOwner;
  const scoped: ApiClient = {
    status: () => apiClient.status(),
    request: (options) =>
      apiClient.request({
        ...options,
        expectedUserId: userId ?? "",
        isCurrent,
      }),
  };
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setDraft(null);
    setDraftOwner(null);
    setError(null);
    setOtherDraft(false);
    bypassBack.current = false;
    busyRef.current = false;
    requestGeneration.current++;
    setBusy(false);
    setConflict(false);
    if (!userId) return;
    void (async () => {
      const restored = await runDraftStore.load(userId);
      if (!active || !isCurrent()) return;
      if (restored && hasRunDraftContent(restored)) {
        setDraftOwner(hydrationOwner);
        setDraft(restored);
        setOtherDraft(restored.editingRunId !== runId);
        setLoaded(true);
        return;
      }
      if (runId) {
        const result = await getRun(runId, scoped);
        if (!active || !isCurrent()) return;
        if (!result.ok || result.value.userId !== userId) {
          setError(
            result.ok
              ? "This run is unavailable for this account."
              : result.message,
          );
          setDraftOwner(hydrationOwner);
          setLoaded(true);
          return;
        }
        setDraft({
          version: 1,
          form: formFromRun(result.value, unit),
          editingRunId: runId,
          expectedRevision: result.value.summary.revision,
          pending: null,
        });
      } else {
        const zone =
          profile?.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          "UTC";
        setDraft({
          version: 1,
          form: emptyForm(unit, zone),
          initialActivityDate: runningDate(new Date(), zone),
          editingRunId: null,
          expectedRevision: null,
          pending: null,
        });
      }
      setDraftOwner(hydrationOwner);
      setLoaded(true);
    })().catch(() => {
      if (active && isCurrent()) {
        setError(
          "Your saved run draft could not be read. Reopen this screen to retry. Nothing has been sent or replaced.",
        );
        setDraftOwner(hydrationOwner);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
    // Session identity retires hydration and keeps draft writes scoped to their original account.
  }, [principal, runId]);
  useEffect(() => {
    // Best-effort shortcut: failures hide it and never touch the form.
    let active = true;
    setLastRun(null);
    if (!userId || runId) return;
    void (async () => {
      const result = await listRuns(scoped);
      if (!active || !isCurrent()) return;
      const newest = result.ok ? result.value.runs[0] : undefined;
      if (newest && newest.userId === userId) setLastRun(newest);
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [principal, runId]);
  useEffect(() => {
    if (
      loaded &&
      draftOwner === hydrationOwner &&
      isCurrent() &&
      draft &&
      hasRunDraftContent(draft) &&
      userId &&
      !otherDraft &&
      !bypassBack.current
    )
      void runDraftStore.save(userId, draft).then((ok) => {
        if (!ok && isCurrent())
          setError(
            "Draft could not be kept on this device. Keep editing or retry before leaving.",
          );
      });
  }, [draft, loaded, draftOwner, hydrationOwner, userId, otherDraft]);
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (
          !isCurrent() ||
          draftOwner !== hydrationOwner ||
          bypassBack.current ||
          !userId ||
          !live.current ||
          !hasRunDraftContent(live.current) ||
          otherDraft
        )
          return;
        event.preventDefault();
        const saved = live.current;
        void runDraftStore.save(userId, saved).then((ok) => {
          if (!isCurrent()) return;
          if (ok) {
            bypassBack.current = true;
            navigation.dispatch(event.data.action);
          } else
            Alert.alert(
              "Draft not saved",
              "Your changes could not be kept on this device.",
              [
                { text: "Keep editing", style: "cancel" },
                {
                  text: "Discard unsaved changes",
                  style: "destructive",
                  onPress: () => {
                    if (!isCurrent() || !draftBelongsHere) return;
                    bypassBack.current = true;
                    navigation.dispatch(event.data.action);
                  },
                },
              ],
            );
        });
      }),
    [navigation, hydrationOwner, draftOwner, userId, otherDraft],
  );
  const change = (patch: Partial<RunForm>) => {
    if (!draftBelongsHere || !isCurrent()) return;
    setDraft((d) =>
      d && !d.pending ? { ...d, form: { ...d.form, ...patch } } : d,
    );
  };
  const finish = (saved: boolean) => {
    invalidateSessionReads();
    if (saved) noteTrainingSaved();
    bypassBack.current = true;
    router.replace({
      pathname: "/(tabs)/workouts",
      params: saved ? { runSaved: "true" } : {},
    } as Href);
  };
  const send = async (next: RunDraft) => {
    if (
      !userId ||
      !draftBelongsHere ||
      !isCurrent() ||
      (busyRef.current && next.pending?.kind !== "cancel")
    )
      return;
    const generation = ++requestGeneration.current;
    const attemptCurrent = () =>
      isCurrent() && generation === requestGeneration.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setConflict(false);
    setDraft(next);
    try {
      const result = await sendRunCommand(
        userId,
        next,
        {
          status: () => apiClient.status(),
          request: (options) =>
            apiClient.request({
              ...options,
              expectedUserId: userId,
              isCurrent: attemptCurrent,
            }),
        },
        attemptCurrent,
      );
      if (!attemptCurrent()) return;
      if (result.ok)
        finish(
          next.pending?.kind === "create" || next.pending?.kind === "edit",
        );
      else {
        setError(result.message);
        setConflict("conflict" in result && result.conflict === true);
        if ("conflict" in result && result.conflict === true)
          setDraft({ ...next, pending: null });
      }
    } catch {
      if (attemptCurrent())
        setError(
          "The response was lost. Your original pending run is kept. Retry when online.",
        );
    } finally {
      if (attemptCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const save = () => {
    if (!draft || !draftBelongsHere || !isCurrent()) return;
    if (draft.pending) {
      void send(draft);
      return;
    }
    const parsed = parseRunForm(draft.form, Crypto.randomUUID());
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    void send({
      ...draft,
      pending: draft.editingRunId
        ? {
            kind: "edit",
            runId: draft.editingRunId,
            body: {
              ...parsed.body,
              expectedRevision: draft.expectedRevision ?? 0,
            },
          }
        : { kind: "create", body: parsed.body },
    });
  };
  const discard = () => {
    if (!draft || !userId || !draftBelongsHere || !isCurrent()) return;
    if (
      draft.pending &&
      (draft.pending.kind === "edit" || draft.pending.kind === "delete")
    ) {
      setError(
        "Retry the pending change to confirm its result before discarding changes.",
      );
      return;
    }
    Alert.alert(
      draft.pending ? "Discard pending run?" : "Discard draft?",
      draft.pending
        ? "Removal stays pending until the server confirms it. A save already in flight will also be cancelled."
        : "This removes your changes from this device.",
      [
        { text: "Keep draft", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            if (!isCurrent() || !draftBelongsHere) return;
            if (draft.pending) {
              const p = draft.pending;
              const operationId =
                p.kind === "create"
                  ? p.body.clientOperationId
                  : p.kind === "edit"
                    ? p.body.clientOperationId
                    : p.operationId;
              void send({ ...draft, pending: { kind: "cancel", operationId } });
            } else
              void runDraftStore.clear(userId).then((ok) => {
                if (!isCurrent()) return;
                if (ok) {
                  bypassBack.current = true;
                  router.back();
                } else setError("Could not discard the draft. Try again.");
              });
          },
        },
      ],
    );
  };
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: disabled && busy }}
      disabled={disabled}
      onPress={() => {
        if (isCurrent() && draftBelongsHere) onPress();
      }}
      style={[styles.button, { borderColor: theme.border }]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
  const field = (
    label: string,
    key: "minutes" | "seconds" | "distance" | "effort" | "notes",
    keyboardType: "number-pad" | "decimal-pad" | "default" = "default",
  ) => (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={draft?.form[key] ?? ""}
        editable={
          !draft?.pending &&
          !busy &&
          !(
            draft?.form.metricsLocked &&
            ["minutes", "seconds", "distance"].includes(key)
          )
        }
        onChangeText={(text) =>
          change({
            [key]: text,
            ...(key === "distance"
              ? {
                  distanceCanonicalMeters: undefined,
                  distanceCanonicalInput: undefined,
                  distanceCanonicalUnit: undefined,
                }
              : {}),
          })
        }
        keyboardType={keyboardType}
        multiline={key === "notes"}
        maxLength={key === "notes" ? 4000 : 100}
        style={[styles.input, { color: theme.text, borderColor: theme.border }]}
      />
    </View>
  );
  // Today in the run's recording time zone, the latest date a run can have.
  const runToday = fromDateInputValue(
    runningDate(new Date(), draft?.form.recordingTimezone ?? "UTC"),
  )!;
  const duration =
    Number(draft?.form.minutes || 0) * 60 + Number(draft?.form.seconds || 0);
  const distance = draft?.form.distance
    ? draft.form.distanceCanonicalInput === draft.form.distance &&
      draft.form.distanceCanonicalUnit === draft.form.unit &&
      draft.form.distanceCanonicalMeters !== undefined
      ? draft.form.distanceCanonicalMeters
      : metresFromDistance(
          Number(draft.form.distance.replace(",", ".")),
          draft.form.unit,
        )
    : null;
  const pace =
    draft && duration > 0 && distance && distance > 0
      ? formatRunPace(duration, distance, draft.form.unit)
      : null;
  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: runId ? "Edit run" : "Log run" }} />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {!draftBelongsHere ? (
          <ThemedText>Loading run…</ThemedText>
        ) : otherDraft ? (
          <>
            <ThemedText>
              A run draft is already waiting on this device. Resume it before
              starting another.
            </ThemedText>
            {button("Resume run draft", () =>
              router.replace(
                draft?.editingRunId
                  ? ({
                      pathname: "/log-run",
                      params: { runId: draft.editingRunId },
                    } as Href)
                  : ("/log-run" as Href),
              ),
            )}
          </>
        ) : draft ? (
          <>
            <ThemedText type="subtitle">
              {runId ? "Edit run" : "Log a completed run"}
            </ThemedText>
            {draft.pending ? (
              <ThemedText type="small">
                {draft.pending.kind === "cancel" ||
                draft.pending.kind === "delete"
                  ? "Removal pending. Retry to confirm removal."
                  : "Save pending. These details stay fixed until the server confirms the result."}
              </ThemedText>
            ) : null}
            {lastRun &&
            !runId &&
            !draft.pending &&
            !draft.form.minutes &&
            !draft.form.seconds &&
            !draft.form.distance
              ? button(
                  `Same as last run · ${
                    lastRun.summary.distanceMeters === null
                      ? ""
                      : `${distanceFromMetres(lastRun.summary.distanceMeters, draft.form.unit).toFixed(2)} ${draft.form.unit} · `
                  }${formatRunDuration(lastRun.summary.durationSeconds)}`,
                  () => change(lastRunPatch(lastRun, draft.form.unit)),
                  busy,
                )
              : null}
            <NativeDatePicker
              label="Date"
              value={fromDateInputValue(draft.form.activityDate) ?? runToday}
              maximumDate={runToday}
              disabled={
                Boolean(draft.pending) ||
                busy ||
                Boolean(draft.form.startedAt) ||
                Boolean(draft.form.metricsLocked)
              }
              onChange={(date) =>
                change({ activityDate: toDateInputValue(date) })
              }
            />
            <ThemedText type="small" themeColor="textSecondary">
              {draft.form.startedAt
                ? `Recorded start · ${new Date(draft.form.startedAt).toLocaleString()} · Start date kept`
                : `Date only · ${draft.form.recordingTimezone}. No start time is recorded.`}
            </ThemedText>
            <View style={styles.row}>
              {field("Minutes", "minutes", "number-pad")}
              {field("Seconds", "seconds", "number-pad")}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {draft.form.metricsLocked
                ? "Date, time, duration and distance come from Health and can't be edited."
                : "Total time including pauses. Minutes can be greater than 59."}
            </ThemedText>
            {field(
              `Distance (${draft.form.unit}, optional)`,
              "distance",
              "decimal-pad",
            )}
            {draft.form.metricsLocked ? null : (
              <View style={styles.row}>
                {quickDistances.map((q) => (
                  <Pressable
                    key={q.label}
                    accessibilityRole="button"
                    accessibilityLabel={`Set distance to ${q.spoken}`}
                    accessibilityState={{ disabled: !!draft.pending || busy }}
                    disabled={!!draft.pending || busy}
                    onPress={() =>
                      change(distancePatch(q.meters, draft.form.unit))
                    }
                    style={[styles.button, { borderColor: theme.border }]}
                  >
                    <ThemedText>{q.label}</ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.row}>
              {(["km", "mi"] as const).map((u) => (
                <Pressable
                  key={u}
                  accessibilityRole="button"
                  accessibilityLabel={`Distance unit ${u}`}
                  accessibilityState={{
                    selected: draft.form.unit === u,
                    disabled: !!draft.pending,
                  }}
                  disabled={!!draft.pending}
                  onPress={() => {
                    const m = draft.form.distance
                      ? draft.form.distanceCanonicalInput ===
                          draft.form.distance &&
                        draft.form.distanceCanonicalUnit === draft.form.unit &&
                        draft.form.distanceCanonicalMeters !== undefined
                        ? draft.form.distanceCanonicalMeters
                        : metresFromDistance(
                            Number(draft.form.distance.replace(",", ".")),
                            draft.form.unit,
                          )
                      : null;
                    const converted =
                      m && Number.isFinite(m)
                        ? String(Number(distanceFromMetres(m, u).toFixed(5)))
                        : draft.form.distance;
                    change({
                      unit: u,
                      distance: converted,
                      distanceCanonicalMeters: m,
                      distanceCanonicalInput: converted,
                      distanceCanonicalUnit: u,
                    });
                  }}
                  style={[styles.button, { borderColor: theme.border }]}
                >
                  <ThemedText>
                    {u}
                    {draft.form.unit === u ? " ✓" : ""}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText accessibilityLabel={spokenRunPace(pace)} type="small">
              {pace ? `Average pace · ${pace}` : "Average pace needs distance."}
            </ThemedText>
            {button(more ? "Hide details" : "More details", () =>
              setMore(!more),
            )}
            {more ? (
              <>
                {field("Effort (0–10, optional)", "effort", "decimal-pad")}
                <ThemedText type="smallBold">Environment</ThemedText>
                <View style={styles.row}>
                  {(["unspecified", "outdoor", "treadmill"] as const).map(
                    (e) => (
                      <Pressable
                        key={e}
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: draft.form.environment === e,
                          disabled: !!draft.pending,
                        }}
                        disabled={!!draft.pending}
                        onPress={() => change({ environment: e })}
                        style={[styles.button, { borderColor: theme.border }]}
                      >
                        <ThemedText>
                          {e === "unspecified"
                            ? "Not specified"
                            : e === "outdoor"
                              ? "Outdoor"
                              : "Treadmill"}
                        </ThemedText>
                      </Pressable>
                    ),
                  )}
                </View>
                {field("Notes (optional)", "notes")}
              </>
            ) : null}
            {button(
              busy
                ? "Saving…"
                : draft.pending
                  ? "Retry pending run"
                  : runId
                    ? "Save changes"
                    : "Save run",
              save,
              busy,
            )}
            {button(
              "Discard draft",
              discard,
              busy && draft.pending?.kind !== "create",
            )}
            {conflict
              ? button("Review current run", () =>
                  router.push(`/run/${draft.editingRunId}` as Href),
                )
              : null}
          </>
        ) : null}
        {error ? (
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingBottom: 64,
  },
  field: { gap: 8, flexGrow: 1, flexBasis: 120 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    justifyContent: "center",
    alignItems: "center",
  },
});
