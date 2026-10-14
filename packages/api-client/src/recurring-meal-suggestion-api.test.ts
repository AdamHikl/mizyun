import { describe, expect, it, vi } from "vitest";
import type { AuthClient, AuthSession } from "@mizyun/identity";
import { HttpApiClient } from "./http-api-client";
import { DisabledApiClient } from "./disabled-api-client";
import { createRecurringMealSuggestionApi } from "./recurring-meal-suggestion-api";
import { recurringMealSuggestionProposalSchema } from "@mizyun/contracts";
import { detectRecurringMealSuggestion } from "@mizyun/core";
const owner = "a2420000-0000-4000-8000-000000000001";
const session: AuthSession = {
  user: { id: owner as never, email: "synthetic@invalid.test" },
  accessToken: "synthetic-token",
};
const auth = (getSession: AuthClient["getSession"]): AuthClient => ({
  status: () => ({ configured: true, provider: "supabase" }),
  getSession,
  signInWithPassword: async () => {
    throw new Error("unused");
  },
  signUpWithPassword: async () => {
    throw new Error("unused");
  },
  signInWithOAuth: async () => {
    throw new Error("unused");
  },
  signInWithIdToken: async () => {
    throw new Error("unused");
  },
  signOut: async () => {},
  consumeDeepLink: async () => {
    throw new Error("unused");
  },
  updatePassword: async () => {
    throw new Error("unused");
  },
  requestPasswordRecovery: async () => {
    throw new Error("unused");
  },
  subscribe: () => () => {},
  dispose: () => {},
});
const proposal = recurringMealSuggestionProposalSchema.parse(
  detectRecurringMealSuggestion({
    userId: owner,
    entries: [11, 12, 13].map((day) => ({
      id: `b2420000-0000-4000-8000-${String(day).padStart(12, "0")}`,
      userId: owner,
      name: "Oats",
      consumedAt: `2026-10-${day}T08:00:00Z`,
      createdAt: `2026-10-${day}T08:01:00Z`,
      updatedAt: `2026-10-${day}T08:01:00Z`,
      confirmedByUser: true,
      caloriesKcal: 200,
      proteinG: 10,
      carbohydrateG: 20,
      fatG: 5,
      details: {},
    })),
    generatedEntryIds: [],
    historyComplete: true,
    referenceAt: new Date("2026-10-13T09:00:00Z"),
    timeZone: "UTC",
  }),
);
const input = {
  operationId: "c2420000-0000-4000-8000-000000000001",
  proposal,
  localTime: "08:00",
  timeZone: "UTC",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
};
describe("meal-suggestion transport boundaries", () => {
  it("retires intent during asynchronous session lookup without sending a request", async () => {
    let resolve!: (value: AuthSession) => void;
    const pending = new Promise<AuthSession>((done) => {
      resolve = done;
    });
    const fetch = vi.fn();
    let current = true;
    const api = createRecurringMealSuggestionApi(
      new HttpApiClient({
        baseUrl: "https://synthetic.invalid",
        authClient: auth(() => pending),
        fetch,
      }),
    );
    const result = api.list("UTC", {
      expectedUserId: owner,
      isCurrent: () => current,
    });
    current = false;
    resolve(session);
    expect((await result).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects invalid schedule fields before network and preserves a disabled transport", async () => {
    const fetch = vi.fn();
    const lifetime = { expectedUserId: owner, isCurrent: () => true };
    const api = createRecurringMealSuggestionApi(
      new HttpApiClient({
        baseUrl: "https://synthetic.invalid",
        authClient: auth(async () => session),
        fetch,
      }),
    );
    expect((await api.accept({ ...input, weekdays: [] }, lifetime)).ok).toBe(
      false,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await createRecurringMealSuggestionApi(new DisabledApiClient()).list(
        "UTC",
        lifetime,
      ),
    ).toMatchObject({ ok: false, error: { kind: "not_configured" } });
  });
  it("rejects a successful response containing a different schedule owner", async () => {
    const payload = {
      recurringMeal: {
        id: "d2420000-0000-4000-8000-000000000001",
        userId: "a2420000-0000-4000-8000-000000000002",
        name: "Oats",
        localTime: "08:00",
        timeZone: "UTC",
        weekdays: input.weekdays,
        enabled: true,
        createdAt: "2026-10-13T09:00:00Z",
        updatedAt: "2026-10-13T09:00:00Z",
      },
      created: true,
      startLocalDate: "2026-10-14",
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200 }),
      );
    const api = createRecurringMealSuggestionApi(
      new HttpApiClient({
        baseUrl: "https://synthetic.invalid",
        authClient: auth(async () => session),
        fetch,
      }),
    );
    expect(
      await api.accept(input, { expectedUserId: owner, isCurrent: () => true }),
    ).toMatchObject({ ok: false, error: { kind: "validation_error" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
