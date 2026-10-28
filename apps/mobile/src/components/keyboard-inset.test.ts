import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  os: "android",
  slots: [] as unknown[],
  index: 0,
  effects: [] as (() => void | (() => void))[],
  listeners: new Map<string, (event: any) => void>(),
  removed: [] as string[],
  window: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 24, right: 0, bottom: 48, left: 0 },
}));

vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const slot = mocks.index++;
    if (!(slot in mocks.slots)) mocks.slots[slot] = initial;
    return [
      mocks.slots[slot],
      (value: unknown) => {
        mocks.slots[slot] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const slot = mocks.index++;
    if (!(slot in mocks.slots)) mocks.slots[slot] = { current: initial };
    return mocks.slots[slot];
  },
  useEffect: (effect: () => void | (() => void)) => {
    mocks.effects.push(effect);
  },
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.os;
    },
  },
  Keyboard: {
    addListener: (name: string, listener: (event: any) => void) => {
      mocks.listeners.set(name, listener);
      return { remove: () => mocks.removed.push(name) };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaFrame: () => mocks.window,
  useSafeAreaInsets: () => mocks.insets,
}));

import { keyboardOverlap, useAndroidKeyboardInset } from "./keyboard-inset";

// A form ScrollView below a 100dp header that reaches the window bottom.
const view = { y: 100, height: 700 };
const scrollRef = {
  current: {
    getNativeScrollRef: () => ({
      measureInWindow: (
        callback: (x: number, y: number, width: number, height: number) => void,
      ) => callback(0, view.y, 400, view.height),
    }),
  },
} as any;

function render() {
  mocks.index = 0;
  return useAndroidKeyboardInset(scrollRef);
}
function mount() {
  render();
  return mocks.effects.splice(0).map((effect) => effect());
}

beforeEach(() => {
  mocks.os = "android";
  mocks.slots = [];
  mocks.effects = [];
  mocks.listeners.clear();
  mocks.removed = [];
  view.y = 100;
  view.height = 700;
});

it("reserves the keyboard and navigation bar overlap below the view", () => {
  expect(
    keyboardOverlap({
      viewBottom: 800,
      windowHeight: 800,
      keyboardHeight: 300,
      navigationBarInset: 48,
    }),
  ).toBe(348);
  // A view that already ends above the keyboard needs no space.
  expect(
    keyboardOverlap({
      viewBottom: 400,
      windowHeight: 800,
      keyboardHeight: 300,
      navigationBarInset: 48,
    }),
  ).toBe(0);
  expect(
    keyboardOverlap({
      viewBottom: 800,
      windowHeight: 800,
      keyboardHeight: 0,
      navigationBarInset: 48,
    }),
  ).toBe(0);
});

it("shrinks the ScrollView above the Android keyboard and restores it", () => {
  mount();
  expect(render()).toEqual({ marginBottom: 0 });

  mocks.listeners.get("keyboardDidShow")!({
    endCoordinates: { height: 300, screenY: 452 },
  });
  expect(render()).toEqual({ marginBottom: 348 });

  // A taller emoji panel re-emits keyboardDidShow while the view is already
  // shrunk; the measurement then excludes the space already reserved.
  view.height = 700 - 348;
  mocks.listeners.get("keyboardDidShow")!({
    endCoordinates: { height: 360, screenY: 392 },
  });
  expect(render()).toEqual({ marginBottom: 408 });

  mocks.listeners.get("keyboardDidHide")!({});
  expect(render()).toEqual({ marginBottom: 0 });
});

it("ignores a measurement that returns after the keyboard hid", () => {
  let measured: (() => void) | null = null;
  const deferredRef = {
    current: {
      getNativeScrollRef: () => ({
        measureInWindow: (
          callback: (x: number, y: number, w: number, h: number) => void,
        ) => {
          measured = () => callback(0, view.y, 400, view.height);
        },
      }),
    },
  } as any;
  mocks.index = 0;
  useAndroidKeyboardInset(deferredRef);
  mocks.effects.splice(0).forEach((effect) => effect());

  mocks.listeners.get("keyboardDidShow")!({
    endCoordinates: { height: 300, screenY: 452 },
  });
  mocks.listeners.get("keyboardDidHide")!({});
  measured!();
  mocks.index = 0;
  expect(useAndroidKeyboardInset(deferredRef)).toEqual({ marginBottom: 0 });
});

it("removes its keyboard listeners on unmount", () => {
  const [cleanup] = mount();
  (cleanup as () => void)();
  expect(mocks.removed.sort()).toEqual(["keyboardDidHide", "keyboardDidShow"]);
});

it("leaves iOS keyboard insets to the ScrollView", () => {
  mocks.os = "ios";
  const cleanups = mount();
  expect(render()).toBeUndefined();
  expect(mocks.listeners.size).toBe(0);
  expect(cleanups).toEqual([undefined]);
});
