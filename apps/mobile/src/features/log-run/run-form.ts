import { runCreateSchema, type RunRecord } from "@mizyun/contracts";
import {
  runningDate,
  metresFromDistance,
  distanceFromMetres,
} from "@mizyun/core";
import type { RunForm } from "./run-draft";
export const quickDistances = [
  { label: "5K", meters: 5000, spoken: "5 kilometres" },
  { label: "10K", meters: 10000, spoken: "10 kilometres" },
  { label: "Half", meters: 21097.5, spoken: "half marathon" },
  { label: "Marathon", meters: 42195, spoken: "marathon" },
] as const;
// Canonical metres stay exact; the field shows a readable rounded value.
const displayDistance = (meters: number, unit: "km" | "mi") =>
  String(Number(distanceFromMetres(meters, unit).toFixed(2)));
/** Sets distance to exact metres while showing the rounded value in the unit. */
export function distancePatch(
  meters: number | null,
  unit: "km" | "mi",
): Pick<
  RunForm,
  | "distance"
  | "unit"
  | "distanceCanonicalMeters"
  | "distanceCanonicalInput"
  | "distanceCanonicalUnit"
> {
  const distance = meters === null ? "" : displayDistance(meters, unit);
  return {
    distance,
    unit,
    distanceCanonicalMeters: meters,
    distanceCanonicalInput: distance,
    distanceCanonicalUnit: unit,
  };
}
/** Copies only duration, distance, environment and name from a previous run. */
export function lastRunPatch(
  run: RunRecord,
  unit: "km" | "mi",
): Partial<RunForm> {
  return {
    minutes: String(Math.floor(run.summary.durationSeconds / 60)),
    seconds: String(run.summary.durationSeconds % 60),
    environment: run.summary.environment,
    name: run.name,
    ...distancePatch(run.summary.distanceMeters, unit),
  };
}
export function formFromRun(run: RunRecord, unit: "km" | "mi"): RunForm {
  const distance =
    run.summary.distanceMeters === null
      ? ""
      : String(
          Number(
            distanceFromMetres(run.summary.distanceMeters, unit).toFixed(5),
          ),
        );
  return {
    name: run.name,
    startedAt: run.summary.startedAt,
    observedActivityDate: run.summary.startedAt
      ? run.summary.activityDate
      : undefined,
    distanceCanonicalMeters: run.summary.distanceMeters,
    distanceCanonicalInput: distance,
    distanceCanonicalUnit: unit,
    activityDate: run.summary.activityDate,
    recordingTimezone: run.summary.recordingTimezone,
    minutes: String(Math.floor(run.summary.durationSeconds / 60)),
    seconds: String(run.summary.durationSeconds % 60),
    distance,
    unit,
    environment: run.summary.environment,
    effort:
      run.summary.perceivedExertion === null
        ? ""
        : String(run.summary.perceivedExertion),
    notes: run.notes ?? "",
    ...(run.summary.origin.kind === "health_import"
      ? { metricsLocked: true }
      : {}),
  };
}
export function parseRunForm(form: RunForm, operationId: string) {
  if (form.startedAt && form.activityDate !== form.observedActivityDate)
    return {
      ok: false as const,
      message:
        "This run has a recorded start time. Its start date cannot be changed in this form.",
    };
  const numeric = (text: string) => Number(text.replace(",", "."));
  if (
    !/^\d+$/.test(form.minutes || "0") ||
    !/^\d+$/.test(form.seconds || "0") ||
    Number(form.seconds || 0) > 59
  )
    return {
      ok: false as const,
      message: "Enter whole minutes and seconds from 0 to 59.",
    };
  const parsed = runCreateSchema.safeParse({
    clientOperationId: operationId,
    activityDate: form.activityDate,
    recordingTimezone: form.recordingTimezone,
    startedAt: form.startedAt ?? null,
    durationSeconds: Number(form.minutes || 0) * 60 + Number(form.seconds || 0),
    distanceMeters: form.distance.trim()
      ? form.distanceCanonicalInput === form.distance &&
        form.distanceCanonicalUnit === form.unit &&
        form.distanceCanonicalMeters !== undefined
        ? form.distanceCanonicalMeters
        : metresFromDistance(numeric(form.distance), form.unit)
      : null,
    environment: form.environment,
    perceivedExertion: form.effort.trim() ? numeric(form.effort) : null,
    name: form.name ?? "Run",
    notes: form.notes.trim() || null,
  });
  if (!parsed.success)
    return {
      ok: false as const,
      message: parsed.error.issues[0]?.message ?? "Check your run details.",
    };
  if (form.activityDate > runningDate(new Date(), form.recordingTimezone))
    return {
      ok: false as const,
      message: "A completed run cannot be in the future.",
    };
  return { ok: true as const, body: parsed.data };
}
