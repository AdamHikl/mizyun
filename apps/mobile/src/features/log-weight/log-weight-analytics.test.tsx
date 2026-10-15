import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  owner: "owner-a",
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  remove: null as (() => void) | null,
  scopes: 0,
  submit: vi.fn(),
  track: vi.fn().mockResolvedValue({ recorded: true }),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) =>
    (mocks.slots[mocks.index++] ??= { current: initial }),
  useState: (initial: unknown) => {
    const i = mocks.index++;
    if (!(i in mocks.slots)) mocks.slots[i] = initial;
    return [
      mocks.slots[i],
      (next: any) => {
        mocks.slots[i] =
          typeof next === "function" ? next(mocks.slots[i]) : next;
      },
    ];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void, deps: any[]) => {
    const i = mocks.index++;
    const prior = mocks.slots[i];
    if (
      !prior ||
      !prior.every((value: any, j: number) => Object.is(value, deps[j]))
    ) {
      mocks.slots[i] = deps;
      mocks.effects.push(fn);
    }
  },
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (x: unknown) => x },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn() },
  Stack: { Screen: "StackScreen" },
  useNavigation: () => navigation,
}));
const navigation = {
  addListener: (_name: string, listener: () => void) => {
    mocks.remove = listener;
    return () => {
      mocks.remove = null;
    };
  },
};
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({
  BottomTabInset: 0,
  MaxContentWidth: 600,
  PageGutter: 20,
  Spacing: {},
}));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  FormField: "FormField",
  FormStatus: "FormStatus",
  FormTextInput: "FormTextInput",
  Notice: "Notice",
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.owner } },
    profile: { unitSystem: "metric" },
  }),
}));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: {
    createFlowScope: () => ({ flowId: `scope-${++mocks.scopes}` }),
    track: mocks.track,
  },
}));
// The preparation helper is real; the authenticated transport is a separate
// boundary and must not initialize native/Auth configuration in this fixture.
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: vi.fn(), status: () => ({ configured: true }) },
}));
vi.mock("@/features/logging-draft-storage", () => ({
  loadRequiredLoggingDraft: async () => ({
    unitSystem: "metric",
    weight: "77.5",
    waist: "85",
    chest: "100",
  }),
  saveLoggingDraft: vi.fn().mockResolvedValue(true),
  clearLoggingDraft: vi.fn(),
}));
vi.mock("./weigh-in-reminders", () => ({
  markWeighInLoggedToday: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./log-weight-data", async (original) => ({
  ...(await original<typeof import("./log-weight-data")>()),
  submitLogWeight: mocks.submit,
}));
import { LogWeightScreen } from "./log-weight-screen";
function render(): any {
  mocks.index = 0;
  const tree = LogWeightScreen();
  mocks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
beforeEach(async () => {
  mocks.slots = [];
  mocks.effects = [];
  mocks.owner = "owner-a";
  mocks.scopes = 0;
  mocks.track.mockClear();
  mocks.submit.mockReset().mockResolvedValue({ ok: true });
  render();
  await settle();
});
function save() {
  find(render(), (node) => node.type === "Button").props.onPress();
}

it("emits one correlated record only on a successful measurement save, without measurements in telemetry", async () => {
  save();
  await settle();
  mocks.remove!();
  await settle();
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      weightKg: 77.5,
      measurements: { waist_cm: 85, chest_cm: 100 },
      clientOperationId: expect.any(String),
      measuredAt: expect.any(String),
    }),
    expect.objectContaining({
      expectedUserId: "owner-a",
      isCurrent: expect.any(Function),
    }),
  );
  expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
    "logging_flow_started",
    "logging_flow_completed",
    "core_record_created",
  ]);
  expect(
    new Set(mocks.track.mock.calls.map(([, scope]) => scope.flowId)).size,
  ).toBe(1);
  expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("77.5");
});

it("reports failed save and observed navigation exit without a core record", async () => {
  mocks.submit.mockResolvedValue({ ok: false, message: "Network unavailable" });
  save();
  await settle();
  mocks.remove!();
  await settle();
  expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
    "logging_flow_started",
    "logging_flow_failed",
    "logging_flow_exited",
  ]);
});

it("does not complete B's attempt when A's save resolves after an account switch", async () => {
  let resolve!: (value: { ok: true }) => void;
  mocks.submit.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  save();
  await settle();
  mocks.owner = "owner-b";
  render();
  resolve({ ok: true });
  await settle();
  expect(
    mocks.track.mock.calls.filter(
      ([event]) => event.name === "logging_flow_completed",
    ),
  ).toHaveLength(0);
  expect(
    mocks.track.mock.calls.filter(
      ([event]) => event.name === "logging_flow_started",
    )[1][1].flowId,
  ).toBe("scope-2");
});
