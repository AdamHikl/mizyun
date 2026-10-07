import {
  nextHealthExportRevision,
  projectHealthExportDeletion,
  projectHealthNutritionExport,
  projectHealthWorkoutExport,
  type HealthExportConfirmation,
  type HealthExportPayload,
  type HealthNutritionExportSource,
  type HealthWorkoutExportSource,
} from "@mizyun/core";
import type {
  HealthExportCategory,
  HealthExportResult,
  HealthExportOperation,
} from "../../../modules/mizyun-health-export";
import {
  HealthExportStorageError,
  isHealthExportScope,
  type HealthExportMapping,
  type HealthExportStorage,
} from "./export-storage";

export interface HealthExportWriter {
  installationIdAsync(): Promise<string | null>;
  availabilityAsync(): Promise<HealthExportResult>;
  requestWritePermissionAsync(
    category: HealthExportCategory,
  ): Promise<HealthExportResult>;
  applyOperationAsync(
    operation: HealthExportOperation,
  ): Promise<HealthExportResult>;
  invalidateAsync(): Promise<void>;
}
export type HealthExportErrorCode =
  | "storage_failed"
  | "storage_full"
  | "storage_invalid"
  | "installation_unavailable"
  | "native_failed"
  | "revision_exhausted";
export interface HealthExportOutboxState {
  phase:
    | "disabled"
    | "ready"
    | "authorizing"
    | "writing"
    | "partial"
    | "permission_required"
    | "unavailable"
    | "install_required"
    | "error";
  enabled: Readonly<Record<HealthExportCategory, boolean>>;
  pending: Readonly<Record<HealthExportCategory, number>>;
  errorCode: HealthExportErrorCode | null;
}
const disabled = (): HealthExportOutboxState => ({
  phase: "disabled",
  enabled: { nutrition: false, workout: false },
  pending: { nutrition: 0, workout: 0 },
  errorCode: null,
});
const failure = (error: unknown): HealthExportErrorCode =>
  error instanceof HealthExportStorageError ? error.code : "native_failed";
function sameProjection(
  a: HealthExportPayload,
  b: HealthExportPayload,
): boolean {
  return (
    JSON.stringify({ ...a, revision: 1 }) ===
    JSON.stringify({ ...b, revision: 1 })
  );
}
function interval(operation: HealthExportPayload): {
  from: string;
  to: string;
} {
  return operation.category === "nutrition"
    ? {
        from: operation.nutrition.consumedAt,
        to: operation.nutrition.consumedAt,
      }
    : { from: operation.workout.startedAt, to: operation.workout.endedAt };
}
function atInterval(
  operation: HealthExportPayload,
  bounds: { from: string; to: string },
): HealthExportPayload {
  return operation.category === "nutrition"
    ? {
        ...operation,
        nutrition: { ...operation.nutrition, consumedAt: bounds.from },
      }
    : { ...operation, workout: { startedAt: bounds.from, endedAt: bounds.to } };
}
function fullyAcknowledged(
  operation: HealthExportPayload,
  result: HealthExportResult,
  acknowledged: readonly string[],
): boolean {
  if (result.status !== "ready") return false;
  if (operation.category === "workout") return acknowledged.includes("workout");
  // Health Connect writes/deletes one NutritionRecord atomically. HealthKit must
  // acknowledge every component, including removal of previously known values.
  return (
    acknowledged.includes("nutrition") ||
    ["energy", "protein", "carbs", "fat"].every((component) =>
      acknowledged.includes(component),
    )
  );
}

/** Device-only foreground outbox. Consent is deliberately memory-only.
 * Calls capture account authority before joining the serial mutation queue.
 * Account changes/toggles retire native work immediately; late results stay pending.
 */
export class HealthExportOutbox {
  private state = disabled();
  private accountId: string | null = null;
  private installationId: string | null = null;
  private generation = 0;
  private active = true;
  private mappings: HealthExportMapping[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(
    private readonly storage: HealthExportStorage,
    private readonly writer: HealthExportWriter,
    private readonly uuid: () => string,
  ) {}
  getSnapshot = (): HealthExportOutboxState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<HealthExportOutboxState> = {}) {
    this.state = {
      ...this.state,
      ...patch,
      pending: {
        nutrition: this.mappings.filter(
          (item) => item.pending && item.operation.category === "nutrition",
        ).length,
        workout: this.mappings.filter(
          (item) => item.pending && item.operation.category === "workout",
        ).length,
      },
    };
    this.listeners.forEach((listener) => listener());
  }
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(action);
    this.tail = result;
    return result;
  }
  private current(generation: number, accountId: string | null): boolean {
    return this.generation === generation && this.accountId === accountId;
  }
  private retire() {
    this.generation++;
    // Invocation occurs immediately, so native queued work is cancelled before
    // the JS mutation queue can advance. New actions wait for invalidation.
    const invalidation = this.writer.invalidateAsync().catch(() => undefined);
    void this.serialized(() => invalidation);
  }
  activate(accountId: string): Promise<void> {
    this.retire();
    this.accountId = isHealthExportScope(accountId) ? accountId : null;
    this.installationId = null;
    this.mappings = [];
    this.state = disabled();
    this.publish();
    const generation = this.generation;
    const owner = this.accountId;
    return this.serialized(async () => {
      if (!owner || !this.current(generation, owner)) return;
      try {
        const installationId = await this.writer.installationIdAsync();
        if (!this.current(generation, owner)) return;
        if (!isHealthExportScope(installationId)) {
          this.publish({
            phase: "unavailable",
            errorCode: "installation_unavailable",
          });
          return;
        }
        const mappings = await this.storage.load(owner, installationId);
        if (!this.current(generation, owner)) return;
        this.installationId = installationId;
        this.mappings = mappings;
        this.publish();
      } catch (error) {
        if (this.current(generation, owner))
          this.publish({ phase: "error", errorCode: failure(error) });
      }
    });
  }
  deactivate(): void {
    this.retire();
    this.accountId = null;
    this.installationId = null;
    this.mappings = [];
    this.state = disabled();
    this.publish();
  }
  setActive(active: boolean): void {
    this.active = active;
    // A permission sheet may temporarily deactivate the app. It cannot start
    // dispatch, and its deliberate foreground authorization remains valid.
    if (!active && this.state.phase !== "authorizing") {
      this.retire();
      this.publish({
        phase:
          this.state.enabled.nutrition || this.state.enabled.workout
            ? "ready"
            : "disabled",
      });
    }
  }
  enable(category: HealthExportCategory): Promise<void> {
    const generation = this.generation,
      accountId = this.accountId;
    return this.serialized(async () => {
      if (
        !this.current(generation, accountId) ||
        !accountId ||
        !this.installationId ||
        !this.active
      )
        return;
      this.publish({ phase: "authorizing", errorCode: null });
      try {
        const mappings = await this.storage.load(
          accountId,
          this.installationId,
        );
        if (!this.current(generation, accountId)) return;
        this.mappings = mappings;
        this.publish();
        const available = await this.writer.availabilityAsync();
        if (!this.current(generation, accountId)) return;
        if (available.status !== "ready") {
          this.publish({ phase: available.status });
          return;
        }
        if (!this.active) {
          this.publish({ phase: "disabled" });
          return;
        }
        const permission =
          await this.writer.requestWritePermissionAsync(category);
        if (!this.current(generation, accountId)) return;
        const granted =
          (permission.status === "ready" || permission.status === "partial") &&
          (permission.writeAccess === "granted" ||
            permission.writeAccess === "partial");
        this.publish({
          enabled: { ...this.state.enabled, [category]: granted },
          phase: granted
            ? permission.status
            : permission.status === "ready"
              ? "permission_required"
              : permission.status,
        });
      } catch {
        if (this.current(generation, accountId))
          this.publish({ phase: "error", errorCode: "native_failed" });
      }
    });
  }
  disable(category: HealthExportCategory): void {
    this.retire();
    this.publish({
      enabled: { ...this.state.enabled, [category]: false },
      phase: "disabled",
      errorCode: null,
    });
  }
  hasRecord(
    accountId: string,
    category: HealthExportCategory,
    sourceId: string,
  ): Promise<boolean> {
    const generation = this.generation;
    return this.serialized(async () => {
      if (!this.current(generation, accountId) || !this.installationId)
        return false;
      try {
        const mappings = await this.storage.load(
          accountId,
          this.installationId,
        );
        if (!this.current(generation, accountId)) return false;
        this.mappings = mappings;
        this.publish();
        return mappings.some(
          (item) =>
            item.sourceId === sourceId && item.operation.category === category,
        );
      } catch (error) {
        if (this.current(generation, accountId))
          this.publish({ phase: "error", errorCode: failure(error) });
        return false;
      }
    });
  }
  enqueueNutrition(
    accountId: string,
    source: HealthNutritionExportSource,
    confirmation: HealthExportConfirmation,
    existingOnly = false,
  ): Promise<void> {
    return this.enqueue(
      accountId,
      "nutrition",
      source.id,
      (clientId, revision) =>
        projectHealthNutritionExport(source, {
          confirmation,
          clientId,
          revision,
        }),
      existingOnly,
    );
  }
  enqueueWorkout(
    accountId: string,
    source: HealthWorkoutExportSource,
    confirmation: HealthExportConfirmation,
    existingOnly = false,
  ): Promise<void> {
    return this.enqueue(
      accountId,
      "workout",
      source.id,
      (clientId, revision) =>
        projectHealthWorkoutExport(source, {
          confirmation,
          clientId,
          revision,
        }),
      existingOnly,
    );
  }
  private enqueue(
    accountId: string,
    category: HealthExportCategory,
    sourceId: string,
    project: (clientId: string, revision: number) => HealthExportPayload | null,
    existingOnly = false,
  ): Promise<void> {
    const generation = this.generation;
    return this.serialized(async () => {
      if (!this.current(generation, accountId) || !this.installationId) return;
      try {
        const mappings = await this.storage.load(
          accountId,
          this.installationId,
        );
        if (!this.current(generation, accountId)) return;
        this.mappings = mappings;
        const previous = mappings.find(
          (item) =>
            item.sourceId === sourceId && item.operation.category === category,
        );
        // Disabled new saves do not retain health payloads or become retrospective exports.
        if (!previous && (existingOnly || !this.state.enabled[category]))
          return;
        const revision = nextHealthExportRevision(
          previous?.operation.revision ?? 0,
        );
        if (revision === null) {
          this.publish({ phase: "error", errorCode: "revision_exhausted" });
          return;
        }
        let operation = project(
          previous?.operation.clientId ?? this.uuid(),
          revision,
        );
        if (
          operation &&
          [accountId, sourceId, this.installationId].some(
            (scope) =>
              scope.toLowerCase() === operation!.clientId.toLowerCase(),
          )
        )
          throw new HealthExportStorageError("storage_invalid");
        // Loss of eligibility retires only an existing own-origin mapping.
        if (!operation && previous)
          operation = projectHealthExportDeletion(previous.operation, revision);
        if (
          !operation ||
          (previous && sameProjection(previous.operation, operation))
        )
          return;
        const cleanupIntervals = [...(previous?.cleanupIntervals ?? [])];
        if (operation.type === "upsert") {
          const bounds = interval(operation);
          if (
            !cleanupIntervals.some(
              (pair) => pair.from === bounds.from && pair.to === bounds.to,
            )
          )
            cleanupIntervals.push(bounds);
        }
        if (cleanupIntervals.length > 8)
          throw new HealthExportStorageError("storage_full");
        const mapping: HealthExportMapping = {
          schemaVersion: 1,
          installationId: this.installationId,
          accountId,
          sourceId,
          operation,
          pending: true,
          acknowledgedComponents: [],
          cleanupIntervals,
        };
        await this.storage.save(mapping);
        if (!this.current(generation, accountId)) return;
        this.mappings = previous
          ? this.mappings.map((item) => (item === previous ? mapping : item))
          : [...this.mappings, mapping];
        this.publish({ phase: "ready", errorCode: null });
        if (this.active && this.state.enabled[category])
          await this.dispatch(generation, accountId, category);
      } catch (error) {
        if (this.current(generation, accountId))
          this.publish({ phase: "error", errorCode: failure(error) });
      }
    });
  }
  deleteRecord(
    accountId: string,
    category: HealthExportCategory,
    sourceId: string,
  ): Promise<void> {
    return this.enqueue(accountId, category, sourceId, () => null);
  }
  retry(category?: HealthExportCategory): Promise<void> {
    const generation = this.generation,
      accountId = this.accountId;
    return this.serialized(async () => {
      if (
        !accountId ||
        !this.installationId ||
        !this.current(generation, accountId)
      )
        return;
      try {
        const mappings = await this.storage.load(
          accountId,
          this.installationId,
        );
        if (!this.current(generation, accountId)) return;
        this.mappings = mappings;
        this.publish();
        await this.dispatch(generation, accountId, category);
      } catch (error) {
        if (this.current(generation, accountId))
          this.publish({ phase: "error", errorCode: failure(error) });
      }
    });
  }
  private async dispatch(
    generation: number,
    accountId: string,
    category?: HealthExportCategory,
  ): Promise<void> {
    for (const originalMapping of this.mappings) {
      let mapping = originalMapping;
      if (!this.current(generation, accountId) || !this.active) return;
      if (
        !mapping.pending ||
        !this.state.enabled[mapping.operation.category] ||
        (category && mapping.operation.category !== category)
      )
        continue;
      this.publish({ phase: "writing", errorCode: null });
      try {
        do {
          // No permission request, background work, automatic loop, or unstable ID.
          const deleting = mapping.operation.type === "delete";
          const operation = deleting
            ? atInterval(mapping.operation, mapping.cleanupIntervals[0]!)
            : mapping.operation;
          const result = await this.writer.applyOperationAsync(operation);
          if (
            !this.current(generation, accountId) ||
            !this.active ||
            !this.state.enabled[mapping.operation.category]
          )
            return;
          const acknowledgedComponents = [
            ...new Set([
              ...mapping.acknowledgedComponents,
              ...result.acknowledgedComponents,
            ]),
          ];
          const complete = fullyAcknowledged(
            operation,
            result,
            acknowledgedComponents,
          );
          const cleanupIntervals = complete
            ? deleting
              ? mapping.cleanupIntervals.slice(1)
              : [interval(operation)]
            : mapping.cleanupIntervals;
          const pending =
            !complete || (deleting && cleanupIntervals.length > 0);
          const next: HealthExportMapping = {
            ...mapping,
            pending,
            cleanupIntervals,
            acknowledgedComponents:
              complete && deleting ? [] : acknowledgedComponents,
          };
          await this.storage.save(next);
          if (!this.current(generation, accountId)) return;
          this.mappings = this.mappings.map((item) =>
            item === mapping ? next : item,
          );
          this.publish({
            phase:
              pending && result.status === "ready" ? "partial" : result.status,
            errorCode: result.status === "error" ? "native_failed" : null,
          });
          // Partial/denied/failure is a user-visible retry boundary; no implicit retry.
          if (!complete) return;
          mapping = next;
        } while (mapping.pending);
      } catch (error) {
        if (this.current(generation, accountId))
          this.publish({ phase: "error", errorCode: failure(error) });
        return;
      }
    }
  }
  /** Forget local mappings only. This does not claim that platform data was erased. */
  clearAccount(accountId: string): Promise<void> {
    if (this.accountId === accountId) this.deactivate();
    // Purge account payloads even after Auth retirement, reinstall or native
    // sentinel failure. Local deletion needs no native permission or identifier.
    return this.serialized(() => this.storage.clearAccount(accountId));
  }
}
