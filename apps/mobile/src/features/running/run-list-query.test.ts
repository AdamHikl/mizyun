import { describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ runImports: false }));
vi.mock("@/composition/app-variant", () => ({
  isRunImportsEnabled: () => flags.runImports,
}));
import { runListBaseQuery } from "./run-list-query";

describe("run list query", () => {
  it("asks for imported runs exactly when this build can import them", () => {
    flags.runImports = false;
    expect(runListBaseQuery()).toEqual({ limit: "50" });
    flags.runImports = true;
    expect(runListBaseQuery()).toEqual({ limit: "50", include: "imports" });
  });
});
