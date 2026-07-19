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
