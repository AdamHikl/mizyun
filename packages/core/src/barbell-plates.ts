/**
 * Barbell plate arithmetic. Pure helpers: weights are in the user's display
 * unit (kg or lb) and plates are always loaded symmetrically on both sides.
 */

export type PlateUnit = "kg" | "lb";

/** Common gym plate denominations, heaviest first. */
export const STANDARD_PLATES: Readonly<Record<PlateUnit, readonly number[]>> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

/** Common bar weights, heaviest (standard Olympic bar) first. */
export const STANDARD_BARS: Readonly<Record<PlateUnit, readonly number[]>> = {
  kg: [20, 15, 10],
  lb: [45, 35, 15],
};

export interface PlateCount {
  readonly plate: number;
  /** Plates of this denomination on each side of the bar. */
  readonly perSide: number;
}

export interface PlateLoadout {
  readonly plates: readonly PlateCount[];
  /** Total of bar plus both sides. */
  readonly total: number;
  /** Target minus total; positive when the target cannot be made exactly. */
  readonly shortBy: number;
}

// Work in hundredths so 1.25 and 2.5 plates sum exactly.
const toHundredths = (value: number): number => Math.round(value * 100);
const fromHundredths = (value: number): number => value / 100;

/** Bar weight plus both sides of the given plate counts. */
export function barbellTotal(
  barWeight: number,
  plates: readonly PlateCount[],
): number {
  const perSide = plates.reduce(
    (sum, { plate, perSide: count }) =>
      sum + toHundredths(plate) * Math.max(0, Math.trunc(count)),
    0,
  );
  return fromHundredths(toHundredths(barWeight) + 2 * perSide);
}

/** Upper bound on a target, so pasted input cannot allocate huge tables. */
export const MAX_BARBELL_TARGET: Readonly<Record<PlateUnit, number>> = {
  kg: 1000,
  lb: 2200,
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Heaviest symmetric loadout that does not exceed `target`, using an
 * unlimited supply of each denomination and, among those, the fewest plates
 * (e.g. 35 + 25 lb rather than 45 + 10 + 5 lb). Returns null for non-finite
 * input, a target below the bar, or a target above `maxTarget`.
 */
export function platesForTarget(
  target: number,
  barWeight: number,
  denominations: readonly number[],
  maxTarget = Number.POSITIVE_INFINITY,
): PlateLoadout | null {
  if (!Number.isFinite(target) || !Number.isFinite(barWeight)) return null;
  if (target > maxTarget) return null;
  const targetH = toHundredths(target);
  const barH = toHundredths(barWeight);
  if (barH < 0 || targetH < barH) return null;

  const sorted = [...new Set(denominations.map(toHundredths))]
    .filter((plate) => plate > 0)
    .sort((a, b) => b - a);
  const step = sorted.reduce(gcd, 0) || 1;
  const units = sorted.map((plate) => plate / step);
  const capacity = Math.floor((targetH - barH) / 2 / step);

  // fewest[w] = minimum plates summing to exactly w units per side.
  const fewest = new Array<number>(capacity + 1).fill(Infinity);
  const choice = new Array<number>(capacity + 1).fill(-1);
  fewest[0] = 0;
  for (let w = 1; w <= capacity; w++) {
    units.forEach((unit, index) => {
      if (unit <= w && fewest[w - unit]! + 1 < fewest[w]!) {
        fewest[w] = fewest[w - unit]! + 1;
        choice[w] = index;
      }
    });
  }
  let w = capacity;
  while (w > 0 && fewest[w] === Infinity) w--;

  const counts = sorted.map(() => 0);
  for (; w > 0; w -= units[choice[w]!]!) counts[choice[w]!]!++;
  const plates = sorted.map((plateH, index) => ({
    plate: fromHundredths(plateH),
    perSide: counts[index]!,
  }));
  const total = barbellTotal(barWeight, plates);
  return {
    plates,
    total,
    shortBy: fromHundredths(targetH - toHundredths(total)),
  };
}
