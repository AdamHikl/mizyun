import { beforeEach, describe, expect, it, vi } from "vitest";

// VoiceOver announcements are covered by src/lib/announce.test.ts.
vi.mock("@/lib/announce", () => ({
  announce: vi.fn(),
  useAnnouncement: vi.fn(),
  textOfChildren: () => "",
}));

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  saveRun: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  unitSystem: "metric",
  userId: "u",
  effects: [] as Array<() => void>,
  runDraft: null as unknown,
  aiConsent: false,
  aiDraft: vi.fn(),
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
  useEffect: (effect: () => void) => {
    mocks.effects.push(effect);
  },
  useState: (initial: any) => {
    const index = hooks.index++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.slots[index],
      (next: any) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
}));
vi.mock("react-native", () => ({
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("expo-router", () => ({
  router: { back: mocks.back, push: mocks.push },
  Stack: { Screen: "StackScreen" },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-2222-4333-8444-555555555555",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 600,
  Spacing: { four: 16, three: 12, one: 4 },
}));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  ChoiceChip: "ChoiceChip",
  ChoiceGroup: "ChoiceGroup",
  FormField: "FormField",
  FormStatus: "FormStatus",
  FormTextInput: "FormTextInput",
  Notice: "Notice",
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.userId }, accessToken: "t" },
    profile: { unitSystem: mocks.unitSystem },
  }),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { status: () => ({ configured: false }), request: vi.fn() },
  invalidateSessionReads: vi.fn(),
}));
vi.mock("@/features/log-run", () => ({
  runDraftStore: { load: () => Promise.resolve(mocks.runDraft) },
  hasRunDraftContent: (draft: { content?: boolean }) => !!draft.content,
}));
vi.mock("@/components/ui/native-date-time-picker", () => ({
  NativeDatePicker: "NativeDatePicker",
  NativeTimePicker: "NativeTimePicker",
}));
vi.mock("@/features/coach/ai-consent-controller", () => ({
  useAiConsentController: () => ({
    consentGranted: mocks.aiConsent,
    confirmedAdult: mocks.aiConsent,
  }),
}));
vi.mock("./activity-ai-draft", () => ({
  draftActivityWithAi: mocks.aiDraft,
}));
vi.mock("./log-activity-data", () => ({
  saveLoggedActivityWith: mocks.save,
  saveLoggedRunWith: mocks.saveRun,
}));

import { LogActivityScreen } from "./log-activity-screen";

const render = () => {
  hooks.index = 0;
  return LogActivityScreen();
};
function find(node: any, p: (n: any) => boolean): any {
  if (!node) return null;
  if (Array.isArray(node))
    return node.map((n) => find(n, p)).find(Boolean) ?? null;
  return p(node) ? node : find(node.props?.children, p);
}
const byLabel = (tree: any, label: string) =>
  find(tree, (n) => n.props?.accessibilityLabel === label);
const byType = (tree: any, type: string) => find(tree, (n) => n.type === type);
const button = (tree: any, label: string) =>
  find(tree, (n) => n.type === "Button" && n.props.label === label);
/** The start time picker's value as HH:MM, or null when none is set. */
const startTime = (tree: any): string | null => {
  const picker = byType(tree, "NativeTimePicker");
  if (!picker) return null;
  const { hour, minute } = picker.props;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};
const chip = (tree: any, label: string) =>
  find(tree, (n) => n.type === "ChoiceChip" && n.props.label === label);
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  mocks.unitSystem = "metric";
  mocks.userId = "u";
  mocks.effects = [];
  mocks.runDraft = null;
  mocks.aiConsent = false;
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({
    ok: false,
    message: "Network unavailable.",
    workoutRequested: true,
    retryable: true,
  });
});

describe("log activity screen", () => {
  it("shows distance for Swimming and hides it for Jump Rope", () => {
    let tree = render();
    chip(tree, "Swimming").props.onPress();
    tree = render();
    expect(byLabel(tree, "Distance (m, optional)")).toBeTruthy();
    byLabel(tree, "Activity").props.onChangeText("Jump Rope");
    tree = render();
    expect(
      find(tree, (n) =>
        String(n.props?.accessibilityLabel).startsWith("Distance"),
      ),
    ).toBeNull();
    byLabel(tree, "Activity").props.onChangeText("Outdoor Cycling");
    tree = render();
    expect(byLabel(tree, "Distance (km, optional)")).toBeTruthy();
  });

  it("blocks save on an invalid duration", async () => {
    let tree = render();
    byLabel(tree, "Activity").props.onChangeText("Swimming");
    tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    tree = render();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(find(tree, (n) => n.type === "FormStatus")).toBeTruthy();
  });

  it("keeps the form locked and retries with the same operation", async () => {
    let tree = render();
    byLabel(tree, "Activity").props.onChangeText("Swimming");
    byLabel(tree, "Minutes").props.onChangeText("45");
    tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    tree = render();
    expect(mocks.save.mock.calls[0]?.[1]).toMatchObject({
      ownerId: "u",
      operationId: "11111111-2222-4333-8444-555555555555",
      durationSeconds: 2700,
    });
    expect(byLabel(tree, "Minutes").props.editable).toBe(false);
    mocks.save.mockResolvedValue({ ok: true, workout: {} });
    byLabel(tree, "Retry save").props.onPress();
    await flush();
    expect(mocks.save.mock.calls[1]?.[1]).toBe(mocks.save.mock.calls[0]?.[1]);
    expect(mocks.back).toHaveBeenCalled();
  });

  const startSave = async () => {
    let tree = render();
    byLabel(tree, "Activity").props.onChangeText("Swimming");
    byLabel(tree, "Minutes").props.onChangeText("45");
    tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    return render();
  };

  it("unlocks the form when nothing reached the server", async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      message: "Multiple saved exercises match Swimming.",
      workoutRequested: false,
      retryable: true,
    });
    const tree = await startSave();
    expect(byLabel(tree, "Minutes").props.editable).toBe(true);
    expect(byLabel(tree, "Save")).toBeTruthy();
  });

  it("offers Close instead of Retry when resending cannot succeed", async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      message: "The server already has a different activity for this save.",
      workoutRequested: true,
      retryable: false,
    });
    const tree = await startSave();
    expect(byLabel(tree, "Retry save")).toBeNull();
    byLabel(tree, "Close").props.onPress();
    expect(mocks.back).toHaveBeenCalled();
  });

  it("never retries one account's plan under another account", async () => {
    let tree = await startSave();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    mocks.userId = "other";
    tree = render();
    byLabel(tree, "Retry save").props.onPress();
    await flush();
    tree = render();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(byLabel(tree, "Minutes").props.editable).toBe(true);
    expect(
      String(find(tree, (n) => n.type === "FormStatus")?.props.children),
    ).toContain("switched accounts");
  });

  it("stays locked after a later attempt fails before the workout step", async () => {
    // Attempt 1: the workout POST's response is lost.
    mocks.save.mockRejectedValueOnce(new Error("lost"));
    let tree = await startSave();
    // Attempt 2: still offline, fails at the exercise list.
    mocks.save.mockResolvedValueOnce({
      ok: false,
      message: "Network unavailable.",
      workoutRequested: false,
      retryable: true,
    });
    byLabel(tree, "Retry save").props.onPress();
    await flush();
    tree = render();
    expect(byLabel(tree, "Minutes").props.editable).toBe(false);
    mocks.save.mockResolvedValueOnce({ ok: true, workout: {} });
    byLabel(tree, "Retry save").props.onPress();
    await flush();
    const plans = mocks.save.mock.calls.map((call) => call[1]);
    expect(plans).toHaveLength(3);
    expect(new Set(plans.map((p) => p.operationId)).size).toBe(1);
    expect(mocks.back).toHaveBeenCalled();
  });

  it("requires an activity before saving", async () => {
    let tree = render();
    byLabel(tree, "Minutes").props.onChangeText("45");
    tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    tree = render();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.saveRun).not.toHaveBeenCalled();
    expect(
      String(find(tree, (n) => n.type === "FormStatus")?.props.children),
    ).toContain("Enter an activity");
  });

  it("saves Running through the runs API, not the workout flow", async () => {
    mocks.saveRun.mockResolvedValue({ ok: true });
    let tree = render();
    byLabel(tree, "Activity").props.onChangeText("Running");
    byLabel(tree, "Minutes").props.onChangeText("30");
    tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.saveRun).toHaveBeenCalledTimes(1);
    const plan = mocks.saveRun.mock.calls[0]?.[1];
    expect(plan.ownerId).toBe("u");
    expect(plan.body).toMatchObject({
      clientOperationId: "11111111-2222-4333-8444-555555555555",
      durationSeconds: 1800,
      startedAt: null,
    });
    expect(mocks.back).toHaveBeenCalled();
  });

  it("picks the date and an optional start time with the native pickers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 17, 15, 10, 30));
    try {
      mocks.saveRun.mockResolvedValue({ ok: true });
      let tree = render();
      const datePicker = byType(tree, "NativeDatePicker");
      expect(datePicker.props.value).toEqual({
        year: 2026,
        month: 10,
        day: 17,
      });
      expect(datePicker.props.maximumDate).toEqual({
        year: 2026,
        month: 10,
        day: 17,
      });
      expect(startTime(tree)).toBeNull();
      datePicker.props.onChange({ year: 2026, month: 10, day: 16 });
      button(tree, "Add start time (optional)").props.onPress();
      tree = render();
      expect(startTime(tree)).toBe("14:00");
      byType(tree, "NativeTimePicker").props.onChange(19, 30);
      byLabel(tree, "Activity").props.onChangeText("Running");
      byLabel(tree, "Minutes").props.onChangeText("30");
      tree = render();
      expect(startTime(tree)).toBe("19:30");
      expect(button(tree, "Add start time (optional)")).toBeNull();
      byLabel(tree, "Save").props.onPress();
      await flush();
      const body = mocks.saveRun.mock.calls[0]?.[1].body;
      expect(new Date(body.startedAt).getTime()).toBe(
        new Date(2026, 9, 16, 19, 30).getTime(),
      );

      tree = render();
      button(tree, "Remove start time").props.onPress();
      tree = render();
      expect(startTime(tree)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves an unknown name as a custom activity", async () => {
    mocks.save.mockResolvedValue({ ok: true, workout: {} });
    let tree = render();
    byLabel(tree, "Activity").props.onChangeText("Padel");
    byLabel(tree, "Minutes").props.onChangeText("60");
    tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    expect(mocks.saveRun).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls[0]?.[1]).toMatchObject({
      activity: { custom: true, name: "Padel" },
      durationSeconds: 3600,
    });
  });

  it("fills the fields from a description", () => {
    let tree = render();
    byLabel(tree, "Describe it (optional)").props.onChangeText(
      "I ran for 45 minutes and 10km, yesterday at 19:00",
    );
    tree = render();
    byLabel(tree, "Fill in from description").props.onPress();
    tree = render();
    expect(byLabel(tree, "Activity").props.value).toBe("Running");
    expect(byLabel(tree, "Minutes").props.value).toBe("45");
    expect(byLabel(tree, "Distance (km, optional)").props.value).toBe("10");
    expect(startTime(tree)).toBe("19:00");
    expect(
      String(find(tree, (n) => n.type === "FormStatus")?.props.children),
    ).toContain("Filled in");
  });

  describe("with AI consent", () => {
    beforeEach(() => {
      mocks.aiConsent = true;
    });

    it("fills any activity from the AI draft", async () => {
      mocks.aiDraft.mockResolvedValue({
        ok: true,
        draft: {
          activity: { kind: "custom", name: "Yardwork" },
          durationSeconds: 7200,
          distance: null,
          date: { year: 2026, month: 10, day: 18 },
          startTime: { hour: 9, minute: 0 },
          endedNow: false,
          environment: null,
          note: "Raking leaves",
        },
      });
      let tree = render();
      byLabel(tree, "Describe it (optional)").props.onChangeText(
        "did yardwork for 2 hours yesterday from 9am, raking leaves",
      );
      tree = render();
      byLabel(tree, "Fill in from description").props.onPress();
      tree = render();
      expect(byLabel(tree, "Fill in from description").props.label).toBe(
        "Filling in…",
      );
      expect(byLabel(tree, "Describe it (optional)").props.editable).toBe(
        false,
      );
      await flush();
      tree = render();
      expect(mocks.aiDraft.mock.calls[0]?.[1]).toBe(
        "did yardwork for 2 hours yesterday from 9am, raking leaves",
      );
      expect(byLabel(tree, "Activity").props.value).toBe("Yardwork");
      expect(byLabel(tree, "Minutes").props.value).toBe("120");
      expect(startTime(tree)).toBe("09:00");
      expect(byLabel(tree, "Notes (optional)").props.value).toBe(
        "Raking leaves",
      );
      expect(byLabel(tree, "Fill in from description").props.label).toBe(
        "Fill in from description",
      );
      const status = String(
        find(tree, (n) => n.type === "FormStatus")?.props.children,
      );
      expect(status).toContain("Filled in activity");
      expect(status).not.toContain("on your device");
    });

    it("falls back to the on-device parser and says why", async () => {
      mocks.aiDraft.mockResolvedValue({ ok: false, failure: "limit" });
      let tree = render();
      byLabel(tree, "Describe it (optional)").props.onChangeText(
        "I swam for 30 minutes",
      );
      tree = render();
      byLabel(tree, "Fill in from description").props.onPress();
      await flush();
      tree = render();
      expect(byLabel(tree, "Activity").props.value).toBe("Swimming");
      expect(byLabel(tree, "Minutes").props.value).toBe("30");
      expect(
        String(find(tree, (n) => n.type === "FormStatus")?.props.children),
      ).toContain("today's AI drafts limit");
    });
  });

  describe("AI draft fallbacks", () => {
    beforeEach(() => {
      mocks.aiConsent = true;
    });

    const fill = async (text: string) => {
      let tree = render();
      byLabel(tree, "Describe it (optional)").props.onChangeText(text);
      tree = render();
      byLabel(tree, "Fill in from description").props.onPress();
      await flush();
      return render();
    };

    // The provider note appears once the on-device check says no
    // (log-activity-screen-on-device.test.tsx); until then neither note shows.
    it("shows no AI note while the on-device check runs", () => {
      const tree = render();
      expect(
        find(
          tree,
          (n) =>
            n.type === "ThemedText" &&
            /sent to our AI provider|isn.t sent anywhere/.test(
              String(n.props.children),
            ),
        ),
      ).toBeNull();
    });

    it("uses the on-device parser when the request throws", async () => {
      mocks.aiDraft.mockRejectedValue(new Error("transport"));
      const tree = await fill("I swam for 30 minutes");
      expect(byLabel(tree, "Activity").props.value).toBe("Swimming");
      expect(
        String(find(tree, (n) => n.type === "FormStatus")?.props.children),
      ).toContain("AI drafting isn't available right now");
      expect(byLabel(tree, "Fill in from description").props.disabled).toBe(
        false,
      );
    });

    it("uses the on-device parser when the AI draft is empty", async () => {
      mocks.aiDraft.mockResolvedValue({
        ok: true,
        draft: {
          activity: null,
          durationSeconds: null,
          distance: null,
          date: null,
          startTime: null,
          endedNow: false,
          environment: null,
          note: null,
        },
      });
      const tree = await fill("I swam for 30 minutes");
      expect(byLabel(tree, "Activity").props.value).toBe("Swimming");
      expect(byLabel(tree, "Minutes").props.value).toBe("30");
    });

    it("drops a draft that returns after the account changed", async () => {
      let resolve: (value: unknown) => void = () => undefined;
      mocks.aiDraft.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      let tree = render();
      byLabel(tree, "Describe it (optional)").props.onChangeText(
        "did yardwork for 2 hours",
      );
      tree = render();
      byLabel(tree, "Fill in from description").props.onPress();
      mocks.userId = "other";
      render();
      resolve({
        ok: true,
        draft: {
          activity: { kind: "custom", name: "Yardwork" },
          durationSeconds: 7200,
          distance: null,
          date: null,
          startTime: null,
          endedNow: false,
          environment: null,
          note: null,
        },
      });
      await flush();
      tree = render();
      expect(byLabel(tree, "Activity").props.value).toBe("");
      expect(find(tree, (n) => n.type === "FormStatus")).toBeNull();
      expect(byLabel(tree, "Fill in from description").props.disabled).toBe(
        false,
      );
    });
  });

  it("uses only the on-device parser without AI consent", () => {
    let tree = render();
    byLabel(tree, "Describe it (optional)").props.onChangeText(
      "I swam for 30 minutes",
    );
    tree = render();
    byLabel(tree, "Fill in from description").props.onPress();
    tree = render();
    expect(mocks.aiDraft).not.toHaveBeenCalled();
    expect(byLabel(tree, "Activity").props.value).toBe("Swimming");
  });

  it("says so when a description has nothing usable", () => {
    let tree = render();
    byLabel(tree, "Describe it (optional)").props.onChangeText("hello there");
    tree = render();
    byLabel(tree, "Fill in from description").props.onPress();
    tree = render();
    expect(
      String(find(tree, (n) => n.type === "FormStatus")?.props.children),
    ).toContain("Couldn't find");
  });
  it("refuses a sets-and-reps catalog exercise", async () => {
    let tree = render();
    byLabel(tree, "Activity").props.onChangeText("Barbell Bench Press");
    byLabel(tree, "Minutes").props.onChangeText("10");
    tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    tree = render();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.saveRun).not.toHaveBeenCalled();
    expect(
      String(find(tree, (n) => n.type === "FormStatus")?.props.children),
    ).toContain("Use Log workout");
  });

  it("starts a 'just' activity that long ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 17, 15, 10, 30));
    try {
      let tree = render();
      byLabel(tree, "Describe it (optional)").props.onChangeText(
        "I just went swimming for half an hour in the ocean",
      );
      tree = render();
      byLabel(tree, "Fill in from description").props.onPress();
      tree = render();
      expect(byLabel(tree, "Activity").props.value).toBe("Swimming");
      expect(byLabel(tree, "Minutes").props.value).toBe("30");
      expect(startTime(tree)).toBe("14:40");
      expect(byLabel(tree, "Notes (optional)").props.value).toBe(
        "In the ocean",
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("links to a run left unfinished in the run editor", async () => {
    mocks.runDraft = { content: true };
    render();
    for (const effect of mocks.effects) effect();
    await flush();
    const tree = render();
    const notice = find(tree, (n) => n.type === "Notice");
    expect(notice.props.title).toBe("Unfinished run");
    notice.props.action.props.onPress();
    expect(mocks.push).toHaveBeenCalledWith("/log-run");
  });

  it("shows no unfinished-run notice without a draft", async () => {
    render();
    for (const effect of mocks.effects) effect();
    await flush();
    expect(find(render(), (n) => n.type === "Notice")).toBeNull();
  });
});
