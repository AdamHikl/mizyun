import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/composition/api-client", () => ({
  apiConfiguration: { configured: true, baseUrl: "https://synthetic.example" },
}));
vi.mock("expo-web-browser", () => ({
  openBrowserAsync: mocks.open,
  WebBrowserPresentationStyle: { AUTOMATIC: "automatic" },
}));
import { LegalCard } from "./legal-card";
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
beforeEach(() => {
  mocks.open.mockReset().mockResolvedValue({ type: "dismiss" });
});
it("gives visible RepDB credit and opens the fixed external source URL", async () => {
  const tree = LegalCard({});
  const credit = find(
    tree,
    (node) =>
      node.props?.accessibilityLabel === "Exercise data by RepDB (repdb.co)",
  );
  expect(credit).toBeTruthy();
  expect(credit.props.accessibilityRole).toBe("link");
  expect(
    find(
      credit,
      (node) => node.props?.children === "Exercise data by RepDB (repdb.co)",
    ),
  ).toBeTruthy();
  await credit.props.onPress();
  expect(mocks.open).toHaveBeenCalledWith("https://repdb.co", {
    presentationStyle: "automatic",
  });
});
it("keeps source credit visible if the browser cannot be opened", async () => {
  mocks.open.mockRejectedValue(new Error("Browser unavailable"));
  const tree = LegalCard({});
  const credit = find(
    tree,
    (node) =>
      node.props?.accessibilityLabel === "Exercise data by RepDB (repdb.co)",
  );
  expect(credit).toBeTruthy();
  await expect(credit.props.onPress()).resolves.toBeUndefined();
});
