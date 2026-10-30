import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  realLoad: null as null | typeof import("./coach-data").loadCoachWith,
  apiRequest: vi.fn(),
  peek: vi.fn(),
  create: vi.fn(),
  thread: vi.fn(),
  send: vi.fn(),
  photo: vi.fn(),
  capability: vi.fn(),
  remove: vi.fn(),
  adapt: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
  alert: vi.fn(),
  announce: vi.fn(),
  permission: vi.fn(),
  picker: vi.fn(),
  normalize: vi.fn(),
  track: vi.fn(),
  consent: true,
  pendingAction: null as any,
  execute: null as any,
  params: {} as { prompt?: string; autoSend?: string },
  owner: "synthetic-user",
  token: "synthetic-token",
  appState: "active",
  fontScale: 1,
  platform: "ios",
  headerHeight: 128,
  appListeners: new Set<(state: string) => void>(),
  readListeners: new Set<(path: string) => void>(),
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => {
  const memo = (fn: () => unknown, deps: any[]) => {
    const i = hooks.index++;
    const previous = hooks.slots[i];
    if (!previous || deps.some((v, j) => !Object.is(v, previous.deps[j]))) {
      hooks.slots[i] = { deps, value: fn() };
    }
    return hooks.slots[i].value;
  };
  return {
    ...(await original<typeof import("react")>()),
    useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
    useState: (initial: any) => {
      const i = hooks.index++;
      if (!(i in hooks.slots))
        hooks.slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        hooks.slots[i],
        (next: any) => {
          hooks.slots[i] =
            typeof next === "function" ? next(hooks.slots[i]) : next;
        },
      ];
    },
    useMemo: memo,
    useCallback: (fn: unknown, deps: any[]) => memo(() => fn, deps),
    useEffect: (callback: () => void, deps: any[]) => {
      const i = hooks.index++;
      const previous = hooks.slots[i];
      if (!previous || deps.some((v, j) => !Object.is(v, previous.deps[j]))) {
        hooks.effects.push(() => {
          previous?.cleanup?.();
          hooks.slots[i] = { deps, cleanup: callback() };
        });
      }
    },
  };
});
vi.mock("react-native", () => ({
  useWindowDimensions: () => ({
    width: 393,
    height: 852,
    fontScale: mocks.fontScale,
  }),
  AccessibilityInfo: { announceForAccessibility: mocks.announce },
  ActivityIndicator: "ActivityIndicator",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  Platform: {
    get OS() {
      return mocks.platform;
    },
    select: (values: any) => values[mocks.platform],
  },
  StyleSheet: { create: (s: unknown) => s },
  Keyboard: { addListener: () => ({ remove: vi.fn() }) },
  AppState: {
    get currentState() {
      return mocks.appState;
    },
    addEventListener: (_: string, callback: (state: string) => void) => {
      mocks.appListeners.add(callback);
      return { remove: () => mocks.appListeners.delete(callback) };
    },
  },
  Alert: { alert: mocks.alert },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useLocalSearchParams: () => mocks.params,
}));
vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: mocks.permission,
  launchImageLibraryAsync: mocks.picker,
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Chip: "Chip",
  Icon: "Icon",
  IconBadge: "IconBadge",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/components/tab-header", () => ({
  TabHeader: "TabHeader",
  useTabHeaderLayout: () => ({
    headerHeight: mocks.headerHeight,
    onHeaderLayout: () => {},
  }),
}));
vi.mock("@/components/brand-wordmark", () => ({
  BrandWordmark: "BrandWordmark",
}));
vi.mock("@/components/account-header-button", () => ({
  AccountHeaderActions: "AccountHeaderActions",
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "#fff" }) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.owner }, accessToken: mocks.token },
    profile: null,
    refreshProfile: vi.fn(),
  }),
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: { track: mocks.track },
}));
vi.mock("@/composition/personal-read-events", () => ({
  subscribeSessionReadUpdates: (listener: (path: string) => void) => {
    mocks.readListeners.add(listener);
    return () => mocks.readListeners.delete(listener);
  },
}));
vi.mock("@/features/logging-draft-storage", () => ({
  loadLoggingDraft: async () => null,
  saveLoggingDraft: mocks.saveDraft,
  clearLoggingDraft: mocks.clearDraft,
}));
vi.mock("@/features/log-meal/advanced-nutrition", () => ({
  fetchAdvancedNutritionCapability: mocks.capability,
}));
vi.mock("@/features/log-meal/meal-photo", () => ({
  normalizeMealPhoto: mocks.normalize,
}));
vi.mock("./ai-consent-controller", () => ({
  useAiConsentController: ({ onExecuteAction }: any) => {
    mocks.execute = onExecuteAction;
    return {
      requestAction: async (action: any) => {
        if (mocks.consent) await onExecuteAction(action);
        else mocks.pendingAction = action;
      },
    };
  },
}));
vi.mock("./ai-consent-modal", () => ({ AiConsentModal: "AiConsentModal" }));
vi.mock("./thread-list-sheet", () => ({ ThreadListSheet: "ThreadListSheet" }));
vi.mock("./multi-workout-plan", () => ({
  humanFocusLabel: vi.fn(),
  saveMultiWorkoutPlan: vi.fn(),
}));
vi.mock("./workout-edit-proposal", () => ({
  applyWorkoutEditProposal: vi.fn(),
}));
vi.mock("@/features/log-meal/meal-form", () => ({
  mealFormStringsFromDraft: vi.fn(),
}));
vi.mock("./training-plan-card", () => ({
  TrainingPlanCard: "TrainingPlanCard",
}));
vi.mock("@/features/workouts/workouts-hub-data", () => ({
  createCustomWorkout: vi.fn(),
  startRoutineSession: vi.fn(),
}));
vi.mock("./coach-data", async (original) => {
  const actual = await original<typeof import("./coach-data")>();
  mocks.realLoad = actual.loadCoachWith;
  return {
    ...actual,
    loadCoach: mocks.load,
    loadCoachWith: mocks.load,
    peekCoachHistory: mocks.peek,
    createCoachConversation: mocks.create,
    loadCoachThread: mocks.thread,
    sendCoachMessage: mocks.send,
    sendCoachMealPhoto: mocks.photo,
    deleteCoachConversation: mocks.remove,
    acceptWeeklyAdaptation: mocks.adapt,
  };
});

import { CoachSetupScreen } from "./coach-setup-screen";

const conversation = {
  id: "thread-a",
  title: "Coach check-in",
  status: "active",
  createdAt: "2026-10-04T10:00:00Z",
  updatedAt: "2026-10-04T10:00:00Z",
};
const ready = { ready: true, reason: null };
const render = () => {
  hooks.index = 0;
  const tree = CoachSetupScreen();
  const effects = hooks.effects.splice(0);
  effects.forEach((effect) => effect());
  return tree;
};
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const nodes = (tree: any): any[] => {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  // TabHeader renders its icon actions from the `actions` prop.
  return [tree, ...nodes(tree.props?.actions), ...nodes(tree.props?.children)];
};
const labelled = (tree: any, label: string) =>
  nodes(tree).find((n) => n.props?.accessibilityLabel === label);
const text = (tree: any, value: string) =>
  nodes(tree).some((n) => n.props?.children === value);
const open = async () => {
  render();
  await settle();
  return render();
};
const typeMessage = (value = "Help me plan today") => {
  labelled(render(), "Message Coach").props.onChangeText(value);
  return labelled(render(), "Send message");
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    fn();
    return 0;
  });
  hooks.slots = [];
  hooks.index = 0;
  hooks.effects = [];
  Object.values(mocks).forEach((v) => {
    if (vi.isMockFunction(v)) v.mockReset();
  });
  mocks.consent = true;
  mocks.pendingAction = null;
  mocks.params = {};
  mocks.owner = "synthetic-user";
  mocks.token = "synthetic-token";
  mocks.appState = "active";
  mocks.fontScale = 1;
  mocks.platform = "ios";
  mocks.headerHeight = 128;
  mocks.appListeners.clear();
  mocks.readListeners.clear();
  mocks.load.mockResolvedValue({ ok: true, status: ready, conversations: [] });
  mocks.peek.mockReturnValue(null);
  mocks.create.mockResolvedValue({ ok: true, conversation, messages: [] });
  mocks.thread.mockResolvedValue({ ok: true, conversation, messages: [] });
  mocks.send.mockResolvedValue({ ok: true, conversation, messages: [] });
  mocks.capability.mockResolvedValue(true);
  mocks.photo.mockResolvedValue({ ok: true, conversation, messages: [] });
  mocks.remove.mockResolvedValue({ ok: true });
  mocks.permission.mockResolvedValue({ granted: true });
  mocks.picker.mockResolvedValue({ canceled: false, assets: [{}] });
  mocks.normalize.mockResolvedValue(new Blob());
  mocks.track.mockResolvedValue({ recorded: true });
});
afterEach(() => {
  hooks.slots.forEach((slot) => slot?.cleanup?.());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Coach translucent header", () => {
  const flatten = (style: any) => Object.assign({}, ...[style].flat(Infinity));

  it("lets messages scroll behind the full header and reserves its remeasured height", async () => {
    let tree = await open();
    const chrome = () => nodes(tree).find((node) => node.type === "TabHeader");
    const keyboard = () =>
      nodes(tree).find((node) => node.type === "KeyboardAvoidingView");
    const transcript = () =>
      nodes(tree).find((node) => node.type === "ScrollView");
    expect(
      labelled(chrome(), "Toggle training plan & advisory info"),
    ).toBeDefined();
    expect(nodes(chrome()).some((node) => node.type === "ScrollView")).toBe(
      false,
    );
    expect(flatten(keyboard().props.style).marginTop).toBe(-128);
    expect(flatten(transcript().props.contentContainerStyle).paddingTop).toBe(
      152,
    );
    expect(keyboard().props.behavior).toBe("padding");
    expect(keyboard().props.keyboardVerticalOffset).toBe(8);

    labelled(chrome(), "Toggle training plan & advisory info").props.onPress();
    mocks.headerHeight = 248;
    tree = render();
    expect(text(chrome(), "Advisory & Privacy Notice")).toBe(true);
    expect(flatten(keyboard().props.style).marginTop).toBe(-248);
    expect(flatten(transcript().props.contentContainerStyle).paddingTop).toBe(
      272,
    );
  });
});

describe("Coach header actions", () => {
  it("keeps recipes, advisory and new-conversation actions in the tab header", async () => {
    const { router } = await import("expo-router");
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
    const tree = await open();
    const chrome = nodes(tree).find((node) => node.type === "TabHeader");
    const actions = nodes(chrome.props.actions);
    const action = (label: string) =>
      actions.find((node) => node.props?.accessibilityLabel === label);
    expect(action("What can I cook?").type).toBe("IconButton");
    expect(action("Toggle training plan & advisory info").type).toBe(
      "IconButton",
    );
    expect(action("New conversation").type).toBe("IconButton");
    expect(action("New conversation").props.disabled).toBe(false);
    action("What can I cook?").props.onPress();
    expect(router.push).toHaveBeenLastCalledWith("/meal-recipes");
    action("New conversation").props.onPress();
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(1);

    const threadRow = nodes(chrome.props.children);
    const switcher = threadRow.find(
      (node) => node.props?.accessibilityLabel === "Open thread list",
    );
    const remove = threadRow.find(
      (node) => node.props?.accessibilityLabel === "Delete conversation",
    );
    expect(switcher).toBeDefined();
    expect(remove.type).toBe("IconButton");
    expect(remove.props.disabled).toBe(false);
    remove.props.onPress();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Coach conversation hierarchy", () => {
  const introduction =
    "Private fitness & nutrition guidance grounded in your confirmed data.";
  const hasIntroduction = (tree: any) =>
    nodes(tree).some(
      (node) =>
        node.type === "ThemedText" &&
        [node.props?.children].flat().join("").replace(/\s+/g, " ").trim() ===
          introduction,
    );

  it("keeps the introduction in the scrollable empty state", async () => {
    const tree = await open();
    const transcript = nodes(tree).find((node) => node.type === "ScrollView");
    expect(hasIntroduction(transcript)).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("prioritizes populated history while retaining conversation and advisory controls", async () => {
    const titled = {
      ...conversation,
      title: "A long training and nutrition check-in",
    };
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [titled],
    });
    mocks.thread.mockResolvedValue({
      ok: true,
      conversation: titled,
      messages: [
        { id: "assistant-1", role: "assistant", text: "Confirmed guidance" },
      ],
    });
    const tree = await open();
    expect(hasIntroduction(tree)).toBe(false);
    expect(
      labelled(tree, "Open thread list").props.accessibilityValue.text,
    ).toContain(titled.title);
    labelled(tree, "Open thread list").props.onPress();
    expect(
      nodes(render()).find((node) => node.type === "ThreadListSheet").props
        .visible,
    ).toBe(true);
    expect(labelled(tree, "New conversation").props.disabled).toBe(false);
    expect(labelled(tree, "Delete conversation")).toBeDefined();
    nodes(render())
      .find((node) => node.type === "ThreadListSheet")
      .props.onClose();
    const advisory = labelled(render(), "Toggle training plan & advisory info");
    expect(advisory.props.accessibilityState.expanded).toBe(false);
    advisory.props.onPress();
    expect(text(render(), "Advisory & Privacy Notice")).toBe(true);
    expect(
      labelled(render(), "Toggle training plan & advisory info").props
        .accessibilityState.expanded,
    ).toBe(true);
  });
});

describe("Coach VoiceOver announcements", () => {
  const reply = {
    id: "announced-reply",
    role: "assistant",
    text: "Try a short walk after lunch.",
    evidenceKinds: [],
  };
  const sendReply = async () => {
    mocks.send.mockResolvedValue({ ok: true, conversation, messages: [reply] });
    const pending = typeMessage().props.onPress();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    render();
  };
  beforeEach(() => {
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
  });

  it("announces a new reply once on iOS but not restored history", async () => {
    mocks.thread.mockResolvedValue({
      ok: true,
      conversation,
      messages: [{ ...reply, id: "history-reply", text: "Earlier advice" }],
    });
    await open();
    render();
    expect(mocks.announce).not.toHaveBeenCalled();
    await sendReply();
    render();
    render();
    expect(mocks.announce.mock.calls).toEqual([
      ["New Coach message: Try a short walk after lunch."],
    ]);
  });

  it("announces a send failure on iOS", async () => {
    await open();
    mocks.send.mockResolvedValue({ ok: false, message: "Coach is busy." });
    const pending = typeMessage().props.onPress();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    render();
    render();
    expect(mocks.announce.mock.calls).toEqual([["Coach is busy."]]);
  });

  it("leaves Android replies to the live region", async () => {
    mocks.platform = "android";
    await open();
    await sendReply();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("renders the live-region announcement inside a Text node", async () => {
    mocks.platform = "android";
    await open();
    await sendReply();
    const region = nodes(render()).find(
      (n) => n.props?.accessibilityLiveRegion === "polite",
    );
    const children = [region.props.children].flat();
    expect(children.some((child: unknown) => typeof child === "string")).toBe(
      false,
    );
    const label = children.find((child: any) => child?.type === "Text");
    expect(label.props.children).toBe(
      "New Coach message: Try a short walk after lunch.",
    );
  });
});

describe("Coach send analytics", () => {
  const sendOnce = async () => {
    await open();
    const pending = typeMessage("My knee hurts after climbing").props.onPress();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
  };

  it("reports a successful send as the fixed action with buckets only", async () => {
    await sendOnce();
    expect(mocks.track.mock.calls).toEqual([
      [
        {
          name: "feature_action_result",
          properties: {
            action: "coach_message_request",
            outcome: "success",
            duration: "under_30_seconds",
          },
        },
      ],
    ]);
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("knee");
  });

  it("reports a failed send with a coarse reason, never the message", async () => {
    mocks.send.mockResolvedValue({
      ok: false,
      message: "Check your network connection and try again.",
    });
    await sendOnce();
    expect(mocks.track.mock.calls).toEqual([
      [
        {
          name: "feature_action_result",
          properties: {
            action: "coach_message_request",
            outcome: "failure",
            reason: "network",
            duration: "under_30_seconds",
          },
        },
      ],
    ]);
  });

  it("reports a reached daily allowance as disabled", async () => {
    mocks.send.mockResolvedValue({
      ok: false,
      message: "You've used today's Coach messages.",
      limitReached: true,
    });
    await sendOnce();
    expect(mocks.track.mock.calls[0]![0].properties).toMatchObject({
      outcome: "failure",
      reason: "disabled",
    });
  });

  it("sends nothing when AI consent is still pending", async () => {
    mocks.consent = false;
    await sendOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });
});

describe("Coach reply text selection", () => {
  it.each([
    ["ios", "history"],
    ["ios", "new reply"],
    ["android", "history"],
    ["android", "new reply"],
  ])(
    "supports selection on %s for formatted text in %s",
    async (platform, source) => {
      mocks.platform = platform;
      const reply = {
        id: "selectable-reply",
        role: "assistant",
        text: "# Today's plan\nPlain guidance\nKeep **steady** progress\n- Bullet advice\n1. Numbered advice\n\n---\n`Example text`",
        evidenceKinds: [],
      };
      mocks.load.mockResolvedValue({
        ok: true,
        status: ready,
        conversations: [conversation],
      });
      mocks.thread.mockResolvedValue({
        ok: true,
        conversation,
        messages: source === "history" ? [reply] : [],
      });
      let tree = await open();
      if (source === "new reply") {
        mocks.send.mockResolvedValue({
          ok: true,
          conversation,
          messages: [reply],
        });
        const pending = typeMessage().props.onPress();
        await settle();
        await vi.advanceTimersByTimeAsync(500);
        await pending;
        tree = render();
      }
      const bubble = nodes(tree).find(
        (node) => node.props?.message?.id === reply.id,
      );
      expect(bubble).toBeDefined();
      const formatted = nodes(bubble.type(bubble.props)).find(
        (node) => node.props?.text === reply.text,
      );
      expect(formatted).toBeDefined();
      const rendered = formatted.type(formatted.props);
      const roots = (node: any): any[] => {
        if (!node || typeof node !== "object") return [];
        if (Array.isArray(node)) return node.flatMap(roots);
        if (node.type?.name === "SelectableCoachText") return [node];
        return roots(node.props?.children);
      };
      const content = (node: any): string => {
        if (typeof node === "string") return node;
        if (Array.isArray(node)) return node.map(content).join("");
        return node ? content(node.props?.children) : "";
      };
      const textRoots = roots(rendered);
      expect(textRoots.map(content)).toEqual([
        "Today's plan",
        "Plain guidance",
        "Keep steady progress",
        "•",
        "Bullet advice",
        "1.",
        "Numbered advice",
        "`Example text`",
      ]);
      for (const root of textRoots) {
        const surface = root.type(root.props);
        if (platform !== "ios") {
          expect(surface.type).toBe("ThemedText");
          expect(surface.props.selectable).toBe(true);
          expect(content(surface)).toBe(content(root));
          continue;
        }
        expect(surface.type).toBe("TextInput");
        expect(surface.props.editable).toBe(false);
        expect(surface.props.multiline).toBe(true);
        expect(surface.props.scrollEnabled).toBe(false);
        expect(surface.props.showSoftInputOnFocus).toBe(false);
        expect(surface.props.value).toBeUndefined();
        expect(surface.props.selection).toBeUndefined();
        expect(content(surface)).toBe(content(root));
      }
      const bold = nodes(textRoots[2]).find(
        (node) => node.props?.type === "smallBold",
      );
      expect(bold.props.children).toBe("steady");
    },
  );
});

describe("direct Coach entry", () => {
  it("keeps an intended older conversation when token refresh interrupts its opening", async () => {
    const older = {
      ...conversation,
      id: "thread-older",
      title: "Older check-in",
    };
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation, older],
    });
    await open();
    let resolve!: (result: any) => void;
    mocks.thread.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const sheet = nodes(render()).find(
      (node) => node.type === "ThreadListSheet",
    );
    sheet.props.onSelect(older.id);
    render();
    mocks.token = "synthetic-rotated";
    render();
    await settle();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    mocks.thread.mockResolvedValue({
      ok: true,
      conversation: older,
      messages: [],
    });
    resolve({ ok: false, message: "Retired thread" });
    await settle();
    render();
    await settle();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.thread.mock.calls.at(-1)?.[0]).toBe(older.id);
    expect(text(render(), "Retired thread")).toBe(false);
  });
  it.each(["token", "foreground"])(
    "waits for a pending send before %s recovery reload",
    async (trigger) => {
      mocks.load.mockResolvedValue({
        ok: true,
        status: ready,
        conversations: [conversation],
      });
      const canonical = {
        id: "canonical-assistant",
        conversationId: conversation.id,
        role: "assistant",
        text: "New reply",
        status: "complete",
        provider: "gemini",
        evidenceKinds: [],
        actionProposal: null,
        createdAt: conversation.createdAt,
      };
      let resolve!: (result: any) => void;
      mocks.send.mockReturnValueOnce(
        new Promise((r) => {
          resolve = r;
        }),
      );
      await open();
      const pending = typeMessage().props.onPress();
      await settle();
      render();
      expect(mocks.send).toHaveBeenCalledTimes(1);
      if (trigger === "token") {
        mocks.token = "synthetic-rotated";
        render();
      } else {
        mocks.appState = "background";
        for (const listener of mocks.appListeners) listener("background");
        mocks.appState = "active";
        for (const listener of mocks.appListeners) listener("active");
      }
      await settle();
      expect(mocks.load).toHaveBeenCalledTimes(1);
      mocks.thread.mockResolvedValue({
        ok: true,
        conversation,
        messages: [canonical],
      });
      resolve({ ok: true, conversation, messages: [canonical] });
      await settle();
      await vi.advanceTimersByTimeAsync(500);
      await pending;
      render();
      await settle();
      const tree = render();
      expect(mocks.load).toHaveBeenCalledTimes(2);
      expect(text(tree, "Couldn't load Coach")).toBe(false);
      expect(
        nodes(tree).some((node) => node.props?.message?.text === "New reply"),
      ).toBe(true);
    },
  );
  it("ignores a late thread response after the app backgrounds", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
    let resolve!: (result: any) => void;
    mocks.thread.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render();
    await settle();
    const client = mocks.thread.mock.calls[0][1];
    mocks.appState = "background";
    for (const listener of mocks.appListeners) listener("background");
    resolve({ ok: false, message: "Retired thread" });
    await settle();
    expect(text(render(), "Retired thread")).toBe(false);
    const request = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const composition = await import("@/composition/api-client");
    composition.apiClient.request = request;
    await client.request({ method: "GET", path: "/v1/coach/conversations" });
    expect(request.mock.calls[0][0].expectedUserId).toBe("synthetic-user");
    expect(request.mock.calls[0][0].isCurrent()).toBe(false);
  });
  it("automatically retries a failed opening read on foreground return", async () => {
    mocks.load.mockResolvedValueOnce({
      ok: false,
      message: "Your session expired. Sign in again.",
    });
    expect(text(await open(), "Couldn't load Coach")).toBe(true);
    mocks.appState = "background";
    for (const listener of mocks.appListeners) listener("background");
    mocks.appState = "active";
    for (const listener of mocks.appListeners) listener("active");
    await settle();
    expect(text(render(), "Couldn't load Coach")).toBe(false);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it("retries after token refresh and ignores a late error from the old token", async () => {
    let resolve!: (result: any) => void;
    mocks.load.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render();
    mocks.token = "synthetic-rotated";
    render();
    await settle();
    resolve({ ok: false, message: "Old token expired" });
    await settle();
    expect(text(render(), "Couldn't load Coach")).toBe(false);
    expect(text(render(), "Old token expired")).toBe(false);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it("drops an old account's delayed conversation and loads the new account", async () => {
    let resolve!: (result: any) => void;
    mocks.load.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render();
    mocks.owner = "synthetic-bob";
    mocks.token = "synthetic-bob-token";
    render();
    await settle();
    resolve({ ok: true, status: ready, conversations: [conversation] });
    await settle();
    render();
    expect(mocks.thread).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it("shows a recoverable read error rather than treating failed history as empty", async () => {
    mocks.load.mockResolvedValueOnce({
      ok: false,
      message: "Coach is offline.",
    });
    let tree = await open();
    expect(text(tree, "Couldn't load Coach")).toBe(true);
    expect(text(tree, "Coach is offline.")).toBe(true);
    expect(labelled(tree, "New conversation").props.disabled).toBe(true);
    labelled(tree, "New conversation").props.onPress();
    await settle();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(labelled(tree, "Message Coach")).toBeUndefined();
    nodes(tree)
      .find((n) => n.type === "Button" && n.props.label === "Check again")
      .props.onPress();
    await settle();
    tree = render();
    expect(labelled(tree, "Message Coach")).toBeDefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not create a replacement thread when the existing thread read fails", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
    mocks.thread.mockResolvedValueOnce({
      ok: false,
      message: "Thread is offline.",
    });
    const tree = await open();
    expect(text(tree, "Couldn't load Coach")).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(labelled(tree, "Message Coach")).toBeUndefined();
  });
  it("serializes the first send against photo and new-conversation actions", async () => {
    let finish!: (v: unknown) => void;
    mocks.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await open();
    const tree = render();
    typeMessage().props.onPress();
    labelled(tree, "Attach photos").props.onPress();
    labelled(tree, "New conversation").props.onPress();
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.picker).not.toHaveBeenCalled();
    finish({ ok: true, conversation, messages: [] });
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("retries a failed first message in the same thread with the same key", async () => {
    mocks.send.mockResolvedValueOnce({
      ok: false,
      message: "Coach is offline.",
    });
    await open();
    typeMessage().props.onPress();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    const firstCall = mocks.send.mock.calls[0];
    const tree = render();
    // MessageBubble's explicit retry callback owns the same pending payload.
    const bubble = nodes(tree).find((n) => n.props?.onRetry !== undefined);
    expect(bubble).toBeDefined();
    bubble.props.onRetry();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[1]).toEqual(firstCall);
    expect(mocks.clearDraft).toHaveBeenCalledTimes(1);
  });
  it("opens suggestions and composer without creating a conversation", async () => {
    const tree = await open();
    expect(text(tree, "Start a private check-in")).toBe(false);
    for (const label of [
      "Ask AI Coach",
      "Suggest a workout routine",
      "Review nutrition targets",
      "Explain weight trend",
      "Suggest a quick gym session",
      "Message Coach",
    ])
      expect(labelled(tree, label)).toBeDefined();
    expect(mocks.create).not.toHaveBeenCalled();
    render();
    await settle();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it("creates once on first send and uses the created thread for persistence and sending", async () => {
    await open();
    const send = typeMessage();
    const pending = send.props.onPress();
    send.props.onPress();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(
      conversation.id,
      "Help me plan today",
      expect.any(String),
    );
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      "synthetic-user",
      "coach",
      expect.objectContaining({
        conversationId: conversation.id,
        text: "Help me plan today",
      }),
    );
  });
  it("preserves typed text on creation failure and allows retry", async () => {
    mocks.create.mockResolvedValueOnce({
      ok: false,
      message: "Coach is offline.",
    });
    await open();
    typeMessage().props.onPress();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(labelled(render(), "Message Coach").props.value).toBe(
      "Help me plan today",
    );
    expect(text(render(), "Coach is offline.")).toBe(true);
    labelled(render(), "Send message").props.onPress();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("keeps conversation creation and sending behind explicit consent", async () => {
    mocks.consent = false;
    await open();
    typeMessage().props.onPress();
    await settle();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.pendingAction.text).toBe("Help me plan today");
    mocks.consent = true;
    const pending = mocks.execute(mocks.pendingAction);
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("creates on photo submission, while cancellation creates nothing", async () => {
    await open();
    mocks.picker.mockResolvedValueOnce({ canceled: true });
    await labelled(render(), "Attach photos").props.onPress();
    await settle();
    expect(mocks.create).not.toHaveBeenCalled();
    await labelled(render(), "Attach photos").props.onPress();
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.photo).toHaveBeenCalledWith(
      conversation.id,
      expect.any(Blob),
      expect.any(String),
      [],
      undefined,
    );
  });
  it("reopens an existing conversation without creating another", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
    await open();
    typeMessage().props.onPress();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.thread).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({ request: expect.any(Function) }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("returns to the full page after deleting the last conversation", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
    await open();
    labelled(render(), "Delete conversation").props.onPress();
    mocks.alert.mock.calls[0][2]
      .find((b: any) => b.text === "Delete")
      .onPress();
    await settle();
    expect(labelled(render(), "Message Coach")).toBeDefined();
    expect(labelled(render(), "Ask AI Coach")).toBeDefined();
    expect(text(render(), "Start a private check-in")).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps the safely-off state and does not create or send", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      status: { ready: false, reason: "Provider disabled" },
      conversations: [],
    });
    const tree = await open();
    expect(text(tree, "Coach is safely off")).toBe(true);
    expect(labelled(tree, "Message Coach")).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("handles reminder autoSend with no existing conversation", async () => {
    mocks.params = { prompt: "Review my day", autoSend: "true" };
    await open();
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    render();
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(
      conversation.id,
      "Review my day",
      expect.any(String),
    );
  });
});

it("sends three Pro photos with the typed question in one Coach request", async () => {
  await open();
  labelled(render(), "Message Coach").props.onChangeText("Compare these menus");
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: "synthetic-1" },
      { uri: "synthetic-2" },
      { uri: "synthetic-3" },
    ],
  });
  await labelled(render(), "Attach photos").props.onPress();
  await settle();
  expect(mocks.picker).toHaveBeenCalledWith(
    expect.objectContaining({
      allowsMultipleSelection: true,
      selectionLimit: 3,
    }),
  );
  expect(mocks.normalize).toHaveBeenCalledTimes(3);
  expect(mocks.photo).toHaveBeenCalledWith(
    conversation.id,
    expect.any(Blob),
    expect.any(String),
    [
      expect.objectContaining({ photo: expect.any(Blob) }),
      expect.objectContaining({ photo: expect.any(Blob) }),
    ],
    "Compare these menus",
  );
});
it("restricts a free Coach picker to one photo and rejects bypassed multi selection", async () => {
  await open();
  mocks.capability.mockResolvedValue(false);
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "synthetic-1" }, { uri: "synthetic-2" }],
  });
  await labelled(render(), "Attach photos").props.onPress();
  await settle();
  expect(mocks.picker).toHaveBeenCalledWith(
    expect.objectContaining({
      allowsMultipleSelection: false,
      selectionLimit: 1,
    }),
  );
  expect(mocks.photo).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});

describe("Coach cached history and live generation authority", () => {
  const savedMessage = {
    id: "cached-coach-message",
    conversationId: conversation.id,
    role: "assistant",
    text: "Previously saved Coach guidance.",
    status: "complete",
    provider: "gemini",
    evidenceKinds: [],
    actionProposal: null,
    createdAt: conversation.updatedAt,
  };
  const bubbles = (tree: any) =>
    nodes(tree).filter((node) => node.props?.message?.id === savedMessage.id);
  beforeEach(() => {
    mocks.thread.mockResolvedValue({
      ok: true,
      conversation,
      messages: [savedMessage],
    });
  });
  it("retires a warmed transcript after a denied list even while provider status never settles", async () => {
    mocks.peek.mockReturnValue({
      conversations: [conversation],
      conversation,
      messages: [savedMessage],
    });
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
    await open();
    mocks.load.mockReset().mockImplementation((client, publish) => {
      return mocks.realLoad!({ ...client, request: mocks.apiRequest }, publish);
    });
    mocks.apiRequest.mockImplementation((options) =>
      options.path === "/v1/coach/status"
        ? new Promise(() => {})
        : Promise.resolve({
            ok: false,
            error: {
              kind: "http_error",
              status: 403,
              code: "FORBIDDEN",
              message: "denied",
            },
          }),
    );
    for (const listener of mocks.readListeners)
      listener("/v1/coach/conversations");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    await settle();
    expect(
      mocks.apiRequest.mock.calls.map(([options]) => options.path),
    ).toEqual(["/v1/coach/status", "/v1/coach/conversations"]);
    const tree = render();
    expect(bubbles(tree)).toHaveLength(0);
    expect(text(tree, "Couldn't load Coach")).toBe(true);
    expect(labelled(tree, "New conversation").props.disabled).toBe(true);
    expect(
      nodes(tree).find((node) => node.type === "ThreadListSheet").props
        .conversations,
    ).toEqual([]);
  });

  it("renders a warmed transcript synchronously while live readiness remains unresolved", () => {
    mocks.peek.mockReturnValue({
      conversations: [conversation],
      conversation,
      messages: [savedMessage],
    });
    mocks.load.mockReturnValue(new Promise(() => {}));
    const first = render();
    expect(bubbles(first)).toHaveLength(1);
    expect(text(first, "Loading Coach…")).toBe(false);
    expect(labelled(first, "Attach photos").props.disabled).toBe(true);
    expect(bubbles(render())).toHaveLength(1);
    expect(text(render(), "Loading Coach…")).toBe(false);
  });
  it("uses startup history filled after an early cold mount before the first focused frame settles", () => {
    mocks.load.mockReturnValue(new Promise(() => {}));
    expect(text(render(), "Loading Coach…")).toBe(true);
    mocks.peek.mockReturnValue({
      conversations: [conversation],
      conversation,
      messages: [savedMessage],
    });
    for (const listener of mocks.readListeners)
      listener("/v1/coach/conversations");
    const firstFocusedFrame = render();
    expect(bubbles(firstFocusedFrame)).toHaveLength(1);
    expect(text(firstFocusedFrame, "Loading Coach…")).toBe(false);
    expect(labelled(firstFocusedFrame, "Attach photos").props.disabled).toBe(
      true,
    );
  });
  it("treats a cached empty history as loaded without granting generation", () => {
    mocks.peek.mockReturnValue({
      conversations: [],
      conversation: null,
      messages: [],
    });
    mocks.load.mockReturnValue(new Promise(() => {}));
    const first = render();
    expect(text(first, "Loading Coach…")).toBe(false);
    expect(labelled(first, "New conversation").props.disabled).toBe(true);
  });
  it.each(["empty", "thread"])(
    "hides A's unsent draft and thread picker in B's first warm %s render",
    (kind) => {
      mocks.peek.mockImplementation((session) =>
        session?.user.id === "synthetic-user"
          ? {
              conversations: [conversation],
              conversation,
              messages: [savedMessage],
            }
          : kind === "empty"
            ? { conversations: [], conversation: null, messages: [] }
            : {
                conversations: [
                  { ...conversation, id: "b-thread", title: "B thread" },
                ],
                conversation: {
                  ...conversation,
                  id: "b-thread",
                  title: "B thread",
                },
                messages: [],
              },
      );
      mocks.load.mockReturnValue(new Promise(() => {}));
      render();
      typeMessage("Private health details for A");
      const oldInput = labelled(render(), "Message Coach");
      labelled(render(), "Open thread list").props.onPress();
      labelled(
        render(),
        "Toggle training plan & advisory info",
      ).props.onPress();
      expect(
        nodes(render()).find((node) => node.type === "ThreadListSheet").props
          .visible,
      ).toBe(true);
      mocks.owner = "other-user";
      mocks.token = "other-token";
      const first = render();
      expect(labelled(first, "Message Coach").props.value).toBe("");
      expect(
        nodes(first).find((node) => node.type === "ThreadListSheet").props
          .visible,
      ).toBe(false);
      expect(
        nodes(first).find((node) => node.type === "TrainingPlanCard"),
      ).toBeUndefined();
      expect(text(first, "Loading Coach…")).toBe(false);
      oldInput.props.onChangeText("Late private text for A");
      expect(labelled(render(), "Message Coach").props.value).toBe("");
    },
  );
  it.each(["send", "draft-storage", "create"])(
    "retires A's deferred %s result after B's warm history is visible",
    async (boundary) => {
      const bConversation = {
        ...conversation,
        id: "b-thread",
        title: "B thread",
      };
      const bMessage = {
        ...savedMessage,
        id: "b-message",
        conversationId: "b-thread",
        text: "B guidance",
      };
      mocks.peek.mockImplementation((session) =>
        session?.user.id === "synthetic-user"
          ? boundary === "create"
            ? { conversations: [], conversation: null, messages: [] }
            : {
                conversations: [conversation],
                conversation,
                messages: [savedMessage],
              }
          : {
              conversations: [bConversation],
              conversation: bConversation,
              messages: [bMessage],
            },
      );
      mocks.load.mockResolvedValue({
        ok: true,
        status: ready,
        conversations: boundary === "create" ? [] : [conversation],
      });
      let finish!: (value: any) => void;
      const paused = new Promise((resolve) => {
        finish = resolve;
      });
      if (boundary === "send") mocks.send.mockReturnValueOnce(paused);
      else if (boundary === "draft-storage")
        mocks.saveDraft.mockReturnValueOnce(paused);
      else mocks.create.mockReturnValueOnce(paused);
      await open();
      const pending = typeMessage("A private request").props.onPress();
      await settle();
      mocks.owner = "other-user";
      mocks.token = "other-token";
      mocks.load.mockReturnValue(new Promise(() => {}));
      let tree = render();
      expect(
        nodes(tree).find((node) => node.props?.message?.id === "b-message"),
      ).toBeDefined();
      finish(
        boundary === "draft-storage"
          ? true
          : { ok: true, conversation, messages: [savedMessage] },
      );
      await settle();
      tree = render();
      expect(
        nodes(tree).find((node) => node.props?.message?.id === "b-message"),
      ).toBeDefined();
      expect(bubbles(tree)).toHaveLength(0);
      if (boundary !== "send") expect(mocks.send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      await pending;
    },
  );

  it("does not let A's late send release B's newer send lock", async () => {
    const bConversation = {
      ...conversation,
      id: "b-thread",
      title: "B thread",
    };
    const bMessage = {
      ...savedMessage,
      id: "b-message",
      conversationId: "b-thread",
    };
    mocks.peek.mockImplementation((session) =>
      session?.user.id === "synthetic-user"
        ? {
            conversations: [conversation],
            conversation,
            messages: [savedMessage],
          }
        : {
            conversations: [bConversation],
            conversation: bConversation,
            messages: [bMessage],
          },
    );
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
    let finishA!: (value: any) => void;
    let finishB!: (value: any) => void;
    mocks.send.mockReturnValueOnce(
      new Promise((resolve) => {
        finishA = resolve;
      }),
    );
    mocks.send.mockReturnValueOnce(
      new Promise((resolve) => {
        finishB = resolve;
      }),
    );
    await open();
    const pendingA = typeMessage("A private request").props.onPress();
    await settle();
    mocks.owner = "other-user";
    mocks.token = "other-token";
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [bConversation],
    });
    mocks.thread.mockResolvedValue({
      ok: true,
      conversation: bConversation,
      messages: [bMessage],
    });
    render();
    await settle();
    const pendingB = typeMessage("B request").props.onPress();
    await settle();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    finishA({ ok: true, conversation, messages: [savedMessage] });
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    await pendingA;
    let tree = render();
    expect(labelled(tree, "Send message").props.accessibilityState.busy).toBe(
      true,
    );
    await labelled(tree, "New conversation").props.onPress();
    expect(mocks.create).not.toHaveBeenCalled();
    finishB({ ok: true, conversation: bConversation, messages: [bMessage] });
    await settle();
    await pendingB;
    tree = render();
    expect(bubbles(tree)).toHaveLength(0);
  });

  it("preserves typed draft text through a same-user token rotation", () => {
    mocks.peek.mockReturnValue({
      conversations: [conversation],
      conversation,
      messages: [savedMessage],
    });
    mocks.load.mockReturnValue(new Promise(() => {}));
    render();
    typeMessage("Keep my typed draft");
    mocks.token = "rotated-token";
    expect(labelled(render(), "Message Coach").props.value).toBe(
      "Keep my typed draft",
    );
  });
  it("keeps the same user's transcript through a token rotation without granting generation", () => {
    mocks.peek.mockImplementation((session) =>
      session?.accessToken === "synthetic-token"
        ? {
            conversations: [conversation],
            conversation,
            messages: [savedMessage],
          }
        : null,
    );
    mocks.load.mockReturnValue(new Promise(() => {}));
    expect(bubbles(render())).toHaveLength(1);
    mocks.token = "rotated-token";
    const first = render();
    expect(bubbles(first)).toHaveLength(1);
    expect(text(first, "Loading Coach…")).toBe(false);
    expect(labelled(first, "Attach photos").props.disabled).toBe(true);
    expect(labelled(first, "New conversation").props.disabled).toBe(true);
    const settled = render();
    expect(bubbles(settled)).toHaveLength(1);
    expect(text(settled, "Loading Coach…")).toBe(false);
  });
  it("keeps loading when the token rotates before any history has loaded", () => {
    mocks.peek.mockReturnValue(null);
    mocks.load.mockReturnValue(new Promise(() => {}));
    expect(text(render(), "Loading Coach…")).toBe(true);
    mocks.token = "rotated-token";
    expect(text(render(), "Loading Coach…")).toBe(true);
    expect(text(render(), "Loading Coach…")).toBe(true);
  });
  it("keeps a same-user empty history loaded through a token rotation", () => {
    mocks.peek.mockImplementation((session) =>
      session?.accessToken === "synthetic-token"
        ? { conversations: [], conversation: null, messages: [] }
        : null,
    );
    mocks.load.mockReturnValue(new Promise(() => {}));
    expect(text(render(), "Loading Coach…")).toBe(false);
    mocks.token = "rotated-token";
    expect(text(render(), "Loading Coach…")).toBe(false);
    expect(text(render(), "Loading Coach…")).toBe(false);
  });
  it.each(["account"])(
    "does not show a stale warm transcript after %s changes",
    (change) => {
      mocks.peek.mockImplementation((session) =>
        session?.user.id === "synthetic-user" &&
        session?.accessToken === "synthetic-token"
          ? {
              conversations: [conversation],
              conversation,
              messages: [savedMessage],
            }
          : null,
      );
      mocks.load.mockReturnValue(new Promise(() => {}));
      expect(bubbles(render())).toHaveLength(1);
      if (change === "account") mocks.owner = "other-user";
      else mocks.token = "other-token";
      const next = render();
      expect(bubbles(next)).toHaveLength(0);
      expect(text(next, "Loading Coach…")).toBe(true);
    },
  );

  it.each([
    [null, "Coach is offline. Your existing conversation is still safe."],
    [{ ready: false, reason: "Provider disabled." }, undefined],
  ])(
    "shows history with unavailable readiness %j and blocks generation actions",
    async (status, readinessMessage) => {
      mocks.load.mockResolvedValue({
        ok: true,
        status,
        readinessMessage,
        conversations: [conversation],
      });
      let tree = await open();
      expect(bubbles(tree)).toHaveLength(1);
      expect(text(tree, "Loading Coach…")).toBe(false);
      expect(labelled(tree, "Open thread list")).toBeDefined();
      expect(labelled(tree, "New conversation").props.disabled).toBe(true);
      expect(labelled(tree, "Attach photos").props.disabled).toBe(true);
      const send = typeMessage();
      expect(send.props.disabled).toBe(true);
      await send.props.onPress();
      await labelled(tree, "Attach photos").props.onPress();
      await labelled(tree, "New conversation").props.onPress();
      await bubbles(tree)[0].props.onAcceptWeeklyAdaptation({
        id: "saved-adaptation",
      });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.photo).not.toHaveBeenCalled();
      expect(mocks.permission).not.toHaveBeenCalled();
      expect(mocks.adapt).not.toHaveBeenCalled();
      expect(bubbles(render())[0].props.actionsEnabled).toBe(false);
    },
  );

  it("shows cached history while the live readiness check is pending", async () => {
    let finish!: (value: any) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    mocks.load.mockImplementation(async (_client, publish) => {
      await publish([conversation]);
      return pending;
    });
    let tree = await open();
    expect(bubbles(tree)).toHaveLength(1);
    expect(text(tree, "Loading Coach…")).toBe(false);
    expect(typeMessage().props.disabled).toBe(true);
    finish({ ok: true, status: ready, conversations: [conversation] });
    await settle();
    tree = render();
    expect(labelled(tree, "Send message").props.disabled).toBe(false);
    expect(mocks.thread).toHaveBeenCalledTimes(1);
  });

  it("keeps the visible thread during background cache refresh and installs fresh messages", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
    await open();
    let finish!: (value: any) => void;
    mocks.load.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    for (const listener of mocks.readListeners)
      listener("/v1/coach/conversations");
    let tree = render();
    expect(bubbles(tree)).toHaveLength(1);
    expect(text(tree, "Loading Coach…")).toBe(false);
    mocks.thread.mockResolvedValue({
      ok: true,
      conversation,
      messages: [{ ...savedMessage, text: "Fresh server guidance." }],
    });
    finish({ ok: true, status: ready, conversations: [conversation] });
    await settle();
    tree = render();
    expect(bubbles(tree)[0].props.message.text).toBe("Fresh server guidance.");
  });

  it("hides the previous account's transcript in the first render after switching", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      status: ready,
      conversations: [conversation],
    });
    await open();
    mocks.owner = "other-user";
    mocks.token = "other-token";
    mocks.load.mockReturnValue(new Promise(() => {}));
    const tree = render();
    expect(bubbles(tree)).toHaveLength(0);
    expect(labelled(tree, "Open thread list")).toBeUndefined();
  });
});

it("opens the same recipe screen from Coach even when suggestions are unavailable", async () => {
  const { router } = await import("expo-router");
  mocks.consent = false;
  labelled(render(), "What can I cook?").props.onPress();
  expect(router.push).toHaveBeenLastCalledWith("/meal-recipes");
});
