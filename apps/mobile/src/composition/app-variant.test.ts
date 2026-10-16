import { describe, expect, it } from "vitest";

import {
  getAppVariant,
  isBoulderingEnabled,
  isProgressPhotosEnabled,
  resolveAppVariant,
} from "./app-variant";

describe("app-variant", () => {
  describe("resolveAppVariant", () => {
    it("respects explicit expoExtraVariant='dev'", () => {
      expect(resolveAppVariant({ expoExtraVariant: "dev" })).toBe("dev");
    });

    it("respects explicit expoExtraVariant='production'", () => {
      expect(resolveAppVariant({ expoExtraVariant: "production" })).toBe(
        "production",
      );
    });

    it("falls back to authRedirectUri with dev scheme", () => {
      expect(
        resolveAppVariant({
          expoExtraVariant: null,
          authRedirectUri: "mizyun-dev://auth/callback",
        }),
      ).toBe("dev");
    });

    it("falls back to authRedirectUri with production scheme", () => {
      expect(
        resolveAppVariant({
          expoExtraVariant: null,
          authRedirectUri: "mizyun://auth/callback",
        }),
      ).toBe("production");
    });

    it("falls back to dev API URL if redirect URI is missing", () => {
      expect(
        resolveAppVariant({
          expoExtraVariant: null,
          authRedirectUri: null,
          apiUrl: "https://mizyun-api-dev.phiskel.com",
        }),
      ).toBe("dev");
    });

    it("fails closed to 'production' if all indicators are missing", () => {
      expect(
        resolveAppVariant({
          expoExtraVariant: null,
          authRedirectUri: null,
          apiUrl: null,
        }),
      ).toBe("production");
    });
  });

  describe("isProgressPhotosEnabled", () => {
    it("respects explicit boolean flag in expoExtraProgressPhotos", () => {
      expect(isProgressPhotosEnabled({ expoExtraProgressPhotos: true })).toBe(
        true,
      );
      expect(isProgressPhotosEnabled({ expoExtraProgressPhotos: false })).toBe(
        false,
      );
    });

    it("enables progress photos when variant resolves to 'dev'", () => {
      expect(isProgressPhotosEnabled({ expoExtraVariant: "dev" })).toBe(true);
      expect(
        isProgressPhotosEnabled({
          expoExtraVariant: null,
          authRedirectUri: "mizyun-dev://auth/callback",
        }),
      ).toBe(true);
    });

    it("disables progress photos when variant resolves to 'production'", () => {
      expect(isProgressPhotosEnabled({ expoExtraVariant: "production" })).toBe(
        false,
      );
      expect(
        isProgressPhotosEnabled({
          expoExtraVariant: null,
          authRedirectUri: "mizyun://auth/callback",
        }),
      ).toBe(false);
    });

    it("disables progress photos by default when environment is unconfigured", () => {
      expect(
        isProgressPhotosEnabled({
          expoExtraVariant: null,
          authRedirectUri: null,
          apiUrl: null,
        }),
      ).toBe(false);
    });
  });

  describe("getAppVariant", () => {
    it("returns a valid AppVariant", () => {
      const variant = getAppVariant();
      expect(variant === "dev" || variant === "production").toBe(true);
    });
  });

  describe("isBoulderingEnabled", () => {
    it("is on for Dev and off for Production by default", () => {
      expect(isBoulderingEnabled({ expoExtraVariant: "dev" })).toBe(true);
      expect(isBoulderingEnabled({ expoExtraVariant: "production" })).toBe(
        false,
      );
      expect(
        isBoulderingEnabled({
          expoExtraVariant: null,
          authRedirectUri: null,
          apiUrl: null,
        }),
      ).toBe(false);
    });

    it("turns Production on only with an explicit true flag", () => {
      expect(
        isBoulderingEnabled({
          expoExtraVariant: "production",
          expoExtraBouldering: true,
        }),
      ).toBe(true);
      expect(
        isBoulderingEnabled({
          expoExtraVariant: "production",
          expoExtraBouldering: "true",
        }),
      ).toBe(false);
    });

    it("lets an explicit false flag switch Dev off", () => {
      expect(
        isBoulderingEnabled({
          expoExtraVariant: "dev",
          expoExtraBouldering: false,
        }),
      ).toBe(false);
    });
  });
});
