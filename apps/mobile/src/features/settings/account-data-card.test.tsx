import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  clear: vi.fn(async (_userId: string) => undefined),
  alert: vi.fn((..._args: unknown[]) => undefined),
}));
vi.mock("expo-apple-authentication", () => ({}));
vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    select: (options: Record<string, unknown>) => options.ios,
  },
  Alert: { alert: mocks.alert },
  StyleSheet: { create: (v: unknown) => v },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: () => null }));
vi.mock("@/components/themed-view", () => ({ ThemedView: () => null }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({}) }));
vi.mock("@/features/coach/ai-consent-controller", () => ({
  useAiConsentController: () => ({}),
}));
vi.mock("./account-data-management", () => ({
  clearLocalUserData: mocks.clear,
}));
import { finishDeletedAccountLocally } from "./account-data-card";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.clear.mockResolvedValue(undefined);
});
describe("completed server deletion local cleanup", () => {
  it("qualifies platform retention separately from completed local cleanup", async () => {
    const signOut = vi.fn(async () => undefined);
    await finishDeletedAccountLocally("account", signOut);
    expect(signOut).toHaveBeenCalledOnce();
    expect(mocks.alert.mock.calls[0][1]).toContain(
      "Copies you exported to Apple Health or Health Connect remain",
    );
  });
  it("reports retained local exports and retries only local cleanup", async () => {
    mocks.clear.mockRejectedValueOnce(new Error("cleanup failed"));
    const signOut = vi.fn(async () => undefined);
    await finishDeletedAccountLocally("captured-account", signOut);
    expect(mocks.alert.mock.calls[0][1]).toContain(
      "Local health export cleanup is incomplete",
    );
    const buttons = mocks.alert.mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    buttons[0].onPress?.();
    await vi.waitFor(() => expect(mocks.clear).toHaveBeenCalledTimes(2));
    expect(mocks.clear.mock.calls[1][0]).toBe("captured-account");
    expect(signOut).toHaveBeenCalledOnce();
  });
});
