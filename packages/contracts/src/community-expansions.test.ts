import { describe, it, expect } from "vitest";
import {
  communityMessagingCommandSchema,
  communityMessagingResponseSchema,
} from "./community-messaging";
import { communityBroaderDiscoveryCommandSchema } from "./community-broader-discovery";
import { communityChallengeCommandSchema } from "./community-challenges";
const id = "41000000-0000-4000-8000-000000000001";
describe("expansion transport boundaries", () => {
  it("rejects unsolicited targets/identity forgery and rich attachments", () => {
    expect(
      communityMessagingCommandSchema.safeParse({
        operation: "send",
        id,
        peerId: id,
        text: "Hello",
        userId: id,
      }).success,
    ).toBe(false);
    expect(
      communityMessagingCommandSchema.safeParse({
        operation: "send",
        id,
        peerId: id,
        text: "Hello",
        attachment: "private/id",
      }).success,
    ).toBe(false);
  });
  it("requires bounded text and optimistic edit version", () => {
    expect(
      communityMessagingCommandSchema.safeParse({
        operation: "send",
        id,
        peerId: id,
        text: " ",
      }).success,
    ).toBe(false);
    expect(
      communityMessagingCommandSchema.safeParse({
        operation: "edit",
        id,
        text: "Hello",
      }).success,
    ).toBe(false);
  });
  it("accepts real Postgres timestamp offsets", () => {
    expect(
      communityMessagingResponseSchema.safeParse({
        message: {
          id,
          userId: id,
          recipientId: id,
          text: "Hello",
          version: 1,
          createdAt: "2026-10-01T00:00:00+00:00",
          editedAt: null,
          deleted: false,
        },
      }).success,
    ).toBe(true);
  });
  it("excludes address book, wildcard and short enumeration requests", () => {
    for (const prefix of ["a", "a__%", "ab%", "abc@"])
      expect(
        communityBroaderDiscoveryCommandSchema.safeParse({
          operation: "search",
          prefix,
        }).success,
      ).toBe(false);
    expect(
      communityBroaderDiscoveryCommandSchema.safeParse({
        operation: "search",
        prefix: "abc",
        contacts: [id],
      }).success,
    ).toBe(false);
  });
  it("requires deliberate challenge join and a provenance workout only for workout declarations", () => {
    expect(
      communityChallengeCommandSchema.safeParse({ operation: "join", id })
        .success,
    ).toBe(false);
    expect(
      communityChallengeCommandSchema.safeParse({
        operation: "contribute",
        id,
        day: "2026-10-01",
        kind: "workout",
        confirmed: true,
      }).success,
    ).toBe(false);
    expect(
      communityChallengeCommandSchema.safeParse({
        operation: "contribute",
        id,
        day: "2026-10-01",
        kind: "rest",
        confirmed: true,
      }).success,
    ).toBe(true);
  });
});
