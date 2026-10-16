import { describe, expect, it, vi } from "vitest";

const variant = vi.hoisted(() => ({
  value: "production" as "dev" | "production",
}));
vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => variant.value,
}));
import { runListBaseQuery } from "./run-list-query";

describe("run list query", () => {
  it("asks for imported runs only in Dev, where older APIs aren't in use", () => {
    variant.value = "production";
    expect(runListBaseQuery()).toEqual({ limit: "50" });
    variant.value = "dev";
    expect(runListBaseQuery()).toEqual({ limit: "50", include: "imports" });
  });
});
