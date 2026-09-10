import { createClient } from "@supabase/supabase-js";

export interface StorageOperationError {
  readonly message: string;
  readonly statusCode?: string | number;
}

export interface StorageBucketClient {
  createSignedUploadUrl(
    path: string,
    options?: { readonly upsert: boolean },
  ): Promise<{
    readonly data: { readonly signedUrl: string } | null;
    readonly error: StorageOperationError | null;
  }>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{
    readonly data: { readonly signedUrl: string } | null;
    readonly error: StorageOperationError | null;
  }>;
  remove(paths: ReadonlyArray<string>): Promise<{
    readonly data: ReadonlyArray<unknown> | null;
    readonly error: StorageOperationError | null;
  }>;
}

export interface StorageSupabaseClient {
  readonly storage: {
    from(bucketId: string): StorageBucketClient;
  };
}

export interface SupabaseMediaStorageOptions {
  readonly clientFor: (accessToken: string) => StorageSupabaseClient;
  readonly publicUrl?: string;
}

export class MediaStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

const SUPABASE_SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

export class SupabaseMediaStorage {
  readonly #clientFor: (accessToken: string) => StorageSupabaseClient;
  readonly #publicUrl: string | undefined;

  constructor(options: SupabaseMediaStorageOptions) {
    this.#clientFor = options.clientFor;
    this.#publicUrl = options.publicUrl;
  }

  #resolvePublicUrl(signedUrl: string): string {
    if (!this.#publicUrl) return signedUrl;
    try {
      const parsed = new URL(signedUrl);
      const publicOrigin = new URL(this.#publicUrl);
      parsed.protocol = publicOrigin.protocol;
      parsed.hostname = publicOrigin.hostname;
      parsed.port = publicOrigin.port;
      return parsed.toString();
    } catch {
      return signedUrl;
    }
  }

  async signUploadUrl(
    bucketId: string,
    objectPath: string,
    options: {
      readonly ttlSeconds: number;
      readonly now: Date;
      readonly accessToken: string;
    },
  ): Promise<{ readonly url: string; readonly expiresAt: Date }> {
    const { data, error } = await this.#clientFor(options.accessToken)
      .storage.from(bucketId)
      .createSignedUploadUrl(objectPath, { upsert: false });
    if (error || data === null) {
      throw new MediaStorageError(
        error?.message ?? "signed upload URL returned no data",
      );
    }
    return {
      url: this.#resolvePublicUrl(data.signedUrl),
      // Supabase fixes signed upload tickets at two hours; unlike signed
      // downloads, the JavaScript API does not accept a caller TTL.
      expiresAt: new Date(
        options.now.getTime() + SUPABASE_SIGNED_UPLOAD_TTL_SECONDS * 1000,
      ),
    };
  }

  async signDownloadUrl(
    bucketId: string,
    objectPath: string,
    options: {
      readonly ttlSeconds: number;
      readonly now: Date;
      readonly accessToken: string;
    },
  ): Promise<{ readonly url: string; readonly expiresAt: Date }> {
    const { data, error } = await this.#clientFor(options.accessToken)
      .storage.from(bucketId)
      .createSignedUrl(objectPath, options.ttlSeconds);
    if (error || data === null) {
      throw new MediaStorageError(
        error?.message ?? "signed download URL returned no data",
      );
    }
    return {
      url: this.#resolvePublicUrl(data.signedUrl),
      expiresAt: new Date(options.now.getTime() + options.ttlSeconds * 1000),
    };
  }

  async remove(
    bucketId: string,
    objectPath: string,
    options: { readonly accessToken: string },
  ): Promise<void> {
    const { error } = await this.#clientFor(options.accessToken)
      .storage.from(bucketId)
      .remove([objectPath]);
    if (error && error.statusCode !== 404 && error.statusCode !== "404") {
      throw new MediaStorageError(error.message);
    }
  }
}

export interface SupabaseStorageConfiguration {
  readonly url: string;
  readonly publishableKey: string;
}

export const createSupabaseStorageClient = (
  configuration: SupabaseStorageConfiguration,
  accessToken: string,
): StorageSupabaseClient => {
  if (!accessToken) {
    throw new Error(
      "createSupabaseStorageClient requires a non-empty access token",
    );
  }
  return createClient(configuration.url, configuration.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  }) as unknown as StorageSupabaseClient;
};
