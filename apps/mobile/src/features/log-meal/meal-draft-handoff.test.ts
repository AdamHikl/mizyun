import { describe, expect, it } from "vitest";
import { stageRecipeMealDraft } from "./meal-draft-handoff";
import {
  clearLoggingDraft,
  loadRequiredLoggingDraft,
  saveLoggingDraft,
} from "../logging-draft-storage";
import { isRecoverableMealDraft } from "./meal-form";
const selected = {
  name: "Reviewed meal",
  caloriesKcal: null,
  proteinG: 12,
  carbohydrateG: 0,
  fatG: null,
  grams: 150,
};
const id = "11111111-1111-4111-8111-111111111111";
const memory = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
};
const options = (store: ReturnType<typeof memory>, replace = false) => ({
  store,
  replace,
  isCurrent: () => true,
});
describe("recoverable consumed-serving handoff", () => {
  it("persists the selected identity and canonical unknown/zero payload before opening the editable form", async () => {
    const store = memory();
    expect(
      await stageRecipeMealDraft("owner", selected, {
        ...options(store),
        operationId: id,
      }),
    ).toEqual({ status: "ready", operationId: id });
    const draft = await loadRequiredLoggingDraft(
      "owner",
      "meal",
      isRecoverableMealDraft,
      store,
    );
    expect(draft).toMatchObject({
      calories: "",
      protein: "12",
      carbs: "0",
      fat: "",
      nutritionBasis: "total",
      preparedMeal: {
        clientOperationId: id,
        caloriesKcal: null,
        carbohydrateG: 0,
        details: { grams: 150 },
      },
    });
    expect(draft?.submittedMeal).toBeUndefined();
    const exact = [...store.values.values()];
    expect(
      await stageRecipeMealDraft("owner", selected, {
        ...options(store),
        operationId: id,
      }),
    ).toEqual({ status: "ready", operationId: id });
    expect([...store.values.values()]).toEqual(exact);
  });
  it("preserves the old draft byte for byte on collision/return and replaces only explicitly", async () => {
    const store = memory();
    await saveLoggingDraft(
      "owner",
      "meal",
      {
        name: "Old",
        calories: "",
        protein: "",
        carbs: "",
        fat: "",
        description: "unaltered",
      },
      store,
    );
    const before = [...store.values.values()];
    expect(
      await stageRecipeMealDraft("owner", selected, options(store)),
    ).toEqual({ status: "collision" });
    expect([...store.values.values()]).toEqual(before);
    expect(
      (await stageRecipeMealDraft("owner", selected, options(store, true)))
        .status,
    ).toBe("ready");
  });
  it("serializes competing handoffs instead of both claiming the empty slot", async () => {
    const store = memory();
    const results = await Promise.all([
      stageRecipeMealDraft("owner", selected, options(store)),
      stageRecipeMealDraft(
        "owner",
        { ...selected, name: "Second" },
        options(store),
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual(["ready", "collision"]);
  });
  it("refuses replacement and Clear while the submitted outcome is unknown", async () => {
    const store = memory();
    await stageRecipeMealDraft("owner", selected, {
      ...options(store),
      operationId: id,
    });
    const draft = (await loadRequiredLoggingDraft(
      "owner",
      "meal",
      isRecoverableMealDraft,
      store,
    ))!;
    await saveLoggingDraft(
      "owner",
      "meal",
      {
        ...draft,
        submittedMeal: draft.preparedMeal,
        submissionStatus: "outcome_unknown",
      },
      store,
    );
    const before = [...store.values.values()];
    expect(
      await stageRecipeMealDraft("owner", selected, options(store, true)),
    ).toEqual({ status: "collision" });
    expect(await clearLoggingDraft("owner", "meal", store)).toBe(false);
    expect([...store.values.values()]).toEqual(before);
    expect(
      await clearLoggingDraft("owner", "meal", store, {
        resolvedOperationId: id,
      }),
    ).toBe(true);
    const repeated = await stageRecipeMealDraft(
      "owner",
      selected,
      options(store),
    );
    expect(repeated.status).toBe("ready");
    if (repeated.status === "ready") expect(repeated.operationId).not.toBe(id);
  });
  it("blocks unavailable/corrupt persistence and fences an account/token change before writing", async () => {
    const store = memory();
    store.setItemAsync = async () => {
      throw Error("locked");
    };
    expect(
      await stageRecipeMealDraft("owner", selected, options(store)),
    ).toEqual({ status: "unavailable" });
    expect(
      await stageRecipeMealDraft("owner", selected, {
        ...options(store),
        isCurrent: () => false,
      }),
    ).toEqual({ status: "context_changed" });
    const changed = memory();
    let current = true;
    changed.getItemAsync = async () => {
      current = false;
      return null;
    };
    expect(
      await stageRecipeMealDraft("owner", selected, {
        ...options(changed),
        isCurrent: () => current,
      }),
    ).toEqual({ status: "context_changed" });
    expect(changed.values.size).toBe(0);
    const corrupt = memory();
    corrupt.getItemAsync = async () => "{broken";
    expect(
      await stageRecipeMealDraft("owner", selected, options(corrupt, true)),
    ).toEqual({ status: "unavailable" });
  });
});

it("returns a durable resolved receipt for an old selection and refuses unexplained resume IDs", async () => {
  const store = memory();
  await stageRecipeMealDraft("owner", selected, {
    ...options(store),
    operationId: id,
  });
  const draft = (await loadRequiredLoggingDraft(
    "owner",
    "meal",
    isRecoverableMealDraft,
    store,
  ))!;
  await saveLoggingDraft(
    "owner",
    "meal",
    {
      ...draft,
      submittedMeal: draft.preparedMeal,
      submissionStatus: "outcome_unknown",
    },
    store,
  );
  await clearLoggingDraft("owner", "meal", store, { resolvedOperationId: id });
  const before = [...store.values.values()];
  expect(
    await stageRecipeMealDraft("owner", selected, {
      ...options(store),
      operationId: id,
      requireExisting: true,
    }),
  ).toEqual({ status: "resolved", operationId: id });
  expect([...store.values.values()]).toEqual(before);
  expect(
    await stageRecipeMealDraft("owner", selected, {
      ...options(store),
      operationId: "22222222-2222-4222-8222-222222222222",
      requireExisting: true,
    }),
  ).toEqual({ status: "unavailable" });
  expect(
    await stageRecipeMealDraft("owner", selected, {
      ...options(store),
      operationId: "22222222-2222-4222-8222-222222222222",
    }),
  ).toEqual({
    status: "ready",
    operationId: "22222222-2222-4222-8222-222222222222",
  });
});

it("preserves the unknown meal when persisting its confirmed completion receipt fails", async () => {
  const store = memory();
  await stageRecipeMealDraft("owner", selected, {
    ...options(store),
    operationId: id,
  });
  const draft = (await loadRequiredLoggingDraft(
    "owner",
    "meal",
    isRecoverableMealDraft,
    store,
  ))!;
  await saveLoggingDraft(
    "owner",
    "meal",
    {
      ...draft,
      submittedMeal: draft.preparedMeal,
      submissionStatus: "outcome_unknown",
    },
    store,
  );
  const before = [...store.values.values()];
  const set = store.setItemAsync;
  store.setItemAsync = async (key, value) => {
    if (key.endsWith(".meal-completed")) throw Error("locked");
    return set(key, value);
  };
  expect(
    await clearLoggingDraft("owner", "meal", store, {
      resolvedOperationId: id,
    }),
  ).toBe(false);
  expect([...store.values.values()]).toEqual(before);
});

it("preserves advanced-only and blank saved forms until explicit replacement", async () => {
  for (const extras of [{ fibre: "10", sodium: "200" }, {}]) {
    const store = memory();
    await saveLoggingDraft(
      "owner",
      "meal",
      { name: "", calories: "", protein: "", carbs: "", fat: "", ...extras },
      store,
    );
    const bytes = [...store.values.values()];
    expect(
      await stageRecipeMealDraft("owner", selected, {
        ...options(store),
        operationId: id,
      }),
    ).toEqual({ status: "collision" });
    expect([...store.values.values()]).toEqual(bytes);
    expect(
      await stageRecipeMealDraft("owner", selected, {
        ...options(store, true),
        operationId: id,
      }),
    ).toEqual({ status: "ready", operationId: id });
  }
});
