import { describe, expect, it } from "vitest";
import {
  communityMessagingCommandSchema,
  communityMessagingResponseSchema,
} from "./community-messaging";
const id = "41000000-0000-4000-8000-000000000001";
const peerId = "41000000-0000-4000-8000-000000000002";
const before = { id, createdAt: "2026-10-07T10:00:00+00:00" };
const message = {
  id,
  userId: id,
  recipientId: peerId,
  text: "Hello",
  version: 1,
  createdAt: before.createdAt,
  editedAt: null,
  deleted: false,
};
describe("bounded Community messaging reads", () => {
  it("accepts a stable timestamp and UUID cursor for latest and thread pages", () => {
    for (const command of [
      { operation: "latest", peerId, before },
      { operation: "threads", before },
    ])
      expect(communityMessagingCommandSchema.safeParse(command).success).toBe(
        true,
      );
  });
  it("rejects forged caller identity, page limits and incomplete cursors", () => {
    for (const extra of [
      { userId: id },
      { limit: 9999 },
      { before: { id } },
      { before: { createdAt: before.createdAt } },
    ])
      expect(
        communityMessagingCommandSchema.safeParse({
          operation: "latest",
          peerId,
          ...extra,
        }).success,
      ).toBe(false);
  });
  it("validates real summaries while rejecting invented unread or presence claims", () => {
    const thread = {
      userId: peerId,
      displayName: "Connection",
      latestMessage: message,
    };
    expect(
      communityMessagingResponseSchema.safeParse({
        threads: [thread],
        nextBefore: before,
      }).success,
    ).toBe(true);
    for (const extra of [
      { unread: 1 },
      { online: true },
      { readAt: before.createdAt },
    ])
      expect(
        communityMessagingResponseSchema.safeParse({
          threads: [{ ...thread, ...extra }],
        }).success,
      ).toBe(false);
    expect(
      communityMessagingResponseSchema.safeParse({
        threads: Array.from({ length: 31 }, () => thread),
      }).success,
    ).toBe(false);
  });
  it("keeps the legacy oldest-first response compatible", () => {
    expect(
      communityMessagingResponseSchema.safeParse({
        messages: [message],
        nextCursor: id,
      }).success,
    ).toBe(true);
  });
});
