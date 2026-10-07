import { describe, expect, it, vi } from "vitest";
import type { SharedActivityFeedItemDto } from "@mizyun/contracts";

vi.mock("react-native", () => ({
  Platform: { select: (values: any) => values.ios },
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1,
  },
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    surface: "#ffffff",
    border: "#e5e5e5",
    foreground: "#000000",
    muted: "#666666",
    tint: "#007aff",
  }),
}));

import { ActivityCard } from "./activity-card";

const mockItem: SharedActivityFeedItemDto = {
  id: "act-123",
  authorUserId: "usr-456",
  authorHandle: "alex_fit",
  authorDisplayName: "Alex",
  authorAvatarSymbol: "AL",
  category: "strength",
  sharedDay: "2026-09-29",
  durationSeconds: 2700,
  workoutDetails: null,
  publishedAt: "2026-09-30T10:00:00.000Z",
  reactionCounts: {
    clap: 3,
    fire: 1,
    high_five: 0,
    fist_bump: 0,
    thumbs_up: 0,
  },
  viewerReaction: null,
};

describe("ActivityCard", () => {
  it("renders card element with accessible attributes and labels", () => {
    const onPress = vi.fn();
    const onOpenActions = vi.fn();
    const element = ActivityCard({
      item: mockItem,
      onPress,
      onOpenActions,
    });

    expect(element).not.toBeNull();
    expect(element.props.testID).toBe("activity-card-act-123");
    expect(element.props.accessible).toBe(false);
    const content = element.props.children[1];
    expect(content.props.accessibilityRole).toBe("button");
    expect(content.props.accessibilityLabel).toContain("Alex (@alex_fit)");
    expect(content.props.accessibilityLabel).toContain("Strength workout");
    expect(content.props.accessibilityLabel).toContain("Sep 29, 2026");
  });

  it("announces explicitly shared details in the feed while old cards remain minimal", () => {
    const details = {
      exercises: [
        {
          name: "Squat",
          sets: [
            {
              setType: "normal" as const,
              repetitions: 8,
              loadKg: 60,
              durationSeconds: null,
            },
          ],
        },
      ],
    };
    const detailed = ActivityCard({
      item: { ...mockItem, workoutDetails: details },
    });
    expect(detailed.props.children[1].props.accessibilityLabel).toContain(
      "1 exercises, workout details shared",
    );
    const minimal = ActivityCard({ item: mockItem });
    expect(minimal.props.children[1].props.accessibilityLabel).not.toContain(
      "workout details shared",
    );
  });
  it("handles null duration gracefully", () => {
    const itemWithoutDuration = { ...mockItem, durationSeconds: null };
    const element = ActivityCard({
      item: itemWithoutDuration,
    });
    expect(element).not.toBeNull();
    expect(element.props.testID).toBe("activity-card-act-123");
  });
});

vi.mock("../ui", () => ({
  CommunityPage: "CommunityPage",
  CommunityIdentityLink: "CommunityIdentityLink",
  CommunityButton: "CommunityButton",
}));
