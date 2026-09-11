export type WeightUnitSystem = "metric" | "imperial";

export const POUNDS_PER_KILOGRAM = 2.204_622_621_8;

export const weightUnitLabel = (unitSystem: WeightUnitSystem): "kg" | "lb" =>
  unitSystem === "imperial" ? "lb" : "kg";

export const displayWeightToKilograms = (
  value: number,
  unitSystem: WeightUnitSystem,
): number => {
  const kilograms =
    unitSystem === "imperial" ? value / POUNDS_PER_KILOGRAM : value;
  return Math.round(kilograms * 1_000) / 1_000;
};

export const kilogramsToDisplayWeight = (
  kilograms: number,
  unitSystem: WeightUnitSystem,
): number => {
  const value =
    unitSystem === "imperial" ? kilograms * POUNDS_PER_KILOGRAM : kilograms;
  return Math.round(value * 10) / 10;
};

export const parseDisplayWeightToKilograms = (
  raw: string,
  unitSystem: WeightUnitSystem,
): number | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return displayWeightToKilograms(value, unitSystem);
};

interface ParsedTargetLoad {
  num: number;
  specifiedUnit: WeightUnitSystem | null;
}

const parseRawTargetLoad = (
  raw: string | number | null | undefined,
): ParsedTargetLoad | null => {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return { num: raw, specifiedUnit: null };
  }

  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("-")) return null;

  const lower = trimmed.toLowerCase();
  const hasLb = lower.includes("lb");
  const hasKg = lower.includes("kg");
  if (hasLb && hasKg) return null;

  const cleaned = trimmed.replace(/[^0-9.]/g, "");
  if (cleaned.length === 0) return null;

  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;

  const specifiedUnit: WeightUnitSystem | null = hasLb
    ? "imperial"
    : hasKg
      ? "metric"
      : null;

  return { num, specifiedUnit };
};

export const parseTargetLoadToDisplay = (
  raw: string | number | null | undefined,
  unitSystem: WeightUnitSystem,
): string | null => {
  const parsed = parseRawTargetLoad(raw);
  if (!parsed) return null;

  const { num, specifiedUnit } = parsed;

  if (specifiedUnit === "imperial") {
    if (unitSystem === "imperial") {
      return String(num);
    }
    const kg = displayWeightToKilograms(num, "imperial");
    const metricDisplay = kilogramsToDisplayWeight(kg, "metric");
    return String(metricDisplay);
  }

  if (specifiedUnit === "metric") {
    if (unitSystem === "metric") {
      return String(num);
    }
    const imperialDisplay = kilogramsToDisplayWeight(num, "imperial");
    return String(imperialDisplay);
  }

  return String(num);
};

export const parseTargetLoadToKilograms = (
  raw: string | number | null | undefined,
  unitSystem: WeightUnitSystem,
): number | null => {
  const parsed = parseRawTargetLoad(raw);
  if (!parsed) return null;

  const { num, specifiedUnit } = parsed;

  if (specifiedUnit === "imperial") {
    return displayWeightToKilograms(num, "imperial");
  }

  if (specifiedUnit === "metric") {
    return displayWeightToKilograms(num, "metric");
  }

  return displayWeightToKilograms(num, unitSystem);
};
