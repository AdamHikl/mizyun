import { describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiError } from "@mizyun/api-client";
import type { CommunityReactionKind, ReactorSummary } from "@mizyun/contracts";
import {
  REACTION_EMOJIS,
  REACTION_LABELS,
  SUPPORTED_REACTIONS,
} from "./constants";
import {
  computeOptimisticReaction,
  defaultReactionCounts,
  getTotalReactionCount,
} from "./reaction-state";
import { buildReactionAccessibilityLabel, ReactionBar } from "./reaction-bar";
import { ReactionBarController } from "./reaction-bar-controller";
import { formatReactorTimestamp, ReactorsModal } from "./reactors-modal";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: any) => [
      typeof initial === "function" ? initial() : initial,
      vi.fn(),
    ],
    useRef: (initial: any) => ({ current: initial }),
    useEffect: vi.fn(),
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(),
  };
});

vi.mock("react-native", () => ({
  Platform: { select: (values: any) => values.ios },
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1,
  },
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  Modal: "Modal",
  ScrollView: "ScrollView",
  ActivityIndicator: "ActivityIndicator",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    text: "#0F172A",
    textSecondary: "#64748B",
    primary: "#059669",
    primaryLight: "#D1FAE5",
    backgroundSelected: "#222D35",
    border: "#CBD5E1",
  }),
}));

vi.mock("../initials-avatar", () => ({
  InitialsAvatar: (props: any) => ({
    type: "InitialsAvatar",
    props,
  }),
}));
vi.mock("../ui", () => ({ CommunityIdentityLink: "CommunityIdentityLink" }));

describe("COMM-08 Reversible encouragement reactions", () => {
  describe("constants and definitions", () => {
    it("defines the 5 predefined supportive reactions in required order", () => {
      expect(SUPPORTED_REACTIONS.map((r) => r.kind)).toEqual([
        "clap",
        "fire",
        "high_five",
        "fist_bump",
        "thumbs_up",
      ]);
      expect(SUPPORTED_REACTIONS.map((r) => r.emoji)).toEqual([
        "👏",
        "🔥",
        "🙌",
        "👊",
        "👍",
      ]);
    });

    it("maps all kinds to correct emojis and labels", () => {
      for (const def of SUPPORTED_REACTIONS) {
        expect(REACTION_EMOJIS[def.kind]).toBe(def.emoji);
        expect(REACTION_LABELS[def.kind]).toBe(def.label);
      }
    });
  });

  describe("reaction-state pure transitions", () => {
    it("adds reaction when currently null", () => {
      const initialCounts = {
        clap: 0,
        fire: 2,
        high_five: 0,
        fist_bump: 0,
        thumbs_up: 0,
      };
      const result = computeOptimisticReaction(null, initialCounts, "clap");
      expect(result.viewerReaction).toBe("clap");
      expect(result.reactionCounts.clap).toBe(1);
      expect(result.reactionCounts.fire).toBe(2);
    });

    it("removes reaction when tapping already active reaction (toggle off)", () => {
      const initialCounts = {
        clap: 3,
        fire: 1,
        high_five: 0,
        fist_bump: 0,
        thumbs_up: 0,
      };
      const result = computeOptimisticReaction("clap", initialCounts, "clap");
      expect(result.viewerReaction).toBeNull();
      expect(result.reactionCounts.clap).toBe(2);
      expect(result.reactionCounts.fire).toBe(1);
    });

    it("replaces active reaction with another reaction", () => {
      const initialCounts = {
        clap: 2,
        fire: 0,
        high_five: 1,
        fist_bump: 0,
        thumbs_up: 0,
      };
      const result = computeOptimisticReaction("clap", initialCounts, "fire");
      expect(result.viewerReaction).toBe("fire");
      expect(result.reactionCounts.clap).toBe(1);
      expect(result.reactionCounts.fire).toBe(1);
      expect(result.reactionCounts.high_five).toBe(1);
    });

    it("does not decrement count below zero", () => {
      const zeroCounts = defaultReactionCounts();
      const result = computeOptimisticReaction("clap", zeroCounts, "clap");
      expect(result.reactionCounts.clap).toBe(0);
    });

    it("computes total reaction count correctly", () => {
      expect(
        getTotalReactionCount({
          clap: 3,
          fire: 2,
          high_five: 1,
          fist_bump: 0,
          thumbs_up: 4,
        }),
      ).toBe(10);
    });
  });

  describe("accessibility spoken labels", () => {
    it("generates label for unselected reaction for regular viewer", () => {
      const label = buildReactionAccessibilityLabel({
        kind: "clap",
        label: "Clap",
        count: 0,
        isSelected: false,
        isAuthor: false,
        totalReactions: 0,
      });
      expect(label).toBe("Clap, 0 reactions. Tap to react.");
    });

    it("generates label with singular reaction count", () => {
      const label = buildReactionAccessibilityLabel({
        kind: "fire",
        label: "Fire",
        count: 1,
        isSelected: false,
        isAuthor: false,
        totalReactions: 1,
      });
      expect(label).toBe("Fire, 1 reaction. Tap to react.");
    });

    it("generates label for selected reaction indicating tap to remove", () => {
      const label = buildReactionAccessibilityLabel({
        kind: "high_five",
        label: "High five",
        count: 2,
        isSelected: true,
        isAuthor: false,
        totalReactions: 2,
      });
      expect(label).toBe(
        "High five, 2 reactions. Selected. Tap to remove reaction.",
      );
    });

    it("generates label for author with reactions indicating tap to view who reacted", () => {
      const label = buildReactionAccessibilityLabel({
        kind: "fist_bump",
        label: "Fist bump",
        count: 3,
        isSelected: false,
        isAuthor: true,
        totalReactions: 5,
      });
      expect(label).toBe("Fist bump, 3 reactions. Tap to view who reacted.");
    });

    it("generates label for author with 0 reactions indicating cannot react to own workout", () => {
      const label = buildReactionAccessibilityLabel({
        kind: "thumbs_up",
        label: "Thumbs up",
        count: 0,
        isSelected: false,
        isAuthor: true,
        totalReactions: 0,
      });
      expect(label).toBe(
        "Thumbs up, 0 reactions. Cannot react to your own activity.",
      );
    });
  });

  describe("ReactionBarController", () => {
    const defaultCounts = {
      clap: 1,
      fire: 0,
      high_five: 0,
      fist_bump: 0,
      thumbs_up: 0,
    };

    it("optimistically toggles on a reaction and reconciles with server response", async () => {
      const serverResponse = {
        activityId: "act-1",
        reactionCounts: {
          clap: 1,
          fire: 1,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 0,
        },
        viewerReaction: "fire",
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: serverResponse });
      const client = { request } as unknown as ApiClient;
      const onReactionChanged = vi.fn();

      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: defaultCounts,
        initialViewerReaction: null,
        scopedClient: client,
        onReactionChanged,
      });

      const promise = controller.toggleReaction("fire");

      // Before server resolves: optimistic state is active
      expect(onReactionChanged).toHaveBeenCalledWith("fire", {
        clap: 1,
        fire: 1,
        high_five: 0,
        fist_bump: 0,
        thumbs_up: 0,
      });

      const success = await promise;
      expect(success).toBe(true);
      expect(controller.state.viewerReaction).toBe("fire");
      expect(controller.state.reactionCounts.fire).toBe(1);
      expect(controller.state.isPending).toBe(false);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "PUT",
          path: "/v1/community/activities/act-1/reaction",
          body: { reaction: "fire" },
        }),
      );
    });

    it("removes an active reaction by setting viewerReaction to null", async () => {
      const serverResponse = {
        activityId: "act-1",
        reactionCounts: {
          clap: 0,
          fire: 0,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 0,
        },
        viewerReaction: null,
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: serverResponse });
      const client = { request } as unknown as ApiClient;
      const onReactionChanged = vi.fn();

      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: defaultCounts,
        initialViewerReaction: "clap",
        scopedClient: client,
        onReactionChanged,
      });

      const promise = controller.toggleReaction("clap");

      expect(onReactionChanged).toHaveBeenCalledWith(null, {
        clap: 0,
        fire: 0,
        high_five: 0,
        fist_bump: 0,
        thumbs_up: 0,
      });

      await promise;
      expect(controller.state.viewerReaction).toBeNull();
      expect(controller.state.reactionCounts.clap).toBe(0);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "PUT",
          path: "/v1/community/activities/act-1/reaction",
          body: { reaction: null },
        }),
      );
    });

    it("replaces active reaction with another reaction", async () => {
      const serverResponse = {
        activityId: "act-1",
        reactionCounts: {
          clap: 0,
          fire: 1,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 0,
        },
        viewerReaction: "fire",
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: serverResponse });
      const client = { request } as unknown as ApiClient;
      const onReactionChanged = vi.fn();

      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: defaultCounts,
        initialViewerReaction: "clap",
        scopedClient: client,
        onReactionChanged,
      });

      await controller.toggleReaction("fire");

      expect(controller.state.viewerReaction).toBe("fire");
      expect(controller.state.reactionCounts.clap).toBe(0);
      expect(controller.state.reactionCounts.fire).toBe(1);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { reaction: "fire" },
        }),
      );
    });

    it("rolls back state and notifies callback on API failure", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 500,
          message: "Internal server error",
        },
      });
      const client = { request } as unknown as ApiClient;
      const onReactionChanged = vi.fn();

      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: {
          clap: 2,
          fire: 0,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 0,
        },
        initialViewerReaction: "clap",
        scopedClient: client,
        onReactionChanged,
      });

      const success = await controller.toggleReaction("fire");

      expect(success).toBe(false);
      // Rolled back to original state
      expect(controller.state.viewerReaction).toBe("clap");
      expect(controller.state.reactionCounts.clap).toBe(2);
      expect(controller.state.reactionCounts.fire).toBe(0);
      expect(controller.state.error).toBe("Internal server error");

      // Verify onReactionChanged was called with rolled-back state
      expect(onReactionChanged).toHaveBeenLastCalledWith("clap", {
        clap: 2,
        fire: 0,
        high_five: 0,
        fist_bump: 0,
        thumbs_up: 0,
      });
    });

    it("rolls back state on network exception", async () => {
      const request = vi.fn().mockRejectedValue(new Error("Network drop"));
      const client = { request } as unknown as ApiClient;
      const onReactionChanged = vi.fn();

      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: defaultCounts,
        initialViewerReaction: null,
        scopedClient: client,
        onReactionChanged,
      });

      const success = await controller.toggleReaction("fire");
      expect(success).toBe(false);
      expect(controller.state.viewerReaction).toBeNull();
      expect(controller.state.reactionCounts.fire).toBe(0);
      expect(controller.state.error).toContain("Could not update reaction");
    });

    it.each([
      {
        kind: "http_error",
        status: 403,
        code: "FORBIDDEN",
        message: "Unavailable",
      },
      {
        kind: "http_error",
        status: 404,
        code: "NOT_FOUND",
        message: "Unavailable",
      },
      {
        kind: "http_error",
        status: 401,
        code: "UNAUTHORIZED",
        message: "Unavailable",
      },
      { kind: "no_session" },
      { kind: "session_expired" },
    ] satisfies ApiError[])(
      "clears the displayed card on lost authority: %j",
      async (error) => {
        const request = vi.fn().mockResolvedValue({ ok: false, error });
        const changed = vi.fn();
        let displayedCard: string | null = "friend health card";
        const unavailable = vi.fn(() => {
          displayedCard = null;
        });
        const controller = new ReactionBarController({
          activityId: "act-1",
          authorUserId: "author-1",
          viewerUserId: "viewer-2",
          initialReactionCounts: defaultCounts,
          initialViewerReaction: "clap",
          scopedClient: { request } as unknown as ApiClient,
          onReactionChanged: changed,
          onUnavailable: unavailable,
        });
        expect(await controller.toggleReaction("fire")).toBe(false);
        expect(displayedCard).toBeNull();
        expect(unavailable).toHaveBeenCalledTimes(1);
        expect(controller.state.reactionCounts).toEqual(
          defaultReactionCounts(),
        );
        expect(controller.state.viewerReaction).toBeNull();
        // The optimistic callback may run, but denied access must never restore
        // the previously cached reaction snapshot or issue another mutation.
        expect(changed).toHaveBeenCalledTimes(1);
        expect(await controller.toggleReaction("clap")).toBe(false);
        expect(request).toHaveBeenCalledTimes(1);
      },
    );

    it("retries the same desired reaction after a committed response is lost and remounts from the fresh result", async () => {
      let saved: string | null = null;
      const request = vi.fn().mockImplementation(async (options) => {
        saved = options.body.reaction;
        if (request.mock.calls.length === 1)
          throw new Error("Response lost after commit");
        return {
          ok: true,
          value: {
            activityId: "act-1",
            viewerReaction: saved,
            reactionCounts: {
              ...defaultCounts,
              clap: saved === "clap" ? 1 : 0,
            },
          },
        };
      });
      const options = {
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: defaultCounts,
        initialViewerReaction: null,
        scopedClient: { request } as unknown as ApiClient,
      };
      const controller = new ReactionBarController(options);
      expect(await controller.toggleReaction("clap")).toBe(false);
      expect(saved).toBe("clap");
      expect(controller.state.viewerReaction).toBeNull();
      expect(await controller.toggleReaction("clap")).toBe(true);
      expect(request.mock.calls.map((call) => call[0].body.reaction)).toEqual([
        "clap",
        "clap",
      ]);
      controller.retire();
      const restarted = new ReactionBarController({
        ...options,
        initialViewerReaction: "clap",
        initialReactionCounts: { ...defaultCounts, clap: 1 },
      });
      expect(restarted.state.viewerReaction).toBe("clap");
      expect(restarted.totalReactions).toBe(1);
    });

    it("defends against rapid taps by dropping requests while in-flight", async () => {
      let resolveRequest!: (val: unknown) => void;
      const request = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      );
      const client = { request } as unknown as ApiClient;

      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: defaultCounts,
        initialViewerReaction: null,
        scopedClient: client,
      });

      // First tap starts request
      const firstTap = controller.toggleReaction("clap");
      expect(controller.state.isPending).toBe(true);

      // Rapid consecutive taps while first is still pending
      const secondTap = await controller.toggleReaction("fire");
      const thirdTap = await controller.toggleReaction("clap");

      expect(secondTap).toBe(false);
      expect(thirdTap).toBe(false);
      // Only 1 API request should have been dispatched
      expect(request).toHaveBeenCalledTimes(1);

      // Finish first request
      resolveRequest({
        ok: true,
        value: {
          activityId: "act-1",
          reactionCounts: {
            clap: 2,
            fire: 0,
            high_five: 0,
            fist_bump: 0,
            thumbs_up: 0,
          },
          viewerReaction: "clap",
        },
      });
      await firstTap;

      expect(controller.state.isPending).toBe(false);
      expect(controller.state.viewerReaction).toBe("clap");
    });

    it("prevents author from reacting to their own workout", async () => {
      const request = vi.fn();
      const client = { request } as unknown as ApiClient;

      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "user-author",
        viewerUserId: "user-author", // author === viewer
        initialReactionCounts: defaultCounts,
        initialViewerReaction: null,
        scopedClient: client,
      });

      expect(controller.isAuthor).toBe(true);

      // Tapping reaction does not dispatch API call
      const result = await controller.toggleReaction("clap");
      expect(result).toBe(false);
      expect(request).not.toHaveBeenCalled();

      // Since there are reactions (total > 0), tapping opened the reactors modal
      expect(controller.state.isModalOpen).toBe(true);
    });

    it("does not open modal for author when there are 0 reactions", async () => {
      const request = vi.fn();
      const client = { request } as unknown as ApiClient;

      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "user-author",
        viewerUserId: "user-author",
        initialReactionCounts: defaultReactionCounts(),
        initialViewerReaction: null,
        scopedClient: client,
      });

      const result = await controller.toggleReaction("clap");
      expect(result).toBe(false);
      expect(request).not.toHaveBeenCalled();
      expect(controller.state.isModalOpen).toBe(false);
    });

    it("supports opening and closing reactors modal directly", () => {
      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "author-1",
        initialReactionCounts: defaultCounts,
        initialViewerReaction: null,
      });

      expect(controller.state.isModalOpen).toBe(false);
      controller.openReactorsModal();
      expect(controller.state.isModalOpen).toBe(true);
      controller.closeReactorsModal();
      expect(controller.state.isModalOpen).toBe(false);
    });

    it("resets state when activityId option changes", () => {
      const controller = new ReactionBarController({
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: defaultCounts,
        initialViewerReaction: "clap",
      });

      expect(controller.state.viewerReaction).toBe("clap");

      controller.updateOptions({
        activityId: "act-2",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: defaultReactionCounts(),
        initialViewerReaction: null,
      });

      expect(controller.state.viewerReaction).toBeNull();
      expect(controller.state.reactionCounts.clap).toBe(0);
    });
  });

  describe("ReactionBar component rendering", () => {
    it("renders reaction bar with 5 buttons and correct initial counts", () => {
      const element = ReactionBar({
        activityId: "act-1",
        authorUserId: "author-1",
        viewerUserId: "viewer-2",
        initialReactionCounts: {
          clap: 3,
          fire: 1,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 5,
        },
        initialViewerReaction: "fire",
      });

      expect(element).toBeDefined();
      expect(element.props.testID).toBe("reaction-bar-act-1");

      const barView = element.props.children[0];
      const buttons = barView.props.children[1];
      expect(buttons).toHaveLength(5);

      // Check each button
      const clapBtn = buttons.find(
        (b: any) => b.props.testID === "reaction-btn-clap",
      );
      expect(clapBtn.props.accessibilityRole).toBe("button");
      expect(clapBtn.props.accessibilityState.selected).toBe(false);
      expect(clapBtn.props.accessibilityLabel).toBe(
        "Clap, 3 reactions. Tap to react.",
      );

      const fireBtn = buttons.find(
        (b: any) => b.props.testID === "reaction-btn-fire",
      );
      expect(fireBtn.props.accessibilityState.selected).toBe(true);
      expect(fireBtn.props.accessibilityLabel).toBe(
        "Fire, 1 reaction. Selected. Tap to remove reaction.",
      );
    });

    it("renders 'Who reacted' button for author when total reactions > 0", () => {
      const element = ReactionBar({
        activityId: "act-1",
        authorUserId: "user-author",
        viewerUserId: "user-author", // author view
        initialReactionCounts: {
          clap: 2,
          fire: 1,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 0,
        },
        initialViewerReaction: null,
      });

      const barView = element.props.children[0];
      const authorViewReactorsBtn = barView.props.children[2];
      expect(authorViewReactorsBtn).toBeDefined();
      expect(authorViewReactorsBtn.props.testID).toBe(
        "author-view-reactors-btn",
      );
      expect(authorViewReactorsBtn.props.accessibilityLabel).toBe(
        "View all 3 reactors",
      );
    });

    it("disables reaction buttons for author when 0 reactions exist", () => {
      const element = ReactionBar({
        activityId: "act-1",
        authorUserId: "user-author",
        viewerUserId: "user-author",
        initialReactionCounts: defaultReactionCounts(),
        initialViewerReaction: null,
      });

      const barView = element.props.children[0];
      const buttons = barView.props.children[1];
      const clapBtn = buttons.find(
        (b: any) => b.props.testID === "reaction-btn-clap",
      );
      expect(clapBtn.props.disabled).toBe(true);
      expect(clapBtn.props.accessibilityState.disabled).toBe(true);
      expect(clapBtn.props.accessibilityLabel).toBe(
        "Clap, 0 reactions. Cannot react to your own activity.",
      );
    });
  });

  describe("reactors-modal", () => {
    it("formats reactor timestamps correctly", () => {
      const now = new Date();
      expect(formatReactorTimestamp(now.toISOString())).toBe("just now");

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      expect(formatReactorTimestamp(fiveMinAgo.toISOString())).toBe("5m ago");

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatReactorTimestamp(twoHoursAgo.toISOString())).toBe("2h ago");

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(formatReactorTimestamp(threeDaysAgo.toISOString())).toBe("3d ago");

      expect(formatReactorTimestamp("invalid")).toBe("");
    });

    it("renders list of reactors with display name, handle, avatar symbol, and reaction emoji", () => {
      const mockReactors: readonly ReactorSummary[] = [
        {
          userId: "u-1",
          displayName: "Maria Silva",
          handle: "maria_s",
          avatarSymbol: "MS",
          reaction: "fire",
          createdAt: new Date(Date.now() - 120000).toISOString(),
        },
        {
          userId: "u-2",
          displayName: "Alex Wong",
          handle: "alex_w",
          avatarSymbol: "AW",
          reaction: "clap",
          createdAt: new Date(Date.now() - 3600000).toISOString(),
        },
      ];

      const onClose = vi.fn();
      const element = ReactorsModal({
        visible: true,
        activityId: "act-1",
        initialReactors: mockReactors,
        onClose,
      });

      expect(element).not.toBeNull();
      if (!element) return;
      expect(element.props.visible).toBe(true);
      expect(element.props.testID).toBe("reactors-modal");

      // Card view contains header and list
      const overlay = element.props.children;
      const card = overlay.props.children;
      const [header, content] = card.props.children;

      expect(header.props.children[0].props.children).toBe("Reactions");
      const closeBtn = header.props.children[1];
      expect(closeBtn.props.testID).toBe("reactors-close-btn");
      closeBtn.props.onPress();
      expect(onClose).toHaveBeenCalled();

      // Content has the scroll view
      expect(content.props.testID).toBe("reactors-list");
      const items = content.props.children;
      expect(items).toHaveLength(2);

      const firstReactor = items[0];
      expect(firstReactor.props.testID).toBe("reactor-item-u-1");
      expect(firstReactor.props.accessibilityLabel).toContain("Maria Silva");
      expect(firstReactor.props.accessibilityLabel).toContain("@maria_s");
      expect(firstReactor.props.accessibilityLabel).toContain(
        "reacted with Fire",
      );
      const identity = firstReactor.props.children[0].props.children;
      expect(identity.props.userId).toBe("u-1");
      expect(identity.props.onPress).toBe(onClose);
    });

    it("renders null when visible is false", () => {
      const element = ReactorsModal({
        visible: false,
        activityId: "act-1",
        onClose: vi.fn(),
      });
      expect(element).toBeNull();
    });
  });
  it("ignores a committed-but-late reaction response after viewer switch", async () => {
    let finish!: (value: unknown) => void;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = { request } as unknown as ApiClient;
    const changed = vi.fn();
    const options = {
      activityId: "activity",
      authorUserId: "author",
      viewerUserId: "first",
      initialViewerReaction: null,
      scopedClient: client,
      onReactionChanged: changed,
    };
    const controller = new ReactionBarController(options);
    const pending = controller.toggleReaction("fire");
    controller.updateOptions({ ...options, viewerUserId: "second" });
    changed.mockClear();
    finish({
      ok: true,
      value: { viewerReaction: "fire", reactionCounts: { fire: 1 } },
    });
    expect(await pending).toBe(false);
    expect(controller.state.viewerReaction).toBeNull();
    expect(controller.state.reactionCounts.fire).toBe(0);
    expect(changed).not.toHaveBeenCalled();
  });
});
