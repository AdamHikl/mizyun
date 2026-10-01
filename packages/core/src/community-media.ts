import type { UserId } from "./index";
import { CommunityMutationError } from "./community";
export const COMMUNITY_MEDIA_MAX_BYTES = 3 * 1024 * 1024;
export const COMMUNITY_MEDIA_MAX_PIXELS = 12_000_000;
export interface CommunityMediaStorage {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(paths: readonly string[]): Promise<void>;
}
export interface CommunityMediaService {
  upload(input: {
    userId: UserId;
    accessToken: string;
    operationId: string;
    altText: string;
    mimeType: "image/jpeg" | "image/png";
    bytes: Uint8Array;
  }): Promise<unknown>;
  execute(
    operation: "list" | "get" | "delete" | "review" | "queue",
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown>;
  evidence(
    reportId: string,
    variant: "image" | "thumbnail",
    accessToken: string,
  ): Promise<Uint8Array>;
  content(
    id: string,
    variant: "image" | "thumbnail",
    accessToken: string,
  ): Promise<Uint8Array>;
}
/** First cheap boundary; decoder is still required before any persistence. */
export function validateCommunityMediaSignature(
  bytes: Uint8Array,
  mimeType: "image/jpeg" | "image/png",
): void {
  if (bytes.length < 12 || bytes.length > COMMUNITY_MEDIA_MAX_BYTES)
    throw new CommunityMutationError("invalid_input");
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (value, index) => bytes[index] === value,
  );
  if (
    (mimeType === "image/jpeg" && !isJpeg) ||
    (mimeType === "image/png" && !isPng)
  )
    throw new CommunityMutationError("invalid_input");
  // APNG animation must not be flattened and represented as a harmless still.
  if (isPng) {
    let pos = 8;
    while (pos + 12 <= bytes.length) {
      const size = new DataView(
        bytes.buffer,
        bytes.byteOffset + pos,
        4,
      ).getUint32(0);
      const kind = String.fromCharCode(...bytes.slice(pos + 4, pos + 8));
      if (kind === "acTL" || kind === "fcTL" || kind === "fdAT")
        throw new CommunityMutationError("invalid_input");
      if (size > bytes.length - pos - 12)
        throw new CommunityMutationError("invalid_input");
      pos += size + 12;
      if (kind === "IEND") {
        if (pos !== bytes.length)
          throw new CommunityMutationError("invalid_input");
        break;
      }
    }
  }
}
