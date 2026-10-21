import { beforeEach, describe, expect, it, vi } from "vitest";

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
  canOnDevice: vi.fn(),
  onDeviceDraft: vi.fn(),
  prewarm: vi.fn(),
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
vi.mock("./activity-on-device-draft", () => ({
  canDraftActivityOnDevice: mocks.canOnDevice,
  draftActivityOnDevice: mocks.onDeviceDraft,
  prewarmActivityDrafting: mocks.prewarm,
}));
vi.mock("./log-activity-data", () => ({
  saveLoggedActivityWith: mocks.save,
  saveLoggedRunWith: mocks.saveRun,
}));

import { LogActivityScreen } from "./log-activity-screen";

const render = () => {
  hooks.index = 0;
  mocks.effects = [];
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
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
/** Effect cleanups from the latest runEffects call. */
let cleanups: Array<() => void> = [];
const runEffects = () => {
  cleanups = [];
  for (const effect of mocks.effects) {
    const cleanup = (effect as () => unknown)();
    if (typeof cleanup === "function") cleanups.push(cleanup as () => void);
  }
};
/** Render, run the mount effects once, and let their promises settle. */
const mount = async () => {
  render();
  runEffects();
  await flush();
  return render();
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
const press = (tree: any) =>
  byLabel(tree, "Fill in from description").props.onPress();
const type = (text: string) => {
  byLabel(render(), "Describe it (optional)").props.onChangeText(text);
  return render();
};
const emptyDraft = {
  activity: null,
  durationSeconds: null,
  distance: null,
  date: null,
  startTime: null,
  endedNow: false,
  environment: null,
  note: null,
};
const hasText = (tree: any, text: string) =>
  find(
    tree,
    (n) => n.type === "ThemedText" && String(n.props.children).includes(text),
  ) !== null;
const status = (tree: any) =>
  String(find(tree, (n) => n.type === "FormStatus")?.props.children ?? "");
const fill = async (tree: any, description: string) => {
  byLabel(tree, "Describe it (optional)").props.onChangeText(description);
  const typed = render();
  byLabel(typed, "Fill in from description").props.onPress();
  await flush();
  return render();
};

/** Neither former note under the button (removed on 2026-10-21). */
const expectNoNote = (tree: any) => {
  expect(hasText(tree, "Apple Intelligence")).toBe(false);
  expect(hasText(tree, "sent to our AI provider")).toBe(false);
  expect(status(tree)).not.toContain("Apple Intelligence");
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
  cleanups = [];
  mocks.canOnDevice.mockResolvedValue(false);
  mocks.prewarm.mockResolvedValue(undefined);
});

describe("log activity screen with on-device drafting", () => {
  it("drafts on the device for a consenting user and never calls the server", async () => {
    mocks.aiConsent = true;
    mocks.canOnDevice.mockResolvedValue(true);
    mocks.onDeviceDraft.mockResolvedValue({
      ok: true,
      draft: {
        activity: { kind: "custom", name: "Yardwork" },
        durationSeconds: 7200,
        distance: null,
        date: { year: 2026, month: 10, day: 18 },
        startTime: { hour: 9, minute: 0 },
        endedNow: false,
        environment: null,
        note: null,
      },
    });
    let tree = await mount();
    expect(mocks.prewarm).toHaveBeenCalledTimes(1);
    expectNoNote(tree);

    tree = await fill(tree, "did yardwork for 2 hours yesterday from 9am");
    expect(mocks.onDeviceDraft).toHaveBeenCalledTimes(1);
    expect(mocks.onDeviceDraft.mock.calls[0]?.[0]).toBe(
      "did yardwork for 2 hours yesterday from 9am",
    );
    expect(mocks.onDeviceDraft.mock.calls[0]?.[1]).toBeInstanceOf(Date);
    expect(mocks.aiDraft).not.toHaveBeenCalled();
    expect(byLabel(tree, "Activity").props.value).toBe("Yardwork");
    expect(byLabel(tree, "Minutes").props.value).toBe("120");
    expect(status(tree)).toContain("Filled in activity");
    expectNoNote(tree);
    expect(byLabel(tree, "Fill in from description").props.label).toBe(
      "Fill in from description",
    );
  });

  it("uses the server when on-device is unavailable, with no note under the button", async () => {
    mocks.aiConsent = true;
    mocks.canOnDevice.mockResolvedValue(false);
    mocks.aiDraft.mockResolvedValue({
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
    let tree = await mount();
    expect(mocks.prewarm).not.toHaveBeenCalled();
    expectNoNote(tree);

    tree = await fill(tree, "did yardwork for 2 hours");
    expect(mocks.aiDraft).toHaveBeenCalledTimes(1);
    expect(mocks.onDeviceDraft).not.toHaveBeenCalled();
    expect(byLabel(tree, "Activity").props.value).toBe("Yardwork");
  });

  it("does not consult the device or show either note without AI consent", async () => {
    mocks.aiConsent = false;
    mocks.canOnDevice.mockResolvedValue(true);
    let tree = await mount();
    expect(mocks.canOnDevice).not.toHaveBeenCalled();
    expectNoNote(tree);

    tree = await fill(tree, "I swam for 30 minutes");
    expect(mocks.onDeviceDraft).not.toHaveBeenCalled();
    expect(mocks.aiDraft).not.toHaveBeenCalled();
    expect(byLabel(tree, "Activity").props.value).toBe("Swimming");
  });

  it("falls back to the AI provider when the on-device model fails", async () => {
    mocks.aiConsent = true;
    mocks.canOnDevice.mockResolvedValue(true);
    mocks.onDeviceDraft.mockResolvedValue({
      ok: false,
      draft: { ...emptyDraft, durationSeconds: 7200 },
    });
    mocks.aiDraft.mockResolvedValue({
      ok: true,
      draft: {
        ...emptyDraft,
        activity: { kind: "custom", name: "Yardwork" },
        durationSeconds: 7200,
      },
    });
    let tree = await mount();
    tree = await fill(tree, "did yardwork for 2 hours");
    expect(mocks.onDeviceDraft).toHaveBeenCalledTimes(1);
    expect(mocks.aiDraft).toHaveBeenCalledTimes(1);
    expect(mocks.aiDraft.mock.calls[0]?.[1]).toBe("did yardwork for 2 hours");
    expect(byLabel(tree, "Activity").props.value).toBe("Yardwork");
    expect(byLabel(tree, "Minutes").props.value).toBe("120");
    expect(status(tree)).toContain("Filled in activity");
    expectNoNote(tree);
    expect(byLabel(tree, "Fill in from description").props.disabled).toBe(
      false,
    );
  });

  it("sends nothing to the provider when the account switches during a failed on-device attempt", async () => {
    mocks.aiConsent = true;
    mocks.canOnDevice.mockResolvedValue(true);
    const attempt = deferred<{ ok: boolean; draft: Record<string, unknown> }>();
    mocks.onDeviceDraft.mockReturnValue(attempt.promise);
    const tree = await mount();
    byLabel(tree, "Describe it (optional)").props.onChangeText(
      "did yardwork for 2 hours",
    );
    press(render());
    await flush();
    mocks.userId = "other";
    render();
    attempt.resolve({
      ok: false,
      draft: { ...emptyDraft, durationSeconds: 7200 },
    });
    await flush();
    expect(mocks.aiDraft).not.toHaveBeenCalled();
  });

  it("keeps the parser fields and says why when the provider also fails after the fallback", async () => {
    mocks.aiConsent = true;
    mocks.canOnDevice.mockResolvedValue(true);
    mocks.onDeviceDraft.mockResolvedValue({
      ok: false,
      draft: { ...emptyDraft, durationSeconds: 7200 },
    });
    mocks.aiDraft.mockResolvedValue({ ok: false, failure: "unavailable" });
    let tree = await mount();
    tree = await fill(tree, "did yardwork for 2 hours");
    expect(mocks.aiDraft).toHaveBeenCalledTimes(1);
    expect(typeof mocks.aiDraft.mock.calls[0]?.[0]?.request).toBe("function");
    expect(byLabel(tree, "Minutes").props.value).toBe("120");
    expect(status(tree)).toContain("filled in on your device");
    expect(byLabel(tree, "Fill in from description").props.disabled).toBe(
      false,
    );
  });

  it("sends nothing to the provider when consent is revoked during the on-device attempt", async () => {
    mocks.aiConsent = true;
    mocks.canOnDevice.mockResolvedValue(true);
    const attempt = deferred<{ ok: boolean; draft: Record<string, unknown> }>();
    mocks.onDeviceDraft.mockReturnValue(attempt.promise);
    const tree = await mount();
    byLabel(tree, "Describe it (optional)").props.onChangeText(
      "did yardwork for 2 hours",
    );
    press(render());
    await flush();
    mocks.aiConsent = false;
    render();
    attempt.resolve({
      ok: false,
      draft: { ...emptyDraft, durationSeconds: 7200 },
    });
    await flush();
    expect(mocks.aiDraft).not.toHaveBeenCalled();
    expect(byLabel(render(), "Minutes").props.value).toBe("120");
  });
});

describe("on-device availability check and races", () => {
  beforeEach(() => {
    mocks.aiConsent = true;
  });

  const yardwork = {
    ok: true,
    draft: {
      ...emptyDraft,
      activity: { kind: "custom", name: "Yardwork" },
      durationSeconds: 7200,
    },
  };

  it("shows no note under the button before or after the check", async () => {
    const check = deferred<boolean>();
    mocks.canOnDevice.mockReturnValue(check.promise);
    let tree = await mount();
    expectNoNote(tree);
    check.resolve(true);
    await flush();
    tree = render();
    expectNoNote(tree);
  });

  it("waits for a pending check on tap and then drafts on the device", async () => {
    const check = deferred<boolean>();
    mocks.canOnDevice.mockReturnValue(check.promise);
    mocks.onDeviceDraft.mockResolvedValue(yardwork);
    await mount();
    const typed = type("did yardwork for 2 hours");
    press(typed);
    await flush();
    const waiting = render();
    expect(byLabel(waiting, "Fill in from description").props.label).toBe(
      "Filling in…",
    );
    expect(byLabel(waiting, "Describe it (optional)").props.editable).toBe(
      false,
    );
    expect(mocks.onDeviceDraft).not.toHaveBeenCalled();
    expect(mocks.aiDraft).not.toHaveBeenCalled();

    check.resolve(true);
    await flush();
    const tree = render();
    expect(mocks.onDeviceDraft).toHaveBeenCalledTimes(1);
    expect(mocks.aiDraft).not.toHaveBeenCalled();
    expect(byLabel(tree, "Activity").props.value).toBe("Yardwork");
    expect(byLabel(tree, "Fill in from description").props.label).toBe(
      "Fill in from description",
    );
  });

  it("uses the server after a pending check resolves false", async () => {
    const check = deferred<boolean>();
    mocks.canOnDevice.mockReturnValue(check.promise);
    mocks.aiDraft.mockResolvedValue({ ok: true, draft: yardwork.draft });
    await mount();
    press(type("did yardwork for 2 hours"));
    check.resolve(false);
    await flush();
    expect(mocks.aiDraft).toHaveBeenCalledTimes(1);
    expect(mocks.onDeviceDraft).not.toHaveBeenCalled();
  });

  it("ignores a stale availability result after AI drafting turns off", async () => {
    const check = deferred<boolean>();
    mocks.canOnDevice.mockReturnValue(check.promise);
    render();
    runEffects();
    mocks.aiConsent = false;
    for (const cleanup of cleanups) cleanup();
    render();
    runEffects();
    check.resolve(true);
    await flush();
    const tree = render();
    expectNoNote(tree);
    expect(mocks.prewarm).not.toHaveBeenCalled();
  });

  it("applies nothing and resets busy when the account switches mid-draft", async () => {
    const draft = deferred<unknown>();
    mocks.canOnDevice.mockResolvedValue(true);
    mocks.onDeviceDraft.mockReturnValue(draft.promise);
    await mount();
    press(type("did yardwork for 2 hours"));
    await flush();
    expect(byLabel(render(), "Fill in from description").props.label).toBe(
      "Filling in…",
    );

    mocks.userId = "someone-else";
    render();
    draft.resolve(yardwork);
    await flush();
    const tree = render();
    expect(byLabel(tree, "Activity").props.value).toBe("");
    expect(byLabel(tree, "Minutes").props.value).toBe("");
    expect(status(tree)).toBe("");
    expect(byLabel(tree, "Fill in from description").props.label).toBe(
      "Fill in from description",
    );
    expect(byLabel(tree, "Describe it (optional)").props.editable).toBe(true);
  });

  it("calls the on-device draft once for a double tap", async () => {
    const draft = deferred<unknown>();
    mocks.canOnDevice.mockResolvedValue(true);
    mocks.onDeviceDraft.mockReturnValue(draft.promise);
    await mount();
    const typed = type("did yardwork for 2 hours");
    press(typed);
    press(typed);
    await flush();
    press(render());
    draft.resolve(yardwork);
    await flush();
    expect(mocks.onDeviceDraft).toHaveBeenCalledTimes(1);
    expect(mocks.aiDraft).not.toHaveBeenCalled();
  });

  it("calls the on-device draft once for a double tap during the check", async () => {
    const check = deferred<boolean>();
    mocks.canOnDevice.mockReturnValue(check.promise);
    mocks.onDeviceDraft.mockResolvedValue(yardwork);
    await mount();
    const typed = type("did yardwork for 2 hours");
    press(typed);
    press(typed);
    check.resolve(true);
    await flush();
    expect(mocks.onDeviceDraft).toHaveBeenCalledTimes(1);
  });

  it("shows no notice when the model finds no activity", async () => {
    mocks.canOnDevice.mockResolvedValue(true);
    mocks.onDeviceDraft.mockResolvedValue({
      ok: true,
      draft: { ...emptyDraft, durationSeconds: 3600 },
    });
    await mount();
    press(type("read a book for an hour"));
    await flush();
    const tree = render();
    expect(byLabel(tree, "Activity").props.value).toBe("");
    expect(byLabel(tree, "Minutes").props.value).toBe("60");
    expectNoNote(tree);
    expect(status(tree)).toContain("Filled in duration");
  });
});

describe("fills that race the availability check or re-check it", () => {
  beforeEach(() => {
    mocks.aiConsent = true;
  });

  const yardworkDraft = {
    ...emptyDraft,
    activity: { kind: "custom", name: "Yardwork" },
    durationSeconds: 7200,
  };

  const expectNothingSent = () => {
    expect(mocks.onDeviceDraft).not.toHaveBeenCalled();
    expect(mocks.aiDraft).not.toHaveBeenCalled();
    const tree = render();
    expect(byLabel(tree, "Activity").props.value).toBe("");
    expect(byLabel(tree, "Minutes").props.value).toBe("");
    expect(status(tree)).toBe("");
    expect(byLabel(tree, "Fill in from description").props.label).toBe(
      "Fill in from description",
    );
    expect(byLabel(tree, "Describe it (optional)").props.editable).toBe(true);
  };

  it.each([false, true])(
    "sends nothing when consent is revoked during the check (resolves %s)",
    async (available) => {
      const check = deferred<boolean>();
      mocks.canOnDevice.mockReturnValue(check.promise);
      await mount();
      press(type("did yardwork for 2 hours"));
      await flush();
      expect(byLabel(render(), "Fill in from description").props.label).toBe(
        "Filling in…",
      );

      mocks.aiConsent = false;
      for (const cleanup of cleanups) cleanup();
      render();
      runEffects();
      check.resolve(available);
      await flush();
      expectNothingSent();
      const tree = render();
      expectNoNote(tree);
    },
  );

  it.each([false, true])(
    "sends nothing when the account switches during the check (resolves %s)",
    async (available) => {
      const check = deferred<boolean>();
      mocks.canOnDevice.mockReturnValue(check.promise);
      await mount();
      press(type("did yardwork for 2 hours"));
      await flush();

      mocks.userId = "someone-else";
      render();
      check.resolve(available);
      await flush();
      expectNothingSent();
    },
  );

  it("re-checks on tap and drafts on the device once the model is ready", async () => {
    mocks.canOnDevice.mockResolvedValueOnce(false);
    mocks.onDeviceDraft.mockResolvedValue({ ok: true, draft: yardworkDraft });
    let tree = await mount();
    expect(mocks.canOnDevice).toHaveBeenCalledTimes(1);

    mocks.canOnDevice.mockResolvedValueOnce(true);
    tree = await fill(tree, "did yardwork for 2 hours");
    expect(mocks.canOnDevice).toHaveBeenCalledTimes(2);
    expect(mocks.onDeviceDraft).toHaveBeenCalledTimes(1);
    expect(mocks.aiDraft).not.toHaveBeenCalled();
    expect(byLabel(tree, "Activity").props.value).toBe("Yardwork");
    expectNoNote(tree);
  });

  it("uses the server when the mount check and the tap-time check both say no", async () => {
    mocks.canOnDevice.mockResolvedValue(false);
    mocks.aiDraft.mockResolvedValue({ ok: true, draft: yardworkDraft });
    let tree = await mount();
    tree = await fill(tree, "did yardwork for 2 hours");
    expect(mocks.canOnDevice).toHaveBeenCalledTimes(2);
    expect(mocks.aiDraft).toHaveBeenCalledTimes(1);
    expect(mocks.onDeviceDraft).not.toHaveBeenCalled();
    expect(byLabel(tree, "Activity").props.value).toBe("Yardwork");
    expectNoNote(tree);
  });
});
