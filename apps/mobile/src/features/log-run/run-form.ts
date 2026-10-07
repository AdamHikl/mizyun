import { runCreateSchema, type RunRecord } from "@mizyun/contracts";
import {
  runningDate,
  metresFromDistance,
  distanceFromMetres,
} from "@mizyun/core";
import type { RunForm } from "./run-draft";
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
