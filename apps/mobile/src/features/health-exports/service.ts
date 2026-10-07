import type { FoodEntry, Workout } from "@mizyun/contracts";
import {
  hasEligibleHealthWorkoutDetails,
  type HealthExportConfirmation,
} from "@mizyun/core";
import { getAppVariant } from "@/composition/app-variant";
import type { HealthExportOutbox } from "./export-outbox";
let controller: HealthExportOutbox | null = null;
let foreground = true;
let controllerLoading: Promise<HealthExportOutbox> | null = null;
let activation: Promise<void> = Promise.resolve();
function outbox(): Promise<HealthExportOutbox> {
  controllerLoading ??= import("./native-writer").then(
    ({ healthExportOutbox }) => {
      controller = healthExportOutbox;
      controller.setActive(foreground);
      return controller;
    },
  );
  return controllerLoading;
}
export function setHealthExportActive(active: boolean): void {
  foreground = active;
  controller?.setActive(active);
}

let owner: string | null = null;
let generation = 0;
export interface HealthExportOwner {
  readonly accountId: string;
  readonly generation: number;
}
export function activateHealthExports(accountId: string | null): void {
  generation++;
  owner = getAppVariant() === "dev" ? accountId : null;
  if (owner) {
    const captured = { accountId: owner, generation };
    activation = outbox()
      .then(async (writer) => {
        if (current(captured)) await writer.activate(captured.accountId);
      })
      .catch(() => undefined);
  } else controller?.deactivate();
}
export function captureHealthExportOwner(): HealthExportOwner | null {
  return owner && getAppVariant() === "dev"
    ? { accountId: owner, generation }
    : null;
}
function current(
  binding: HealthExportOwner | null,
): binding is HealthExportOwner {
  return (
    binding !== null &&
    owner === binding.accountId &&
    generation === binding.generation &&
    getAppVariant() === "dev"
  );
}
function confirmation(
  record: { id: string; updatedAt: string },
  timeBasis: "observed" | "date_only",
): HealthExportConfirmation {
  return {
    schemaVersion: 1,
    recordId: record.id,
    savedUpdatedAt: record.updatedAt,
    origin: "mizyun_user_entered",
    rights: "first_party",
    derivedFrom: [],
    timeBasis,
  };
}
/** Save callbacks never expose health failures to the successful API operation. */
export function exportSavedNutrition(
  binding: HealthExportOwner | null,
  record: FoodEntry,
  options: {
    firstParty: boolean;
    timeBasis: "observed" | "date_only";
    existingOnly?: boolean;
  },
): void {
  if (!current(binding) || record.userId !== binding.accountId) return;
  const captured = binding;
  void (async () => {
    await activation;
    const writer = await outbox();
    if (!current(captured)) return;
    if (
      options.existingOnly &&
      !(await writer.hasRecord(captured.accountId, "nutrition", record.id))
    )
      return;
    if (!current(captured)) return;
    if (!options.firstParty) {
      await writer.deleteRecord(captured.accountId, "nutrition", record.id);
      return;
    }
    await writer.enqueueNutrition(
      captured.accountId,
      record,
      confirmation(record, options.timeBasis),
      options.existingOnly ?? false,
    );
  })().catch(() => undefined);
}
export function exportSavedWorkout(
  binding: HealthExportOwner | null,
  record: Workout,
  existingOnly = false,
): void {
  if (!current(binding) || record.userId !== binding.accountId) return;
  const captured = binding;
  void (async () => {
    await activation;
    const writer = await outbox();
    if (!current(captured)) return;
    if (
      existingOnly &&
      !(await writer.hasRecord(captured.accountId, "workout", record.id))
    )
      return;
    if (!current(captured)) return;
    await writer.enqueueWorkout(
      captured.accountId,
      record,
      confirmation(record, "observed"),
      existingOnly,
    );
  })().catch(() => undefined);
}
export function deleteHealthExport(
  binding: HealthExportOwner | null,
  category: "nutrition" | "workout",
  sourceId: string,
): void {
  if (!current(binding)) return;
  const captured = binding;
  void (async () => {
    await activation;
    const writer = await outbox();
    if (current(captured))
      await writer.deleteRecord(captured.accountId, category, sourceId);
  })().catch(() => undefined);
}
export async function clearLocalHealthExports(
  accountId: string,
): Promise<void> {
  if (owner === accountId) {
    owner = null;
    generation++;
  }
  if (controller) await controller.clearAccount(accountId);
  else {
    const { SecureHealthExportStorage } = await import("./export-storage");
    await new SecureHealthExportStorage().clearAccount(accountId);
  }
}
/** Only a known fresh standalone producer can attach this marker. */
export function markFirstPartyWorkout(
  details: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const candidate = {
    ...details,
    workoutLifecycle: details.workoutLifecycle ?? { kind: "session" },
    healthExportOrigin: { version: 1, origin: "mizyun_user_entered" },
  };
  return hasEligibleHealthWorkoutDetails(candidate) ? candidate : details;
}
