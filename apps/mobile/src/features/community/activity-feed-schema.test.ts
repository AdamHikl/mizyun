import { describe, expect, it } from "vitest";
import { communityFeedResponseSchema } from "@mizyun/contracts";
import { tolerantCommunityFeedResponseSchema } from "./activity-feed-schema";

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  authorUserId: "00000000-0000-4000-8000-000000000001",
  authorHandle: "friend",
  authorDisplayName: "Friend",
  authorAvatarSymbol: "FR",
  activityKind: "workout",
  category: "strength",
  sharedDay: "2026-10-16",
  durationSeconds: null,
  publishedAt: "2026-10-16T10:00:00.000Z",
  reactionCounts: {},
  viewerReaction: null,
  ...extra,
});
const a = "00000000-0000-4000-8000-00000000000a";
const b = "00000000-0000-4000-8000-00000000000b";
const c = "00000000-0000-4000-8000-00000000000c";

describe("tolerant Community feed page", () => {
  it("skips a card of an unknown future kind instead of failing the page", () => {
    const page = {
      items: [
        item(a),
        item(b, { activityKind: "kayaking", kayakingDetails: {} }),
        item(c, {
          activityKind: "bouldering",
          boulderingDetails: {
            activityDate: "2026-10-16",
            topGrade: "6C",
            sends: 9,
            flashes: 4,
            gradeBreakdown: null,
          },
        }),
      ],
      nextCursor: "next",
    };
    expect(communityFeedResponseSchema.safeParse(page).success).toBe(false);
    const parsed = tolerantCommunityFeedResponseSchema.parse(page);
    expect(parsed.items.map((entry) => entry.id)).toEqual([a, c]);
    expect(parsed.nextCursor).toBe("next");
  });
  it("still rejects a page with a malformed card of a known kind", () => {
    const page = { items: [item(a), item(b, { sharedDay: "yesterday" })] };
    expect(tolerantCommunityFeedResponseSchema.safeParse(page).success).toBe(
      false,
    );
    expect(
      tolerantCommunityFeedResponseSchema.safeParse({
        items: [
          item(a, {
            activityKind: "bouldering",
            boulderingDetails: { sends: -1 },
          }),
        ],
      }).success,
    ).toBe(false);
  });
  it("keeps legacy items without a kind as workouts", () => {
    const legacy = item(a);
    delete (legacy as Record<string, unknown>).activityKind;
    expect(
      tolerantCommunityFeedResponseSchema.parse({ items: [legacy] }).items[0]!
        .activityKind,
    ).toBe("workout");
  });
});
