import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentGroundingItem,
  type AgentProvider,
} from "@mizyun/agent-runtime";
import { DEFAULT_TIMEZONE, type UserId } from "@mizyun/core";
import { DEVICE_TIME_ZONE_HEADER } from "@mizyun/contracts";
import type { AccessTokenVerifier } from "@mizyun/identity";

import { buildApp } from "./app.js";
import { InMemoryBodyMeasurementRepository } from "./body-measurement-repository.js";
import { InMemoryFoodEntryRepository } from "./food-entry-repository.js";
import { InMemoryGoalRepository } from "./goal-repository.js";
import { buildCoachToolRegistry } from "./modules/coach/tools.js";
import { InMemoryProfileRepository } from "./profile-repository.js";
import {
  requestTimeZone,
  runWithRequestTimeZone,
  withRequestTimeZone,
} from "./request-time-zone.js";
import { InMemoryWorkoutRepository } from "./workout-repository.js";
import { InMemoryWorkoutSetRepository } from "./workout-set-repository.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const auth = { authorization: "Bearer valid" };
const tokenVerifier: AccessTokenVerifier = {
  verify: async (token) =>
    token === "valid" ? { userId, accessToken: "test-access-token" } : null,
};
// 23:30 on 9 September in Los Angeles (UTC-7); already 10 September in UTC.
const NOW = new Date("2026-09-10T06:30:00.000Z");
const LOS_ANGELES = "America/Los_Angeles";
const apps: ReturnType<typeof buildApp>[] = [];
const TOOL_LABEL = "Confirmed nutrition in the window";

// The app's Coach tools read the orchestrator's system clock.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const setup = async (storedTimeZone: string = DEFAULT_TIMEZONE) => {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: storedTimeZone,
    defaultUnitSystem: "metric",
    defaultBirthYear: 1990,
    clock: { now: () => NOW },
  });
  const foodEntryRepository = new InMemoryFoodEntryRepository();
  const base = {
    userId,
    proteinG: 10,
    carbohydrateG: 20,
    fatG: 5,
    details: {},
    source: "manual" as const,
    confidence: null,
    confirmedByUser: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
  // Lunch and a late dinner on 9 September in Los Angeles. In UTC the
  // dinner already falls on 10 September.
  for (const [id, consumedAt, caloriesKcal] of [
    ["lunch", "2026-09-09T20:00:00.000Z", 600],
    ["late-dinner", "2026-09-10T05:00:00.000Z", 400],
  ] as const) {
    await foodEntryRepository.create(
      userId,
      {
        ...base,
        id,
        name: id,
        caloriesKcal,
        consumedAt: new Date(consumedAt),
      },
      { accessToken: "test-access-token" },
    );
  }
  let grounding: readonly AgentGroundingItem[] = [];
  // First turn asks for a Coach tool; the second sees its evidence, so the
  // test covers the orchestrator's tool loop inside the request scope.
  const respond = vi.fn<AgentProvider["respond"]>(async (request) => {
    const toolDone = request.grounding.some(
      (item) => item.label === TOOL_LABEL,
    );
    if (!toolDone && request.tools?.length) {
      return {
        message: { role: "assistant", text: "" },
        provider: "fake",
        evidence: [],
        toolCalls: [
          { id: "c1", name: "get_recent_food_entries", args: { daysBack: 2 } },
        ],
      };
    }
    grounding = request.grounding;
    return {
      message: { role: "assistant", text: "Noted." },
      provider: "fake",
      evidence: request.grounding,
      providerMetadata: { totalTokens: 10, resolvedModel: "fake-v1" },
    };
  });
  // No injected orchestrator: the app's own Coach tool registry is used.
  const app = buildApp({
    tokenVerifier,
    profileRepository,
    foodEntryRepository,
    coachControls: { now: () => NOW },
    provider: {
      status: async () => ({
        ready: true,
        provider: "fake",
        externalAccess: true,
      }),
      respond,
    },
  });
  apps.push(app);
  return {
    app,
    profileRepository,
    foodEntryRepository,
    grounding: () => grounding,
  };
};

const homeDailyTotal = async (app: ReturnType<typeof buildApp>) => {
  // Home asks for the device's calendar day with `-getTimezoneOffset()`.
  const response = await app.inject({
    method: "GET",
    url: "/v1/food-entries/summary?date=2026-09-09&utcOffsetMinutes=-420",
    headers: auth,
  });
  expect(response.statusCode).toBe(200);
  return response.json().summary as {
    readonly date: string;
    readonly entryCount: number;
    readonly caloriesKcal: number | null;
  };
};

const coachToday = async (
  app: ReturnType<typeof buildApp>,
  read: () => readonly AgentGroundingItem[],
  headers: Readonly<Record<string, string>>,
) => {
  const created = await app.inject({
    method: "POST",
    url: "/v1/coach/conversations",
    headers: auth,
    payload: { title: "Evening" },
  });
  expect(created.statusCode).toBe(201);
  const response = await app.inject({
    method: "POST",
    url: `/v1/coach/conversations/${created.json().conversation.id}/messages`,
    headers: { ...auth, ...headers, "idempotency-key": "rel-01-today" },
    payload: { text: "How am I doing on food today?" },
  });
  expect(response.statusCode).toBe(200);
  const items = read();
  const tool = items.find((item) => item.label === TOOL_LABEL)?.data as
    { readonly today: unknown } | undefined;
  expect(
    items.find((item) => item.kind === "profile")?.data,
  ).not.toHaveProperty("timezone");
  return {
    ...(items.find((item) => item.kind === "nutrition")?.data as {
      readonly entryCount: number;
      readonly caloriesKcal: number | null;
      readonly loggedMealsToday: ReadonlyArray<{
        readonly consumedAt: string;
      }>;
    }),
    toolToday: tool?.today,
  };
};

describe("REL-01 Coach today follows the phone's zone", () => {
  it("agrees with Home's daily total near midnight for a user whose profile is still UTC", async () => {
    const { app, grounding } = await setup();
    const home = await homeDailyTotal(app);
    expect(home).toMatchObject({ entryCount: 2, caloriesKcal: 1000 });

    const coach = await coachToday(app, grounding, {
      [DEVICE_TIME_ZONE_HEADER]: LOS_ANGELES,
    });
    expect(coach).toMatchObject({
      entryCount: home.entryCount,
      caloriesKcal: home.caloriesKcal,
    });
    // The Coach tool, run by the app's orchestrator, uses the same day.
    expect(coach.toolToday).toMatchObject({
      day: "2026-09-09",
      entryCount: home.entryCount,
      caloriesKcal: home.caloriesKcal,
    });
    expect(
      coach?.loggedMealsToday.map((meal) => meal.consumedAt).sort(),
    ).toEqual(["2026-09-09T13:00:00-07:00", "2026-09-09T22:00:00-07:00"]);
  });

  it("keeps the stored UTC day for older builds that send no zone", async () => {
    const { app, grounding } = await setup();
    const coach = await coachToday(app, grounding, {});
    expect(coach).toMatchObject({ entryCount: 1, caloriesKcal: 400 });
    expect(coach.toolToday).toMatchObject({ day: "2026-09-10" });
  });

  it("ignores an invalid zone header", async () => {
    const { app, grounding } = await setup();
    const coach = await coachToday(app, grounding, {
      [DEVICE_TIME_ZONE_HEADER]: "Mars/Olympus_Mons",
    });
    expect(coach).toMatchObject({ entryCount: 1, caloriesKcal: 400 });
  });

  it("prefers a saved profile zone over the request zone", async () => {
    const { app, grounding } = await setup(LOS_ANGELES);
    const coach = await coachToday(app, grounding, {
      [DEVICE_TIME_ZONE_HEADER]: "Asia/Tokyo",
    });
    expect(coach).toMatchObject({ entryCount: 2, caloriesKcal: 1000 });
  });
});

describe("request time zone scope", () => {
  it("reads only named zones from the header", () => {
    expect(
      requestTimeZone({ headers: { [DEVICE_TIME_ZONE_HEADER]: LOS_ANGELES } }),
    ).toBe(LOS_ANGELES);
    expect(
      requestTimeZone({ headers: { [DEVICE_TIME_ZONE_HEADER]: "+02:00" } }),
    ).toBeNull();
    expect(requestTimeZone({ headers: {} })).toBeNull();
  });

  it("applies the zone to Coach tool reads inside the scope only", async () => {
    const { profileRepository, foodEntryRepository } = await setup();
    const tools = buildCoachToolRegistry({
      profileRepository: withRequestTimeZone(profileRepository),
      goalRepository: new InMemoryGoalRepository(),
      workoutRepository: new InMemoryWorkoutRepository(),
      workoutSetRepository: new InMemoryWorkoutSetRepository(),
      foodEntryRepository,
      bodyMeasurementRepository: new InMemoryBodyMeasurementRepository(),
    });
    const run = () =>
      tools.execute({
        principalUserId: userId,
        accessToken: "test-access-token",
        clock: { now: () => NOW },
        calls: [
          { id: "c1", name: "get_recent_food_entries", args: { daysBack: 2 } },
        ],
      });
    const today = (items: Awaited<ReturnType<typeof run>>) =>
      (items[0]?.evidence.data as { readonly today: unknown }).today;

    expect(today(await runWithRequestTimeZone(LOS_ANGELES, run))).toMatchObject(
      { day: "2026-09-09", entryCount: 2, caloriesKcal: 1000 },
    );
    expect(today(await run())).toMatchObject({
      day: "2026-09-10",
      entryCount: 1,
    });
    // The stored profile is never rewritten by a scoped read.
    expect(
      (
        await profileRepository.getOrCreate(userId, {
          now: NOW,
          accessToken: "test-access-token",
        })
      ).timezone,
    ).toBe(DEFAULT_TIMEZONE);
  });
});
