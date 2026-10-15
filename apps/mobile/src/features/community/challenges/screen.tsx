import {
  getCommunityReadEpoch,
  invalidateCommunityReads,
} from "../state/read-cache";
import { useAuth } from "@/features/auth/auth-context";
import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from "react-native";
import {
  router,
  type Href,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import * as Crypto from "expo-crypto";
import { communityChallengeResponseSchema } from "@mizyun/contracts";
import { challengeLocalDay } from "@mizyun/core";
import { useTheme } from "@/hooks/use-theme";
import { CommunityPage } from "../ui";
import {
  ExpansionButton,
  ExpansionInput,
  useExpansionCommand,
} from "../expansions";
import { apiClient } from "@/composition/api-client";
import { workoutListResponseSchema } from "@mizyun/contracts";
import { ReportModal } from "../safety/report-modal";
import { scopeCommunityClient } from "../scoped-client";
function CommunityChallengesScreenContent() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const state = useExpansionCommand(
    "/v1/community/challenges",
    communityChallengeResponseSchema,
  );
  const t = useTheme();
  const [creating, setCreating] = useState(false);
  const [manage, setManage] = useState(false);
  const [report, setReport] = useState(false);
  const [title, setTitle] = useState("");
  const [workouts, setWorkouts] = useState<{ id: string; name: string }[]>([]);
  const [workoutsBusy, setWorkoutsBusy] = useState(false);
  const [workoutsNotice, setWorkoutsNotice] = useState<string | null>(null);
  const workoutRead = useRef<AbortController | null>(null);
  const workoutChoicesAccess = useRef<(() => boolean) | null>(null);
  const cancelWorkoutRead = useCallback(() => {
    workoutRead.current?.abort();
    workoutRead.current = null;
    workoutChoicesAccess.current = null;
  }, []);
  const clearWorkoutChoices = () => {
    cancelWorkoutRead();
    workoutChoicesAccess.current = null;
    setWorkouts([]);
    setWorkoutsBusy(false);
    setWorkoutsNotice(null);
  };
  const [id, setId] = useState<string | null>(null);
  const [createId, setCreateId] = useState(() => Crypto.randomUUID());
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = challengeLocalDay(
    new Date(),
    (state.data?.challenge?.id === id ? state.data.challenge.timezone : null) ??
      timezone,
  );
  useFocusEffect(
    useCallback(() => {
      cancelWorkoutRead();
      setReport(false);
      setManage(false);
      setCreating(false);
      setTitle("");
      setId(null);
      setWorkouts([]);
      setWorkoutsBusy(false);
      setWorkoutsNotice(null);
      setCreateId(Crypto.randomUUID());
      if (groupId)
        void state.run({
          operation: "list",
          groupId,
        });
      let foreground = AppState.currentState === "active";
      const sub = AppState.addEventListener("change", (next) => {
        if (foreground === (next === "active")) return;
        foreground = next === "active";
        cancelWorkoutRead();
        setReport(false);
        setId(null);
        setTitle("");
        setWorkouts([]);
        setWorkoutsBusy(false);
        setWorkoutsNotice(null);
      });
      return () => {
        sub.remove();
        cancelWorkoutRead();
        setReport(false);
        setId(null);
        setTitle("");
        setWorkouts([]);
        setWorkoutsBusy(false);
        setWorkoutsNotice(null);
      };
    }, [state.run, groupId, cancelWorkoutRead]),
  );
  const current =
    state.data?.challenge?.id === id ? state.data.challenge : null;
  const loadWorkouts = async () => {
    const principal = state.principal;
    if (!principal || !current || state.busy || workoutsBusy) return;
    const capturedAccess = state.capture();
    const readEpoch = getCommunityReadEpoch();
    const currentAccess = () =>
      capturedAccess() && readEpoch === getCommunityReadEpoch();
    cancelWorkoutRead();
    const read = new AbortController();
    workoutRead.current = read;
    setWorkoutsBusy(true);
    setWorkoutsNotice(null);
    const response = await scopeCommunityClient(
      apiClient,
      principal,
      currentAccess,
    ).request<{
      workouts: { id: string; name: string; completedAt?: string | null }[];
    }>({
      method: "GET",
      path: "/v1/workouts?limit=50",
      schema: workoutListResponseSchema,
      // A deliberate source selection needs a live owner read, not saved display data.
      signal: read.signal,
    });
    if (workoutRead.current !== read || read.signal.aborted) return;
    workoutRead.current = null;
    setWorkoutsBusy(false);
    if (!currentAccess()) return;
    workoutChoicesAccess.current = currentAccess;
    if (!response.ok) {
      setWorkouts([]);
      setWorkoutsNotice("Unable to load your completed workouts. Try again.");
      return;
    }
    const completed = response.value.workouts.filter(
      (w) =>
        w.completedAt &&
        challengeLocalDay(
          new Date(w.completedAt),
          current?.timezone ?? timezone,
        ) === today,
    );
    setWorkouts(completed);
    if (!completed.length)
      setWorkoutsNotice(
        "No completed workouts from today. You can choose a rest or recovery day instead.",
      );
  };
  const choicesAccess = workoutChoicesAccess.current;
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <CommunityPage title="Cooperative challenges" backHref="/community/more">
        <Text style={{ color: t.textSecondary }}>
          Deliberately join a private group challenge. Workouts and rest both
          count as a day of consistency. Missing declarations stay unknown.
          Nothing is imported from your diary or health apps automatically.
        </Text>
        {state.error && (
          <Text accessibilityRole="alert" style={{ color: t.text }}>
            {state.error}
          </Text>
        )}
        <ExpansionButton
          disabled={state.busy || workoutsBusy}
          label="Manage my challenges"
          onPress={() => {
            clearWorkoutChoices();
            setManage(true);
            setCreating(false);
            setId(null);
            void state.run({ operation: "listMine" });
          }}
        />
        {!groupId && !manage ? (
          <>
            <Text style={{ color: t.text }}>
              Open Challenges from one of your private groups.
            </Text>
            <ExpansionButton
              disabled={state.busy || workoutsBusy}
              label="Open private groups"
              onPress={() => router.push("/community/groups" as Href)}
            />
          </>
        ) : !id ? (
          <>
            <ExpansionButton
              disabled={state.busy || workoutsBusy}
              label="Refresh challenges"
              onPress={() => {
                invalidateCommunityReads();
                void state.run({
                  operation: manage ? "listMine" : "list",
                  ...(manage ? {} : { groupId }),
                });
              }}
            />
            {state.data?.challenges?.map((c) => (
              <View key={c.id}>
                <ExpansionButton
                  disabled={state.busy || workoutsBusy}
                  label={`${c.title}${c.canceled ? " · canceled" : ""}`}
                  onPress={() => {
                    clearWorkoutChoices();
                    setCreating(false);
                    setId(c.id);
                    void state.run({
                      operation: manage ? "getMine" : "get",
                      id: c.id,
                    });
                  }}
                />
                <Text style={{ color: t.textSecondary }}>
                  {c.startDay}–{c.endDay} · {c.goalDays} days per person ·{" "}
                  {c.timezone}
                </Text>
              </View>
            ))}
            {state.data?.challenges?.length === 0 && !state.busy && (
              <Text style={{ color: t.textSecondary }}>
                {manage
                  ? "You have no challenges to manage."
                  : "No challenges in this group yet."}
              </Text>
            )}
            {manage && state.data?.nextCursor && (
              <ExpansionButton
                disabled={state.busy || workoutsBusy}
                label="Next page of my challenges"
                onPress={() =>
                  void state.run({
                    operation: "listMine",
                    after: state.data?.nextCursor,
                  })
                }
              />
            )}
            {!manage && !creating && (
              <ExpansionButton
                label="Create a cooperative challenge"
                disabled={state.busy || workoutsBusy}
                onPress={() => setCreating(true)}
              />
            )}
            {!manage && creating && (
              <>
                <ExpansionButton
                  label="Cancel challenge creation"
                  disabled={state.busy || workoutsBusy}
                  onPress={() => {
                    setCreating(false);
                    setTitle("");
                    setCreateId(Crypto.randomUUID());
                  }}
                />
                <ExpansionInput
                  label="New challenge title"
                  value={title}
                  onChange={setTitle}
                  editable={!state.busy && !workoutsBusy}
                  multiline={false}
                  maxLength={80}
                />
                <Text style={{ color: t.text }}>
                  Today through the next six days in {timezone}; a cooperative
                  goal of four days per person. Publication requires deliberate
                  confirmation below.
                </Text>
                <ExpansionButton
                  label="Confirm and create this seven-day challenge"
                  disabled={state.busy || workoutsBusy || !title.trim()}
                  onPress={() => {
                    const end = new Date();
                    end.setDate(end.getDate() + 6);
                    void state
                      .run({
                        operation: "create",
                        id: createId,
                        groupId,
                        title,
                        startDay: today,
                        endDay: challengeLocalDay(end, timezone),
                        timezone,
                        goalDays: 4,
                        confirmed: true,
                      })
                      .then((result) => {
                        if (result?.challenge) {
                          setId(result.challenge.id);
                          setCreateId(Crypto.randomUUID());
                        }
                      });
                  }}
                />
              </>
            )}
          </>
        ) : (
          <>
            <ExpansionButton
              disabled={state.busy || workoutsBusy}
              label={
                manage ? "Back to my challenges" : "Back to group challenges"
              }
              onPress={() => {
                clearWorkoutChoices();
                setReport(false);
                setId(null);
                setWorkouts([]);
                setWorkoutsBusy(false);
                setWorkoutsNotice(null);
                void state.run({
                  operation: manage ? "listMine" : "list",
                  ...(manage ? {} : { groupId }),
                });
              }}
            />
            <ExpansionButton
              disabled={state.busy || workoutsBusy}
              label="Refresh progress"
              onPress={() => {
                clearWorkoutChoices();
                invalidateCommunityReads();
                void state.run({ operation: manage ? "getMine" : "get", id });
              }}
            />
            {current && (
              <>
                <Text
                  accessibilityRole="header"
                  style={{ color: t.text, fontSize: 22 }}
                >
                  {current.title}
                </Text>
                <Text style={{ color: t.text }}>
                  Your declared days: {current.myProgress ?? "not declared"}.
                  {current.canceled ? " Canceled." : ""}
                </Text>
                {manage ? (
                  <Text style={{ color: t.textSecondary }}>
                    This view shows your declarations. Open the challenge from
                    its private group to check shared progress and participants.
                  </Text>
                ) : (
                  <Text style={{ color: t.text }}>
                    Shared declared days:{" "}
                    {current.teamProgress ?? "not declared"}.{" "}
                    {current.participants} participants.
                  </Text>
                )}
                <Text style={{ color: t.textSecondary }}>
                  {current.startDay}–{current.endDay} · {current.goalDays} days
                  per person · {current.timezone}
                </Text>
                {!manage && !current.isOwner && (
                  <ExpansionButton
                    disabled={state.busy || workoutsBusy}
                    label="Report this challenge"
                    onPress={() => setReport(true)}
                  />
                )}
                <ReportModal
                  visible={report}
                  targetType="challenge"
                  targetId={current.id}
                  principalKey={state.principal}
                  onClose={() => setReport(false)}
                />
                {!manage && !current.joined && !current.canceled && (
                  <ExpansionButton
                    disabled={state.busy || workoutsBusy}
                    label="I choose to join and share my consistency declarations"
                    onPress={() =>
                      void state.run({ operation: "join", id, confirmed: true })
                    }
                  />
                )}
                {!manage &&
                  current.joined &&
                  !current.canceled &&
                  today >= current.startDay &&
                  today <= current.endDay && (
                    <>
                      <ExpansionButton
                        disabled={state.busy || workoutsBusy}
                        label="Confirm today as a rest or recovery day"
                        onPress={() =>
                          void state.run({
                            operation: "contribute",
                            id,
                            day: today,
                            kind: "rest",
                            confirmed: true,
                          })
                        }
                      />
                      <ExpansionButton
                        disabled={state.busy || workoutsBusy}
                        label="Choose a completed workout from today"
                        onPress={() => void loadWorkouts()}
                      />
                      {choicesAccess?.() && workoutsNotice && (
                        <Text
                          accessibilityLiveRegion="polite"
                          style={{ color: t.textSecondary }}
                        >
                          {workoutsNotice}
                        </Text>
                      )}
                      {(choicesAccess?.() ? workouts : []).map((w) => (
                        <ExpansionButton
                          disabled={state.busy || workoutsBusy}
                          key={w.id}
                          label={`Confirm workout: ${w.name}`}
                          onPress={() => {
                            if (
                              workoutChoicesAccess.current !== choicesAccess ||
                              !choicesAccess?.()
                            )
                              return;
                            void state.run({
                              operation: "contribute",
                              id,
                              day: today,
                              kind: "workout",
                              sourceWorkoutId: w.id,
                              confirmed: true,
                            });
                          }}
                        />
                      ))}
                    </>
                  )}
                {current.days.map((d) => (
                  <View key={d.day}>
                    <Text style={{ color: t.text }}>
                      {d.day}: {d.kind}
                      {d.valid ? "" : " · source changed"}
                    </Text>
                    <ExpansionButton
                      disabled={state.busy || workoutsBusy}
                      label={`Remove declaration for ${d.day}`}
                      onPress={() =>
                        Alert.alert(
                          "Remove this declaration?",
                          `This removes your declaration for ${d.day} from the challenge.`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Remove",
                              style: "destructive",
                              onPress: () =>
                                void state
                                  .run({
                                    operation: "removeContribution",
                                    id,
                                    day: d.day,
                                  })
                                  .then(
                                    (result) =>
                                      result &&
                                      state.run({
                                        operation: manage ? "getMine" : "get",
                                        id,
                                      }),
                                  ),
                            },
                          ],
                        )
                      }
                    />
                  </View>
                ))}
                <ExpansionButton
                  disabled={state.busy || workoutsBusy}
                  label="Leave and remove my declarations"
                  onPress={() =>
                    Alert.alert(
                      "Leave this challenge?",
                      "This removes all of your declarations from the challenge.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Leave",
                          style: "destructive",
                          onPress: () =>
                            void state.run({ operation: "leave", id }).then(
                              (result) =>
                                result &&
                                state.run({
                                  operation: manage ? "getMine" : "get",
                                  id,
                                }),
                            ),
                        },
                      ],
                    )
                  }
                />
                {current.isOwner && !current.canceled && (
                  <ExpansionButton
                    disabled={state.busy || workoutsBusy}
                    label="Cancel challenge"
                    onPress={() =>
                      Alert.alert(
                        "Cancel this challenge?",
                        "This cancels the challenge for every participant.",
                        [
                          { text: "Keep challenge", style: "cancel" },
                          {
                            text: "Cancel challenge",
                            style: "destructive",
                            onPress: () =>
                              void state.run({ operation: "cancel", id }).then(
                                (result) =>
                                  result &&
                                  state.run({
                                    operation: manage ? "getMine" : "get",
                                    id,
                                  }),
                              ),
                          },
                        ],
                      )
                    }
                  />
                )}
              </>
            )}
          </>
        )}
      </CommunityPage>
    </KeyboardAvoidingView>
  );
}

export function CommunityChallengesScreen() {
  const { session } = useAuth();
  return (
    <CommunityChallengesScreenContent key={session?.user.id ?? "signed-out"} />
  );
}
