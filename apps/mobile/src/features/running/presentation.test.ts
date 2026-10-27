import { describe, expect, it } from "vitest";
import type { RunRecord } from "@mizyun/contracts";
import { runSourceLabel } from "./presentation";

const withOrigin = (origin: unknown) =>
  ({ summary: { origin } }) as unknown as RunRecord;

describe("runSourceLabel", () => {
  it("describes every origin kind", () => {
    expect(runSourceLabel(withOrigin({ kind: "manual" }))).toBe(
      "Entered manually",
    );
    expect(
      runSourceLabel(
        withOrigin({ kind: "file_import", format: "strava", externalId: "1" }),
      ),
    ).toBe("Imported from Strava export");
    expect(
      runSourceLabel(
        withOrigin({
          kind: "health_import",
          provider: "apple_health",
          sourceAppId: "x",
          sourceAppName: "Watch",
          externalId: "1",
        }),
      ),
    ).toBe("From Apple Health · Watch");
  });
});
