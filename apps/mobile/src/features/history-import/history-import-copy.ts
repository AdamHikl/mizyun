import type {
  HistoryImportBatch,
  HistoryImportPreview,
} from "@mizyun/contracts";
import type { DistanceUnit, WeightUnit } from "./history-import-files";

type IssueCode = HistoryImportPreview["issues"][number]["code"];

const ISSUE_COPY: Record<IssueCode, string> = {
  malformed_row: "The row doesn't have the expected columns.",
  invalid_date: "The date or time couldn't be read.",
  invalid_number: "A number (reps, weight, duration or distance) is invalid.",
  empty_set: "The set has no reps, weight, duration or distance.",
  out_of_range: "A value is outside a believable range.",
  future: "The date is in the future.",
  duplicate: "The same record appears more than once in the file.",
  too_many_sets: "The workout has more sets than Mizyun can store.",
};

export const issueCopy = (code: IssueCode): string => ISSUE_COPY[code];

export const FORMAT_LABELS = {
  hevy: "Hevy",
  strong: "Strong",
  strava: "Strava export",
  generic: "CSV file",
} as const;

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

export const issuesSummary = (preview: HistoryImportPreview): string | null =>
  preview.issueCount > 0
    ? `${plural(preview.issueCount, "row")} skipped`
    : null;

export const issueLines = (
  preview: HistoryImportPreview,
): ReadonlyArray<{ readonly key: string; readonly text: string }> =>
  preview.issues.map((issue, index) => ({
    key: `${issue.line}-${index}`,
    text: `Line ${issue.line}: ${issueCopy(issue.code)}`,
  }));

export const hiddenIssueCount = (preview: HistoryImportPreview): number =>
  Math.max(0, preview.issueCount - preview.issues.length);

export const unitsAssumedMessage = (
  weight: WeightUnit,
  distance: DistanceUnit,
  strava: boolean,
): string =>
  strava
    ? `Units assumed: ${distance}. Change them below if that's wrong; the preview updates.`
    : `Units assumed: ${weight}/${distance}. Change them below if that's wrong; the preview updates.`;

/** e.g. "12 rides not imported — Mizyun imports runs from Strava". */
export function skippedActivitiesMessage(
  preview: HistoryImportPreview,
): string | null {
  if (preview.skippedActivities.length === 0) return null;
  const total = preview.skippedActivities.reduce((n, a) => n + a.count, 0);
  const types = preview.skippedActivities
    .slice(0, 4)
    .map((a) => `${a.count} ${a.type.toLowerCase()}`)
    .join(", ");
  const more = preview.skippedActivities.length > 4 ? " and more" : "";
  return `${plural(total, "other activity", "other activities")} not imported (${types}${more}). Mizyun imports runs from Strava.`;
}

const dateFormat = (iso: string, timezone: string): string => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: timezone,
    });
  } catch {
    return iso.slice(0, 10);
  }
};

export function dateRangeLabel(
  preview: Pick<HistoryImportPreview, "firstStartedAt" | "lastStartedAt">,
  timezone: string,
): string | null {
  if (!preview.firstStartedAt || !preview.lastStartedAt) return null;
  const first = dateFormat(preview.firstStartedAt, timezone);
  const last = dateFormat(preview.lastStartedAt, timezone);
  return first === last ? first : `${first} – ${last}`;
}

/** The headline counts, e.g. "42 workouts · 510 sets". */
export function previewCounts(preview: HistoryImportPreview): string {
  const parts: string[] = [];
  if (preview.workouts > 0 || preview.runs === 0)
    parts.push(plural(preview.workouts, "workout"));
  if (preview.workouts > 0) parts.push(plural(preview.sets, "set"));
  if (preview.runs > 0) parts.push(plural(preview.runs, "run"));
  return parts.join(" · ");
}

export function importButtonLabel(
  preview: Pick<HistoryImportPreview, "workouts" | "runs">,
): string {
  if (preview.workouts > 0 && preview.runs > 0)
    return `Import ${plural(preview.workouts, "workout")} and ${plural(preview.runs, "run")}`;
  if (preview.runs > 0) return `Import ${plural(preview.runs, "run")}`;
  return `Import ${plural(preview.workouts, "workout")}`;
}

/** Records that would be written if nothing else is skipped. */
export const importableCount = (preview: HistoryImportPreview): number =>
  preview.workouts + preview.runs;

export function resultSummary(batch: HistoryImportBatch): string {
  const added: string[] = [];
  if (batch.workoutCount > 0) added.push(plural(batch.workoutCount, "workout"));
  if (batch.runCount > 0) added.push(plural(batch.runCount, "run"));
  const head = added.length
    ? `Imported ${added.join(" and ")}`
    : "Nothing new to import";
  const skipped: string[] = [];
  if (batch.duplicateCount > 0)
    skipped.push(`${batch.duplicateCount} already imported`);
  if (batch.overlapCount > 0)
    skipped.push(`${batch.overlapCount} overlapped existing records`);
  return skipped.length
    ? `${head}. Skipped: ${skipped.join(", ")}.`
    : `${head}.`;
}

export function batchTitle(batch: HistoryImportBatch): string {
  const what = [
    batch.workoutCount > 0 ? plural(batch.workoutCount, "workout") : null,
    batch.runCount > 0 ? plural(batch.runCount, "run") : null,
  ]
    .filter(Boolean)
    .join(" and ");
  return `${FORMAT_LABELS[batch.format]}${what ? ` · ${what}` : ""}`;
}

export function batchSubtitle(batch: HistoryImportBatch): string {
  const when = new Date(batch.createdAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return batch.status === "importing"
    ? `Started ${when} · not finished`
    : `Imported ${when}${batch.fileName ? ` · ${batch.fileName}` : ""}`;
}

export const undoConfirmMessage = (batch: HistoryImportBatch): string =>
  `This removes the ${
    [
      batch.workoutCount > 0 ? plural(batch.workoutCount, "workout") : null,
      batch.runCount > 0 ? plural(batch.runCount, "run") : null,
    ]
      .filter(Boolean)
      .join(" and ") || "records"
  } added by this import, including any edits you made to them, and custom exercises it created that nothing else uses. Records you added yourself are not affected.`;
