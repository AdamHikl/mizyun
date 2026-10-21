import { describe, expect, it } from "vitest";
import { runHealthImportsEnabled } from "./run-health-imports";
describe("Health run imports", () => {
  it("is on in the Dev environment", () => {
    expect(runHealthImportsEnabled({ MIZYUN_ENVIRONMENT: "dev" })).toBe(true);
  });
  it("is off elsewhere unless explicitly enabled", () => {
    for (const value of ["production", "Dev", "", undefined])
      expect(runHealthImportsEnabled({ MIZYUN_ENVIRONMENT: value })).toBe(
        false,
      );
    expect(runHealthImportsEnabled({})).toBe(false);
    expect(
      runHealthImportsEnabled({ MIZYUN_RUN_IMPORTS_ENABLED: "true" }),
    ).toBe(true);
    for (const value of ["1", "TRUE", "", undefined])
      expect(
        runHealthImportsEnabled({ MIZYUN_RUN_IMPORTS_ENABLED: value }),
      ).toBe(false);
  });
});
