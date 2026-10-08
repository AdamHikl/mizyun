import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  captureRunningRelease,
  createReleaseReadiness,
  registerReleaseReadiness,
} from "./release-readiness.js";

const config = {
  url: "http://dependency.invalid",
  publishableKey: "public-key",
  serviceRoleKey: "secret-never-used",
};
const release = {
  sha: "a".repeat(40),
  instanceId: "frozen-instance",
  startedAt: 1,
};

describe("running release readiness", () => {
  it("freezes actual startup identity across checkout and rejects dirty/unknown source", () => {
    const root = mkdtempSync(join(tmpdir(), "mizyun-release-"));
    const git = (args: string[]) =>
      execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
      }).trim();
    try {
      git(["init"]);
      git(["config", "user.email", "fixture@example.invalid"]);
      git(["config", "user.name", "Fixture"]);
      writeFileSync(join(root, "source"), "first");
      git(["add", "source"]);
      git(["commit", "-m", "first"]);
      const first = captureRunningRelease(root);
      expect(first.sha).toBe(git(["rev-parse", "HEAD"]));
      expect(Object.isFrozen(first)).toBe(true);
      writeFileSync(join(root, "source"), "second");
      expect(captureRunningRelease(root).sha).toBeNull();
      git(["commit", "-am", "second"]);
      const second = captureRunningRelease(root);
      expect(second.sha).not.toBe(first.sha);
      expect(second.instanceId).not.toBe(first.instanceId);
      expect(first.sha).not.toBe(git(["rev-parse", "HEAD"]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(captureRunningRelease("/path/that/does/not/exist").sha).toBeNull();
  });

  it("checks only bounded read-only dependencies, coalesces polling and excludes credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 200 }));
    const read = createReleaseReadiness(release, config, fetcher);
    const [one, two] = await Promise.all([read(), read()]);
    expect(one.ready).toBe(true);
    expect(two).toBe(one);
    await read();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const calls = fetcher.mock.calls;
    expect(calls[0]?.[0]).toBe(
      "http://dependency.invalid/rest/v1/profiles?select=id&limit=0",
    );
    expect(calls[0]?.[1]?.method).toBe("HEAD");
    for (const [, options] of calls) {
      expect(options?.headers).toEqual({ apikey: "public-key" });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options?.redirect).toBe("error");
    }
    expect(JSON.stringify(one)).not.toContain("secret");
    expect(JSON.stringify(one)).not.toContain("dependency.invalid");
  });

  it.each(["database", "auth", "storage"])(
    "fails closed on %s failure without exposing upstream errors",
    async (dependency) => {
      const paths = {
        database: "/rest/",
        auth: "/auth/",
        storage: "/storage/",
      };
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
        if (String(url).includes(paths[dependency as keyof typeof paths]))
          throw new Error("private credentials and path");
        return new Response(null, { status: 200 });
      });
      const snapshot = await createReleaseReadiness(release, config, fetcher)();
      expect(snapshot.ready).toBe(false);
      expect(
        snapshot.dependencies[dependency as keyof typeof snapshot.dependencies],
      ).toBe(false);
      expect(JSON.stringify(snapshot)).not.toContain("private");
    },
  );

  it("bounds stalled dependency probes by their abort deadline", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("timeout")),
            { once: true },
          );
        }),
    );
    const snapshot = await createReleaseReadiness(release, config, fetcher)();
    expect(snapshot.ready).toBe(false);
    expect(snapshot.dependencies).toEqual({
      database: false,
      auth: false,
      storage: false,
    });
  });

  it("rejects HTTP failure, missing persistence and unknown source identity", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 401 }));
    expect(
      (await createReleaseReadiness(release, config, fetcher)()).ready,
    ).toBe(false);
    fetcher.mockClear();
    expect((await createReleaseReadiness(release, null, fetcher)()).ready).toBe(
      false,
    );
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockImplementation(async () => new Response(null, { status: 200 }));
    expect(
      (
        await createReleaseReadiness(
          { ...release, sha: null },
          config,
          fetcher,
        )()
      ).ready,
    ).toBe(false);
  });

  it("serves generic 503/no-store for an unavailable dependency and 200 for readiness", async () => {
    const app = Fastify();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 200 }));
    const read = createReleaseReadiness(release, config, fetcher);
    registerReleaseReadiness(app, read);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/readiness",
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().release.sha).toBe(release.sha);
    } finally {
      await app.close();
    }
    const unavailable = Fastify();
    registerReleaseReadiness(
      unavailable,
      createReleaseReadiness(release, null, fetcher),
    );
    try {
      expect(
        (await unavailable.inject({ method: "GET", url: "/v1/readiness" }))
          .statusCode,
      ).toBe(503);
    } finally {
      await unavailable.close();
    }
  });
});
