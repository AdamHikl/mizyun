import * as Crypto from "expo-crypto";
import { noteTrainingSaved } from "@/features/evening-stretch/public-data";
import { recordCoreRecordSaved } from "@/features/analytics/flow-measurement";
import { Image } from "expo-image";
import { router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ApiClient } from "@mizyun/api-client";
import type {
  BoulderAscentRecord,
  BoulderProjectRecord,
  BoulderSessionRecord,
} from "@mizyun/contracts";
import type { FontGrade } from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  ListGroup,
  Notice,
} from "@/components/ui";
import {
  MaxContentWidth,
  MinTouchTarget,
  Radius,
  Spacing,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { apiClient } from "@/composition/api-client";
import { isBoulderingEnabled } from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import { useCommunityProfile } from "@/features/community";
import {
  activeBoulderingFromResponse,
  computeElapsedSeconds,
  formatStopwatch,
  guardSessionStart,
} from "@/features/workouts/active-workout-state";
import { useOptionalActiveWorkout } from "@/features/workouts/active-workout-context";
import {
  finishBoulderSession,
  getActiveBoulderSession,
  getBoulderProgress,
  getBoulderSession,
  listBoulderProjects,
  removeBoulderSession,
  startBoulderSession,
  type BoulderFailure,
} from "./client";
import {
  attachBoulderPhoto,
  deleteBoulderPhoto,
  signBoulderPhoto,
  type PreparedBoulderPhoto,
} from "./boulder-photo";
import {
  boulderPhotoSource,
  forgetBoulderPhoto,
  keepBoulderBackupOnDevice,
  needsSignedBoulderPhoto,
  reconcileBoulderBackupRecord,
  type BoulderPhotoSource,
} from "./boulder-photo-display";
import {
  localPhotoUri,
  useLocalPhotoVersion,
} from "@/features/private-photos/local-photo-library";
import {
  blankBoulderForm,
  boulderCreateBody,
  boulderUpdateBody,
  formFromAscent,
  tryAgainForm,
  type BoulderForm,
} from "./log-boulder-form";
import {
  HoldColourSwatch,
  LogBoulderSheet,
  type BoulderPhotoChoice,
  type TryAgainProject,
} from "./log-boulder-sheet";
import {
  boulderPendingStore,
  commandOperationId,
  droppedMessage,
  enqueueFailureMessage,
  flushBoulderCommands,
  type BoulderPendingCommand,
  type BoulderPendingFinish,
} from "./pending-ascents";
import {
  DEFAULT_BOULDER_GRADE,
  PENDING_SYNC_TEXT,
  RESULT_ICONS,
  ascentAccessibilityLabel,
  formatBoulderDate,
  gradeSpoken,
  holdColourLabel,
  initialBoulderGrade,
  resultText,
  sessionTitle,
} from "./presentation";
import {
  projectAccessibilityLabel,
  projectName,
  projectSubtitle,
  tryAgainProjects,
} from "./progress";
import {
  mergeBoulderRows,
  rememberFinish,
  type BoulderRow,
} from "./session-rows";
import { canShareBoulderingSession, shareBoulderingHref } from "./share-gate";

type ScreenStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "none" }
  | { kind: "blocked_strength"; workoutId: string }
  | { kind: "disabled" }
  | { kind: "error"; failure: BoulderFailure };

type SheetState =
  | {
      mode: "create";
      key: number;
      form: BoulderForm;
      /** "Try again" (active sessions only): links the create to a project. */
      project: TryAgainProject | null;
    }
  | {
      mode: "edit";
      key: number;
      form: BoulderForm;
      ascent: BoulderAscentRecord;
    }
  | null;

const timezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/**
 * Active bouldering session (mode "active") or a finished session's history
 * detail (mode "history"). Every write goes through the durable pending store
 * first; rows show "Saved on this device · Waiting to sync" until the server
 * confirms them.
 */
export function BoulderingSessionScreen({
  mode,
  sessionId: historySessionId,
  startOnOpen = false,
}: {
  mode: "active" | "history";
  sessionId?: string;
  startOnOpen?: boolean;
}) {
  const theme = useTheme();
  const { session: auth, profile: accountProfile } = useAuth();
  const workoutContext = useOptionalActiveWorkout();
  const userId = auth?.user.id ?? "";
  const enabled = isBoulderingEnabled();
  const community = useCommunityProfile({
    principalKey: auth?.user.id ?? null,
    birthYear: accountProfile?.birthYear,
  });

  const ownerRef = useRef(userId);
  ownerRef.current = userId;
  // Re-renders rows when a device photo is saved, downloaded or removed.
  useLocalPhotoVersion();
  const [status, setStatus] = useState<ScreenStatus>({ kind: "loading" });
  const [record, setRecord] = useState<BoulderSessionRecord | null>(null);
  const [ascents, setAscents] = useState<BoulderAscentRecord[]>([]);
  const [commands, setCommands] = useState<readonly BoulderPendingCommand[]>(
    [],
  );
  const [pendingFinish, setPendingFinish] =
    useState<BoulderPendingFinish | null>(null);
  const [storeUnreadable, setStoreUnreadable] = useState(false);
  const [syncProblem, setSyncProblem] = useState<BoulderFailure | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoRetry, setPhotoRetry] = useState<
    Record<string, PreparedBoulderPhoto>
  >({});
  const [recentGrade, setRecentGrade] = useState<FontGrade | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [projects, setProjects] = useState<BoulderProjectRecord[]>([]);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [busy, setBusy] = useState<null | "finish" | "discard" | "start">(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const sheetCounter = useRef(0);
  const startOperation = useRef<{ owner: string; id: string } | null>(null);
  /** Photos waiting for their boulder (or edit) to sync, by operation id. */
  const waitingPhotos = useRef(new Map<string, PreparedBoulderPhoto>());
  const syncing = useRef(false);
  /** Start a session when none is active (from "Start bouldering"). */
  const wantStart = useRef(startOnOpen);

  const capture = useCallback(() => {
    const owner = userId;
    return () => ownerRef.current === owner && owner !== "";
  }, [userId]);

  const client = useCallback(
    (isCurrent: () => boolean): ApiClient => ({
      status: () => apiClient.status(),
      request: (options) =>
        apiClient.request({ ...options, expectedUserId: userId, isCurrent }),
    }),
    [userId],
  );

  // An account switch clears every piece of the previous account's state.
  useEffect(() => {
    setStatus({ kind: "loading" });
    setRecord(null);
    setAscents([]);
    setCommands([]);
    setPendingFinish(null);
    setStoreUnreadable(false);
    setSyncProblem(null);
    setNotices([]);
    setPhotoUrls({});
    setPhotoRetry({});
    setRecentGrade(null);
    setSheet(null);
    setProjects([]);
    setBusy(null);
    waitingPhotos.current.clear();
    startOperation.current = null;
  }, [userId]);

  const sessionId = record?.id ?? null;
  const isActive = record !== null && record.completedAt === null;

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isActive]);

  const loadLocal = useCallback(async (isCurrent: () => boolean) => {
    try {
      const state = await boulderPendingStore.load(ownerRef.current);
      if (!isCurrent()) return null;
      setCommands(state.commands);
      setPendingFinish(state.finish);
      setStoreUnreadable(false);
      return state;
    } catch {
      if (isCurrent()) setStoreUnreadable(true);
      return null;
    }
  }, []);

  const applyServer = useCallback(
    (next: {
      session: BoulderSessionRecord;
      ascents: BoulderAscentRecord[];
    }) => {
      setRecord(next.session);
      setAscents(next.ascents);
      setStatus({ kind: "ready" });
      if (mode === "active")
        workoutContext?.setActiveBouldering(
          activeBoulderingFromResponse({
            session: next.session,
            ascents: next.ascents,
          }),
        );
    },
    [mode, workoutContext],
  );

  const fetchServer = useCallback(
    async (isCurrent: () => boolean, id: string | null) => {
      const c = client(isCurrent);
      if (mode === "history" || id) {
        const target = id ?? historySessionId ?? "";
        const result = await getBoulderSession(target, c);
        if (!isCurrent()) return null;
        if (result.ok) {
          applyServer(result.value);
          return result.value;
        }
        return result.error;
      }
      const result = await getActiveBoulderSession(c);
      if (!isCurrent()) return null;
      if (!result.ok) return result.error;
      if (result.value.session) {
        const value = {
          session: result.value.session,
          ascents: result.value.ascents,
        };
        applyServer(value);
        return value;
      }
      workoutContext?.setActiveBouldering(null);
      return "none" as const;
    },
    [applyServer, client, historySessionId, mode, workoutContext],
  );

  const signPhotos = useCallback(
    async (rows: readonly BoulderAscentRecord[], isCurrent: () => boolean) => {
      // Device copies first (ADR-0079); only unmatched server photos are signed.
      const owner = ownerRef.current;
      for (const ascent of rows) {
        const assetId = ascent.photoAssetId;
        if (!needsSignedBoulderPhoto(owner, ascent.id, assetId)) continue;
        const url = await signBoulderPhoto(client(isCurrent), assetId);
        if (!isCurrent()) return;
        if (!url) continue;
        setPhotoUrls((current) => ({ ...current, [assetId]: url }));
        keepBoulderBackupOnDevice(owner, ascent.id, assetId, url);
      }
    },
    [client],
  );

  /** Open projects for "Try again"; best effort, active sessions only. */
  const loadProjects = useCallback(
    async (isCurrent: () => boolean) => {
      if (mode !== "active") return;
      const result = await listBoulderProjects("open", client(isCurrent));
      if (isCurrent() && result.ok) setProjects(result.value);
    },
    [client, mode],
  );

  /** Replays waiting commands, attaches waiting photos, then refreshes. */
  const sync = useCallback(
    async (isCurrent: () => boolean, id: string | null) => {
      if (syncing.current || !isCurrent()) return;
      syncing.current = true;
      try {
        let changed = false;
        for (let round = 0; round < 3; round++) {
          const c = client(isCurrent);
          const outcome = await flushBoulderCommands(ownerRef.current, {
            client: c,
            isCurrent,
            onMediaOrphan: (assetId) => void deleteBoulderPhoto(c, assetId),
            newOperationId: () => Crypto.randomUUID(),
          });
          if (!isCurrent()) return;
          for (const moved of outcome.relinked) {
            changed = true;
            // The photo waits for the re-queued (unlinked) operation instead.
            const from = commandOperationId(moved.from);
            const photo = waitingPhotos.current.get(from);
            waitingPhotos.current.delete(from);
            if (photo)
              waitingPhotos.current.set(commandOperationId(moved.to), photo);
            setNotices((current) => [
              ...current,
              "Project was already sent or removed — saved as a new boulder.",
            ]);
          }
          if (outcome.dropped.length > 0) {
            changed = true;
            setNotices((current) => [
              ...current,
              ...outcome.dropped.map(droppedMessage),
            ]);
            for (const d of outcome.dropped)
              waitingPhotos.current.delete(commandOperationId(d.command));
          }
          setSyncProblem(outcome.blocked);
          let attached = false;
          for (const synced of outcome.synced) {
            changed = true;
            if (synced.ascent) {
              const syncedId = synced.ascent.id;
              reconcileBoulderBackupRecord(
                ownerRef.current,
                synced.ascent,
                outcome.remaining.some(
                  (c) => c.kind !== "create" && c.ascentId === syncedId,
                ),
              );
            }
            const opId = commandOperationId(synced.command);
            const photo = waitingPhotos.current.get(opId);
            waitingPhotos.current.delete(opId);
            if (!photo || !synced.ascent) continue;
            const result = await attachBoulderPhoto({
              userId: ownerRef.current,
              client: c,
              ascent: synced.ascent,
              photo,
              operationId: Crypto.randomUUID(),
              isCurrent,
            });
            if (!isCurrent()) return;
            // Any queued edit (link or unlink) needs another flush round.
            if (result.kind === "queued") attached = true;
            else if (result.kind === "kept_on_device") {
              attached = synced.ascent.photoAssetId !== null;
              if (result.backupPending) setNotices(addBackupNotice);
            } else {
              const ascentId = synced.ascent.id;
              setPhotoRetry((current) => ({ ...current, [ascentId]: photo }));
            }
          }
          if (!attached) break;
        }
        await loadLocal(isCurrent);
        if (changed && isCurrent()) {
          void loadProjects(isCurrent);
          const fresh = await fetchServer(isCurrent, id);
          if (fresh && typeof fresh === "object" && "ascents" in fresh)
            void signPhotos(fresh.ascents, isCurrent);
        }
      } finally {
        syncing.current = false;
      }
    },
    [client, fetchServer, loadLocal, loadProjects, signPhotos],
  );

  const finishNow = useCallback(
    async (
      isCurrent: () => boolean,
      target: BoulderSessionRecord,
      finish: BoulderPendingFinish,
    ) => {
      const result = await finishBoulderSession(
        target.id,
        { clientOperationId: finish.clientOperationId, notes: finish.notes },
        client(isCurrent),
      );
      if (!isCurrent()) return;
      if (result.ok) {
        await boulderPendingStore.setFinish(ownerRef.current, null, isCurrent);
        setPendingFinish(null);
        rememberFinish(ownerRef.current, result.value);
        noteTrainingSaved();
        recordCoreRecordSaved("bouldering_session", ownerRef.current);
        workoutContext?.setActiveBouldering(null);
        router.replace({
          pathname: "/bouldering/summary/[id]",
          params: { id: target.id },
        });
        return;
      }
      if (
        result.error.kind === "removed" ||
        result.error.kind === "not_found" ||
        result.error.kind === "conflict"
      ) {
        await boulderPendingStore.setFinish(ownerRef.current, null, isCurrent);
        setPendingFinish(null);
        const fresh = await getBoulderSession(target.id, client(isCurrent));
        if (!isCurrent()) return;
        if (fresh.ok && fresh.value.session.completedAt !== null) {
          workoutContext?.setActiveBouldering(null);
          router.replace({
            pathname: "/bouldering/summary/[id]",
            params: { id: target.id },
          });
          return;
        }
      }
      Alert.alert("Couldn't finish the session", result.error.message);
    },
    [client, workoutContext],
  );

  const load = useCallback(async () => {
    const isCurrent = capture();
    if (!isCurrent()) return;
    if (!enabled) {
      setStatus({ kind: "disabled" });
      return;
    }
    const local = await loadLocal(isCurrent);
    if (!isCurrent()) return;
    let fetched = await fetchServer(isCurrent, record?.id ?? null);
    if (!isCurrent() || fetched === null) return;
    if (fetched === "none" && wantStart.current) {
      const guard = guardSessionStart("bouldering", {
        workout: workoutContext?.activeWorkout,
        bouldering: null,
      });
      if (
        guard.kind === "blocked" &&
        guard.resume.pathname === "/log-workout"
      ) {
        setStatus({
          kind: "blocked_strength",
          workoutId: guard.resume.workoutId,
        });
        return;
      }
      setBusy("start");
      if (startOperation.current?.owner !== ownerRef.current)
        startOperation.current = {
          owner: ownerRef.current,
          id: Crypto.randomUUID(),
        };
      const started = await startBoulderSession(
        {
          clientOperationId: startOperation.current.id,
          recordingTimezone: timezone(),
          gymName: null,
        },
        client(isCurrent),
      );
      if (!isCurrent()) return;
      setBusy(null);
      if (started.ok) {
        startOperation.current = null;
        wantStart.current = false;
        applyServer(started.value);
        fetched = started.value;
      } else if (started.error.kind === "active_session") {
        fetched = await fetchServer(isCurrent, null);
        if (!isCurrent() || fetched === null) return;
      } else {
        fetched = started.error;
      }
    }
    if (fetched === "none") {
      setStatus({ kind: "none" });
      return;
    }
    if (!("ascents" in fetched)) {
      setStatus(
        fetched.kind === "disabled"
          ? { kind: "disabled" }
          : { kind: "error", failure: fetched },
      );
      return;
    }
    const current = fetched;
    void signPhotos(current.ascents, isCurrent);
    if (current.session.completedAt === null) void loadProjects(isCurrent);
    if (current.ascents.length === 0)
      void getBoulderProgress("30d", client(isCurrent)).then((progress) => {
        if (isCurrent() && progress.ok)
          setRecentGrade(initialBoulderGrade([], progress.value.pyramid));
      });
    await sync(isCurrent, current.session.id);
    if (!isCurrent()) return;
    if (
      local?.finish &&
      local.finish.sessionId === current.session.id &&
      current.session.completedAt === null
    )
      await finishNow(isCurrent, current.session, local.finish);
  }, [
    applyServer,
    capture,
    client,
    enabled,
    fetchServer,
    finishNow,
    loadLocal,
    loadProjects,
    record?.id,
    signPhotos,
    sync,
    workoutContext?.activeWorkout,
  ]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(
    useCallback(() => {
      void loadRef.current();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void loadRef.current();
      });
      return () => subscription.remove();
    }, [userId]),
  );

  const rows: BoulderRow[] = sessionId
    ? mergeBoulderRows(sessionId, ascents, commands)
    : [];
  const sessionCommands = commands.filter((c) => c.sessionId === sessionId);
  const lastRow = rows.at(-1) ?? null;
  const initialGrade =
    rows.length > 0
      ? initialBoulderGrade(
          rows.map((row, index) => ({ grade: row.grade, sequence: index + 1 })),
        )
      : (recentGrade ?? DEFAULT_BOULDER_GRADE);

  const openCreate = () => {
    sheetCounter.current += 1;
    setSheet({
      mode: "create",
      key: sheetCounter.current,
      form: blankBoulderForm(initialGrade),
      project: null,
    });
  };

  const openTryAgain = (project: BoulderProjectRecord) => {
    sheetCounter.current += 1;
    setSheet({
      mode: "create",
      key: sheetCounter.current,
      form: tryAgainForm(project, initialGrade),
      project: {
        id: project.id,
        grade: project.grade,
        holdColour: project.holdColour,
        sessions: project.sessions,
      },
    });
  };

  const openRow = (row: BoulderRow) => {
    if (row.pending || !row.ascent) {
      Alert.alert(
        "Waiting to sync",
        "This boulder is saved on this device. You can edit it once it has synced.",
        [
          { text: "OK" },
          {
            text: "Retry sync",
            onPress: () => void sync(capture(), sessionId),
          },
        ],
      );
      return;
    }
    sheetCounter.current += 1;
    setSheet({
      mode: "edit",
      key: sheetCounter.current,
      ascent: row.ascent,
      form: formFromAscent(row.ascent, DEFAULT_BOULDER_GRADE),
    });
  };

  const save = async (
    form: BoulderForm,
    photo: BoulderPhotoChoice,
    projectId: string | null = null,
  ): Promise<string | null> => {
    const isCurrent = capture();
    if (!sessionId || !sheet) return "This session is no longer open.";
    const operationId = Crypto.randomUUID();
    const queuedAt = new Date().toISOString();
    let command: BoulderPendingCommand | null = null;
    if (sheet.mode === "create") {
      const body = boulderCreateBody(
        form,
        operationId,
        sheet.project ? projectId : null,
      );
      if (body) command = { kind: "create", sessionId, body, queuedAt };
    } else {
      const keepPhoto =
        photo.kind === "remove" ? null : sheet.ascent.photoAssetId;
      const body = boulderUpdateBody(
        form,
        sheet.ascent,
        operationId,
        keepPhoto,
      );
      if (body)
        command = {
          kind: "update",
          sessionId,
          ascentId: sheet.ascent.id,
          body,
          replacedPhotoAssetId: sheet.ascent.photoAssetId,
          queuedAt,
        };
    }
    if (!command) return "Check the boulder details and try again.";
    const write = await boulderPendingStore.enqueue(
      ownerRef.current,
      command,
      isCurrent,
    );
    if (!isCurrent()) return enqueueFailureMessage("account");
    if (!write.ok) return enqueueFailureMessage(write.reason);
    if (sheet.mode === "edit" && photo.kind === "remove") {
      // The edit unlinks any server backup; the device copy goes now.
      forgetBoulderPhoto(ownerRef.current, sheet.ascent.id);
    }
    if (photo.kind === "new")
      waitingPhotos.current.set(operationId, photo.photo);
    // Only now, after the durable write, does the row show as saved.
    await loadLocal(isCurrent);
    setSheet(null);
    void sync(isCurrent, sessionId);
    return null;
  };

  const confirmDelete = (ascent: BoulderAscentRecord) => {
    const hasPhoto =
      ascent.photoAssetId !== null ||
      localPhotoUri(ownerRef.current, "boulder", ascent.id) !== null;
    Alert.alert(
      "Delete boulder?",
      `This removes the ${ascent.grade} boulder${hasPhoto ? " and its photo" : ""}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const isCurrent = capture();
            const write = await boulderPendingStore.enqueue(
              ownerRef.current,
              {
                kind: "delete",
                sessionId: ascent.sessionId,
                ascentId: ascent.id,
                operationId: Crypto.randomUUID(),
                photoAssetId: ascent.photoAssetId,
                queuedAt: new Date().toISOString(),
              },
              isCurrent,
            );
            if (!isCurrent()) return;
            if (!write.ok) {
              Alert.alert(
                "Couldn't delete",
                enqueueFailureMessage(write.reason),
              );
              return;
            }
            forgetBoulderPhoto(ownerRef.current, ascent.id);
            setSheet(null);
            await loadLocal(isCurrent);
            void sync(isCurrent, ascent.sessionId);
          },
        },
      ],
    );
  };

  const retryPhoto = async (ascent: BoulderAscentRecord) => {
    const photo = photoRetry[ascent.id];
    if (!photo) return;
    const isCurrent = capture();
    const result = await attachBoulderPhoto({
      userId: ownerRef.current,
      client: client(isCurrent),
      ascent,
      photo,
      operationId: Crypto.randomUUID(),
      isCurrent,
    });
    if (!isCurrent()) return;
    if (result.kind === "queued" || result.kind === "kept_on_device") {
      setPhotoRetry((current) => {
        const next = { ...current };
        delete next[ascent.id];
        return next;
      });
      if (result.kind === "kept_on_device" && result.backupPending)
        setNotices(addBackupNotice);
      await loadLocal(isCurrent);
      await sync(isCurrent, ascent.sessionId);
    } else Alert.alert("Photo not added", result.message);
  };

  const finish = () => {
    if (!record || busy) return;
    Alert.alert("Finish session?", "You'll see your session summary next.", [
      { text: "Keep climbing", style: "cancel" },
      {
        text: "Finish",
        onPress: async () => {
          const isCurrent = capture();
          setBusy("finish");
          try {
            await sync(isCurrent, record.id);
            if (!isCurrent()) return;
            const state = await loadLocal(isCurrent);
            if (!isCurrent()) return;
            if (
              state === null ||
              state.commands.some((c) => c.sessionId === record.id)
            ) {
              Alert.alert(
                "Boulders still waiting to sync",
                "Connect to the internet and try again so your summary includes every boulder.",
              );
              return;
            }
            const op: BoulderPendingFinish =
              state.finish?.sessionId === record.id
                ? state.finish
                : {
                    sessionId: record.id,
                    clientOperationId: Crypto.randomUUID(),
                    notes: null,
                  };
            if (
              !(await boulderPendingStore.setFinish(
                ownerRef.current,
                op,
                isCurrent,
              ))
            ) {
              Alert.alert(
                "Couldn't finish the session",
                "Your device couldn't keep the finish request. Nothing was sent. Try again.",
              );
              return;
            }
            setPendingFinish(op);
            await finishNow(isCurrent, record, op);
          } finally {
            if (isCurrent()) setBusy(null);
          }
        },
      },
    ]);
  };

  const removeSession = () => {
    if (!record || busy) return;
    const active = record.completedAt === null;
    Alert.alert(
      active ? "Discard session?" : "Delete session?",
      "This permanently removes the session, its boulders and their photos.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: active ? "Discard" : "Delete",
          style: "destructive",
          onPress: async () => {
            const isCurrent = capture();
            setBusy("discard");
            const result = await removeBoulderSession(
              record.id,
              client(isCurrent),
            );
            if (!isCurrent()) return;
            setBusy(null);
            if (!result.ok && result.error.kind !== "not_found") {
              Alert.alert("Couldn't remove the session", result.error.message);
              return;
            }
            for (const command of sessionCommands)
              await boulderPendingStore.remove(
                ownerRef.current,
                commandOperationId(command),
                isCurrent,
              );
            if (pendingFinish?.sessionId === record.id)
              await boulderPendingStore.setFinish(
                ownerRef.current,
                null,
                isCurrent,
              );
            const c = client(isCurrent);
            for (const ascent of ascents) {
              if (ascent.photoAssetId)
                void deleteBoulderPhoto(c, ascent.photoAssetId);
              forgetBoulderPhoto(ownerRef.current, ascent.id);
            }
            if (active) workoutContext?.setActiveBouldering(null);
            router.back();
          },
        },
      ],
    );
  };

  const startFresh = () => {
    wantStart.current = true;
    setStatus({ kind: "loading" });
    void load();
  };

  const header = (
    <Stack.Screen
      options={{
        title: record ? sessionTitle(record) : "Bouldering",
      }}
    />
  );

  if (status.kind !== "ready" || !record) {
    return (
      <ThemedView style={styles.page}>
        {header}
        <SafeAreaView style={styles.page} edges={["left", "right", "bottom"]}>
          <ScrollView contentContainerStyle={styles.content}>
            {status.kind === "loading" ? (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                accessibilityLiveRegion="polite"
              >
                {busy === "start" ? "Starting session…" : "Loading session…"}
              </ThemedText>
            ) : status.kind === "disabled" ? (
              <Card>
                <EmptyState
                  icon="info"
                  title="Bouldering isn't available"
                  message="Indoor bouldering is not turned on for this app yet."
                />
              </Card>
            ) : status.kind === "blocked_strength" ? (
              <Card>
                <EmptyState
                  icon="dumbbell"
                  title="Workout in progress"
                  message="Finish your workout before starting a bouldering session, or resume it now."
                  action={
                    <Button
                      label="Resume workout"
                      variant="tinted"
                      onPress={() =>
                        router.replace({
                          pathname: "/log-workout",
                          params: { workoutId: status.workoutId },
                        })
                      }
                    />
                  }
                />
              </Card>
            ) : status.kind === "none" ? (
              <Card>
                <EmptyState
                  icon="mobility"
                  title="No bouldering session in progress"
                  message="Start a session to log boulders as you climb."
                  action={
                    <Button
                      label="Start bouldering"
                      variant="tinted"
                      onPress={startFresh}
                    />
                  }
                />
              </Card>
            ) : status.kind === "error" ? (
              <View accessibilityRole="alert">
                <Notice
                  tone={
                    status.failure.kind === "offline" ? "warning" : "danger"
                  }
                  title={
                    status.failure.kind === "offline"
                      ? "You're offline"
                      : "Couldn't load the session"
                  }
                  message={status.failure.message}
                  action={
                    <Button
                      label="Retry"
                      variant="plain"
                      size="small"
                      onPress={() => {
                        setStatus({ kind: "loading" });
                        void load();
                      }}
                    />
                  }
                />
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const elapsed = isActive
    ? formatStopwatch(computeElapsedSeconds(record.startedAt, nowMs))
    : record.completedAt
      ? formatStopwatch(
          Math.max(
            0,
            (Date.parse(record.completedAt) - Date.parse(record.startedAt)) /
              1000,
          ),
        )
      : "";

  return (
    <ThemedView style={styles.page}>
      {header}
      <SafeAreaView style={styles.page} edges={["left", "right", "bottom"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
            />
          }
        >
          <Card>
            <ThemedText type="footnote" themeColor="textSecondary">
              {formatBoulderDate(record.session.activityDate)}
              {isActive ? " · In progress" : " · Finished"}
            </ThemedText>
            <ThemedText
              type="title"
              accessibilityLabel={`${isActive ? "Elapsed" : "Duration"} ${elapsed}`}
            >
              {elapsed}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {rows.length} {rows.length === 1 ? "boulder" : "boulders"}
            </ThemedText>
          </Card>

          {storeUnreadable ? (
            <Notice
              tone="danger"
              title="Saved boulders can't be read"
              message="Boulders kept on this device couldn't be read, so they haven't been sent. New boulders can't be saved offline until this is cleared."
              action={
                <Button
                  label="Clear device copy"
                  variant="plain"
                  size="small"
                  onPress={() =>
                    Alert.alert(
                      "Clear boulders saved on this device?",
                      "Anything not yet synced will be lost.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Clear",
                          style: "destructive",
                          onPress: async () => {
                            await boulderPendingStore.discard(ownerRef.current);
                            void load();
                          },
                        },
                      ],
                    )
                  }
                />
              }
            />
          ) : null}
          {syncProblem && sessionCommands.length > 0 ? (
            <Notice
              tone="warning"
              message={`${syncProblem.message} ${sessionCommands.length} waiting to sync.`}
              action={
                <Button
                  label="Retry sync"
                  variant="plain"
                  size="small"
                  onPress={() => void sync(capture(), sessionId)}
                />
              }
            />
          ) : null}
          {notices.map((message, index) => (
            <Notice
              key={`${index}:${message}`}
              tone="info"
              message={message}
              action={
                <Button
                  label="Dismiss"
                  variant="plain"
                  size="small"
                  onPress={() =>
                    setNotices((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                />
              }
            />
          ))}

          {isActive ? (
            <Button
              label="Log a boulder"
              icon="add"
              block
              onPress={openCreate}
            />
          ) : null}

          {isActive && projects.length > 0 ? (
            <Card>
              <ThemedText type="headline" accessibilityRole="header">
                Projects
              </ThemedText>
              {(showAllProjects
                ? tryAgainProjects(projects)
                : tryAgainProjects(projects).slice(0, VISIBLE_PROJECTS)
              ).map((project) => (
                <View key={project.id} style={styles.projectRow}>
                  <View
                    style={styles.projectText}
                    accessible
                    accessibilityLabel={projectAccessibilityLabel(project)}
                  >
                    <View style={styles.projectTitle}>
                      {project.holdColour ? (
                        <HoldColourSwatch
                          colour={project.holdColour}
                          size={14}
                        />
                      ) : null}
                      <ThemedText type="smallBold">
                        {projectName(project)}
                      </ThemedText>
                    </View>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {project.older
                        ? `Older than 6 weeks · ${projectSubtitle(project)}`
                        : projectSubtitle(project)}
                    </ThemedText>
                  </View>
                  <Button
                    label="Try again"
                    icon="repeat"
                    variant="tinted"
                    size="small"
                    accessibilityLabel={`Try again: project ${projectName(project, true)}`}
                    onPress={() => openTryAgain(project)}
                  />
                </View>
              ))}
              {projects.length > VISIBLE_PROJECTS ? (
                <Button
                  label={
                    showAllProjects
                      ? "Show fewer projects"
                      : `Show all ${projects.length} projects`
                  }
                  variant="plain"
                  size="small"
                  onPress={() => setShowAllProjects((all) => !all)}
                />
              ) : null}
            </Card>
          ) : null}

          {rows.length === 0 ? (
            <Card>
              <EmptyState
                icon="mobility"
                title={isActive ? "No boulders yet" : "No boulders logged"}
                message={
                  isActive
                    ? "Log each boulder as you climb: grade, then Flash, Sent or Not yet."
                    : undefined
                }
              />
            </Card>
          ) : (
            <ListGroup>
              {rows.map((row) => (
                <BoulderRowView
                  key={row.key}
                  row={row}
                  photo={
                    row.ascent
                      ? boulderPhotoSource(
                          userId,
                          row.ascent.id,
                          row.photoAssetId,
                          photoUrls,
                        )
                      : null
                  }
                  photoFailed={!!(row.ascent && photoRetry[row.ascent.id])}
                  onPress={() => openRow(row)}
                  onRetryPhoto={
                    row.ascent && photoRetry[row.ascent.id]
                      ? () => void retryPhoto(row.ascent!)
                      : undefined
                  }
                />
              ))}
            </ListGroup>
          )}

          {isActive ? (
            <Button
              label={busy === "finish" ? "Finishing…" : "Finish session"}
              icon="checkCircle"
              variant="secondary"
              block
              loading={busy === "finish"}
              disabled={busy !== null}
              onPress={finish}
            />
          ) : (
            <>
              <Button
                label="View summary"
                variant="secondary"
                block
                onPress={() =>
                  router.push({
                    pathname: "/bouldering/summary/[id]",
                    params: { id: record.id },
                  })
                }
              />
              {mode === "history" &&
              canShareBoulderingSession({
                boulderingEnabled: enabled,
                communityEnrolled: community.isEnrolled,
                completedAt: record.completedAt,
                pendingChanges: commands.length,
              }) ? (
                <Button
                  label="Share session"
                  icon="share"
                  variant="secondary"
                  block
                  accessibilityHint="Preview the card before sharing it with your approved followers"
                  onPress={() => router.push(shareBoulderingHref(record.id))}
                />
              ) : null}
            </>
          )}
          <Button
            label={isActive ? "Discard session" : "Delete session"}
            variant="plain"
            disabled={busy !== null}
            onPress={removeSession}
          />
        </ScrollView>
      </SafeAreaView>

      {sheet ? (
        <LogBoulderSheet
          key={sheet.key}
          visible
          mode={sheet.mode}
          initialForm={sheet.form}
          project={sheet.mode === "create" ? sheet.project : null}
          lastAscent={
            sheet.mode === "create" && lastRow
              ? {
                  grade: lastRow.grade as FontGrade,
                  holdColour: lastRow.holdColour,
                }
              : null
          }
          hasExistingPhoto={
            sheet.mode === "edit" &&
            (sheet.ascent.photoAssetId !== null ||
              localPhotoUri(userId, "boulder", sheet.ascent.id) !== null)
          }
          onClose={() => setSheet(null)}
          onSave={save}
          onDelete={
            sheet.mode === "edit"
              ? () => confirmDelete(sheet.ascent)
              : undefined
          }
        />
      ) : null}
    </ThemedView>
  );
}

function BoulderRowView({
  row,
  photo,
  photoFailed,
  onPress,
  onRetryPhoto,
}: {
  row: BoulderRow;
  photo: BoulderPhotoSource | null;
  photoFailed: boolean;
  onPress: () => void;
  onRetryPhoto?: () => void;
}) {
  const theme = useTheme();
  const send = row.result !== "not_yet";
  const pendingText =
    row.pending === "delete"
      ? "Delete saved on this device · Waiting to sync"
      : row.pending
        ? PENDING_SYNC_TEXT
        : null;
  return (
    <View style={styles.rowWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ascentAccessibilityLabel(row, row.pending !== null)}
        accessibilityHint={
          row.pending ? undefined : "Edit or delete this boulder"
        }
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: theme.backgroundSelected },
          row.pending === "delete" && styles.fading,
        ]}
      >
        <View
          style={[
            styles.gradeBadge,
            {
              backgroundColor: send
                ? theme.primaryLight
                : theme.backgroundSelected,
            },
          ]}
        >
          <ThemedText
            type="headline"
            style={{ color: send ? theme.primary : theme.text }}
            accessibilityLabel={gradeSpoken(row.grade)}
          >
            {row.grade}
          </ThemedText>
        </View>
        <View style={styles.rowText}>
          <View style={styles.inline}>
            <Icon
              name={RESULT_ICONS[row.result]}
              size={14}
              color={send ? "primary" : "textSecondary"}
            />
            <ThemedText type="default">
              {resultText(row.result, row.attempts)}
            </ThemedText>
          </View>
          {row.holdColour ? (
            <View style={styles.inline}>
              <HoldColourSwatch colour={row.holdColour} size={12} />
              <ThemedText type="footnote" themeColor="textSecondary">
                {holdColourLabel(row.holdColour)}
              </ThemedText>
            </View>
          ) : null}
          {row.note ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {row.note}
            </ThemedText>
          ) : null}
          {pendingText ? (
            <View style={styles.inline}>
              <Icon name="timer" size={12} color="warning" />
              <ThemedText type="footnote" themeColor="warning">
                {pendingText}
              </ThemedText>
            </View>
          ) : null}
        </View>
        {photo ? (
          <Image
            key={photo.uri}
            recyclingKey={photo.uri}
            source={{ uri: photo.uri }}
            cachePolicy={photo.cachePolicy}
            style={styles.thumb}
            accessibilityLabel="Boulder photo"
          />
        ) : row.photoAssetId ? (
          <Icon name="photo" size={20} color="textTertiary" />
        ) : null}
      </Pressable>
      {photoFailed && onRetryPhoto ? (
        <View style={styles.retryRow}>
          <ThemedText type="footnote" themeColor="warning" style={styles.grow}>
            Photo not kept. The boulder is saved.
          </ThemedText>
          <Button
            label="Retry photo"
            variant="plain"
            size="small"
            onPress={onRetryPhoto}
          />
        </View>
      ) : null}
    </View>
  );
}

const BACKUP_PENDING_NOTICE =
  "Photo saved on this device. Its backup will be tried again later.";
const addBackupNotice = (current: string[]) =>
  current.includes(BACKUP_PENDING_NOTICE)
    ? current
    : [...current, BACKUP_PENDING_NOTICE];

/** Projects shown before "Show all" in the active session. */
const VISIBLE_PROJECTS = 3;

const styles = StyleSheet.create({
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: MinTouchTarget,
  },
  projectText: { flex: 1, gap: Spacing.half },
  projectTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  page: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.three,
    gap: Spacing.three,
  },
  rowWrap: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    minHeight: MinTouchTarget + Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  fading: { opacity: 0.55 },
  gradeBadge: {
    minWidth: 52,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: Spacing.half },
  inline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.one + Spacing.half,
  },
  thumb: { width: 48, height: 48, borderRadius: Radius.sm },
  retryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  grow: { flexGrow: 1, flexShrink: 1 },
});
