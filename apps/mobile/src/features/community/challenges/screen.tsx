import { useAuth } from "@/features/auth/auth-context";
import React, { useCallback, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  Stack,
  router,
  type Href,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import * as Crypto from "expo-crypto";
import { communityChallengeResponseSchema } from "@mizyun/contracts";
import { challengeLocalDay } from "@mizyun/core";
import { useTheme } from "@/hooks/use-theme";
import { CommunityIntro } from "../community-presentation";
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
  const [manage, setManage] = useState(false);
  const [report, setReport] = useState(false);
  const [title, setTitle] = useState("");
  const [workouts, setWorkouts] = useState<{ id: string; name: string }[]>([]);
  const [workoutsBusy, setWorkoutsBusy] = useState(false);
  const [workoutsNotice, setWorkoutsNotice] = useState<string | null>(null);
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
      setReport(false);
      setManage(false);
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
        setReport(false);
        setId(null);
        setTitle("");
        setWorkouts([]);
        setWorkoutsBusy(false);
        setWorkoutsNotice(null);
      });
      return () => {
        sub.remove();
        setReport(false);
        setId(null);
        setTitle("");
        setWorkouts([]);
        setWorkoutsBusy(false);
        setWorkoutsNotice(null);
      };
    }, [state.run, groupId]),
  );
  const current =
    state.data?.challenge?.id === id ? state.data.challenge : null;
  const loadWorkouts = async () => {
    const principal = state.principal;
    if (!principal || state.busy || workoutsBusy) return;
    const currentAccess = state.capture();
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
    });
    setWorkoutsBusy(false);
    if (!currentAccess()) return;
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
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={{ flex: 1, backgroundColor: t.background }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 20,
          gap: 16,
          backgroundColor: t.background,
        }}
      >
        <Stack.Screen options={{ title: "Together, consistently" }} />
        <CommunityIntro
          icon="🌿"
          title="A small shared goal"
          description="Deliberately join a private group challenge. Workouts and rest both count as a day of consistency. Missing declarations stay unknown. Nothing is imported from your diary or health apps automatically."
        />
        {state.error && (
          <Text accessibilityRole="alert" style={{ color: t.text }}>
            {state.error}
          </Text>
        )}
        <ExpansionButton
          disabled={state.busy || workoutsBusy}
          label="Manage my challenges"
          onPress={() => {
            setManage(true);
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
              onPress={() =>
                void state.run({
                  operation: manage ? "listMine" : "list",
                  ...(manage ? {} : { groupId }),
                })
              }
            />
            {state.data?.challenges?.map((c) => (
              <ExpansionButton
                disabled={state.busy || workoutsBusy}
                key={c.id}
                label={`${c.title}${c.canceled ? " · canceled" : ""}`}
                onPress={() => {
                  setId(c.id);
                  void state.run({
                    operation: manage ? "getMine" : "get",
                    id: c.id,
                  });
                }}
              />
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
            {!manage && (
              <>
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
              onPress={() =>
                void state.run({ operation: manage ? "getMine" : "get", id })
              }
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
                  Shared declared days: {current.teamProgress ?? "not declared"}
                  . {current.participants} participants.{" "}
                  {current.canceled ? "Canceled." : ""}
                </Text>
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
                )}{" "}
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
                      {workoutsNotice && (
                        <Text
                          accessibilityLiveRegion="polite"
                          style={{ color: t.textSecondary }}
                        >
                          {workoutsNotice}
                        </Text>
                      )}
                      {workouts.map((w) => (
                        <ExpansionButton
                          disabled={state.busy || workoutsBusy}
                          key={w.id}
                          label={`Confirm workout: ${w.name}`}
                          onPress={() =>
                            void state.run({
                              operation: "contribute",
                              id,
                              day: today,
                              kind: "workout",
                              sourceWorkoutId: w.id,
                              confirmed: true,
                            })
                          }
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
                          )
                      }
                    />
                  </View>
                ))}
                <ExpansionButton
                  disabled={state.busy || workoutsBusy}
                  label="Leave and remove my declarations"
                  onPress={() =>
                    void state.run({ operation: "leave", id }).then(
                      (result) =>
                        result &&
                        state.run({
                          operation: manage ? "getMine" : "get",
                          id,
                        }),
                    )
                  }
                />
                {current.isOwner && !current.canceled && (
                  <ExpansionButton
                    disabled={state.busy || workoutsBusy}
                    label="Cancel challenge"
                    onPress={() =>
                      void state.run({ operation: "cancel", id }).then(
                        (result) =>
                          result &&
                          state.run({
                            operation: manage ? "getMine" : "get",
                            id,
                          }),
                      )
                    }
                  />
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function CommunityChallengesScreen() {
  const { session } = useAuth();
  return (
    <CommunityChallengesScreenContent key={session?.user.id ?? "signed-out"} />
  );
}
