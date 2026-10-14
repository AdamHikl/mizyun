import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  communityFeedResponseSchema,
  communityProfileDtoSchema,
} from "@mizyun/contracts";
import { CommunityReadCache, setCommunityReadPrincipal } from "./read-cache";
import {
  clearCommunityDisplaySnapshot,
  readCommunityDisplaySnapshot,
  subscribeCommunityDisplaySnapshot,
} from "./display-snapshot";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000004";
const profile = (userId: string, status = "active") => ({
  userId,
  handle: "synthetic_viewer",
  displayName: "Synthetic Viewer",
  avatarSymbol: "SV",
  bio: null,
  isSearchable: false,
  status,
  generation: 1,
  createdAt: "2026-10-01T08:00:00Z",
  updatedAt: "2026-10-01T08:00:00Z",
});
const item = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  authorUserId: "00000000-0000-4000-8000-000000000003",
  authorHandle: "synthetic_friend",
  authorDisplayName: "Synthetic Friend",
  authorAvatarSymbol: "SF",
  category: "running",
  sharedDay: "2026-10-12",
  durationSeconds: 1800,
  workoutDetails: null,
  activityKind: "workout",
  mealDetails: null,
  publishedAt: "2026-10-12T07:00:00Z",
  reactionCounts: {},
  viewerReaction: null,
});

let raw: ReturnType<typeof vi.fn>;
let cache: CommunityReadCache;
let token = "token-a";
let user = A;

const profileRead = (expectedUserId = user) =>
  cache.request({
    method: "GET",
    path: "/v1/community/profile",
    schema: communityProfileDtoSchema,
    expectedUserId,
  });
const feedRead = (expectedUserId = user) =>
  cache.request({
    method: "GET",
    path: "/v1/community/feed?limit=20",
    schema: communityFeedResponseSchema,
    expectedUserId,
  });

async function warm(items = [item(2)]) {
  raw.mockResolvedValueOnce({ ok: true, value: profile(user) });
  raw.mockResolvedValueOnce({ ok: true, value: { items, nextCursor: null } });
  await profileRead();
  await feedRead();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T08:00:00Z"));
  clearCommunityDisplaySnapshot();
  token = "token-a";
  user = A;
  raw = vi.fn();
  cache = new CommunityReadCache(
    { request: raw, status: () => ({ configured: true }) } as any,
    async () => ({ user: { id: user }, accessToken: token }) as any,
  );
  cache.setPrincipal(A, token);
  cache.setForeground(true);
});
afterEach(() => {
  cache.dispose();
  vi.useRealTimers();
});

describe("Community display snapshot", () => {
  it("records the authorized first page and outlives authority expiry, backgrounding, invalidation and token rotation", async () => {
    const listener = vi.fn();
    const stop = subscribeCommunityDisplaySnapshot(listener);
    await warm();
    stop();
    expect(listener).toHaveBeenCalled();
    expect(readCommunityDisplaySnapshot(A, 1990)?.items).toEqual([item(2)]);
    vi.advanceTimersByTime(60_000);
    cache.setForeground(false);
    cache.clear();
    token = "token-rotated";
    setCommunityReadPrincipal(A, token);
    expect(readCommunityDisplaySnapshot(A, 1990)?.items).toEqual([item(2)]);
  });

  it("is only readable by the same adult-eligible user", async () => {
    await warm();
    expect(readCommunityDisplaySnapshot(B, 1990)).toBeUndefined();
    expect(readCommunityDisplaySnapshot(null, 1990)).toBeUndefined();
    expect(readCommunityDisplaySnapshot(A, null)).toBeUndefined();
    expect(readCommunityDisplaySnapshot(A, 2015)).toBeUndefined();
  });

  it.each([B, null])("clears on a principal change to %s", async (next) => {
    await warm();
    setCommunityReadPrincipal(next, next ? "token-b" : null);
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeUndefined();
  });

  it("needs both an active membership and a first page", async () => {
    raw.mockResolvedValueOnce({ ok: true, value: profile(A) });
    await profileRead();
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeUndefined();
    raw.mockResolvedValueOnce({
      ok: true,
      value: { items: [item(2)], nextCursor: null },
    });
    await cache.request({
      method: "GET",
      path: "/v1/community/feed?limit=20&cursor=abc",
      schema: communityFeedResponseSchema,
      expectedUserId: A,
    });
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeUndefined();
  });

  it("never records a read for another expected user and retires on the mismatch", async () => {
    await warm();
    raw.mockResolvedValueOnce({ ok: true, value: profile(B) });
    await profileRead(B);
    expect(readCommunityDisplaySnapshot(B, 1990)).toBeUndefined();
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeUndefined();
  });

  it.each([
    ["withdrawn membership", { ok: true, value: profile(A, "withdrawn") }],
    [
      "not enrolled",
      {
        ok: false,
        error: {
          kind: "http_error",
          status: 404,
          code: "COMMUNITY_NOT_ENROLLED",
          message: "No",
        },
      },
    ],
    [
      "403",
      {
        ok: false,
        error: {
          kind: "http_error",
          status: 403,
          code: "FORBIDDEN",
          message: "No",
        },
      },
    ],
    [
      "401",
      {
        ok: false,
        error: {
          kind: "http_error",
          status: 401,
          code: "INVALID_ACCESS_TOKEN",
          message: "No",
        },
      },
    ],
    ["no_session", { ok: false, error: { kind: "no_session" } }],
  ])("clears when membership revalidation returns %s", async (_, outcome) => {
    await warm();
    vi.advanceTimersByTime(10_001);
    raw.mockResolvedValueOnce(outcome);
    await profileRead();
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeUndefined();
  });

  it("clears on a blocked error from any Community read", async () => {
    await warm();
    raw.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "http_error",
        status: 403,
        code: "COMMUNITY_BLOCKED",
        message: "No",
      },
    });
    await cache.request({
      method: "GET",
      path: `/v1/community/profiles/${B}`,
      schema: communityProfileDtoSchema,
      expectedUserId: A,
    });
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeUndefined();
  });

  it.each([
    ["network", { ok: false, error: { kind: "network_error", cause: "x" } }],
    [
      "502",
      {
        ok: false,
        error: {
          kind: "http_error",
          status: 502,
          code: "BAD_GATEWAY",
          message: "Later",
        },
      },
    ],
    [
      "429",
      {
        ok: false,
        error: {
          kind: "http_error",
          status: 429,
          code: "RATE_LIMITED",
          message: "Later",
        },
      },
    ],
  ])("keeps the snapshot after a %s failure", async (_, outcome) => {
    await warm();
    vi.advanceTimersByTime(10_001);
    raw.mockResolvedValueOnce(outcome);
    raw.mockResolvedValueOnce(outcome);
    await profileRead();
    await feedRead();
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeDefined();
  });

  it("hides the snapshot when the Community kill switch answers the feed with 503", async () => {
    await warm();
    vi.advanceTimersByTime(10_001);
    raw.mockResolvedValueOnce({ ok: true, value: profile(A) });
    raw.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "http_error",
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "Community is unavailable",
      },
    });
    await profileRead();
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeDefined();
    await feedRead();
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeUndefined();
  });

  it.each([
    ["POST", "/v1/community/reactions", true],
    ["POST", "/v1/community/blocks", true],
    ["DELETE", "/v1/community/profile", true],
    ["DELETE", "/v1/account", true],
    ["POST", "/v1/account/delete/request", true],
    ["POST", "/v1/meals", false],
  ])(
    "%s %s retires the snapshot even when the write fails: %s",
    async (method, path, clears) => {
      await warm();
      raw.mockResolvedValueOnce({
        ok: false,
        error: { kind: "network_error", cause: "lost" },
      });
      await cache.request({ method: method as any, path, body: {} });
      expect(readCommunityDisplaySnapshot(A, 1990) === undefined).toBe(clears);
    },
  );

  it("does not record a read that overlapped a Community write", async () => {
    let resolveFeed!: (value: unknown) => void;
    raw.mockResolvedValueOnce({ ok: true, value: profile(A) });
    await profileRead();
    raw.mockReturnValueOnce(new Promise((resolve) => (resolveFeed = resolve)));
    const pendingFeed = feedRead();
    await Promise.resolve();
    await Promise.resolve();
    raw.mockResolvedValueOnce({ ok: true, value: {} });
    await cache.request({
      method: "POST",
      path: "/v1/community/blocks",
      body: {},
    });
    resolveFeed({ ok: true, value: { items: [item(2)], nextCursor: null } });
    await pendingFeed;
    expect(readCommunityDisplaySnapshot(A, 1990)).toBeUndefined();
  });

  it("bounds the stored page", async () => {
    await warm(Array.from({ length: 25 }, (_, i) => item(i + 10)));
    expect(readCommunityDisplaySnapshot(A, 1990)?.items).toHaveLength(20);
  });
});
