const BOUNDARY =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Opaque pagination state, not an authorization capability or a signature.
// Every page still uses the current principal and live repository visibility.
export function encodeActivityCursor(
  boundary: string | null | undefined,
  viewerId: string,
  authorId: string | null = null,
): string | null {
  return boundary
    ? Buffer.from(JSON.stringify([1, viewerId, authorId, boundary])).toString(
        "base64url",
      )
    : null;
}

export function decodeActivityCursor(
  cursor: string,
  viewerId: string,
  authorId: string | null = null,
): string | null {
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      value[0] !== 1 ||
      value[1] !== viewerId ||
      value[2] !== authorId ||
      typeof value[3] !== "string" ||
      !BOUNDARY.test(value[3]) ||
      !Number.isFinite(Date.parse(value[3].split("|")[0]!))
    )
      return null;
    return value[3];
  } catch {
    return null;
  }
}
