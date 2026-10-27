import { describe, expect, it } from "vitest";
import { historyImportsEnabled } from "./history-imports";
describe("History imports", () => {
  it("is on in the Dev environment", () => {
    expect(historyImportsEnabled({ MIZYUN_ENVIRONMENT: "dev" })).toBe(true);
  });
  it("is off elsewhere unless explicitly enabled", () => {
    for (const value of ["production", "Dev", "", undefined])
      expect(historyImportsEnabled({ MIZYUN_ENVIRONMENT: value })).toBe(false);
    expect(
      historyImportsEnabled({ MIZYUN_HISTORY_IMPORTS_ENABLED: "true" }),
    ).toBe(true);
    for (const value of ["1", "TRUE", "", undefined])
      expect(
        historyImportsEnabled({ MIZYUN_HISTORY_IMPORTS_ENABLED: value }),
      ).toBe(false);
  });
});
