import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  thread: vi.fn(),
  send: vi.fn(),
  photo: vi.fn(),
  remove: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
  alert: vi.fn(),
  permission: vi.fn(),
  picker: vi.fn(),
  normalize: vi.fn(),
  consent: true,
  pendingAction: null as any,
  execute: null as any,
  params: {} as { prompt?: string; autoSend?: string },
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
      if (!previous || deps.some((v, j) => !Object.is(v, previous[j]))) {
        hooks.slots[i] = deps;
        hooks.effects.push(callback);
      }
    },
  };
});
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  Platform: { OS: "ios", select: (values: any) => values.ios },
  StyleSheet: { create: (s: unknown) => s },
  Keyboard: { addListener: () => ({ remove: vi.fn() }) },
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
vi.mock("@/components/brand-wordmark", () => ({
  BrandWordmark: "BrandWordmark",
}));
vi.mock("@/components/account-header-button", () => ({
  AccountHeaderActions: "AccountHeaderActions",
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "#fff" }) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "synthetic-user" } },
    profile: null,
    refreshProfile: vi.fn(),
  }),
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("@/features/logging-draft-storage", () => ({
  loadLoggingDraft: async () => null,
  saveLoggingDraft: mocks.saveDraft,
  clearLoggingDraft: mocks.clearDraft,
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
vi.mock("./coach-data", async (original) => ({
  ...(await original<typeof import("./coach-data")>()),
  loadCoach: mocks.load,
  createCoachConversation: mocks.create,
  loadCoachThread: mocks.thread,
  sendCoachMessage: mocks.send,
  sendCoachMealPhoto: mocks.photo,
  deleteCoachConversation: mocks.remove,
}));

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
  return [tree, ...nodes(tree.props?.children)];
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
  mocks.load.mockResolvedValue({ ok: true, status: ready, conversations: [] });
  mocks.create.mockResolvedValue({ ok: true, conversation, messages: [] });
  mocks.thread.mockResolvedValue({ ok: true, conversation, messages: [] });
  mocks.send.mockResolvedValue({ ok: true, conversation, messages: [] });
  mocks.photo.mockResolvedValue({ ok: true, conversation, messages: [] });
  mocks.remove.mockResolvedValue({ ok: true });
  mocks.permission.mockResolvedValue({ granted: true });
  mocks.picker.mockResolvedValue({ canceled: false, assets: [{}] });
  mocks.normalize.mockResolvedValue(new Blob());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("direct Coach entry", () => {
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
      .find((n) => n.type === "Pressable" && text(n, "Check again"))
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
    labelled(tree, "Attach a meal photo").props.onPress();
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
    await labelled(render(), "Attach a meal photo").props.onPress();
    await settle();
    expect(mocks.create).not.toHaveBeenCalled();
    await labelled(render(), "Attach a meal photo").props.onPress();
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.photo).toHaveBeenCalledWith(
      conversation.id,
      expect.any(Blob),
      expect.any(String),
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
    expect(mocks.thread).toHaveBeenCalledWith(conversation.id);
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
