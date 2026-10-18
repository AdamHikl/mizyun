import { buildEveningStretchSession, formatStretchFocus } from "@mizyun/core";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useState } from "react";

import { ListGroup, ListRow } from "@/components/ui";
import {
  EVENING_STRETCH_ROUTE,
  isEveningStretchDoneToday,
  loadEveningStretch,
} from "./evening-stretch-reminder";
import { eveningStretchRuntime } from "./evening-stretch-runtime";
import { formatMinutes } from "./stretch-progress";
import { fetchTodayTraining } from "./today-training-data";

/**
 * Home shortcut to tonight's stretch on training days (#298). Hidden on rest
 * days, once tonight's stretch is done, or when the reminder is turned off.
 * Each focus also refreshes tonight's notification without prompting.
 */
export function EveningStretchHomeCard({
  userId,
}: {
  readonly userId: string;
}) {
  const [subtitle, setSubtitle] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const [settings, training] = await Promise.all([
          loadEveningStretch(userId),
          fetchTodayTraining().catch(() => null),
        ]);
        if (!active) return;
        // The runtime fences the signed-in owner and skips preview sessions.
        void eveningStretchRuntime.refresh().catch(() => {});
        if (
          !settings.enabled ||
          training === null ||
          !training.trained ||
          isEveningStretchDoneToday(settings)
        ) {
          setSubtitle(null);
          return;
        }
        const plan = buildEveningStretchSession(training.input);
        setSubtitle(
          `${formatStretchFocus(plan)} · about ${formatMinutes(plan.totalSeconds)}`,
        );
      })();
      return () => {
        active = false;
      };
    }, [userId]),
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
