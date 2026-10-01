import crypto from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import {
  COMMUNITY_MEDIA_MAX_PIXELS,
  CommunityMutationError,
  validateCommunityMediaSignature,
  type CommunityMediaService,
  type CommunityMediaStorage,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

async function boundedMediaOperation<T>(
  operation: Promise<T>,
  milliseconds = 30_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new RepositoryError("Community media operation timed out")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export async function processCommunityMedia(
  bytes: Uint8Array,
  mimeType: "image/jpeg" | "image/png",
) {
  validateCommunityMediaSignature(bytes, mimeType);
  try {
    const input = Buffer.from(bytes);
    const image = sharp(input, {
      failOn: "warning",
      limitInputPixels: COMMUNITY_MEDIA_MAX_PIXELS,
      animated: false,
    });
    const metadata = await boundedMediaOperation(image.metadata(), 10_000);
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > COMMUNITY_MEDIA_MAX_PIXELS ||
      (metadata.pages ?? 1) !== 1 ||
      !["jpeg", "png"].includes(metadata.format ?? "") ||
      metadata.width > 12000 ||
      metadata.height > 12000
    )
      throw new Error("Unsupported image");
    const decoded = await image
      .timeout({ seconds: 10 })
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(decoded.data, {
      failOn: "warning",
      limitInputPixels: COMMUNITY_MEDIA_MAX_PIXELS,
    })
      .timeout({ seconds: 10 })
      .resize({
        width: 320,
        height: 320,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 75 })
      .toBuffer();
    if (decoded.data.length > 2 * 1024 * 1024 || thumbnail.length > 256 * 1024)
      throw new Error("Output too large");
    return {
      image: decoded.data,
      thumbnail,
      width: decoded.info.width,
      height: decoded.info.height,
      inputDigest: crypto.createHash("sha256").update(input).digest("hex"),
    };
  } catch {
    throw new CommunityMutationError("invalid_input");
  }
}
/** Bucket paths come exclusively from authorization RPCs, never from the caller. */
export function createSupabaseCommunityMediaStorage(config: {
  url: string;
  serviceRoleKey: string;
}): CommunityMediaStorage {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
    },
  });
  const bucket = client.storage.from("community-media");
  return {
    async put(path, bytes) {
      const result = await bucket.upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: false,
        cacheControl: "0",
      });
      if (!result.error) return;
      // A partial upload/retry may find immutable bytes already written. Verify, never overwrite.
      if (
        String(result.error.statusCode) === "409" ||
        result.error.message.toLowerCase().includes("already exists")
      ) {
        const existing = await bucket.download(path);
        if (
          !existing.error &&
          existing.data &&
          Buffer.from(await existing.data.arrayBuffer()).equals(
            Buffer.from(bytes),
          )
        )
          return;
      }
      throw new RepositoryError("Community media storage write unavailable");
    },
    async get(path) {
      const result = await bucket.download(path);
      if (result.error || !result.data || result.data.size > 2 * 1024 * 1024)
        throw new RepositoryError("Community media storage read unavailable");
      return new Uint8Array(await result.data.arrayBuffer());
    },
    async remove(paths) {
      if (!paths.length) return;
      const result = await bucket.remove([...paths]);
      if (result.error)
        throw new RepositoryError(
          "Community media storage removal unavailable",
        );
    },
  };
}
export class SupabaseCommunityMediaService implements CommunityMediaService {
  constructor(
    private readonly options: {
      clientFor: (token: string) => RepositorySupabaseClient;
      serviceClient: RepositorySupabaseClient;
      storage: CommunityMediaStorage;
    },
  ) {}
  private async call(
    client: RepositorySupabaseClient,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const { data, error } = await boundedMediaOperation(client.rpc(name, args));
    if (error) {
      const reasons = {
        community_access_denied: "access_denied",
        community_unavailable: "unavailable",
        community_conflict: "conflict",
        community_invalid_input: "invalid_input",
        community_content_violation: "content_violation",
        community_rate_limited: "rate_limited",
      } as const;
      const reason = reasons[error.message as keyof typeof reasons];
      if (error.code === "P0001" && reason)
        throw new CommunityMutationError(reason);
      throw new RepositoryError("Community media operation unavailable");
    }
    return data;
  }
  async execute(
    operation: Parameters<CommunityMediaService["execute"]>[0],
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown> {
    return this.call(this.options.clientFor(accessToken), "community_media", {
      p_operation: operation,
      p_args: args,
    });
  }
  async upload(
    input: Parameters<CommunityMediaService["upload"]>[0],
  ): Promise<unknown> {
    validateCommunityMediaSignature(input.bytes, input.mimeType);
    const digest = crypto
      .createHash("sha256")
      .update(input.bytes)
      .digest("hex");
    const client = this.options.clientFor(input.accessToken);
    const args = {
      operationId: input.operationId,
      altText: input.altText,
      digest,
      rightsConfirmed: true,
    };
    const ticket = (await this.call(client, "community_media_begin", {
      p_args: args,
    })) as {
      id: string;
      imagePath: string;
      thumbnailPath: string;
      uploaded: boolean;
      userId: string;
      generation: number;
    };
    if (ticket.userId !== input.userId)
      throw new CommunityMutationError("access_denied");
    if (!ticket.uploaded) {
      const prepared = await processCommunityMedia(input.bytes, input.mimeType);
      await this.options.storage.put(ticket.imagePath, prepared.image);
      await this.options.storage.put(ticket.thumbnailPath, prepared.thumbnail);
      await this.call(this.options.serviceClient, "community_media_commit", {
        p_id: ticket.id,
        p_user_id: input.userId,
        p_generation: ticket.generation,
        p_digest: prepared.inputDigest,
        p_width: prepared.width,
        p_height: prepared.height,
      });
    }
    return this.execute("get", { id: ticket.id }, input.accessToken);
  }
  async content(
    id: string,
    variant: "image" | "thumbnail",
    accessToken: string,
  ): Promise<Uint8Array> {
    const client = this.options.clientFor(accessToken);
    const authorize = () =>
      this.call(client, "community_media_access", {
        p_id: id,
        p_variant: variant,
      }) as Promise<{ path: string; version: number }>;
    const before = await authorize();
    const bytes = await this.options.storage.get(before.path);
    const after = await authorize();
    if (after.path !== before.path || after.version !== before.version)
      throw new CommunityMutationError("unavailable");
    return bytes;
  }
  async evidence(
    reportId: string,
    variant: "image" | "thumbnail",
    accessToken: string,
  ): Promise<Uint8Array> {
    const client = this.options.clientFor(accessToken);
    const authorize = () =>
      this.call(client, "community_media_evidence_access", {
        p_report_id: reportId,
        p_variant: variant,
      }) as Promise<{ path: string; version: number }>;
    const before = await authorize();
    const bytes = await this.options.storage.get(before.path);
    const after = await authorize();
    if (after.path !== before.path || after.version !== before.version)
      throw new CommunityMutationError("unavailable");
    return bytes;
  }
  /** Durable deletion tickets are acknowledged only after both immutable objects disappear. */
  async cleanup(limit = 50): Promise<number> {
    const tickets = (await this.call(
      this.options.serviceClient,
      "community_media_cleanup",
      { p_operation: "claim", p_args: { limit } },
    )) as { id: string; imagePath: string; thumbnailPath: string }[];
    let completed = 0;
    for (const ticket of tickets) {
      await this.options.storage.remove([
        ticket.imagePath,
        ticket.thumbnailPath,
      ]);
      await this.call(this.options.serviceClient, "community_media_cleanup", {
        p_operation: "ack",
        p_args: { id: ticket.id },
      });
      completed++;
    }
    return completed;
  }
}
