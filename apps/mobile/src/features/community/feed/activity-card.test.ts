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

vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Card: "Card",
  Icon: "Icon",
  IconButton: "IconButton",
}));
vi.mock("@/constants/theme", () => ({
  PageGutter: 20,
  Radius: { pill: 999 },
  Spacing: { half: 2, one: 4, two: 8, three: 16 },
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
  activityKind: "workout",
  mealDetails: null,
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
    expect(element.type).toBe("Card");
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
  it("renders meals with a meal destination and excludes workout fields", () => {
    const meal = {
      name: "Lentil soup",
      caloriesKcal: 320,
      proteinG: 18,
      carbsG: 42,
      fatG: null,
    };
    const element = ActivityCard({
      item: { ...mockItem, activityKind: "meal", mealDetails: meal },
    });
    const content = element.props.children[1];
    expect(content.props.accessibilityLabel).toContain("Meal · Lentil soup");
    expect(content.props.accessibilityLabel).not.toContain("duration");
    expect(content.props.accessibilityLabel).not.toContain("Strength workout");
    expect(content.props.accessibilityHint).toBe("Open shared meal details");
    const projection = content.props.children.find(
      (child: any) => child?.props?.details === meal,
    );
    expect(projection.props.compact).toBe(true);
  });
  it("keeps card options as an icon button that opens actions without opening the card", () => {
    const onPress = vi.fn();
    const onOpenActions = vi.fn();
    const element = ActivityCard({ item: mockItem, onPress, onOpenActions });
    const options = element.props.children[0].props.children[1];
    expect(options.type).toBe("IconButton");
    expect(options.props.testID).toBe("activity-actions-act-123");
    expect(options.props.accessibilityLabel).toBe("Card options");
    const stopPropagation = vi.fn();
    options.props.onPress({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onOpenActions).toHaveBeenCalledOnce();
    expect(onPress).not.toHaveBeenCalled();
    expect(
      ActivityCard({ item: mockItem }).props.children[0].props.children[1],
    ).toBeFalsy();
  });
  it("renders a stale read-only card without navigation, options or button semantics", () => {
    const onPress = vi.fn();
    const onOpenActions = vi.fn();
    const element = ActivityCard({
      item: mockItem,
      onPress,
      onOpenActions,
      readOnly: true,
    });
    const header = element.props.children[0];
    const identity = header.props.children[0].props.children[0];
    expect(identity.props.disabled).toBe(true);
    expect(header.props.children[1]).toBe(false);
    const content = element.props.children[1];
    expect(content.props.onPress).toBeUndefined();
    expect(content.props.disabled).toBe(true);
    expect(content.props.accessibilityRole).toBeUndefined();
    expect(content.props.accessibilityHint).toBeUndefined();
  });
  it("renders a bouldering card from the allowlisted snapshot only", () => {
    const details = {
      activityDate: "2026-09-29",
      topGrade: "6C" as const,
      sends: 9,
      flashes: 4,
      gradeBreakdown: [
        { grade: "6C" as const, sends: 2 },
        { grade: "6B" as const, sends: 7 },
      ],
    };
    const element = ActivityCard({
      item: {
        ...mockItem,
        category: "other",
        // A stray duration must never be shown on a bouldering card.
        durationSeconds: 3600,
        activityKind: "bouldering",
        boulderingDetails: details,
      },
    });
    const content = element.props.children[1];
    const label = content.props.accessibilityLabel;
    expect(label).toContain("Bouldering session, top grade 6C");
    expect(label).toContain("9 sends, 4 flashes");
    expect(label).toContain("6C: 2 sends, 6B: 7 sends");
    expect(label).not.toContain("duration");
    expect(label).not.toContain("Other");
    expect(content.props.accessibilityHint).toBe(
      "Open shared bouldering session",
    );
    expect(content.props.children[0].props.children).toBe(
      "Bouldering · Top grade 6C",
    );
    const projection = content.props.children.find(
      (child: any) => child?.props?.details === details,
    );
    expect(projection.props.compact).toBe(true);
  });
  it("renders a bouldering card without breakdown or sends", () => {
    const element = ActivityCard({
      item: {
        ...mockItem,
        durationSeconds: null,
        activityKind: "bouldering",
        boulderingDetails: {
          activityDate: "2026-09-29",
          topGrade: null,
          sends: 0,
          flashes: 0,
          gradeBreakdown: null,
        },
      },
    });
    const content = element.props.children[1];
    expect(content.props.children[0].props.children).toBe(
      "Bouldering · No sends",
    );
    expect(content.props.accessibilityLabel).toContain("0 sends, 0 flashes");
    expect(content.props.accessibilityLabel).not.toContain("sends by grade");
  });
  it("keeps the workout fallback for an unknown future kind", () => {
    const element = ActivityCard({
      item: {
        ...mockItem,
        activityKind: "future_kind" as never,
        boulderingDetails: undefined,
      },
    });
    const content = element.props.children[1];
    expect(content.props.accessibilityLabel).toContain("Strength workout");
    expect(content.props.accessibilityHint).toBe("Open shared workout details");
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
