import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  workoutListResponseSchema,
  type Workout,
  type WorkoutListResponse,
  type CommunityRoutinePreview,
  type CommunityRoutineShare,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { ReportModal, scopeCommunityClient } from "@/features/community";
import {
  listRoutineShares,
  previewRoutineShare,
  publishRoutineShare,
  importRoutineShare,
  unshareRoutine,
} from "./client";

export function CommunityRoutinesScreen() {
  const { session } = useAuth();
  return (
    <RoutinesContent
      key={session?.user.id ?? "signed-out"}
      principal={session?.user.id ?? null}
    />
  );
}
function RoutinesContent({ principal }: { principal: string | null }) {
  const theme = useTheme();
  const epoch = useRef(0);
  const freshRead = useRef(0);
  const freshLoading = useRef(false);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  const client = useMemo(
    () => scopeCommunityClient(apiClient, principal, () => active.current),
    [principal],
  );
  const [shares, setShares] = useState<CommunityRoutineShare[]>([]);
  const [routines, setRoutines] = useState<Workout[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState<CommunityRoutinePreview | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<CommunityRoutineShare | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const reset = useCallback(() => {
    freshRead.current++;
    if (expiry.current !== null) clearTimeout(expiry.current);
    expiry.current = null;
    freshLoading.current = false;
    epoch.current++;
    active.current = false;
    setShares([]);
    setRoutines([]);
    setPreview(null);
    setSelected(null);
    setOperation(null);
    setReport(null);
    setCursor(null);
    setBusy(false);
  }, []);
  const load = useCallback(
    async (append = false, mine = mineOnly) => {
      const current = ++epoch.current;
      const read = ++freshRead.current;
      freshLoading.current = true;
      const deadline = Date.now() + 10_000;
      if (expiry.current !== null) clearTimeout(expiry.current);
      // Hide the old authorization result before starting another request.
      setShares([]);
      setRoutines([]);
      setReport(null);
      setPreview(null);
      expiry.current = setTimeout(() => {
        if (freshRead.current !== read) return;
        freshRead.current++;
        expiry.current = null;
        setShares([]);
        setReport(null);
        setCursor(null);
        if (freshLoading.current) {
          freshLoading.current = false;
          setBusy(false);
        }
        setNotice("Refresh shared routines to check current access.");
      }, 10_000);
      setBusy(true);
      setError(null);
      const [page, privateRows] = await Promise.all([
        listRoutineShares(
          client,
          mine,
          append ? (cursor ?? undefined) : undefined,
        ),
        client.request<WorkoutListResponse>({
          method: "GET",
          path: "/v1/workouts?kind=routine&limit=200",
          schema: workoutListResponseSchema,
        }),
      ]).catch(() => [{ ok: false as const }, { ok: false as const }] as const);
      if (
        current !== epoch.current ||
        freshRead.current !== read ||
        Date.now() >= deadline ||
        !active.current
      )
        return;
      freshLoading.current = false;
      setBusy(false);
      if (!page.ok || !privateRows.ok) {
        setShares([]);
        setRoutines([]);
        setError(
          "Shared routines are unavailable. Refresh to check your current access.",
        );
        return;
      }
      setShares(page.value.items);
      setRoutines(privateRows.value.workouts);
      setCursor(page.value.nextCursor);
    },
    [client, cursor, mineOnly],
  );
  // Do not use cursor-dependent load as a focus effect dependency.
  const initialLoad = useRef(load);
  initialLoad.current = load;
  useFocusEffect(
    useCallback(() => {
      let foreground = AppState.currentState === "active";
      if (foreground) {
        active.current = true;
        void initialLoad.current();
      }
      const sub = AppState.addEventListener("change", (state) => {
        if (foreground === (state === "active")) return;
        foreground = state === "active";
        reset();
        if (foreground) {
          active.current = true;
          void initialLoad.current();
        }
      });
      return () => {
        sub.remove();
        reset();
      };
    }, [reset]),
  );
  const perform = async (
    action: () => Promise<{ ok: boolean }>,
    message: string,
  ) => {
    const current = epoch.current;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (current !== epoch.current || !active.current) return;
      setBusy(false);
      if (!result.ok) {
        setShares([]);
        setPreview(null);
        setError("That routine action is unavailable. Refresh and try again.");
        return;
      }
      setNotice(message);
      setPreview(null);
      setOperation(null);
      await load();
    } catch {
      if (current === epoch.current && active.current) {
        setBusy(false);
        setShares([]);
        setPreview(null);
        setError("Unable to finish. Refresh and try again.");
      }
    }
  };
  const button = (label: string, action: () => void, disabled = busy) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={action}
      style={{
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 12,
        padding: 12,
        marginVertical: 5,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: theme.text }}>{label}</Text>
    </Pressable>
  );
  const showPreview = async () => {
    if (!selected) return;
    const current = epoch.current;
    setBusy(true);
    setError(null);
    const result = await previewRoutineShare(client, selected, title);
    if (current !== epoch.current || !active.current) return;
    setBusy(false);
    if (!result.ok) {
      setPreview(null);
      setError(
        "Use a plain title and a routine with bounded numeric repetition targets and kg or lb loads. Refresh after edits.",
      );
      return;
    }
    setPreview(result.value);
    setOperation(Crypto.randomUUID());
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: "Shared routines" }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700" }}>
          Exchange a workout plan
        </Text>
        <Text style={{ color: theme.text }}>
          Share only the targets you preview with your approved followers.
          Notes, injury information, Coach context and private exercise IDs stay
          private. Names become independent custom exercises in a recipient's
          copy.
        </Text>
        <Text style={{ color: theme.text }}>
          Shared copies can remain with recipients after you unshare, edit or
          delete your original. Plans are suggestions; adapt them to your
          abilities.
        </Text>
        {!principal && (
          <Text style={{ color: theme.text }}>
            Sign in to use Community routines.
          </Text>
        )}
        {error && (
          <Text accessibilityRole="alert" style={{ color: theme.text }}>
            {error}
          </Text>
        )}
        {notice && (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.text }}>
            {notice}
          </Text>
        )}
        {button(
          busy ? "Loading…" : "Refresh routines",
          () => void load(),
          busy || !principal,
        )}
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>
          Choose your private routine
        </Text>
        {routines.map((r) =>
          button(`${selected === r.id ? "Selected: " : ""}${r.name}`, () => {
            setSelected(r.id);
            setPreview(null);
            setOperation(null);
          }),
        )}
        {selected && (
          <>
            <TextInput
              editable={!busy}
              accessibilityLabel="Public routine title"
              placeholder="Choose a title to share"
              placeholderTextColor={theme.text}
              maxLength={80}
              value={title}
              onChangeText={(text) => {
                setTitle(text);
                setPreview(null);
                setOperation(null);
              }}
              style={{
                color: theme.text,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 12,
                borderRadius: 10,
              }}
            />
            {button(
              "Preview exact shared targets",
              () => void showPreview(),
              busy || !title.trim(),
            )}
          </>
        )}
        {preview && (
          <View
            style={{
              gap: 8,
              padding: 14,
              borderColor: theme.border,
              borderWidth: 1,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: theme.text, fontWeight: "700" }}>
              {preview.snapshot.title}
            </Text>
            {preview.snapshot.exercises.map((e, i) => (
              <Text key={i} style={{ color: theme.text }}>
                {e.name}: {e.sets} sets × {e.repsMin}–{e.repsMax} reps
                {e.loadKg === null ? "" : ` at ${e.loadKg} kg`}; rest{" "}
                {e.restSeconds}s
              </Text>
            ))}
            {button(
              "Confirm and share this preview with approved followers",
              () => {
                if (selected && operation)
                  void perform(
                    () =>
                      publishRoutineShare(client, selected, preview, operation),
                    "Routine shared.",
                  );
              },
            )}
          </View>
        )}
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>
          Currently available routines
        </Text>
        {button(
          mineOnly
            ? "Show friends’ available routines"
            : "Manage my shared routines",
          () => {
            setMineOnly(!mineOnly);
            void load(false, !mineOnly);
          },
        )}
        {!busy && !shares.length && !error && (
          <Text style={{ color: theme.text }}>
            No currently available shared routines.
          </Text>
        )}
        {shares.map((s) => (
          <View
            key={s.id}
            style={{
              borderColor: theme.border,
              borderWidth: 1,
              borderRadius: 14,
              padding: 14,
              gap: 6,
            }}
          >
            <Text style={{ color: theme.text, fontWeight: "700" }}>
              {s.snapshot.title} · @{s.authorHandle} · version {s.version}
            </Text>
            {!s.available && (
              <Text style={{ color: theme.text }}>
                No longer available to followers. You can unshare this snapshot.
              </Text>
            )}
            {s.snapshot.exercises.map((e, i) => (
              <Text key={i} style={{ color: theme.text }}>
                {e.name}: {e.sets} × {e.repsMin}–{e.repsMax}
                {e.loadKg === null ? "" : ` · ${e.loadKg} kg`} · rest{" "}
                {e.restSeconds}s
              </Text>
            ))}
            {s.isOwner ? (
              button(
                "Unshare routine",
                () =>
                  void perform(
                    () => unshareRoutine(client, s.id),
                    "Routine no longer shared.",
                  ),
              )
            ) : (
              <>
                {button("Import an independent private copy", () =>
                  Alert.alert(
                    "Copy this routine?",
                    "This creates an editable private workout routine with attribution. It will not update when the author changes or deletes the shared plan. Review the targets before training.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Confirm import",
                        onPress: () =>
                          void perform(
                            () => importRoutineShare(client, s.id, s.version),
                            "Private routine imported. Find and edit it in Workouts.",
                          ),
                      },
                    ],
                  ),
                )}
                {button("Report unsafe routine", () => setReport(s))}
              </>
            )}
          </View>
        ))}
        {cursor &&
          button("Next page of shared routines", () => void load(true))}
        <ReportModal
          visible={report !== null}
          targetType="routine"
          targetId={report?.id ?? ""}
          targetHandle={report?.authorHandle ?? ""}
          principalKey={principal}
          onClose={() => setReport(null)}
        />
      </ScrollView>
    </View>
  );
}
