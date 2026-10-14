import { describe, expect, it, vi } from "vitest";

vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));

import { router } from "expo-router";
import { SETTINGS_CATALOG } from "./settings-catalog";
import { navigateToSetting } from "./settings-destinations";
import { searchSettings } from "./settings-search";

describe("analytics consent discovery", () => {
  it.each([
    "data collection",
    "usage data",
    "help improve Mizyun",
    "analytics consent",
  ])("finds the consent controls using %s", (query) => {
    const results = searchSettings(query, SETTINGS_CATALOG);
    expect(results[0]?.item.destinationId).toBe("analytics");
    navigateToSetting(results[0].item);
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/account-settings/analytics",
      params: undefined,
    });
  });
});
