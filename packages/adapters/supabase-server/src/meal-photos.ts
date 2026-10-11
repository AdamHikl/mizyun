import crypto from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import {
  MealPhotoError,
  type MealPhoto,
  type MealPhotoService,
  type UserId,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

export async function processMealPhoto(
  bytes: Uint8Array,
  width: number,
  height: number,
) {
  if (bytes.length === 0 || bytes.length > 256 * 1024)
    throw new MealPhotoError("invalid_input");
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: 640 * 640,
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== "jpeg" ||
      metadata.width !== width ||
      metadata.height !== height ||
      width > 640 ||
      height > 640 ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error("Invalid dimensions");
    const result = await image
      .timeout({ seconds: 10 })
      .rotate()
      .jpeg({ quality: 75 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > 256 * 1024) throw new Error("Output too large");
    return {
      bytes: result.data,
      width: result.info.width,
      height: result.info.height,
      digest: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    throw new MealPhotoError("invalid_input");
  }
}
interface PhotoRow extends Record<string, unknown>, MealPhoto {
  readonly state: string;
  readonly objectPath: string;
}
interface CleanupRow extends Record<string, unknown> {
  readonly object_path: string;
}
export interface MealPhotoStorage {
  upload(path: string, bytes: Uint8Array): Promise<void>;
  sign(
    path: string,
    accessToken: string,
  ): Promise<{ signedUrl: string; expiresAt: string }>;
  remove(path: string): Promise<void>;
}
export function createMealPhotoStorage(config: {
  url: string;
  publishableKey: string;
  serviceRoleKey: string;
  publicUrl?: string;
}): MealPhotoStorage {
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
    },
  };
  const service = createClient(
    config.url,
    config.serviceRoleKey,
    options,
  ).storage.from("private-media");
  return {
    async upload(path, bytes) {
      const { error } = await service.upload(path, bytes, {
        upsert: false,
        contentType: "image/jpeg",
        cacheControl: "0",
      });
      if (error && String(error.statusCode) !== "409")
        throw new RepositoryError(error.message);
    },
    async remove(path) {
      const { error } = await service.remove([path]);
      if (error && String(error.statusCode) !== "404")
        throw new RepositoryError(error.message);
    },
    async sign(path, accessToken) {
      const client = createClient(config.url, config.publishableKey, {
        ...options,
        global: {
          ...options.global,
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      });
      const { data, error } = await client.storage
        .from("private-media")
        .createSignedUrl(path, 300);
      if (error || !data)
        throw new RepositoryError(error?.message ?? "No download URL");
      const url = new URL(data.signedUrl);
      if (config.publicUrl) {
        const origin = new URL(config.publicUrl);
        url.protocol = origin.protocol;
        url.hostname = origin.hostname;
        url.port = origin.port;
      }
      return {
        signedUrl: url.toString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
    },
  };
}
export class SupabaseMealPhotoService implements MealPhotoService {
  constructor(
    readonly options: {
      clientFor: (token: string) => RepositorySupabaseClient;
      serviceClient: RepositorySupabaseClient;
      storage: MealPhotoStorage;
    },
  ) {}
  async #call(
    token: string,
    operation: string,
    args: Record<string, unknown>,
    userId?: UserId,
  ): Promise<PhotoRow | null> {
    const { data, error } = await (
      operation === "get"
        ? this.options.clientFor(token)
        : this.options.serviceClient
    ).rpc<PhotoRow>("meal_photo", {
      p_operation: operation,
      p_args: args,
      p_user_id: userId ?? null,
    });
    if (error) {
      for (const kind of [
        "invalid_input",
        "not_found",
        "conflict",
        "unavailable",
      ] as const)
        if (error.message.includes(`meal_photo_${kind}`))
          throw new MealPhotoError(kind);
      throw new RepositoryError(error.message);
    }
    return data as unknown as PhotoRow | null;
  }
  async save(input: {
    mealId: string;
    userId: UserId;
    accessToken: string;
    clientOperationId: string;
    bytes: Uint8Array;
    width: number;
    height: number;
  }): Promise<MealPhoto> {
    const image = await processMealPhoto(
      input.bytes,
      input.width,
      input.height,
    );
    const row = await this.#call(
      input.accessToken,
      "begin",
      {
        mealId: input.mealId,
        operationId: input.clientOperationId,
        digest: image.digest,
        width: image.width,
        height: image.height,
        byteSize: image.bytes.length,
      },
      input.userId,
    );
    if (!row) throw new MealPhotoError("unavailable");
    if (row.state !== "ready") {
      await this.options.storage.upload(row.objectPath, image.bytes);
      try {
        await this.#call(
          input.accessToken,
          "commit",
          { mealId: input.mealId, assetId: row.assetId },
          input.userId,
        );
      } catch (error) {
        // Revoked/dropped meals cannot regain bytes after an in-flight upload.
        if (
          error instanceof MealPhotoError &&
          (error.kind === "not_found" ||
            error.kind === "conflict" ||
            error.kind === "unavailable")
        )
          await this.options.storage.remove(row.objectPath);
        throw error;
      }
    }
    return { assetId: row.assetId, width: row.width, height: row.height };
  }
  async get(mealId: string, options: { userId: UserId; accessToken: string }) {
    const row = await this.#call(options.accessToken, "get", { mealId });
    if (!row) return null;
    const signed = await this.options.storage.sign(
      row.objectPath,
      options.accessToken,
    );
    return {
      assetId: row.assetId,
      width: row.width,
      height: row.height,
      ...signed,
    };
  }
  async remove(
    mealId: string,
    options: { userId: UserId; accessToken: string },
  ) {
    await this.#call(options.accessToken, "remove", { mealId }, options.userId);
    // Revocation commits before best-effort byte deletion; durable jobs retry failures.
    try {
      await this.cleanup(options.userId);
    } catch {
      /* worker retains retry authority */
    }
  }
  async cleanup(userId?: UserId) {
    const { error: pendingError } = await this.options.serviceClient.rpc(
      "meal_photo_cleanup_pending",
      {},
    );
    if (pendingError) throw new RepositoryError(pendingError.message);
    let jobs = this.options.serviceClient
      .from<CleanupRow>("meal_photo_cleanup_jobs")
      .select("object_path");
    if (userId !== undefined) jobs = jobs.eq("user_id", userId);
    const { data, error } = await jobs
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw new RepositoryError(error.message);
    let failed = false;
    for (const job of data ?? []) {
      try {
        await this.options.storage.remove(job.object_path);
        const { error: deleteError } = await this.options.serviceClient
          .from<CleanupRow>("meal_photo_cleanup_jobs")
          .delete()
          .eq("object_path", job.object_path);
        if (deleteError) throw new RepositoryError(deleteError.message);
      } catch {
        failed = true;
      }
    }
    if (failed)
      throw new RepositoryError(
        "Meal photo cleanup incomplete; durable jobs retained.",
      );
  }
}
