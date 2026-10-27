import { HISTORY_IMPORT_MAX_CONTENT } from "@mizyun/contracts";

export type WeightUnit = "kg" | "lb";
export type DistanceUnit = "km" | "mi";

export interface PickedFileInfo {
  readonly name: string;
  /** Bytes, when the picker reports it. */
  readonly size?: number | null;
}

export type FileCheck = { ok: true } | { ok: false; message: string };

const maxMegabytes = Math.round(HISTORY_IMPORT_MAX_CONTENT / 1_000_000);

/** Rejects archives and oversized files before any text is read. */
export function checkPickedFile(file: PickedFileInfo): FileCheck {
  const name = file.name.trim().toLowerCase();
  if (name.endsWith(".zip"))
    return {
      ok: false,
      message:
        "This is a zip archive. Open it in Files, then choose activities.csv from inside it.",
    };
  if (typeof file.size === "number" && file.size > HISTORY_IMPORT_MAX_CONTENT)
    return {
      ok: false,
      message: `This file is larger than ${maxMegabytes} MB, which is more than Mizyun can import at once. Export a shorter date range and try again.`,
    };
  if (typeof file.size === "number" && file.size === 0)
    return { ok: false, message: "This file is empty." };
  return { ok: true };
}

/** Checks the decoded text (file size in bytes can differ from characters). */
export function checkFileText(text: string): FileCheck {
  if (text.trim().length === 0)
    return { ok: false, message: "This file is empty." };
  if (text.length > HISTORY_IMPORT_MAX_CONTENT)
    return {
      ok: false,
      message: `This file is larger than ${maxMegabytes} MB, which is more than Mizyun can import at once. Export a shorter date range and try again.`,
    };
  return { ok: true };
}

/** Excel and some exporters prefix CSV files with a byte-order mark. */
export const stripByteOrderMark = (text: string): string =>
  text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

/** Units offered first, from the profile's unit system. */
export const defaultUnits = (
  unitSystem: "metric" | "imperial" | null | undefined,
): { weightUnit: WeightUnit; distanceUnit: DistanceUnit } =>
  unitSystem === "imperial"
    ? { weightUnit: "lb", distanceUnit: "mi" }
    : { weightUnit: "kg", distanceUnit: "km" };
