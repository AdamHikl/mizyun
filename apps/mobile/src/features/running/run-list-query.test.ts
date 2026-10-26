import { describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ runImports: false, historyImports: false }));
vi.mock("@/composition/app-variant", () => ({
  isRunImportsEnabled: () => flags.runImports,
  isHistoryImportsEnabled: () => flags.historyImports,
}));
import { runListBaseQuery } from "./run-list-query";

describe("run list query", () => {
  it("asks for imported runs exactly when this build can import them", () => {
    flags.runImports = false;
    flags.historyImports = false;
    expect(runListBaseQuery()).toEqual({ limit: "50" });
    flags.runImports = true;
    expect(runListBaseQuery()).toEqual({ limit: "50", include: "imports" });
  });

  it("asks for file imports too when history import is enabled", () => {
    flags.runImports = true;
    flags.historyImports = true;
    expect(runListBaseQuery()).toEqual({ limit: "50", include: "all_imports" });
  });
});
