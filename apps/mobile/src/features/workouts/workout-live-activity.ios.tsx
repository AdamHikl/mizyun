import { HStack, Image, Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import * as Linking from "expo-linking";
import { createLiveActivity } from "expo-widgets";
import type { WorkoutLiveActivityProps } from "./workout-live-activity";

const WorkoutLiveActivity = createLiveActivity<WorkoutLiveActivityProps>(
  "MizyunWorkout",
  (props, environment) => {
    "widget";

    const accentColor = environment.isLuminanceReduced ? "#FFFFFF" : "#10B981";
    const isResting = props.state === "resting" && props.restEndsAt !== null;
    const isComplete = props.state === "complete";
    const progress = props.totalPlannedSetsCount
      ? `${props.completedSetsCount}/${props.totalPlannedSetsCount}`
      : `${props.completedSetsCount}`;
    const status = isComplete
      ? "Workout complete"
      : isResting
        ? "Resting"
        : "Active workout";
    const detail = isComplete
      ? "All planned sets completed — finish when ready"
      : props.nextSetSummary
        ? `${props.currentExerciseName} · ${props.nextSetSummary}`
        : props.currentExerciseName;
    const restStart = isResting
      ? new Date(props.restStartedAt ?? Date.now())
      : null;
    const restEnd = isResting ? new Date(props.restEndsAt!) : null;
    const timer =
      restStart && restEnd ? (
        <Text
          timerInterval={{ lower: restStart, upper: restEnd }}
          countsDown
          modifiers={[
            font({ size: 16, weight: "bold", design: "rounded" }),
            foregroundStyle(accentColor),
          ]}
        />
      ) : (
        <Text
          modifiers={[
            font({ size: 15, weight: "bold", design: "rounded" }),
            foregroundStyle(accentColor),
          ]}
        >
          {progress}
        </Text>
      );

    return {
      banner: (
        <HStack
          spacing={12}
          modifiers={[
            padding({ all: 14 }),
            frame({ maxWidth: 1000, alignment: "leading" }),
          ]}
        >
          <Image
            systemName={isResting ? "timer" : "dumbbell.fill"}
            color={accentColor}
          />
          <VStack alignment="leading" spacing={3}>
            <Text
              modifiers={[
                font({ textStyle: "headline", weight: "semibold" }),
                lineLimit(1),
              ]}
            >
              {props.workoutName}
            </Text>
            <Text
              modifiers={[
                font({ textStyle: "subheadline", weight: "medium" }),
                foregroundStyle(accentColor),
              ]}
            >
              {status} · {progress} sets
            </Text>
            <Text modifiers={[font({ textStyle: "caption" }), lineLimit(2)]}>
              {detail}
            </Text>
          </VStack>
          {timer}
        </HStack>
      ),
      compactLeading: (
        <Image
          systemName={isResting ? "timer" : "dumbbell.fill"}
          color={accentColor}
        />
      ),
      compactTrailing:
        restStart && restEnd ? (
          <Text
            timerInterval={{ lower: restStart, upper: restEnd }}
            countsDown
            modifiers={[
              font({ size: 14, weight: "bold", design: "rounded" }),
              foregroundStyle(accentColor),
              frame({ width: 56, alignment: "trailing" }),
            ]}
          />
        ) : (
          <Text
            modifiers={[
              font({ size: 14, weight: "bold", design: "rounded" }),
              foregroundStyle(accentColor),
              frame({ width: 56, alignment: "trailing" }),
            ]}
          >
            {progress}
          </Text>
        ),
      minimal: (
        <Image
          systemName={isResting ? "timer" : "dumbbell.fill"}
          color={accentColor}
        />
      ),
      expandedLeading: (
        <VStack
          alignment="leading"
          spacing={2}
          modifiers={[padding({ all: 8 })]}
        >
          <Image
            systemName={isResting ? "timer" : "dumbbell.fill"}
            color={accentColor}
          />
          <Text modifiers={[font({ size: 11, weight: "semibold" })]}>
            {status}
          </Text>
        </VStack>
      ),
      expandedTrailing: (
        <VStack
          alignment="trailing"
          spacing={2}
          modifiers={[padding({ all: 8 })]}
        >
          {timer}
          <Text modifiers={[font({ size: 10 })]}>{progress} sets</Text>
        </VStack>
      ),
      expandedBottom: (
        <VStack
          alignment="leading"
          spacing={3}
          modifiers={[padding({ horizontal: 12, bottom: 10 })]}
        >
          <Text
            modifiers={[font({ size: 14, weight: "semibold" }), lineLimit(1)]}
          >
            {props.workoutName}
          </Text>
          <Text modifiers={[font({ size: 12 }), lineLimit(2)]}>{detail}</Text>
        </VStack>
      ),
    };
  },
);

let operationQueue: Promise<void> = Promise.resolve();
let activeWorkoutId: string | null = null;

const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

export const updateWorkoutLiveActivity = (
  props: WorkoutLiveActivityProps,
): Promise<string | null> =>
  enqueue(async () => {
    const instances = WorkoutLiveActivity.getInstances();
    const staleDate =
      props.state === "resting" &&
      props.restEndsAt !== null &&
      props.restEndsAt > Date.now()
        ? new Date(props.restEndsAt)
        : undefined;

    const [primary, ...duplicates] = instances;
    if (primary && activeWorkoutId === props.workoutId) {
      await primary.update(props, staleDate);
      await Promise.all(
        duplicates.map((duplicate) => duplicate.end("immediate")),
      );
      return primary.getId();
    }

    if (instances.length > 0) {
      await Promise.all(instances.map((activity) => activity.end("immediate")));
    }

    const activity = WorkoutLiveActivity.start(
      props,
      Linking.createURL("/log-workout", {
        queryParams: { workoutId: props.workoutId },
      }),
      staleDate,
    );
    activeWorkoutId = props.workoutId;
    return activity.getId();
  });

export const endWorkoutLiveActivity = (): Promise<void> =>
  enqueue(async () => {
    try {
      await Promise.all(
        WorkoutLiveActivity.getInstances().map((activity) =>
          activity.end("immediate"),
        ),
      );
    } finally {
      activeWorkoutId = null;
    }
  });
