import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ALLOWED_MOBILE_PUBLIC_KEYS } from "./mobile.js";

const REPO_ROOT = resolve(__dirname, "../../..");
const BUNDLE_DIR = resolve(
  REPO_ROOT,
  "apps/mobile/dist/bundle-check/_expo/static/js/ios",
);

describe("ALLOWED_MOBILE_PUBLIC_KEYS — invariant", () => {
  it("every entry starts with the EXPO_PUBLIC_ prefix", () => {
    for (const key of ALLOWED_MOBILE_PUBLIC_KEYS) {
      expect(key.startsWith("EXPO_PUBLIC_")).toBe(true);
    }
  });

  it("contains no duplicate entries", () => {
    const unique = new Set(ALLOWED_MOBILE_PUBLIC_KEYS);
    expect(unique.size).toBe(ALLOWED_MOBILE_PUBLIC_KEYS.length);
  });

  it("does not leak any server-side secret prefix", () => {
    // Belt-and-braces: even if a future contributor types a real key name
    // here, the test should reject known secret-shaped names.
    for (const key of ALLOWED_MOBILE_PUBLIC_KEYS) {
      expect(key).not.toMatch(/SECRET/);
      expect(key).not.toMatch(/SERVICE_ROLE/);
      expect(key).not.toMatch(/^SUPABASE_SECRET/);
    }
  });
});

// The bundle-scan test is opt-in. When `pnpm check` runs `bundle:check`
// before `test`, the bundle artifact exists and this test runs. On a cold
// checkout where the bundle has not been produced yet, it is skipped with a
// readable message rather than failing spuriously.
const bundlePresent = existsSync(BUNDLE_DIR);

describe.skipIf(!bundlePresent)(
  "Hermes bundle purity — no server secrets in mobile output",
  () => {
    const findBundle = (): string | null => {
      const entry = require("node:fs")
        .readdirSync(BUNDLE_DIR)
        .find((name: string) => name.endsWith(".hbc"));
      return entry ? resolve(BUNDLE_DIR, entry) : null;
    };

    it("the generated Hermes bundle contains no SUPABASE_SECRET_KEY literal", () => {
      const bundlePath = findBundle();
      if (!bundlePath) {
        // Path is checked again at runtime in case the directory was emptied
        // between the skipIf and the test running.
        return;
      }
      const bytes = readFileSync(bundlePath);
      const text = bytes.toString("binary");
      expect(text).not.toContain("SUPABASE_SECRET_KEY");
    });

    it("the generated Hermes bundle contains no Supabase service-role key prefix", () => {
      const bundlePath = findBundle();
      if (!bundlePath) return;
      const text = readFileSync(bundlePath).toString("binary");
      expect(text).not.toContain("sbp_");
    });

    it("the generated Hermes bundle contains no embedded JWT-shaped token", () => {
      const bundlePath = findBundle();
      if (!bundlePath) return;
      const text = readFileSync(bundlePath).toString("binary");
      // A JWT begins with `eyJ` (base64 of `{"`). Hermes strings are
      // stored verbatim in the constant pool, so a leaked access token
      // would surface as a literal substring.
      expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.eyJ/);
    });
  },
);

if (!bundlePresent) {
  // Helpful runtime hint when the bundle-scan test is skipped.
  // eslint-disable-next-line no-console
  console.warn(
    `[config] bundle-purity tests skipped: ${BUNDLE_DIR} not found. Run \`pnpm --filter @mizyun/mobile bundle:check\` first.`,
  );
}
