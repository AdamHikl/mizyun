import { describe, expect, it } from "vitest";

import type { MemoryId, UserId } from "@mizyun/core";

import { InMemoryMemoryStore } from "./index.js";

describe("InMemoryMemoryStore", () => {
  it("never returns another user's memory", async () => {
    const store = new InMemoryMemoryStore();
    const firstUser = "00000000-0000-4000-8000-000000000001" as UserId;
    const secondUser = "00000000-0000-4000-8000-000000000002" as UserId;

    await store.save({
      id: "00000000-0000-4000-8000-000000000003" as MemoryId,
      userId: firstUser,
      kind: "goal",
      content: "Build stronger legs",
      source: "user",
      confidence: 1,
      importance: 8,
    });

    const results = await store.search({
      userId: secondUser,
      text: "legs",
      limit: 10,
      asOf: new Date(),
    });

    expect(results).toEqual([]);
  });
});
