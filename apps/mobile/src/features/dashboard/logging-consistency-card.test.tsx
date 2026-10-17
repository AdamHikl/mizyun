import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (value: unknown) => value },
  View: "View",
}));
vi.mock("expo-router", () => ({
  router: { push: mocks.push },
  useFocusEffect: () => {},
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({ Card: "Card", Icon: "Icon" }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    primary: "#0A8F63",
    backgroundSelected: "#E8ECEA",
  }),
}));
vi.mock("./logging-consistency-data", () => ({ loadLoggingHistory: vi.fn() }));

import { computeLoggingConsistency } from "@mizyun/core";
import {
  LoggingConsistencyView,
  resolveLoggingConsistencyCard,
} from "./logging-consistency-card";
import { presentLoggingConsistency } from "./logging-consistency-presentation";

function findAll(node: any, predicate: (n: any) => boolean, out: any[] = []) {
  if (Array.isArray(node)) node.forEach((c) => findAll(c, predicate, out));
  else if (node && typeof node === "object") {
    if (predicate(node)) out.push(node);
    findAll(node.props?.children, predicate, out);
  }
  return out;
}
const view = (loggedDates: string[], weeklyGoal = 5) =>
  LoggingConsistencyView({
    presentation: presentLoggingConsistency(
      computeLoggingConsistency({
        loggedDates,
        today: "2026-10-17",
        weeklyGoal,
      })!,
    ),
  });
const texts = (tree: any) =>
  findAll(tree, (n) => n.type === "ThemedText").map((n) => n.props.children);

beforeEach(() => mocks.push.mockReset());

describe("LoggingConsistencyView", () => {
  it("shows weekly progress and seven accessible day dots without actions", () => {
    const tree = view(["2026-10-12", "2026-10-16"]);
    expect(texts(tree)).toContain("Logged 2 of 5 days this week");
    const labelled = findAll(tree, (n) =>
      /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,/.test(
        n.props?.accessibilityLabel ?? "",
      ),
    );
    expect(labelled).toHaveLength(7);
    expect(
      findAll(tree, (n) => n.props?.accessibilityRole === "button"),
    ).toHaveLength(0);
  });

  it("greets a returning user without competing actions or guilt wording", () => {
    const tree = view(["2026-10-10"]);
    expect(texts(tree)).toContain("Welcome back");
    expect(
      findAll(tree, (n) => n.props?.accessibilityRole === "button"),
    ).toHaveLength(0);
  });
});

describe("resolveLoggingConsistencyCard", () => {
  const prefs = { weeklyGoal: 4, hidden: false };
  const history = { today: "2026-10-17", loggedDates: ["2026-10-16"] };

  it("computes the state from preferences and history", async () => {
    const result = await resolveLoggingConsistencyCard("u", {
      loadPreferences: async () => prefs,
      loadHistory: async () => history,
    });
    expect(result?.weeklyGoal).toBe(4);
    expect(result?.daysLoggedThisWeek).toBe(1);
  });

  it("renders nothing when hidden, without reading history", async () => {
    const loadHistory = vi.fn();
    expect(
      await resolveLoggingConsistencyCard("u", {
        loadPreferences: async () => ({ ...prefs, hidden: true }),
        loadHistory,
      }),
    ).toBeNull();
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it("renders nothing for unknown or empty history, never 0 of N", async () => {
    for (const loaded of [null, { today: "2026-10-17", loggedDates: [] }])
      expect(
        await resolveLoggingConsistencyCard("u", {
          loadPreferences: async () => prefs,
          loadHistory: async () => loaded,
        }),
      ).toBeNull();
  });
});
