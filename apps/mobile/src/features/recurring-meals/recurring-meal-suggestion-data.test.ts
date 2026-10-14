import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectRecurringMealSuggestion,
  type RecurringMealSuggestionEntry,
} from "@mizyun/core";
import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import { recurringMealSuggestionProposalSchema } from "@mizyun/contracts";
import type {
  FoodEntry,
  RecurringMealSuggestionAccept,
  RecurringMealSuggestionAcceptResponse,
} from "@mizyun/contracts";
const mocks = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("@/composition/api-client", () => ({
  apiClient: {},
  invalidateSessionReads: mocks.invalidate,
}));
vi.mock("expo-router", () => ({ useFocusEffect: vi.fn() }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove() {} }),
  },
}));
vi.mock("expo-notifications", () => ({ setNotificationChannelAsync: vi.fn() }));
vi.mock("@/features/health-exports", () => ({
  clearLocalHealthExports: vi.fn(),
}));
vi.mock("../dashboard/public-data", () => ({ clearQuickMealRepeat: vi.fn() }));
vi.mock("../analytics/public-data", () => ({
  clearAnalyticsReminder: vi.fn(),
}));
vi.mock("../meal-recipes/public-data", () => ({
  clearRecipeIngredientData: vi.fn(),
  exportIngredientReview: vi.fn(),
  getIngredientReviewGeneration: () => 0,
  recipeSessionStore: { export: async () => null },
}));
import { createFoodCopyPayload } from "@/features/log-meal/public-data";
import { RecurringMealSuggestionController } from "./recurring-meal-suggestion-data";
import {
  RecurringSuggestionRetryStore,
  type SuggestionSecureStore,
} from "./recurring-meal-suggestion-retry";
import { retireRecurringMealSuggestions } from "./recurring-meal-suggestion-lifetime";
import { fetchAccountExport } from "@/features/settings/account-data-management";

const owner = "a2440000-0000-4000-8000-000000000099";
const entry = (day: number): RecurringMealSuggestionEntry => ({
  id: `b2440000-0000-4000-8000-${String(day).padStart(12, "0")}`,
  userId: owner,
  name: "Yogurt 150 g",
  consumedAt: `2026-10-${day}T08:00:00Z`,
  createdAt: `2026-10-${day}T08:01:00Z`,
  updatedAt: `2026-10-${day}T08:01:00Z`,
  confirmedByUser: true,
  caloriesKcal: 150,
  proteinG: 12,
  carbohydrateG: 15,
  fatG: 4,
  details: { grams: 150 },
});
const proposal = recurringMealSuggestionProposalSchema.parse(
  detectRecurringMealSuggestion({
    userId: owner,
    entries: [entry(11), entry(12), entry(13)],
    generatedEntryIds: [],
    historyComplete: true,
    referenceAt: new Date("2026-10-13T09:00:00Z"),
    timeZone: "UTC",
  })!,
);
const response: RecurringMealSuggestionAcceptResponse = {
  recurringMeal: {
    id: "c2440000-0000-4000-8000-000000000099",
    userId: owner,
    name: proposal.name,
    localTime: "08:00",
    timeZone: "UTC",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
    createdAt: "2026-10-13T09:00:00Z",
    updatedAt: "2026-10-13T09:00:00Z",
  },
  created: true,
  startLocalDate: "2026-10-14",
};
const input: RecurringMealSuggestionAccept = {
  operationId: "d2440000-0000-4000-8000-000000000099",
  proposal,
  localTime: proposal.localTime,
  timeZone: proposal.timeZone,
  weekdays: [...proposal.weekdays],
};
function primitive() {
  const values = new Map<string, string>();
  const store: SuggestionSecureStore = {
    getItemAsync: vi.fn(async (key) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key, value) => {
      if (new TextEncoder().encode(value).byteLength > 2048)
        throw new Error("Native limit");
      values.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key) => {
      values.delete(key);
    }),
  };
  return { values, store, retry: new RecurringSuggestionRetryStore(store) };
}
function client(
  accept: (
    body: RecurringMealSuggestionAccept,
  ) => Promise<
    | { ok: true; value: RecurringMealSuggestionAcceptResponse }
    | { ok: false; error: ApiError }
  >,
  detect: (
    timeZone: string,
  ) => RecurringMealSuggestionAccept["proposal"] | null = () => proposal,
) {
  const requests: RequestOptions[] = [];
  const api: ApiClient = {
    status: () => ({ configured: true, baseUrl: "https://synthetic.invalid" }),
    request: async <T>(options: RequestOptions) => {
      requests.push(options);
      if (options.path === "/v1/recurring-meals")
        return {
          ok: true,
          value: { recurringMeals: [response.recurringMeal] } as T,
        };
      if (options.path.includes("/accept"))
        return (await accept(
          options.body as RecurringMealSuggestionAccept,
        )) as never;
      if (options.method === "GET")
        return {
          ok: true,
          value: {
            suggestion: detect(
              new URL(
                options.path,
                "https://synthetic.invalid",
              ).searchParams.get("timeZone")!,
            ),
            enabled: true,
          } as T,
        };
      return { ok: true, value: { ok: true } as T };
    },
  };
  return { api, requests };
}
beforeEach(() => {
  mocks.invalidate.mockClear();
});

describe("real meal-copy detection boundary", () => {
  it("counts explicitly copied meals, including a copied automatic source and later photo metadata updates", () => {
    const source: FoodEntry = {
      ...entry(11),
      source: "manual",
      confidence: null,
      details: {
        grams: 150,
        recurringMeal: {
          scheduleId: response.recurringMeal.id,
          localDate: "2026-10-11",
        },
      },
    };
    const copies = [11, 12, 13].map((day) => {
      const payload = createFoodCopyPayload(source, false, {
        consumedAt: `2026-10-${day}T08:00:00Z`,
        clientOperationId: `e2440000-0000-4000-8000-${String(day).padStart(12, "0")}`,
      });
      expect(payload.details).not.toHaveProperty("recurringMeal");
      return {
        ...entry(day),
        ...payload,
        updatedAt: `2026-10-${day}T08:02:00Z`,
      };
    });
    expect(
      detectRecurringMealSuggestion({
        userId: owner,
        entries: copies,
        generatedEntryIds: ["original-generated-source-id"],
        historyComplete: true,
        referenceAt: new Date("2026-10-13T09:00:00Z"),
        timeZone: "UTC",
      }),
    ).toMatchObject({
      sourceEntryId: copies[2]!.id,
      reasonCode: "three_consecutive_days",
    });
    expect(
      detectRecurringMealSuggestion({
        userId: owner,
        entries: copies,
        generatedEntryIds: [copies[1]!.id],
        historyComplete: true,
        referenceAt: new Date("2026-10-13T09:00:00Z"),
        timeZone: "UTC",
      }),
    ).toBeNull();
  });
});

describe("encrypted suggestion recovery", () => {
  it("includes only the active owner's local setup recovery in account export", async () => {
    const { retry, store } = primitive();
    await retry.prepare(owner, input, () => true);
    const api: ApiClient = {
      status: () => ({
        configured: true,
        baseUrl: "https://synthetic.invalid",
      }),
      request: async <T>() => ({
        ok: true as const,
        value: { export: { userId: owner } } as T,
      }),
    };
    const options = {
      expectedUserId: owner,
      isCurrent: () => true,
      recurringSuggestionRetryStore: retry,
      draftStore: store,
      recipeReviewStore: { export: async () => null } as any,
      recipeSessionStore: { export: async () => null } as any,
    };
    const exported = await fetchAccountExport(api, options);
    expect(exported.ok).toBe(true);
    if (exported.ok)
      expect(exported.data.export.localRecurringMealSetup?.input).toEqual(
        input,
      );
    expect(
      (
        await fetchAccountExport(api, {
          ...options,
          expectedUserId: "a2440000-0000-4000-8000-000000000098",
        })
      ).ok,
    ).toBe(false);
  });
  it("round-trips large multibyte names under native item limits and erases every chunk", async () => {
    const { retry, values } = primitive();
    const large = {
      ...input,
      proposal: {
        ...proposal,
        name: "🥣".repeat(100),
        familyKey: "🥣".repeat(100),
      },
    };
    await retry.prepare(owner, large, () => true);
    expect((await retry.load(owner))?.input).toEqual(large);
    expect(values.size).toBeGreaterThan(2);
    await retry.clear(owner);
    expect(values.size).toBe(0);
  });
  it("repairs an interrupted native write without losing the committed operation", async () => {
    const { retry, store, values } = primitive();
    await retry.prepare(owner, input, () => true);
    const original = store.setItemAsync;
    let failed = false;
    store.setItemAsync = async (key, value) => {
      if (!failed && key.endsWith(".1")) {
        failed = true;
        throw new Error("Native write interrupted");
      }
      return original(key, value);
    };
    await expect(retry.complete(owner, input, response)).rejects.toThrow();
    expect((await retry.load(owner))?.input).toEqual(input);
    expect((await retry.load(owner))?.completed).toBeNull();
    await retry.clear(owner);
    expect(values.size).toBe(0);
  });
  it("allows erasure retry after partial chunk deletion, and keeps another owner intact", async () => {
    const { retry, store, values } = primitive();
    const second = "a2440000-0000-4000-8000-000000000098";
    await retry.prepare(owner, input, () => true);
    await retry.prepare(second, input, () => true);
    const original = store.deleteItemAsync;
    let failed = false;
    store.deleteItemAsync = async (key) => {
      if (!failed && key.includes(owner) && key.endsWith(".1")) {
        failed = true;
        throw new Error("Native delete interrupted");
      }
      return original(key);
    };
    await expect(retry.clear(owner)).rejects.toThrow();
    await retry.clear(owner);
    expect([...values.keys()].some((key) => key.includes(owner))).toBe(false);
    expect((await retry.load(second))?.input).toEqual(input);
  });
  it("does not replace an unresolved immutable attempt with another schedule", async () => {
    const { retry } = primitive();
    await retry.prepare(owner, input, () => true);
    await expect(
      retry.prepare(owner, { ...input, localTime: "09:15" }, () => true),
    ).rejects.toThrow("previous setup");
    expect((await retry.load(owner))?.input).toEqual(input);
  });
});

describe("suggestion acceptance controller", () => {
  it("holds a real device/profile mismatch until an explicit choice, then detects fresh evidence in that zone", async () => {
    const { retry } = primitive();
    const detect = vi.fn((timeZone: string) =>
      recurringMealSuggestionProposalSchema.parse(
        detectRecurringMealSuggestion({
          userId: owner,
          entries: [entry(11), entry(12), entry(13)],
          generatedEntryIds: [],
          historyComplete: true,
          referenceAt: new Date("2026-10-13T09:00:00Z"),
          timeZone,
        }),
      ),
    );
    const { api, requests } = client(
      async (body) => ({
        ok: true,
        value: {
          ...response,
          recurringMeal: {
            ...response.recurringMeal,
            timeZone: body.timeZone,
            localTime: body.localTime,
          },
        },
      }),
      detect,
    );
    const controller = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => "America/New_York",
      () => true,
      () => "UTC",
    );
    await controller.refresh();
    expect(controller.state.status).toBe("timezone-choice");
    expect(controller.state.candidate).toBeNull();
    expect(requests).toHaveLength(1);
    await controller.accept();
    expect(await retry.load(owner)).toBeNull();
    await controller.chooseTimeZone("Europe/Bratislava");
    expect(requests).toHaveLength(1);
    await controller.chooseTimeZone("America/New_York");
    expect(controller.state.candidate).toMatchObject({
      timeZone: "America/New_York",
      localTime: "04:00",
    });
    expect(detect).toHaveBeenLastCalledWith("America/New_York");
    const newYorkCandidateId = controller.state.candidate?.candidateId;
    await controller.chooseTimeZone("UTC");
    expect(controller.state.candidate).toMatchObject({
      timeZone: "UTC",
      localTime: "08:00",
    });
    expect(controller.state.candidate?.candidateId).not.toBe(
      newYorkCandidateId,
    );
    expect(detect).toHaveBeenLastCalledWith("UTC");
    await controller.accept();
    const accepted = requests.find((request) =>
      request.path.includes("/accept"),
    )?.body as RecurringMealSuggestionAccept;
    expect(accepted.timeZone).toBe("UTC");
    expect(accepted.proposal).toEqual(controller.state.candidate);
  });
  it("does not prompt for timezone choice when suggestions are disabled or no pattern qualifies", async () => {
    for (const enabled of [true, false]) {
      const { retry } = primitive();
      const api = {
        status: () => ({
          configured: true as const,
          baseUrl: "https://synthetic.invalid",
        }),
        request: async <T>() => ({
          ok: true as const,
          value: {
            enabled,
            suggestion: enabled
              ? null
              : { ...proposal, timeZone: "America/New_York" },
          } as T,
        }),
      };
      const controller = new RecurringMealSuggestionController(
        owner,
        api,
        async () => retry,
        () => "America/New_York",
        () => true,
        () => "UTC",
      );
      await controller.refresh();
      expect(controller.state.status).toBe("idle");
      expect(controller.state.timezoneChoice).toBeUndefined();
      expect(controller.state.candidate).toBeNull();
    }
  });
  it("rechecks timezone agreement at acceptance instead of silently using stale evidence", async () => {
    const { retry } = primitive();
    const { api, requests } = client(async () => ({
      ok: true,
      value: response,
    }));
    let device = "UTC";
    let profile = "UTC";
    const controller = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => device,
      () => true,
      () => profile,
    );
    await controller.refresh();
    device = "Europe/Bratislava";
    await controller.accept();
    expect(controller.state.status).toBe("timezone-choice");
    expect(requests.some((request) => request.path.includes("/accept"))).toBe(
      false,
    );
    expect(await retry.load(owner)).toBeNull();
    device = "UTC";
    await controller.refresh();
    device = profile = "Europe/Bratislava";
    await controller.accept();
    expect(controller.state.status).toBe("stale");
    expect(requests.some((request) => request.path.includes("/accept"))).toBe(
      false,
    );
  });
  it("discards an in-flight detection when the profile/device timezone context changes", async () => {
    const { retry } = primitive();
    let device = "UTC";
    let resolve!: (value: any) => void;
    const api = {
      status: () => ({
        configured: true as const,
        baseUrl: "https://synthetic.invalid",
      }),
      request: vi.fn(
        () =>
          new Promise<any>((done) => {
            resolve = done;
          }),
      ),
    };
    const controller = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => device,
      () => true,
      () => "UTC",
    );
    const detection = controller.refresh();
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    device = "America/New_York";
    resolve({ ok: true, value: { enabled: true, suggestion: proposal } });
    await detection;
    expect(controller.state.status).toBe("timezone-choice");
    expect(controller.state.candidate).toBeNull();
  });
  it("invalidates an earlier timezone choice after travel but preserves an immutable unresolved operation on restart", async () => {
    const { retry } = primitive();
    const submitted: RecurringMealSuggestionAccept[] = [];
    let device = "America/New_York";
    let profile = "UTC";
    const { api } = client(
      async (body) => {
        submitted.push(body);
        return submitted.length === 1
          ? {
              ok: false,
              error: { kind: "network_error", cause: "lost response" },
            }
          : { ok: true, value: response };
      },
      (timeZone) => ({ ...proposal, timeZone }),
    );
    const controller = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => device,
      () => true,
      () => profile,
    );
    await controller.refresh();
    await controller.chooseTimeZone("UTC");
    device = "Asia/Tokyo";
    await controller.accept();
    expect(controller.state.status).toBe("timezone-choice");
    expect(submitted).toHaveLength(0);
    await controller.chooseTimeZone("UTC");
    await controller.accept();
    expect(controller.state.status).toBe("unknown");
    device = profile = "Europe/Bratislava";
    const restarted = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => device,
      () => true,
      () => profile,
    );
    await restarted.refresh();
    expect(restarted.state.status).toBe("unknown");
    expect(restarted.state.candidate?.timeZone).toBe("UTC");
    await restarted.chooseTimeZone("Europe/Bratislava");
    expect(restarted.state.status).toBe("unknown");
    await restarted.retry();
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(submitted[1]?.timeZone).toBe("UTC");
  });
  it("revalidates a completed receipt against live paused/stopped state instead of showing stale success", async () => {
    const { retry } = primitive();
    await retry.prepare(owner, input, () => true);
    await retry.complete(owner, input, response);
    let stopped = false;
    const request = vi.fn(async <T>(options: RequestOptions) => ({
      ok: true as const,
      value: {
        recurringMeals: stopped
          ? []
          : [{ ...response.recurringMeal, enabled: false }],
      } as T,
    }));
    const api: ApiClient = {
      request: request as ApiClient["request"],
      status: () => ({
        configured: true as const,
        baseUrl: "https://synthetic.invalid",
      }),
    };
    const controller = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => "UTC",
    );
    await controller.refresh();
    expect(controller.state.result?.recurringMeal.enabled).toBe(false);
    stopped = true;
    await controller.refresh();
    expect(controller.state.result).toBeNull();
    expect(controller.state.candidate).toBeNull();
    expect(await retry.load(owner)).toBeNull();
    expect(
      request.mock.calls.every(([options]) => options.method === "GET"),
    ).toBe(true);
  });
  it("double taps and lost response/restart reuse one immutable operation", async () => {
    const { retry } = primitive();
    const submitted: RecurringMealSuggestionAccept[] = [];
    let first = true;
    const { api } = client(async (body) => {
      submitted.push(body);
      if (first) {
        first = false;
        return {
          ok: false,
          error: { kind: "network_error", cause: "lost after commit" },
        };
      }
      return { ok: true, value: response };
    });
    const controller = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => "UTC",
    );
    await controller.refresh();
    await Promise.all([controller.accept(), controller.accept()]);
    expect(controller.state.status).toBe("unknown");
    expect(submitted).toHaveLength(1);
    const restarted = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => "UTC",
    );
    await restarted.refresh();
    expect(restarted.state.status).toBe("unknown");
    await restarted.retry();
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(restarted.state.result).toEqual(response);
    expect(mocks.invalidate).toHaveBeenCalledTimes(4);
  });
  it("sends nothing when native recovery persistence fails", async () => {
    const { retry, store } = primitive();
    const { api, requests } = client(async () => ({
      ok: true,
      value: response,
    }));
    const controller = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => "UTC",
    );
    await controller.refresh();
    store.setItemAsync = async () => {
      throw new Error("Storage unavailable");
    };
    await controller.accept();
    expect(requests.some((request) => request.path.includes("/accept"))).toBe(
      false,
    );
    expect(controller.state.status).toBe("error");
  });
  it("stale rejection clears the old attempt and requires refresh before a new action", async () => {
    const { retry } = primitive();
    const { api, requests } = client(async () => ({
      ok: false,
      error: {
        kind: "http_error",
        status: 409,
        code: "CONFLICT",
        message: "stale",
      },
    }));
    const controller = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => "UTC",
    );
    await controller.refresh();
    await controller.accept();
    expect(controller.state.status).toBe("stale");
    expect(await retry.load(owner)).toBeNull();
    await controller.accept();
    expect(
      requests.filter((request) => request.path.includes("/accept")),
    ).toHaveLength(1);
  });
  it("does not dispatch or display after owner retirement during encrypted preparation", async () => {
    const unique = "a2440000-0000-4000-8000-000000000097";
    const { retry, store } = primitive();
    const { api, requests } = client(async () => ({
      ok: true,
      value: {
        ...response,
        recurringMeal: { ...response.recurringMeal, userId: unique },
      },
    }));
    const controller = new RecurringMealSuggestionController(
      unique,
      api,
      async () => retry,
      () => "UTC",
    );
    await controller.refresh();
    const original = store.setItemAsync;
    store.setItemAsync = async (key, value) => {
      await original(key, value);
      if (key.endsWith(".journal")) retireRecurringMealSuggestions(unique);
    };
    await controller.accept();
    expect(requests.some((request) => request.path.includes("/accept"))).toBe(
      false,
    );
    expect(controller.state.candidate).toBeNull();
    expect(controller.state.result).toBeNull();
  });
  it("Undo never stops a reused pre-existing schedule", async () => {
    const { retry } = primitive();
    const { api, requests } = client(async () => ({
      ok: true,
      value: { ...response, created: false },
    }));
    const controller = new RecurringMealSuggestionController(
      owner,
      api,
      async () => retry,
      () => "UTC",
    );
    await controller.refresh();
    await controller.accept();
    await controller.undo();
    expect(controller.state.status).toBe("already-scheduled");
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });
});
