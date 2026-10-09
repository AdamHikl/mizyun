const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export interface MealImagePathRecord {
  readonly userId: string;
  readonly pathKey: string;
  readonly createdAt: string;
}
/** Validate, never normalize, coordinates before privileged food-image lifecycle IO. */
export function isOwnedMealImagePath(
  userId: string,
  bucketId: string,
  path: string,
): boolean {
  return (
    bucketId === "private-media" &&
    userId.length === 36 &&
    new RegExp(`^${UUID}$`, "i").test(userId) &&
    path.startsWith(`${userId}/`) &&
    new RegExp(
      `^(?:meal-photos/${UUID}|[a-z0-9_-]{1,100})\\.(?:jpg|jpeg|png|webp)$(?![\\s\\S])`,
      "i",
    ).test(path.slice(userId.length + 1))
  );
}
