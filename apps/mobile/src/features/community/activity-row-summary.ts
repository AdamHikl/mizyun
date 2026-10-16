import type { SharedActivityFeedItemDto } from "@mizyun/contracts";
import {
  boulderingCardCounts,
  boulderingCardTitle,
} from "./bouldering-card-text";

/**
 * Compact one-line title/description for list rows (profile timeline).
 * Meal and bouldering cards render their own allowlisted fields; every other
 * kind keeps the original workout presentation.
 */
export function activityRowSummary(
  item: Pick<
    SharedActivityFeedItemDto,
    | "activityKind"
    | "mealDetails"
    | "boulderingDetails"
    | "category"
    | "sharedDay"
    | "durationSeconds"
  >,
): { title: string; description: string } {
  if (item.activityKind === "meal")
    return {
      title: `Meal · ${item.mealDetails?.name ?? "Shared meal"}`,
      description: item.sharedDay,
    };
  if (item.activityKind === "bouldering") {
    const details = item.boulderingDetails;
    return {
      title: boulderingCardTitle(details),
      description: details
        ? `${item.sharedDay} · ${boulderingCardCounts(details)}`
        : item.sharedDay,
    };
  }
  return {
    title: item.category.replaceAll("_", " "),
    description: `${item.sharedDay}${item.durationSeconds !== null ? ` · ${Math.round(item.durationSeconds / 60)} min` : ""}`,
  };
}
