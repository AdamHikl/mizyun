import { describe, expect, it } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CommunityDiscoveryRateLimiter } from "./discovery-routes.js";

const request = (actor: string, source = "127.0.0.1") =>
  ({
    principal: { userId: actor },
    ip: source,
    id: "test",
  }) as unknown as FastifyRequest;
const reply = () => {
  const result = {
    code: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.code = code;
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  return result;
};
describe("Community discovery budget", () => {
  it("combines lookup/resolve actor attempts and does not reset on source change", async () => {
    const limiter = new CommunityDiscoveryRateLimiter(() => 0);
    for (let i = 0; i < 30; i++) {
      const res = reply();
      await limiter.check(
        request("actor", `source-${i}`),
        res as unknown as FastifyReply,
      );
      expect(res.code).toBe(200);
    }
    const res = reply();
    await limiter.check(
      request("actor", "new-source"),
      res as unknown as FastifyReply,
    );
    expect(res.code).toBe(429);
  });
  it("limits many actors sharing an abuse source", async () => {
    const limiter = new CommunityDiscoveryRateLimiter(() => 0);
    for (let i = 0; i < 120; i++)
      await limiter.check(
        request(`actor-${i}`),
        reply() as unknown as FastifyReply,
      );
    const res = reply();
    await limiter.check(request("new-actor"), res as unknown as FastifyReply);
    expect(res.code).toBe(429);
  });
  it("enforces fixed UTC daily actor quota and resets at UTC midnight", async () => {
    const start = Date.parse("2026-09-30T23:50:00Z");
    let now = start;
    const limiter = new CommunityDiscoveryRateLimiter(() => now);
    for (let minute = 0; minute < 4; minute++) {
      now = start + minute * 60_001;
      for (let i = 0; i < 30; i++)
        await limiter.check(
          request("actor"),
          reply() as unknown as FastifyReply,
        );
    }
    now += 60_001;
    const exhausted = reply();
    await limiter.check(request("actor"), exhausted as unknown as FastifyReply);
    expect(exhausted.code).toBe(429);
    now = Date.parse("2026-10-01T00:00:00Z");
    const refreshed = reply();
    await limiter.check(request("actor"), refreshed as unknown as FastifyReply);
    expect(refreshed.code).toBe(200);
  });
  it("preserves the rolling minute cap across UTC midnight", async () => {
    let now = Date.parse("2026-09-30T23:59:59Z");
    const limiter = new CommunityDiscoveryRateLimiter(() => now);
    for (let i = 0; i < 30; i++)
      await limiter.check(request("actor"), reply() as unknown as FastifyReply);
    now = Date.parse("2026-10-01T00:00:00Z");
    const carried = reply();
    await limiter.check(request("actor"), carried as unknown as FastifyReply);
    expect(carried.code).toBe(429);
    now = Date.parse("2026-10-01T00:01:00Z");
    const reset = reply();
    await limiter.check(request("actor"), reset as unknown as FastifyReply);
    expect(reset.code).toBe(200);
  });
});
