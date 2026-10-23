import { CommunityIdentityLink } from "../ui";
import {
  COMMUNITY_READ_LIFETIME_MS,
  COMMUNITY_READ_RENEWAL_RETRY_MS,
  canRetryCommunityRenewal,
  communityRenewalDelay,
  getCommunityReadDeadline,
  invalidateCommunityReads,
} from "../state/read-cache";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
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
import { CommunityPage } from "../ui";
import { ReportModal, scopeCommunityClient } from "@/features/community";
import {
  listRoutineShares,
  previewRoutineShare,
  publishRoutineShare,
  importRoutineShare,
  unshareRoutine,
} from "./client";
import { isCommunityAccessDenial } from "../community-client";

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
  const renewal = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPage = useRef<{ mine: boolean; cursor?: string } | null>(null);
  const active = useRef(false);
  const actionLock = useRef<symbol | null>(null);
  const privateRead = useRef(0);
  const privateLoaded = useRef(false);
  const privatePending = useRef(false);
  const client = useMemo(
    () => scopeCommunityClient(apiClient, principal, () => active.current),
    [principal],
  );
  const [shares, setShares] = useState<CommunityRoutineShare[]>([]);
  const [routines, setRoutines] = useState<Workout[]>([]);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [privateError, setPrivateError] = useState<string | null>(null);
  const [shareTask, setShareTask] = useState(false);
  const [openedShare, setOpenedShare] = useState<string | null>(null);
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
    if (renewal.current !== null) clearTimeout(renewal.current);
    renewal.current = null;
    lastPage.current = null;
    freshLoading.current = false;
    epoch.current++;
    active.current = false;
    actionLock.current = null;
    setShares([]);
    setOpenedShare(null);
    setShareTask(false);
    setRoutines([]);
    privateRead.current++;
    privateLoaded.current = false;
    privatePending.current = false;
    setPrivateBusy(false);
    setPrivateError(null);
    setPreview(null);
    setSelected(null);
    setOperation(null);
    setReport(null);
    setCursor(null);
    setBusy(false);
  }, []);
  /** Deadline of the displayed shared page; renewal retries stop before it. */
  const displayDeadline = useRef(0);
  const retireFor = useCallback(
    (read: number) => () => {
      if (freshRead.current !== read) return;
      freshRead.current++;
      if (expiry.current !== null) clearTimeout(expiry.current);
      expiry.current = null;
      if (renewal.current !== null) clearTimeout(renewal.current);
      renewal.current = null;
      setShares([]);
      setReport(null);
      setCursor(null);
      if (freshLoading.current) {
        freshLoading.current = false;
        setBusy(false);
      }
      setNotice("Refresh shared routines to check current access.");
    },
    [],
  );
  // Silent renewal: re-read the displayed page without clearing it or showing a
  // loading state. Only a fresh successful response, applied before the original
  // deadline, replaces the page and re-arms timers; otherwise the old timer retires it.
  const renew = useCallback(async () => {
    const last = lastPage.current;
    const read = freshRead.current;
    // A preempted or transiently failed renewal is retried until the deadline.
    const retry = () => {
      if (
        !active.current ||
        freshRead.current !== read ||
        !canRetryCommunityRenewal(displayDeadline.current)
      )
        return;
      if (renewal.current !== null) clearTimeout(renewal.current);
      renewal.current = setTimeout(
        () => void renewRef.current(),
        COMMUNITY_READ_RENEWAL_RETRY_MS,
      );
    };
    if (!last || !active.current) return;
    if (actionLock.current) return retry();
    const current = epoch.current;
    let deadline = Date.now() + COMMUNITY_READ_LIFETIME_MS;
    const page = await listRoutineShares(client, last.mine, last.cursor).catch(
      () => ({ ok: false as const, error: null }),
    );
    if (current !== epoch.current || !active.current) return;
    if (freshRead.current !== read) return;
    if (!page.ok) {
      if (page.error && isCommunityAccessDenial(page.error)) retireFor(read)();
      else retry();
      return;
    }
    if (actionLock.current) return retry();
    deadline = Math.min(
      deadline,
      getCommunityReadDeadline(page.value) ?? deadline,
    );
    if (Date.now() >= deadline) return;
    const next = ++freshRead.current;
    displayDeadline.current = deadline;
    if (expiry.current !== null) clearTimeout(expiry.current);
    expiry.current = setTimeout(retireFor(next), deadline - Date.now());
    if (renewal.current !== null) clearTimeout(renewal.current);
    renewal.current = setTimeout(
      () => void renewRef.current(),
      communityRenewalDelay(deadline),
    );
    setShares(page.value.items);
    setCursor(page.value.nextCursor);
  }, [client, retireFor]);
  const renewRef = useRef(renew);
  renewRef.current = renew;
  const load = useCallback(
    async (append = false, mine = mineOnly, refreshPrivate = false) => {
      const current = ++epoch.current;
      const read = ++freshRead.current;
      freshLoading.current = true;
      let deadline = Date.now() + COMMUNITY_READ_LIFETIME_MS;
      if (expiry.current !== null) clearTimeout(expiry.current);
      if (renewal.current !== null) clearTimeout(renewal.current);
      renewal.current = null;
      lastPage.current = null;
      // Hide the old authorization result before starting another request.
      setShares([]);
      setReport(null);
      setPreview(null);
      const retire = retireFor(read);
      expiry.current = setTimeout(retire, COMMUNITY_READ_LIFETIME_MS);
      setBusy(true);
      setError(null);
      const pageRequest = listRoutineShares(
        client,
        mine,
        append ? (cursor ?? undefined) : undefined,
      ).catch(() => ({ ok: false as const }));
      // Private source choices are independent of the protected shared list.
      // Paging and audience changes must not refetch an unchanged private diary.
      if (
        !append &&
        (refreshPrivate || (!privateLoaded.current && !privatePending.current))
      ) {
        const privateRequest = ++privateRead.current;
        privatePending.current = true;
        setPrivateBusy(true);
        setPrivateError(null);
        setRoutines([]);
        void client
          .request<WorkoutListResponse>({
            method: "GET",
            path: "/v1/workouts?kind=routine&limit=200",
            schema: workoutListResponseSchema,
          })
          .catch(() => ({ ok: false as const }))
          .then((rows) => {
            if (privateRead.current !== privateRequest || !active.current)
              return;
            privatePending.current = false;
            setPrivateBusy(false);
            privateLoaded.current = rows.ok;
            if (rows.ok) setRoutines(rows.value.workouts);
            else
              setPrivateError(
                "Your private routines could not be loaded. Refresh to try again.",
              );
          });
      }
      const page = await pageRequest;
      if (page.ok)
        deadline = Math.min(
          deadline,
          getCommunityReadDeadline(page.value) ?? deadline,
        );
      if (
        current !== epoch.current ||
        freshRead.current !== read ||
        !active.current
      )
        return;
      if (Date.now() >= deadline) {
        retire();
        return;
      }
      if (expiry.current !== null) clearTimeout(expiry.current);
      expiry.current = setTimeout(retire, deadline - Date.now());
      freshLoading.current = false;
      setBusy(false);
      if (!page.ok) {
        setShares([]);
        setError(
          "Shared routines are unavailable. Refresh to check your current access.",
        );
        return;
      }
      setNotice((previous) =>
        previous === "Refresh shared routines to check current access."
          ? null
          : previous,
      );
      setShares(page.value.items);
      setCursor(page.value.nextCursor);
      lastPage.current = {
        mine,
        ...(append && cursor ? { cursor } : {}),
      };
      displayDeadline.current = deadline;
      renewal.current = setTimeout(
        () => void renewRef.current(),
        communityRenewalDelay(deadline),
      );
    },
    [client, cursor, mineOnly, retireFor],
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
    if (!active.current || actionLock.current) return;
    const token = Symbol();
    actionLock.current = token;
    const current = epoch.current;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (
        current !== epoch.current ||
        !active.current ||
        actionLock.current !== token
      )
        return;
      actionLock.current = null;
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
        if (actionLock.current !== token) return;
        actionLock.current = null;
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
        borderBottomWidth: 1,
        borderColor: theme.border,
        paddingVertical: 12,
        minHeight: 48,
        justifyContent: "center",
        marginVertical: 5,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
  const showPreview = async () => {
    if (!selected) return;
    const current = epoch.current;
    setBusy(true);
    setError(null);
    const result = await previewRoutineShare(client, selected, title).catch(
      () => ({ ok: false as const }),
    );
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <CommunityPage title="Shared routines" backHref="/community/more">
        <Text style={{ color: theme.textSecondary }}>
          Preview the exact targets before sharing or saving a private copy.
          Imported copies stay independent of the author's original.
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
          () => {
            invalidateCommunityReads();
            void load(false, mineOnly, true);
          },
          busy || !principal,
        )}
        {!shareTask &&
          button("Share a private routine", () => {
            setShareTask(true);
            setOpenedShare(null);
          })}
        {shareTask && (
          <>
            {button("Cancel routine sharing", () => {
              setShareTask(false);
              setSelected(null);
              setPreview(null);
              setOperation(null);
              setTitle("");
            })}
            <Text style={{ color: theme.textSecondary }}>
              Share only the targets you preview with current and future
              approved followers. Notes, injury information, Coach context and
              private exercise IDs stay private. Names become independent custom
              exercises in a recipient's copy. Shared copies can remain after
              you unshare, edit or delete the original. Adapt plans to your
              abilities.
            </Text>
            <Text
              style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}
            >
              Choose your private routine
            </Text>
            {privateBusy && (
              <Text style={{ color: theme.textSecondary }}>
                Loading your private routines…
              </Text>
            )}
            {privateError && (
              <Text accessibilityRole="alert" style={{ color: theme.text }}>
                {privateError}
              </Text>
            )}
            {routines.map((r) => (
              <View key={r.id}>
                {button(
                  `${selected === r.id ? "Selected: " : ""}${r.name}`,
                  () => {
                    setSelected(r.id);
                    setPreview(null);
                    setOperation(null);
                  },
                )}
              </View>
            ))}
            {selected && (
              <>
                <TextInput
                  editable={!busy}
                  accessibilityLabel="Shared routine title"
                  placeholder="Choose a title to share"
                  placeholderTextColor={theme.textSecondary}
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
                          publishRoutineShare(
                            client,
                            selected,
                            preview,
                            operation,
                          ),
                        "Routine shared.",
                      );
                  },
                )}
              </View>
            )}
          </>
        )}
        {!shareTask && (
          <>
            <Text
              style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}
            >
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
                  borderBottomWidth: 1,
                  paddingVertical: 14,
                  gap: 6,
                }}
              >
                {s.authorUserId ? (
                  <CommunityIdentityLink
                    userId={s.authorUserId}
                    displayName={`@${s.authorHandle}`}
                  />
                ) : null}
                {button(`${s.snapshot.title} · @${s.authorHandle}`, () =>
                  setOpenedShare(openedShare === s.id ? null : s.id),
                )}
                {openedShare === s.id && (
                  <>
                    <Text style={{ color: theme.textSecondary }}>
                      Shared version {s.version}. Save creates an independent
                      private copy.
                    </Text>
                    {!s.available && (
                      <Text style={{ color: theme.text }}>
                        No longer available to followers. You can unshare this
                        snapshot.
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
                      button("Unshare routine", () =>
                        Alert.alert(
                          "Unshare this routine?",
                          "Followers will no longer be able to see or import this snapshot. Copies they already imported are kept.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Unshare",
                              style: "destructive",
                              onPress: () =>
                                void perform(
                                  () => unshareRoutine(client, s.id),
                                  "Routine no longer shared.",
                                ),
                            },
                          ],
                        ),
                      )
                    ) : (
                      <>
                        {button("Import an independent private copy", () => {
                          const intentEpoch = epoch.current;
                          const intentRead = freshRead.current;
                          Alert.alert(
                            "Copy this routine?",
                            "This creates an editable private workout routine with attribution. It will not update when the author changes or deletes the shared plan. Review the targets before training.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Confirm import",
                                onPress: () => {
                                  if (
                                    !active.current ||
                                    epoch.current !== intentEpoch ||
                                    freshRead.current !== intentRead
                                  )
                                    return;
                                  void perform(
                                    () =>
                                      importRoutineShare(
                                        client,
                                        s.id,
                                        s.version,
                                      ),
                                    "Private routine imported. Find and edit it in Workouts.",
                                  );
                                },
                              },
                            ],
                          );
                        })}
                        {button("Report unsafe routine", () => setReport(s))}
                      </>
                    )}
                  </>
                )}
              </View>
            ))}
            {cursor &&
              button("Next page of shared routines", () => void load(true))}
          </>
        )}
        <ReportModal
          visible={report !== null}
          targetType="routine"
          targetId={report?.id ?? ""}
          targetHandle={report?.authorHandle ?? ""}
          principalKey={principal}
          onClose={() => setReport(null)}
        />
      </CommunityPage>
    </KeyboardAvoidingView>
  );
}
