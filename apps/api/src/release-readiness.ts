import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ServerSupabaseConfiguration } from "@mizyun/config";
import type { FastifyInstance } from "fastify";

export interface RunningRelease {
  readonly sha: string | null;
  readonly instanceId: string;
  readonly startedAt: number;
}

// Capture once: a checkout cannot relabel an old process. Requested SHA is
// operator intent, never evidence of the code loaded by this process.
export const captureRunningRelease = (
  root = fileURLToPath(new URL("../../../", import.meta.url)),
): RunningRelease => {
  let sha: string | null = null;
  try {
    root = realpathSync(root);
    const git = (args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "core.fsmonitor=false",
          "-c",
          `safe.directory=${root}`,
          "-C",
          root,
          ...args,
        ],
        {
          encoding: "utf8",
          timeout: 2_000,
          maxBuffer: 64 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
    const head = git(["rev-parse", "HEAD"]);
    if (
      /^[0-9a-f]{40}$/.test(head) &&
      git(["status", "--porcelain"]) === "" &&
      git(["rev-parse", "HEAD"]) === head
    ) {
      sha = head;
    }
  } catch {
    // Unreadable metadata or dirty/unknown source cannot attest a release.
  }
  return Object.freeze({
    sha,
    instanceId: randomUUID(),
    startedAt: Date.now(),
  });
};

export interface ReadinessSnapshot {
  readonly version: 1;
  readonly ready: boolean;
  readonly release: RunningRelease;
  readonly dependencies: {
    readonly database: boolean;
    readonly auth: boolean;
    readonly storage: boolean;
  };
}

export const createReleaseReadiness = (
  release: RunningRelease,
  config: ServerSupabaseConfiguration | null,
  fetcher: typeof fetch = fetch,
): (() => Promise<ReadinessSnapshot>) => {
  let pending: Promise<ReadinessSnapshot> | undefined;
  let cached: ReadinessSnapshot | undefined;
  let cachedAt = 0;
  const probe = async (path: string): Promise<boolean> => {
    if (!config) return false;
    try {
      const response = await fetcher(
        `${config.url.replace(/\/$/, "")}${path}`,
        {
          // Zero-row HEAD checks database/schema without enumerating users.
          method: path.startsWith("/rest/") ? "HEAD" : "GET",
          headers: { apikey: config.publishableKey },
          signal: AbortSignal.timeout(2_000),
          redirect: "error",
        },
      );
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  };
  return () => {
    if (cached && Date.now() - cachedAt < 2_000) return Promise.resolve(cached);
    // Public polling shares one bounded set of read-only dependency probes.
    pending ??= Promise.all([
      probe("/rest/v1/profiles?select=id&limit=0"),
      probe("/auth/v1/health"),
      probe("/storage/v1/status"),
    ]).then(([database, auth, storage]) => {
      const snapshot: ReadinessSnapshot = {
        version: 1,
        ready: release.sha !== null && database && auth && storage,
        release,
        dependencies: { database, auth, storage },
      };
      cached = snapshot;
      cachedAt = Date.now();
      pending = undefined;
      return snapshot;
    });
    return pending;
  };
};

export const registerReleaseReadiness = (
  app: FastifyInstance,
  read: () => Promise<ReadinessSnapshot>,
): void => {
  app.get("/v1/readiness", async (_request, reply) => {
    const snapshot = await read();
    return reply
      .header("cache-control", "no-store")
      .code(snapshot.ready ? 200 : 503)
      .send(snapshot);
  });
};
