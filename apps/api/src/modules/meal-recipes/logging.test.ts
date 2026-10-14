import { describe, it, expect } from "vitest";
import pino from "pino";
import { loggerConfig } from "../../logging.js";
describe("recipe diagnostics", () => {
  it("redacts recipe inventory, photos and context in supported diagnostic shapes", () => {
    const config = loggerConfig("development");
    if (!config.logger) throw new Error("Logger unavailable");
    const lines: string[] = [];
    const log = pino(config.logger, {
      write: (s: string) => {
        lines.push(s);
      },
    });
    const privateValues = {
      input: { ingredients: [{ name: "PRIVATE_PANTRY_FOOD" }] },
      images: [{ bytes: "PRIVATE_PHOTO_BYTES" }],
      fingerprint: "PRIVATE_FINGERPRINT",
      healthContext: { proteinG: 1234.567 },
    };
    log.info(
      { ...privateValues, body: privateValues, req: { body: privateValues } },
      "Recipe diagnostic",
    );
    const output = lines.join("");
    for (const value of [
      "PRIVATE_PANTRY_FOOD",
      "PRIVATE_PHOTO_BYTES",
      "PRIVATE_FINGERPRINT",
      "1234.567",
    ])
      expect(output).not.toContain(value);
    expect(output).toContain("Recipe diagnostic");
  });
});
