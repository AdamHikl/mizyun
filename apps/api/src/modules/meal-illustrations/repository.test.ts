import { describe, expect, it } from "vitest";
import type { UserId } from "@mizyun/core";
import { InMemoryMealIllustrationRepository } from "./repository.js";
const a = "a" as UserId,
  b = "b" as UserId,
  c = "c" as UserId;
describe("illustration reservation failure boundaries", () => {
  it("consumes failed attempts and caps a user's day", async () => {
    const repo = new InMemoryMealIllustrationRepository(
      () => new Date("2026-10-09T12:00:00Z"),
    );
    for (let i = 0; i < 5; i++) {
      const slot = await repo.claim(a, String(i));
      expect(slot.kind).toBe("claimed");
      if (slot.kind === "claimed") await repo.fail(a, slot.record.id);
    }
    expect((await repo.claim(a, "sixth")).kind).toBe("limited");
  });
  it("enforces per-user and global concurrency", async () => {
    const repo = new InMemoryMealIllustrationRepository();
    expect((await repo.claim(a, "one")).kind).toBe("claimed");
    expect((await repo.claim(a, "two")).kind).toBe("limited");
    expect((await repo.claim(b, "one")).kind).toBe("claimed");
    expect((await repo.claim(c, "one")).kind).toBe("limited");
  });
  it("restart-expired work remains unknown, never retried or late-completed", async () => {
    let now = new Date("2026-10-09T12:00:00Z");
    const repo = new InMemoryMealIllustrationRepository(() => now);
    const slot = await repo.claim(a, "one");
    if (slot.kind !== "claimed") throw new Error("Missing claim");
    now = new Date(now.getTime() + 120_001);
    const repeated = await repo.claim(a, "one");
    expect(repeated.kind).toBe("existing");
    if (repeated.kind === "existing")
      expect(repeated.record.state).toBe("unknown");
    await repo.complete(a, slot.record.id, {
      base64: "AAAA",
      key: "one",
      mimeType: "image/jpeg",
    });
    expect((await repo.exportForUser(a))[0]?.image).toBeNull();
  });
  it("monthly budget survives daily rollover and exports remain user-owned", async () => {
    let now = new Date("2026-10-01T12:00:00Z");
    const repo = new InMemoryMealIllustrationRepository(() => now);
    for (let day = 1; day <= 6; day++) {
      now = new Date(`2026-10-0${day}T12:00:00Z`);
      for (let i = 0; i < 5; i++) {
        const slot = await repo.claim(a, `${day}-${i}`);
        if (slot.kind !== "claimed") throw new Error("Missing claim");
        await repo.fail(a, slot.record.id);
      }
    }
    now = new Date("2026-10-07T12:00:00Z");
    expect((await repo.claim(a, "seventh day")).kind).toBe("limited");
    expect((await repo.exportForUser(b)).length).toBe(0);
    expect((await repo.exportForUser(a)).length).toBe(30);
  });
});
