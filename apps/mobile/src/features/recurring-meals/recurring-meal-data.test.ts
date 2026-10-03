import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, RequestOptions } from "@mizyun/api-client";
const mocks = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("@/composition/api-client", () => ({
  apiClient: {},
  invalidateSessionReads: mocks.invalidate,
}));
import {
  createSchedule,
  isAutomaticallyLogged,
  loadSchedules,
  scheduleDate,
  skipSchedule,
  stopSchedule,
  updateSchedule,
} from "./recurring-meal-data";
const id = "00000000-0000-4000-8000-000000000001";
const sourceEntryId = "00000000-0000-4000-8000-000000000002";
const lifetime = { expectedUserId: "user-a", isCurrent: () => true };
const input = {
  id,
  sourceEntryId,
  localTime: "10:00",
  timeZone: "Europe/Bratislava",
  weekdays: [1, 2, 3, 4, 5],
};
const requests: RequestOptions[] = [];
const client: ApiClient = {
  status: () => ({ configured: true, baseUrl: "https://example.test" }),
  request: async <T>(options: RequestOptions) => {
    requests.push(options);
    return { ok: true, value: {} as T };
  },
};
beforeEach(() => {
  requests.length = 0;
  mocks.invalidate.mockReset();
});
describe("recurring meal transport", () => {
  it("rejects invalid schedules before making any request", async () => {
    for (const invalid of [
      { localTime: "24:00" },
      { timeZone: "Mars/Nowhere" },
      { weekdays: [] },
    ]) {
      expect(
        (await createSchedule({ ...input, ...invalid }, lifetime, client)).ok,
      ).toBe(false);
    }
    expect(requests).toEqual([]);
  });
  it("retains stable operation identity after an ambiguous response and invalidates stale meal reads", async () => {
    let attempts = 0;
    const flaky: ApiClient = {
      ...client,
      request: async <T>(options: RequestOptions) => {
        requests.push(options);
        return ++attempts === 1
          ? {
              ok: false,
              error: { kind: "network_error", cause: "lost response" },
            }
          : { ok: true, value: {} as T };
      },
    };
    expect((await createSchedule(input, lifetime, flaky)).ok).toBe(false);
    expect((await createSchedule(input, lifetime, flaky)).ok).toBe(true);
    expect(
      requests.map((request) => (request.body as typeof input).id),
    ).toEqual([id, id]);
    expect(requests[0]).toMatchObject(lifetime);
    expect(mocks.invalidate).toHaveBeenCalledTimes(4);
  });
  it("sends pause, skip and stop with the caller's account lifetime", async () => {
    await updateSchedule(id, { enabled: false }, lifetime, client);
    await skipSchedule(id, "2026-10-03", lifetime, client);
    await stopSchedule(id, lifetime, client);
    expect(requests.map(({ method, body }) => ({ method, body }))).toEqual([
      { method: "PATCH", body: { enabled: false } },
      { method: "POST", body: { localDate: "2026-10-03" } },
      { method: "DELETE", body: undefined },
    ]);
    expect(
      requests.every(
        (request) =>
          request.expectedUserId === "user-a" &&
          request.isCurrent === lifetime.isCurrent,
      ),
    ).toBe(true);
    expect(mocks.invalidate).toHaveBeenCalledTimes(6);
  });
  it("uses live management reads and the schedule's local day", async () => {
    await loadSchedules(lifetime, {
      ...client,
      request: async <T>(options: RequestOptions) => {
        requests.push(options);
        return { ok: true, value: { recurringMeals: [] } as T };
      },
    });
    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "/v1/recurring-meals",
      expectedUserId: "user-a",
    });
    expect(
      scheduleDate("America/Los_Angeles", new Date("2026-10-03T01:00:00Z")),
    ).toBe("2026-10-02");
    expect(
      scheduleDate("Europe/Bratislava", new Date("2026-10-03T01:00:00Z")),
    ).toBe("2026-10-03");
  });
  it("marks only entries containing the automatic occurrence marker", () => {
    expect(
      isAutomaticallyLogged({
        recurringMeal: {
          scheduleId: id,
          localDate: "2026-10-03",
          timeZone: "UTC",
        },
      }),
    ).toBe(true);
    expect(isAutomaticallyLogged({})).toBe(false);
    expect(isAutomaticallyLogged({ recurringMeal: "bad" })).toBe(false);
  });
});

it.each([
  [422, true],
  [409, true],
  [503, false],
])(
  "classifies HTTP %s without discarding ambiguous outcomes",
  async (status, definitiveRejected) => {
    const rejected: ApiClient = {
      ...client,
      request: async () => ({
        ok: false,
        error: {
          kind: "http_error",
          status: status as number,
          code: "VALIDATION_ERROR",
          message: "Synthetic rejection",
        },
      }),
    };
    expect(await createSchedule(input, lifetime, rejected)).toMatchObject({
      ok: false,
      definitiveRejected,
    });
  },
);
