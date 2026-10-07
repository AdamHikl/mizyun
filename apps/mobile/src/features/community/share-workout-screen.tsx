import React, { useCallback, useState } from "react";
import { Text } from "react-native";
import { useFocusEffect, type Href } from "expo-router";
import {
  workoutListResponseSchema,
  type WorkoutListResponse,
} from "@mizyun/contracts";
import { useTheme } from "@/hooks/use-theme";
import { useExpansionCommand } from "./expansions/use-expansion-command";
import { ShareWorkoutModal } from "./share-workout-modal";
import {
  CommunityButton,
  CommunityPage,
  CommunityRow,
  CommunityState,
} from "./ui";

export { selectableSharedWorkouts } from "./share-workout-selection";
import { selectableSharedWorkouts } from "./share-workout-selection";

export function CommunityShareWorkoutScreen() {
  const colors = useTheme();
  const { principal, data, run, busy, error, capture } =
    useExpansionCommand<WorkoutListResponse>(
      "/v1/workouts?kind=session&limit=200",
      workoutListResponseSchema,
      "GET",
    );
  const [selection, setSelection] = useState<{
    id: string;
    current: () => boolean;
  } | null>(null);
  useFocusEffect(
    useCallback(() => {
      void run({});
      return () => setSelection(null);
    }, [run]),
  );
  const workouts =
    data && principal ? selectableSharedWorkouts(data.workouts, principal) : [];
  const selected = selection?.current() && data ? selection.id : null;
  return (
    <CommunityPage
      title="Share workout"
      description="Choose a saved completed workout. You will preview exactly what your approved followers can see."
    >
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {error}
        </Text>
      ) : null}
      {busy ? (
        <CommunityState title="Checking saved workouts" busy />
      ) : !data ? (
        <CommunityState
          title="Check your saved workouts"
          action={
            <CommunityButton
              label="Refresh workouts"
              onPress={() => void run({})}
            />
          }
        />
      ) : workouts.length === 0 ? (
        <CommunityState
          title="No completed workouts here"
          description="Finish and save a workout first. Saving stays private until you deliberately publish a preview."
          action={
            <CommunityButton label="Open workouts" href={"/workouts" as Href} />
          }
        />
      ) : (
        <>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 15,
              lineHeight: 22,
            }}
          >
            Recent completed workouts from your latest 200 sessions. These names
            are private and are omitted from the shared card.
          </Text>
          {workouts.map((workout) => (
            <CommunityRow
              key={workout.id}
              title={workout.name ?? "Completed workout"}
              description={new Date(workout.completedAt!).toLocaleDateString()}
              onPress={() =>
                setSelection({ id: workout.id, current: capture() })
              }
            />
          ))}
          <CommunityButton
            label="Refresh workouts"
            onPress={() => void run({})}
          />
        </>
      )}
      {selected ? (
        <ShareWorkoutModal
          key={`${principal}:${selected}`}
          visible
          workoutId={selected}
          onDismiss={() => setSelection(null)}
          onPublished={() => {
            setSelection(null);
            void run({});
          }}
          onRevoked={() => {
            setSelection(null);
            void run({});
          }}
        />
      ) : null}
    </CommunityPage>
  );
}
