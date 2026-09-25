import { describe, expect, it, vi } from "vitest";

import { createActiveWorkoutUnmountCleanup } from "./active-workout-lifecycle";

describe("ActiveWorkoutProvider lifecycle", () => {
  it("dismisses the Dev workout Live Activity when SessionGate unmounts the provider", () => {
    const dismiss = vi.fn().mockResolvedValue(undefined);
    const cleanup = createActiveWorkoutUnmountCleanup(dismiss);

    cleanup();

    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
