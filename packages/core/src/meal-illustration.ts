import type { UserId } from "./index.js";

export const MEAL_ILLUSTRATION_STYLE = "food-icon-v1";
export const MEAL_ILLUSTRATION_MAX_BYTES = 256 * 1024;
export interface MealIllustrationImage {
  readonly base64: string;
  readonly mimeType: "image/jpeg";
  readonly key: string;
}
export interface StoredMealIllustration {
  readonly id: string;
  readonly userId: UserId;
  readonly sourceEntryId: string;
  readonly key: string;
  readonly state: "generating" | "ready" | "failed" | "unknown";
  readonly createdAt: string;
  readonly leaseUntil: string;
  readonly image: MealIllustrationImage | null;
}
export interface MealIllustrationUsage {
  readonly userId: UserId;
  readonly day: string;
  readonly attempts: number;
}

export type MealIllustrationClaim =
  | { readonly kind: "claimed"; readonly record: StoredMealIllustration }
  | { readonly kind: "existing"; readonly record: StoredMealIllustration }
  | { readonly kind: "limited" };
export interface MealIllustrationRepository {
  claim(
    userId: UserId,
    key: string,
    consentVersion: string,
    sourceEntryId: string,
  ): Promise<MealIllustrationClaim>;
  complete(
    userId: UserId,
    id: string,
    image: MealIllustrationImage,
    consentVersion: string,
  ): Promise<void>;
  fail(userId: UserId, id: string): Promise<void>;
  exportForUser(
    userId: UserId,
    accessToken: string,
  ): Promise<readonly StoredMealIllustration[]>;
  exportUsageForUser(
    userId: UserId,
    accessToken: string,
  ): Promise<readonly MealIllustrationUsage[]>;
  deleteForUser(userId: UserId): Promise<void>;
  invalidateForEntry(userId: UserId, sourceEntryId: string): Promise<void>;
}
/** Pure normalization; no meal quantities, dates, or nutrient values enter a prompt. */
export function normalizeMealIllustrationName(name: string): string | null {
  const normalized = name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|oz|grams?)$/u, "")
    .replace(/\s*&\s*/gu, " and ")
    .trim();
  if (
    normalized.length < 2 ||
    normalized.length > 100 ||
    !/^[\p{L}\p{M} '’\-]+$/u.test(normalized)
  )
    return null;
  return normalized;
}
