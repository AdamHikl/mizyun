/** INT-04 pure outbound policy. No storage, platform, vendor or framework dependencies. */
export interface HealthExportConfirmation {
  readonly schemaVersion: 1;
  readonly recordId: string;
  readonly savedUpdatedAt: string;
  readonly origin: "mizyun_user_entered";
  readonly rights: "first_party";
  readonly derivedFrom: readonly never[];
  readonly timeBasis: "observed" | "date_only";
}
export interface HealthExportProjectionOptions {
  readonly confirmation: HealthExportConfirmation;
  /** Random ID from the device/account-bound local mapping; never a source/account ID. */
  readonly clientId: string;
  readonly revision: number;
}
interface ExportBase {
  readonly type: "upsert" | "delete";
  readonly clientId: string;
  readonly revision: number;
}
export interface HealthNutritionExport extends ExportBase {
  readonly category: "nutrition";
  readonly nutrition: {
    readonly consumedAt: string;
    readonly energyKcal: number | null;
    readonly proteinG: number | null;
    readonly carbsG: number | null;
    readonly fatG: number | null;
  };
}
export interface HealthWorkoutExport extends ExportBase {
  readonly category: "workout";
  readonly workout: {
    readonly startedAt: string;
    readonly endedAt: string;
  };
}
export type HealthExportPayload = HealthNutritionExport | HealthWorkoutExport;
interface SavedSource {
  readonly id: string;
  readonly updatedAt: string;
  readonly source: string;
  readonly details: Readonly<Record<string, unknown>>;
}
export interface HealthNutritionExportSource extends SavedSource {
  readonly confirmedByUser: boolean;
  readonly consumedAt: string;
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
}
export interface HealthWorkoutExportSource extends SavedSource {
  readonly startedAt: string;
  readonly completedAt: string | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function instant(value: unknown): value is string {
  if (typeof value !== "string" || !INSTANT.test(value)) return false;
  const ms = Date.parse(value);
  return (
    Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function options(value: unknown): value is HealthExportProjectionOptions {
  return (
    object(value) &&
    exactKeys(value, ["confirmation", "clientId", "revision"]) &&
    uuid(value.clientId) &&
    revision(value.revision)
  );
}
/** Positive safe revisions map unchanged to both platform sync version fields. */
export function nextHealthExportRevision(previous: number): number | null {
  return Number.isSafeInteger(previous) &&
    previous >= 0 &&
    previous < Number.MAX_SAFE_INTEGER
    ? previous + 1
    : null;
}
function confirmed(
  source: unknown,
  marker: unknown,
): source is Record<string, unknown> {
  return (
    object(source) &&
    source.source === "manual" &&
    uuid(source.id) &&
    instant(source.updatedAt) &&
    object(source.details) &&
    object(marker) &&
    exactKeys(marker, [
      "schemaVersion",
      "recordId",
      "savedUpdatedAt",
      "origin",
      "rights",
      "derivedFrom",
      "timeBasis",
    ]) &&
    marker.schemaVersion === 1 &&
    marker.origin === "mizyun_user_entered" &&
    marker.rights === "first_party" &&
    Array.isArray(marker.derivedFrom) &&
    marker.derivedFrom.length === 0 &&
    marker.timeBasis === "observed" &&
    marker.recordId === source.id &&
    marker.savedUpdatedAt === source.updatedAt
  );
}
function nutrient(value: unknown, maximum: number): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= maximum)
  );
}
function boundedText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
function allowedKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
/** Benign manual display metadata is retained locally; unknown lineage fails closed. */
export function hasEligibleHealthNutritionDetails(details: unknown): boolean {
  if (
    !object(details) ||
    !allowedKeys(details, [
      "grams",
      "mealDescription",
      "mealGroup",
      "mealGroupId",
      "mealGroupName",
    ])
  )
    return false;
  if (
    Object.hasOwn(details, "grams") &&
    (typeof details.grams !== "number" ||
      !Number.isFinite(details.grams) ||
      details.grams <= 0 ||
      details.grams > 100_000)
  )
    return false;
  if (
    Object.hasOwn(details, "mealDescription") &&
    !boundedText(details.mealDescription, 4_000)
  )
    return false;
  if (
    Object.hasOwn(details, "mealGroupId") &&
    !boundedText(details.mealGroupId, 128)
  )
    return false;
  if (
    Object.hasOwn(details, "mealGroupName") &&
    !boundedText(details.mealGroupName, 200)
  )
    return false;
  if (
    Object.hasOwn(details, "mealGroup") &&
    (!object(details.mealGroup) ||
      !exactKeys(details.mealGroup, ["id", "name"]) ||
      !boundedText(details.mealGroup.id, 128) ||
      !boundedText(details.mealGroup.name, 200))
  )
    return false;
  return true;
}
/** Only fresh standalone sessions qualify; routine/AI/import metadata is excluded.
 * Exercise display fields are inspected for unexpected lineage, never projected.
 */
export function hasEligibleHealthWorkoutDetails(details: unknown): boolean {
  if (
    !object(details) ||
    !allowedKeys(details, [
      "workoutLifecycle",
      "sessionMode",
      "sessionExercises",
      "healthExportOrigin",
    ])
  )
    return false;
  if (
    !object(details.healthExportOrigin) ||
    !exactKeys(details.healthExportOrigin, ["version", "origin"]) ||
    details.healthExportOrigin.version !== 1 ||
    details.healthExportOrigin.origin !== "mizyun_user_entered"
  )
    return false;
  if (
    !object(details.workoutLifecycle) ||
    !exactKeys(details.workoutLifecycle, ["kind"]) ||
    details.workoutLifecycle.kind !== "session"
  )
    return false;
  if (
    Object.hasOwn(details, "sessionMode") &&
    details.sessionMode !== "one_time"
  )
    return false;
  if (!Object.hasOwn(details, "sessionExercises")) return true;
  if (
    !Array.isArray(details.sessionExercises) ||
    details.sessionExercises.length > 1_000
  )
    return false;
  return details.sessionExercises.every((exercise: unknown) => {
    if (
      !object(exercise) ||
      !allowedKeys(exercise, [
        "name",
        "catalogId",
        "targetSets",
        "sets",
        "repsMin",
        "repsMax",
        "durationMinutes",
        "restSeconds",
        "targetLoad",
      ]) ||
      !boundedText(exercise.name, 200)
    )
      return false;
    for (const field of ["catalogId", "targetLoad"]) {
      if (Object.hasOwn(exercise, field) && !boundedText(exercise[field], 200))
        return false;
    }
    for (const field of [
      "targetSets",
      "sets",
      "repsMin",
      "repsMax",
      "durationMinutes",
      "restSeconds",
    ]) {
      const value = exercise[field];
      if (
        Object.hasOwn(exercise, field) &&
        (typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 86_400)
      )
        return false;
    }
    return true;
  });
}
/** Strict runtime guard for restored/local outbox data before native use. */
export function isHealthExportPayload(
  value: unknown,
): value is HealthExportPayload {
  if (
    !object(value) ||
    !uuid(value.clientId) ||
    !revision(value.revision) ||
    (value.type !== "upsert" && value.type !== "delete")
  )
    return false;
  if (value.category === "nutrition") {
    const nutrition = value.nutrition;
    return (
      exactKeys(value, [
        "type",
        "category",
        "clientId",
        "revision",
        "nutrition",
      ]) &&
      object(nutrition) &&
      exactKeys(nutrition, [
        "consumedAt",
        "energyKcal",
        "proteinG",
        "carbsG",
        "fatG",
      ]) &&
      instant(nutrition.consumedAt) &&
      nutrient(nutrition.energyKcal, 20_000) &&
      nutrient(nutrition.proteinG, 10_000) &&
      nutrient(nutrition.carbsG, 10_000) &&
      nutrient(nutrition.fatG, 10_000) &&
      [
        nutrition.energyKcal,
        nutrition.proteinG,
        nutrition.carbsG,
        nutrition.fatG,
      ].some((quantity) => quantity !== null)
    );
  }
  if (
    value.category !== "workout" ||
    !exactKeys(value, [
      "type",
      "category",
      "clientId",
      "revision",
      "workout",
    ]) ||
    !object(value.workout) ||
    !exactKeys(value.workout, ["startedAt", "endedAt"]) ||
    !instant(value.workout.startedAt) ||
    !instant(value.workout.endedAt)
  )
    return false;
  const duration =
    Date.parse(value.workout.endedAt) - Date.parse(value.workout.startedAt);
  return duration > 0 && duration <= 86_400_000;
}
/** Only saved first-party user input. Unknown nutrients stay null. */
export function projectHealthNutritionExport(
  source: HealthNutritionExportSource,
  exportOptions: HealthExportProjectionOptions,
): HealthNutritionExport | null {
  if (
    !options(exportOptions) ||
    !confirmed(source, exportOptions.confirmation) ||
    !hasEligibleHealthNutritionDetails(source.details) ||
    source.confirmedByUser !== true ||
    !instant(source.consumedAt) ||
    !nutrient(source.caloriesKcal, 20_000) ||
    !nutrient(source.proteinG, 10_000) ||
    !nutrient(source.carbohydrateG, 10_000) ||
    !nutrient(source.fatG, 10_000) ||
    [
      source.caloriesKcal,
      source.proteinG,
      source.carbohydrateG,
      source.fatG,
    ].every((value) => value === null)
  )
    return null;
  return Object.freeze({
    type: "upsert",
    category: "nutrition",
    clientId: exportOptions.clientId,
    revision: exportOptions.revision,
    nutrition: Object.freeze({
      consumedAt: source.consumedAt,
      energyKcal: source.caloriesKcal,
      proteinG: source.proteinG,
      carbsG: source.carbohydrateG,
      fatG: source.fatG,
    }),
  });
}
/** Native maps this actual completed interval to generic strength training. */
export function projectHealthWorkoutExport(
  source: HealthWorkoutExportSource,
  exportOptions: HealthExportProjectionOptions,
): HealthWorkoutExport | null {
  if (
    !options(exportOptions) ||
    !confirmed(source, exportOptions.confirmation) ||
    !hasEligibleHealthWorkoutDetails(source.details) ||
    !instant(source.startedAt) ||
    !instant(source.completedAt)
  )
    return null;
  const durationSeconds =
    (Date.parse(source.completedAt) - Date.parse(source.startedAt)) / 1000;
  if (durationSeconds <= 0 || durationSeconds > 86_400) return null;
  return Object.freeze({
    type: "upsert",
    category: "workout",
    clientId: exportOptions.clientId,
    revision: exportOptions.revision,
    workout: Object.freeze({
      startedAt: source.startedAt,
      endedAt: source.completedAt,
    }),
  });
}
/** Scope matching and monotonic revision protect edits/deletes from stale jobs. */
export function canReplaceHealthExport(
  previous: HealthExportPayload,
  next: HealthExportPayload,
): boolean {
  return (
    isHealthExportPayload(previous) &&
    isHealthExportPayload(next) &&
    previous.clientId === next.clientId &&
    previous.category === next.category &&
    next.revision > previous.revision
  );
}
/** Delete only an existing owned mapping; retain its interval for native ownership checks. */
export function projectHealthExportDeletion(
  previous: HealthExportPayload,
  nextRevision: number,
): HealthExportPayload | null {
  if (
    !isHealthExportPayload(previous) ||
    !revision(nextRevision) ||
    nextRevision <= previous.revision
  )
    return null;
  return previous.category === "nutrition"
    ? Object.freeze({
        type: "delete",
        category: "nutrition",
        clientId: previous.clientId,
        revision: nextRevision,
        nutrition: Object.freeze({ ...previous.nutrition }),
      })
    : Object.freeze({
        type: "delete",
        category: "workout",
        clientId: previous.clientId,
        revision: nextRevision,
        workout: Object.freeze({ ...previous.workout }),
      });
}
