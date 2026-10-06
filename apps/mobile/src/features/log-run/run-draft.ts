import type { ApiClient } from "@mizyun/api-client";
import {
  runCreateSchema,
  runUpdateSchema,
  type RunCreate,
  type RunUpdate,
} from "@mizyun/contracts";
import {
  loadRequiredLoggingDraft,
  saveLoggingDraft,
  clearLoggingDraft,
} from "@/features/logging-draft-storage";
import {
  createRun,
  updateRun,
  removeRun,
  cancelRunOperation,
} from "@/features/running/client";
export interface RunForm {
  activityDate: string;
  recordingTimezone: string;
  minutes: string;
  seconds: string;
  distance: string;
  unit: "km" | "mi";
  environment: "outdoor" | "treadmill" | "unspecified";
  effort: string;
  notes: string;
  startedAt?: string | null;
  name?: string;
  observedActivityDate?: string;
  distanceCanonicalMeters?: number | null;
  distanceCanonicalInput?: string;
  distanceCanonicalUnit?: "km" | "mi";
}
export type RunCommand =
  | { kind: "create"; body: RunCreate }
  | { kind: "edit"; runId: string; body: RunUpdate }
  | { kind: "cancel"; operationId: string }
  | { kind: "delete"; runId: string; operationId: string };
export interface RunDraft {
  version: 1;
  initialActivityDate?: string;
  form: RunForm;
  editingRunId: string | null;
  expectedRevision: number | null;
  pending: RunCommand | null;
}
export const isRunDraft = (value: unknown): value is RunDraft => {
  if (!value || typeof value !== "object") return false;
  const d = value as RunDraft;
  const f = d.form;
  if (
    d.version !== 1 ||
    !f ||
    typeof f !== "object" ||
    !(
      [
        "activityDate",
        "recordingTimezone",
        "minutes",
        "seconds",
        "distance",
        "effort",
        "notes",
      ] as const
    ).every((k) => typeof f[k] === "string") ||
    !(f.unit === "km" || f.unit === "mi") ||
    !["outdoor", "treadmill", "unspecified"].includes(f.environment) ||
    !(d.editingRunId === null || typeof d.editingRunId === "string") ||
    !(d.expectedRevision === null || Number.isInteger(d.expectedRevision))
  )
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: f.recordingTimezone }).format(0);
  } catch {
    return false;
  }
  if (
    f.startedAt !== undefined &&
    f.startedAt !== null &&
    (typeof f.startedAt !== "string" ||
      !Number.isFinite(Date.parse(f.startedAt)))
  )
    return false;
  if (f.name !== undefined && typeof f.name !== "string") return false;
  if (
    f.observedActivityDate !== undefined &&
    typeof f.observedActivityDate !== "string"
  )
    return false;
  if (
    f.distanceCanonicalMeters !== undefined &&
    f.distanceCanonicalMeters !== null &&
    (typeof f.distanceCanonicalMeters !== "number" ||
      !Number.isFinite(f.distanceCanonicalMeters) ||
      f.distanceCanonicalMeters <= 0)
  )
    return false;
  if (
    f.distanceCanonicalInput !== undefined &&
    typeof f.distanceCanonicalInput !== "string"
  )
    return false;
  if (
    f.distanceCanonicalUnit !== undefined &&
    f.distanceCanonicalUnit !== "km" &&
    f.distanceCanonicalUnit !== "mi"
  )
    return false;
  if (d.pending === null) return true;
  const p = d.pending;
  if (!p || typeof p !== "object") return false;
  return p.kind === "create"
    ? runCreateSchema.safeParse(p.body).success
    : p.kind === "edit"
      ? typeof p.runId === "string" && runUpdateSchema.safeParse(p.body).success
      : p.kind === "cancel"
        ? typeof p.operationId === "string"
        : p.kind === "delete" &&
          typeof p.runId === "string" &&
          typeof p.operationId === "string";
};
export const hasRunDraftContent = (draft: RunDraft): boolean =>
  !!draft.pending ||
  draft.editingRunId !== null ||
  !!(
    draft.form.minutes.trim() ||
    draft.form.seconds.trim() ||
    draft.form.distance.trim() ||
    draft.form.effort.trim() ||
    draft.form.notes.trim()
  ) ||
  draft.form.environment !== "unspecified" ||
  (draft.initialActivityDate !== undefined &&
    draft.initialActivityDate !== draft.form.activityDate);

export const runDraftStore = {
  load: (userId: string) => loadRequiredLoggingDraft(userId, "run", isRunDraft),
  save: (userId: string, draft: RunDraft) =>
    saveLoggingDraft(userId, "run", draft),
  clear: (userId: string) => clearLoggingDraft(userId, "run"),
};
/** Serialize storage before the mutation. A changed principal never dispatches or consumes a late result. */
export async function sendRunCommand(
  userId: string,
  draft: RunDraft,
  client: ApiClient,
  isCurrent: () => boolean,
  store = runDraftStore,
) {
  if (!draft.pending) return { ok: false as const, message: "No pending run." };
  if (!isCurrent())
    return {
      ok: false as const,
      message: "Your account changed. Reopen your run.",
    };
  if (!(await store.save(userId, draft)))
    return {
      ok: false as const,
      message:
        "Could not keep your pending run on this device. Nothing was sent. Keep editing and try again.",
    };
  if (!isCurrent())
    return {
      ok: false as const,
      message: "Your account changed. Your original draft is kept.",
    };
  const command = draft.pending;
  const result =
    command.kind === "create"
      ? await createRun(command.body, client)
      : command.kind === "edit"
        ? await updateRun(command.runId, command.body, client)
        : command.kind === "cancel"
          ? await cancelRunOperation(command.operationId, client)
          : await removeRun(command.runId, command.operationId, client);
  if (!isCurrent())
    return {
      ok: false as const,
      message: "Your account changed. Your original draft is kept.",
    };
  if (result.ok) await store.clear(userId);
  return result;
}
