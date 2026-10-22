/** Light exports (no native modules) for other features such as Workouts. */
export {
  getActiveBoulderSession,
  listBoulderSessions,
  type BoulderFailure,
} from "./client";
export {
  formatBoulderDate,
  sessionHistorySubtitle,
  sessionTitle,
} from "./presentation";

type BoulderPhotoModule = typeof import("./boulder-photo");

/**
 * Background photo backup (ADR-0079), loaded on demand so this light surface
 * never pulls in file-system or media modules for its other callers.
 */
export const backUpDeviceBoulderPhoto = async (
  input: Parameters<BoulderPhotoModule["backUpDeviceBoulderPhoto"]>[0],
): Promise<boolean> =>
  (await import("./boulder-photo")).backUpDeviceBoulderPhoto(input);

export const removeBoulderPhotoBackup = async (
  input: Parameters<BoulderPhotoModule["removeBoulderPhotoBackup"]>[0],
): Promise<boolean> =>
  (await import("./boulder-photo")).removeBoulderPhotoBackup(input);

export const ensureBoulderPhotoOnDevice = async (
  input: Parameters<BoulderPhotoModule["ensureBoulderPhotoOnDevice"]>[0],
): Promise<boolean> =>
  (await import("./boulder-photo")).ensureBoulderPhotoOnDevice(input);
