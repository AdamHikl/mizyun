import {
  buildEveningStretchSession,
  formatStretchFocus,
  type StretchSessionInput,
} from "@mizyun/core";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { AppState } from "react-native";

import { ListGroup, ListRow } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import {
  EVENING_STRETCH_ROUTE,
  isEveningStretchDoneToday,
  isoLocalDate,
  loadEveningStretch,
  type EveningStretchSettings,
} from "./evening-stretch-reminder";
import { eveningStretchRuntime } from "./evening-stretch-runtime";
import { peekTailoredStretchPlan } from "./stretch-ai-refine";
import { formatMinutes } from "./stretch-progress";
import { fetchTodayTraining, type TodayTraining } from "./today-training-data";

type StretchSession = ReturnType<typeof buildEveningStretchSession>;

const describePlan = (
  input: StretchSessionInput,
  tailored: StretchSession | null,
): string => {
  const plan = tailored ?? buildEveningStretchSession(input);
  return `${formatStretchFocus(plan)} · about ${formatMinutes(plan.totalSeconds)}`;
};

/**
 * The card's next subtitle. A failed training read (null) is transient: at
 * launch the shared read cache retires reads while the app becomes active or
 * the session token refreshes, so keep what is shown instead of hiding it.
 * Today's AI-tailored plan (ADR-0076) is described when one is cached.
 */
export const nextStretchSubtitle = (
  previous: string | null,
  settings: EveningStretchSettings,
  training: TodayTraining | null,
  tailored: StretchSession | null = null,
): string | null => {
  if (!settings.enabled || isEveningStretchDoneToday(settings)) return null;
  if (training === null) return previous;
  return training.trained ? describePlan(training.input, tailored) : null;
};

/**
 * Home shortcut to tonight's stretch on training days (#298). Hidden on rest
 * days, once tonight's stretch is done, or when the reminder is turned off.
 * Each focus also refreshes tonight's notification without prompting. It
 * reloads when the app returns to the foreground or the session token
 * changes, since a cold-start read can be retired before either settles.
 */
export function EveningStretchHomeCard({
  userId,
}: {
  readonly userId: string;
}) {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  // Owned by account so a retained subtitle never crosses a sign-in switch.
  const [shown, setShown] = useState<{
    readonly userId: string;
    readonly subtitle: string | null;
  } | null>(null);
  const subtitle = shown?.userId === userId ? shown.subtitle : null;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let run = 0;
      const load = async () => {
        const current = ++run;
        const [settings, training] = await Promise.all([
          loadEveningStretch(userId),
          fetchTodayTraining().catch(() => null),
        ]);
        if (!active || current !== run) return;
        // The runtime fences the signed-in owner and skips preview sessions.
        void eveningStretchRuntime.refresh().catch(() => {});
        // Today's tailored plan when one is cached; never a network call here.
        const tailored = training?.trained
          ? await peekTailoredStretchPlan(
              userId,
              training.input,
              isoLocalDate(new Date()),
            ).catch(() => null)
          : null;
        if (!active || current !== run) return;
        setShown((previous) => ({
          userId,
          subtitle: nextStretchSubtitle(
            previous?.userId === userId ? previous.subtitle : null,
            settings,
            training,
            tailored,
          ),
        }));
      };
      void load();
      let foreground = AppState.currentState === "active";
      const subscription = AppState.addEventListener("change", (state) => {
        const wasForeground = foreground;
        foreground = state === "active";
        if (foreground && !wasForeground) void load();
      });
      return () => {
        active = false;
        subscription.remove();
      };
    }, [userId, accessToken]),
  );

  if (subtitle === null) return null;
  return (
    <ListGroup>
      <ListRow
        icon="mobility"
        title="Tonight's stretch"
        subtitle={subtitle}
        accessibilityLabel={`Tonight's stretch. ${subtitle}`}
        onPress={() => router.push(EVENING_STRETCH_ROUTE as Href)}
      />
    </ListGroup>
  );
}
