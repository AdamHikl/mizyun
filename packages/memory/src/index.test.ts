import { describe, expect, it } from "vitest";

import type { MemoryId, UserId } from "@mizyun/core";

import { InMemoryMemoryStore } from "./index.js";

describe("InMemoryMemoryStore", () => {
  it("never returns another user's memory", async () => {
    const store = new InMemoryMemoryStore();
    const firstUser = "00000000-0000-4000-8000-000000000001" as UserId;
    const secondUser = "00000000-0000-4000-8000-000000000002" as UserId;

    await store.save(
      {
        id: "00000000-0000-4000-8000-000000000003" as MemoryId,
        userId: firstUser,
        kind: "goal",
        content: "Build stronger legs",
        source: "user",
        confidence: 1,
        importance: 8,
        status: "active",
      },
      { accessToken: "first-user-token" },
    );

    const results = await store.search({
      userId: secondUser,
      accessToken: "second-user-token",
      text: "legs",
      limit: 10,
      asOf: new Date(),
    });

    expect(results).toEqual([]);
  });

  it("recalls only active, thresholded, non-expired memories", async () => {
    const store = new InMemoryMemoryStore();
    const userId = "00000000-0000-4000-8000-000000000001" as UserId;
    const save = (
      id: string,
      status: "candidate" | "active",
      confidence: number,
      importance: number,
      expiresAt?: Date,
    ) =>
      store.save(
        {
          id: id as MemoryId,
          userId,
          kind: "preference",
          content: `Memory ${id}`,
          source: "user",
          confidence,
          importance,
          status,
          ...(expiresAt ? { expiresAt } : {}),
        },
        { accessToken: "token" },
      );
    await save("00000000-0000-4000-8000-000000000011", "candidate", 1, 10);
    await save("00000000-0000-4000-8000-000000000012", "active", 0.9, 5);
    await save(
      "00000000-0000-4000-8000-000000000013",
      "active",
      0.9,
      5,
      new Date("2026-01-01T00:00:00Z"),
    );

    const results = await store.search({
      userId,
      accessToken: "token",
      text: "",
      limit: 10,
      asOf: new Date("2026-07-26T00:00:00Z"),
    });
    expect(results.map((memory) => memory.id)).toEqual([
      "00000000-0000-4000-8000-000000000012",
    ]);
  });

  it("rejects activation below the recall threshold", async () => {
    const store = new InMemoryMemoryStore();
    const userId = "00000000-0000-4000-8000-000000000001" as UserId;
    const id = "00000000-0000-4000-8000-000000000021" as MemoryId;
    await store.save(
      {
        id,
        userId,
        kind: "preference",
        content: "Low-confidence preference",
        source: "user",
        confidence: 0.4,
        importance: 2,
        status: "candidate",
      },
      { accessToken: "token" },
    );
    await expect(
      store.update(userId, id, {
        accessToken: "token",
        patch: { status: "active" },
      }),
    ).rejects.toThrow(/active memories require/);
  });
});
