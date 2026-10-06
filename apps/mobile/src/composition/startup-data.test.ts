import { describe, expect, it, vi } from "vitest";
import type { ApiClient, RequestOptions } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
vi.mock(
  "@/features/workouts",
  () => import("../features/workouts/workouts-hub-data"),
);
import { preloadAppData } from "./startup-data";
const session = {
  user: { id: "synthetic-user" },
  accessToken: "synthetic-token",
} as AuthSession;
function client(membership = "withdrawn") {
  const request = vi.fn(async (options: RequestOptions) => {
    if (options.path.startsWith("/v1/runs"))
      return { ok: true, value: { runs: [], nextCursor: null } };
    if (options.path.startsWith("/v1/workouts"))
      return { ok: true, value: { workouts: [] } };
    if (options.path.startsWith("/v1/exercises"))
      return { ok: true, value: { exercises: [] } };
    if (options.path.startsWith("/v1/body-measurements"))
      return { ok: true, value: { bodyMeasurements: [] } };
    if (options.path.startsWith("/v1/food-entries?"))
      return { ok: true, value: { foodEntries: [] } };
    if (options.path === "/v1/community/profile")
      return { ok: true, value: { status: membership } };
    if (options.path === "/v1/coach/status")
      return { ok: true, value: { ready: true } };
    if (options.path === "/v1/coach/conversations")
      return { ok: true, value: { conversations: [{ id: "previous-chat" }] } };
    return { ok: true, value: {} };
  });
  return {
    request,
    status: () => ({ configured: false, reason: "fixture" }),
  } as unknown as ApiClient & { request: typeof request };
}
describe("authenticated startup display preloading", () => {
  it("starts the main-screen and account reads without visiting their routes", async () => {
    const raw = client();
    await preloadAppData(raw, session, () => true, new Date(2026, 9, 3, 12));
    const paths = raw.request.mock.calls.map(([options]) => options.path);
    expect(paths).toContain("/v1/workouts?limit=200");
    expect(paths).toContain("/v1/runs?limit=50");
    expect(
      paths.some((path) => path.startsWith("/v1/runs?limit=50&from=")),
    ).toBe(true);
    expect(paths).toContain("/v1/workouts?kind=routine&limit=200");
    expect(paths).toContain("/v1/exercises?limit=200");
    expect(
      paths.some((path) => path.startsWith("/v1/food-entries?limit=200")),
    ).toBe(true);
    expect(paths).toContain("/v1/body-measurements?limit=200");
    expect(paths).toContain("/v1/coach/conversations");
    expect(paths).toContain("/v1/coach/conversations/previous-chat");
    expect(paths).toContain("/v1/goals/active");
    expect(paths).toContain("/v1/profile");
    for (const [options] of raw.request.mock.calls) {
      expect(options.method).toBe("GET");
      expect(options.expectedUserId).toBe(session.user.id);
      expect(options.isCurrent?.()).toBe(true);
      expect(options.path).not.toContain("/media/");
    }
  });
  it("warms only an eligible active member's initial feed", async () => {
    for (const [birthYear, status, shouldFetch] of [
      [2000, "active", true],
      [2000, "withdrawn", false],
      [2015, "active", false],
    ] as const) {
      const raw = client(status);
      await preloadAppData(
        raw,
        session,
        () => true,
        new Date(2026, 9, 3, 12),
        birthYear,
      );
      expect(
        raw.request.mock.calls.some(
          ([options]) => options.path === "/v1/community/feed?limit=20",
        ),
      ).toBe(shouldFetch);
    }
  });
  it("settles independent sections when one startup read fails", async () => {
    const raw = client();
    raw.request.mockRejectedValueOnce(new Error("synthetic offline"));
    await expect(
      preloadAppData(raw, session, () => true),
    ).resolves.toBeUndefined();
    expect(
      raw.request.mock.calls.some(
        ([options]) => options.path === "/v1/profile",
      ),
    ).toBe(true);
  });
});
