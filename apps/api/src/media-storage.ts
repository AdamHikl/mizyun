import type { UserId } from "@mizyun/core";

/**
 * Minimal media-storage abstraction used by MEDIA-001.
 *
 * The in-memory implementation backs the local dev environment
 * with a Map keyed by `<bucketId>/<objectPath>`. The Supabase
 * adapter implements the same interface against the storage
 * SDK. The route layer treats the abstraction as opaque — it
 * never reads bytes, only issues URLs.
 *
 * Why an interface and not a direct Supabase SDK call: the route
 * layer should be SDK-agnostic so a swap to a different storage
 * provider (or a local file-system fallback) is a one-line
 * change in the composition root.
 */
export interface MediaStorage {
  /** Issue a short-lived signed URL the client can PUT bytes to. */
  signUploadUrl(
    bucketId: string,
    objectPath: string,
    options: {
      readonly ttlSeconds: number;
      readonly now: Date;
      readonly accessToken: string;
    },
  ): Promise<{ readonly url: string; readonly expiresAt: Date }>;
  /** Issue a short-lived signed URL the client can GET bytes from. */
  signDownloadUrl(
    bucketId: string,
    objectPath: string,
    options: {
      readonly ttlSeconds: number;
      readonly now: Date;
      readonly accessToken: string;
    },
  ): Promise<{ readonly url: string; readonly expiresAt: Date }>;
  /**
   * Remove the underlying object. Idempotent: missing objects
   * return without error. Production implementations should also
   * revoke any outstanding signed URLs whose path matches.
   */
  remove(
    bucketId: string,
    objectPath: string,
    options: { readonly accessToken: string },
  ): Promise<void>;
}

interface UploadTicket {
  readonly bucketId: string;
  readonly objectPath: string;
  readonly userId: UserId;
  readonly expiresAtMs: number;
}

interface DownloadTicket {
  readonly bucketId: string;
  readonly objectPath: string;
  readonly userId: UserId;
  readonly expiresAtMs: number;
}

/**
 * In-memory implementation. Stores bytes keyed by
 * `<bucketId>/<objectPath>`; signed URLs embed a ticket token
 * the test (or future client SDK) can exchange for the bytes.
 * Production swaps this for a Supabase storage SDK adapter.
 */
export class InMemoryMediaStorage implements MediaStorage {
  readonly #bytes = new Map<string, Uint8Array>();
  readonly #uploadTickets = new Map<string, UploadTicket>();
  readonly #downloadTickets = new Map<string, DownloadTicket>();
  readonly #ttlSeconds: number;

  constructor(options: { readonly defaultTtlSeconds?: number } = {}) {
    this.#ttlSeconds = options.defaultTtlSeconds ?? 5 * 60;
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
    const ttl = options.ttlSeconds > 0 ? options.ttlSeconds : this.#ttlSeconds;
    const expiresAt = new Date(options.now.getTime() + ttl * 1000);
    const ticketId = crypto.randomUUID();
    const userId = extractUserIdFromObjectPath(objectPath);
    this.#uploadTickets.set(ticketId, {
      bucketId,
      objectPath,
      userId,
      expiresAtMs: expiresAt.getTime(),
    });
    return {
      url: `mem://upload/${ticketId}`,
      expiresAt,
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
    const ttl = options.ttlSeconds > 0 ? options.ttlSeconds : this.#ttlSeconds;
    const expiresAt = new Date(options.now.getTime() + ttl * 1000);
    const ticketId = crypto.randomUUID();
    const userId = extractUserIdFromObjectPath(objectPath);
    this.#downloadTickets.set(ticketId, {
      bucketId,
      objectPath,
      userId,
      expiresAtMs: expiresAt.getTime(),
    });
    return {
      url: `mem://download/${ticketId}`,
      expiresAt,
    };
  }

  async remove(
    bucketId: string,
    objectPath: string,
    _options: { readonly accessToken: string },
  ): Promise<void> {
    this.#bytes.delete(`${bucketId}/${objectPath}`);
    // Revoke any outstanding tickets whose path matches.
    for (const [id, t] of this.#uploadTickets) {
      if (t.bucketId === bucketId && t.objectPath === objectPath) {
        this.#uploadTickets.delete(id);
      }
    }
    for (const [id, t] of this.#downloadTickets) {
      if (t.bucketId === bucketId && t.objectPath === objectPath) {
        this.#downloadTickets.delete(id);
      }
    }
  }

  /**
   * Test-only helper: PUT bytes for a ticket the route issued.
   * Returns the canonical key the bytes were stored under so
   * tests can re-sign and re-download.
   */
  __putFromUploadTicket(
    ticketId: string,
    bytes: Uint8Array,
  ): { readonly bucketId: string; readonly objectPath: string } {
    const ticket = this.#uploadTickets.get(ticketId);
    if (ticket === undefined) {
      throw new Error(`upload ticket ${ticketId} not found`);
    }
    if (ticket.expiresAtMs < Date.now()) {
      throw new Error(`upload ticket ${ticketId} expired`);
    }
    this.#bytes.set(`${ticket.bucketId}/${ticket.objectPath}`, bytes);
    return { bucketId: ticket.bucketId, objectPath: ticket.objectPath };
  }

  /**
   * Test-only helper: exchange a download ticket for the bytes.
   */
  __exchangeDownloadTicket(ticketId: string): {
    readonly bucketId: string;
    readonly objectPath: string;
    readonly bytes: Uint8Array;
  } {
    const ticket = this.#downloadTickets.get(ticketId);
    if (ticket === undefined) {
      throw new Error(`download ticket ${ticketId} not found`);
    }
    if (ticket.expiresAtMs < Date.now()) {
      throw new Error(`download ticket ${ticketId} expired`);
    }
    const bytes = this.#bytes.get(`${ticket.bucketId}/${ticket.objectPath}`);
    if (bytes === undefined) {
      throw new Error(`no bytes for ${ticket.bucketId}/${ticket.objectPath}`);
    }
    return {
      bucketId: ticket.bucketId,
      objectPath: ticket.objectPath,
      bytes,
    };
  }

  /** Test-only helper: read the raw bytes for a given object. */
  __raw(bucketId: string, objectPath: string): Uint8Array | undefined {
    return this.#bytes.get(`${bucketId}/${objectPath}`);
  }
}

/**
 * Extract a user id from the conventional `<userId>/<id>.<ext>`
 * private-media path layout. Throws when the path is malformed so
 * a wrong-shape upload URL never makes it past the route.
 */
const extractUserIdFromObjectPath = (objectPath: string): UserId => {
  const firstSlash = objectPath.indexOf("/");
  if (firstSlash < 0) {
    throw new Error(`object path ${objectPath} is not a user-scoped path`);
  }
  const userId = objectPath.slice(0, firstSlash);
  return userId as UserId;
};
