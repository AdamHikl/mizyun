import { describe, expect, it } from "vitest";
import { accountExportSchema } from "./account.js";

const record = {
  requestId: "83000000-0000-4000-8000-000000000002",
  operation: "suggest",
  status: "succeeded",
  createdAt: "2026-10-13T12:00:00.000Z",
  budgetDay: "2026-10-13",
  tokensCharged: 1500,
};
const schema = accountExportSchema.shape.recipeRequests;

describe("content-free recipe request account export", () => {
  it("accepts operational metadata and remains optional for older exports", () => {
    expect(schema.parse([record])).toEqual([record]);
    expect(schema.parse(undefined)).toBeUndefined();
  });
  it.each([
    { prompt: "private" },
    { fingerprint: "private" },
    { attemptId: "private" },
    { operation: "chat" },
    { status: "content" },
    { requestId: "bad" },
    { createdAt: "bad" },
    { budgetDay: "2026-02-30" },
    { tokensCharged: -1 },
    { tokensCharged: 0.5 },
    { tokensCharged: 2_000_001 },
  ])("rejects extra content and malformed accounting: %j", (change) => {
    expect(schema.safeParse([{ ...record, ...change }]).success).toBe(false);
  });
});
