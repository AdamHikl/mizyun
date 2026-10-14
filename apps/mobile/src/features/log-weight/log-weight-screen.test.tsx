import { beforeEach, expect, it, vi } from "vitest";
import type { RequestOptions } from "@mizyun/api-client";

const mocks = vi.hoisted(() => ({
  owner: "owner-a",
  unitSystem: "metric",
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  store: new Map<string, string>(),
  rows: new Map<string, { id: string; body: unknown }>(),
  requests: [] as RequestOptions[],
  dropResponse: false,
  failRead: false,
  failWrite: false,
  delayWrite: null as null | Promise<void>,
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  request: vi.fn(),
  back: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => (mocks.slots[mocks.index++] ??= { current }),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.slots)) mocks.slots[index] = initial;
    return [
      mocks.slots[index],
      (next: any) => {
        mocks.slots[index] =
          typeof next === "function" ? next(mocks.slots[index]) : next;
      },
    ];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (callback: () => void, dependencies: any[]) => {
    const index = mocks.index++;
    const prior = mocks.slots[index];
    if (
      !prior ||
      prior.some((value: any, i: number) => !Object.is(value, dependencies[i]))
    ) {
      mocks.slots[index] = dependencies;
      mocks.effects.push(callback);
    }
  },
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("expo-router", () => ({
  router: { back: mocks.back },
  Stack: { Screen: "StackScreen" },
}));
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
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "black" }) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.owner } },
    profile: { unitSystem: mocks.unitSystem },
  }),
}));
vi.mock("@/features/analytics/flow-measurement", () => ({
  useLoggingFlowMeasurement: () => ({ current: null }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: mocks.get,
  setItemAsync: mocks.set,
  deleteItemAsync: mocks.delete,
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request, status: () => ({ configured: true }) },
}));

import { LogWeightScreen } from "./log-weight-screen";

const key = (owner = "owner-a") => `mizyun.logging-draft.${owner}.weight`;
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
const saveButton = (tree = render()) =>
  find(
    tree,
    (node) =>
      node.type === "Button" && node.props.label !== "Retry draft recovery",
  );
const field = (tree: any, id: string) =>
  find(tree, (node) => node.props?.testID === id);
async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}
async function open() {
  render();
  await settle();
  return render();
}
function restart() {
  mocks.slots = [];
  mocks.effects = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  restart();
  mocks.owner = "owner-a";
  mocks.unitSystem = "metric";
  mocks.store.clear();
  mocks.rows.clear();
  mocks.requests = [];
  mocks.dropResponse = false;
  mocks.failRead = false;
  mocks.failWrite = false;
  mocks.delayWrite = null;
  mocks.store.set(
    key(),
    JSON.stringify({
      weight: "72.5",
      waist: "81",
      chest: "",
      unitSystem: "metric",
    }),
  );
  mocks.get.mockImplementation(async (draftKey: string) => {
    if (mocks.failRead) throw new Error("keychain locked");
    return mocks.store.get(draftKey) ?? null;
  });
  mocks.set.mockImplementation(async (draftKey: string, value: string) => {
    if (mocks.delayWrite) await mocks.delayWrite;
    if (mocks.failWrite) throw new Error("storage unavailable");
    mocks.store.set(draftKey, value);
  });
  mocks.delete.mockImplementation(async (draftKey: string) => {
    mocks.store.delete(draftKey);
  });
  mocks.request.mockImplementation(async (options: RequestOptions) => {
    mocks.requests.push(options);
    const body = options.body as { clientOperationId: string };
    const operation = `${options.expectedUserId}:${body.clientOperationId}`;
    const prior = mocks.rows.get(operation);
    const row = prior ?? {
      id: "00000000-0000-4000-8000-000000000001",
      body: structuredClone(body),
    };
    if (prior) expect(body).toEqual(prior.body);
    mocks.rows.set(operation, row);
    if (mocks.dropResponse)
      return { ok: false, error: { kind: "network_error" } };
    return { ok: true, value: { bodyMeasurement: { id: row.id } } };
  });
});

it("replays the screen's persisted command after server commit, lost response, and app restart", async () => {
  await open();
  mocks.dropResponse = true;
  saveButton().props.onPress();
  await settle();
  expect(mocks.rows.size).toBe(1);
  const first = mocks.requests[0]!;
  const pending = JSON.parse(mocks.store.get(key())!);
  expect(pending.pending).toEqual(first.body);
  expect(first.headers?.["Idempotency-Key"]).toBe(
    pending.pending.clientOperationId,
  );
  expect(mocks.back).not.toHaveBeenCalled();
  restart();
  mocks.unitSystem = "imperial";
  const tree = await open();
  expect(field(tree, "body-weight-input").props.editable).toBe(false);
  expect(saveButton(tree).props.label).toBe("Retry measurement");
  mocks.dropResponse = false;
  saveButton(tree).props.onPress();
  await settle();
  expect(mocks.requests).toHaveLength(2);
  expect(mocks.requests[1]?.body).toEqual(first.body);
  expect(mocks.rows.size).toBe(1);
  expect(mocks.back).toHaveBeenCalledTimes(1);
  expect(mocks.store.has(key())).toBe(false);
  render();
  await settle();
  expect(mocks.store.has(key())).toBe(false);
});

it("awaits persistence and synchronously blocks a second tap before React rerenders", async () => {
  await open();
  await settle();
  let finish!: () => void;
  mocks.delayWrite = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const button = saveButton();
  button.props.onPress();
  button.props.onPress();
  await settle();
  expect(mocks.request).not.toHaveBeenCalled();
  finish();
  await settle();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.rows.size).toBe(1);
});

it("sends nothing when command persistence fails and reuses its identity on recovery", async () => {
  await open();
  mocks.failWrite = true;
  saveButton().props.onPress();
  await settle();
  expect(mocks.request).not.toHaveBeenCalled();
  const tree = render();
  expect(saveButton(tree).props.label).toBe("Retry measurement");
  expect(field(tree, "body-weight-input").props.editable).toBe(false);
  mocks.failWrite = false;
  saveButton(tree).props.onPress();
  await settle();
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("blocks a fresh submission while recovery is unavailable or the saved identity is corrupt", async () => {
  mocks.failRead = true;
  const tree = await open();
  expect(saveButton(tree).props.disabled).toBe(true);
  saveButton(tree).props.onPress();
  await settle();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
  mocks.failRead = false;
  mocks.store.set(
    key(),
    JSON.stringify({
      weight: "72",
      unitSystem: "metric",
      pending: {
        clientOperationId: "bad",
        measuredAt: "2026-10-08T10:00:00Z",
        weightKg: 72,
      },
    }),
  );
  find(
    tree,
    (node) =>
      node.type === "Button" && node.props.label === "Retry draft recovery",
  ).props.onPress();
  render();
  await settle();
  expect(saveButton().props.disabled).toBe(true);
  expect(mocks.request).not.toHaveBeenCalled();
});

it("does not send A's command or expose its fields after an account switch during persistence", async () => {
  await open();
  await settle();
  let finish!: () => void;
  mocks.delayWrite = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const oldSave = saveButton();
  oldSave.props.onPress();
  await settle();
  mocks.owner = "owner-b";
  const tree = render();
  expect(field(tree, "body-weight-input").props.value).toBe("");
  oldSave.props.onPress();
  finish();
  await settle();
  render();
  await settle();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.back).not.toHaveBeenCalled();
  const draftB = JSON.parse(mocks.store.get(key("owner-b"))!);
  expect(draftB.weight).toBe("");
  expect(draftB.pending).toBeUndefined();
  expect(
    JSON.parse(mocks.store.get(key())!).pending.clientOperationId,
  ).toBeTruthy();
});
