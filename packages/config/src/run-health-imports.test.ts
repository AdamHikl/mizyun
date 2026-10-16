import { describe, expect, it } from "vitest";
import { runHealthImportsEnabled } from "./run-health-imports";
describe("Dev Health run imports", () => {
  it("is enabled only in the Dev environment", () => {
    expect(runHealthImportsEnabled({ MIZYUN_ENVIRONMENT: "dev" })).toBe(true);
    for (const value of ["production", "Dev", "", undefined])
      expect(runHealthImportsEnabled({ MIZYUN_ENVIRONMENT: value })).toBe(
        false,
      );
    expect(runHealthImportsEnabled({})).toBe(false);
  });
});
