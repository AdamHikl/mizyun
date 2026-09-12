import { describe, expect, it } from "vitest";

import { validateBuildMatrix } from "./build-matrix";

describe("validateBuildMatrix", () => {
  describe("Valid Configurations", () => {
    it("resolves development profile with dev defaults", () => {
      const result = validateBuildMatrix({
        profile: "development",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({
        variant: "dev",
        profile: "development",
        name: "Mizyun Dev",
        slug: "mizyun-dev",
        scheme: "mizyun-dev",
        iosBundleIdentifier: "com.mizyun.development",
        androidPackage: "com.mizyun.dev",
      });
    });

    it("resolves preview profile with dev endpoints", () => {
      const result = validateBuildMatrix({
        profile: "preview",
        apiUrl: "https://mizyun-api-dev.phiskel.com",
        supabaseUrl: "https://mizyun-supabase-dev.phiskel.com",
        authRedirectUri: "mizyun-dev://auth/callback",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.variant).toBe("dev");
      expect(result.value.profile).toBe("preview");
      expect(result.value.iosBundleIdentifier).toBe("com.mizyun.development");
      expect(result.value.scheme).toBe("mizyun-dev");
    });

    it("resolves production profile with production endpoints", () => {
      const result = validateBuildMatrix({
        profile: "production",
        apiUrl: "https://mizyun-api.phiskel.com",
        supabaseUrl: "https://mizyun-supabase.phiskel.com",
        authRedirectUri: "mizyun://auth/callback",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({
        variant: "production",
        profile: "production",
        name: "Mizyun",
        slug: "mizyun",
        scheme: "mizyun",
        iosBundleIdentifier: "com.mizyun.app",
        androidPackage: "com.mizyun.app",
      });
    });

    it("accepts local development with localhost API", () => {
      const result = validateBuildMatrix({
        profile: "development",
        variant: "dev",
        apiUrl: "http://localhost:4100",
        supabaseUrl: "http://localhost:8100",
        authRedirectUri: "mizyun-dev://auth/callback",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("Hostile & Conflicting Ambient Environments", () => {
    it("rejects dev variant pointing to production API host", () => {
      const result = validateBuildMatrix({
        variant: "dev",
        profile: "development",
        apiUrl: "https://mizyun-api.phiskel.com",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        key: "EXPO_PUBLIC_API_URL",
      });
    });

    it("rejects dev variant pointing to production Supabase host", () => {
      const result = validateBuildMatrix({
        variant: "dev",
        profile: "preview",
        supabaseUrl: "https://mizyun-supabase.phiskel.com",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        key: "EXPO_PUBLIC_SUPABASE_URL",
      });
    });

    it("rejects production variant pointing to dev API host", () => {
      const result = validateBuildMatrix({
        variant: "production",
        profile: "production",
        apiUrl: "https://mizyun-api-dev.phiskel.com",
        supabaseUrl: "https://mizyun-supabase.phiskel.com",
        authRedirectUri: "mizyun://auth/callback",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        key: "EXPO_PUBLIC_API_URL",
      });
    });

    it("rejects production variant pointing to localhost API", () => {
      const result = validateBuildMatrix({
        variant: "production",
        profile: "production",
        apiUrl: "http://localhost:4000",
        supabaseUrl: "https://mizyun-supabase.phiskel.com",
        authRedirectUri: "mizyun://auth/callback",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        key: "EXPO_PUBLIC_API_URL",
      });
    });

    it("rejects production profile paired with dev variant", () => {
      const result = validateBuildMatrix({
        variant: "dev",
        profile: "production",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        key: "MIZYUN_APP_VARIANT",
      });
    });

    it("rejects development profile paired with production variant", () => {
      const result = validateBuildMatrix({
        variant: "production",
        profile: "development",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        key: "MIZYUN_APP_VARIANT",
      });
    });

    it("rejects conflicting EAS profile and build profile", () => {
      const result = validateBuildMatrix({
        easProfile: "production",
        profile: "development",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        key: "MIZYUN_BUILD_PROFILE",
      });
    });

    it("rejects dev variant with production redirect scheme", () => {
      const result = validateBuildMatrix({
        variant: "dev",
        profile: "development",
        authRedirectUri: "mizyun://auth/callback",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        key: "EXPO_PUBLIC_AUTH_REDIRECT_URI",
      });
    });

    it("rejects production variant with dev redirect scheme", () => {
      const result = validateBuildMatrix({
        variant: "production",
        profile: "production",
        apiUrl: "https://mizyun-api.phiskel.com",
        supabaseUrl: "https://mizyun-supabase.phiskel.com",
        authRedirectUri: "mizyun-dev://auth/callback",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        key: "EXPO_PUBLIC_AUTH_REDIRECT_URI",
      });
    });

    it("rejects production profile when API URL is missing", () => {
      const result = validateBuildMatrix({
        variant: "production",
        profile: "production",
        supabaseUrl: "https://mizyun-supabase.phiskel.com",
        authRedirectUri: "mizyun://auth/callback",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        kind: "missing",
        keys: ["EXPO_PUBLIC_API_URL"],
      });
    });

    it("rejects production profile when foreign API URL is given", () => {
      const result = validateBuildMatrix({
        variant: "production",
        profile: "production",
        apiUrl: "https://evil.com/api",
        supabaseUrl: "https://mizyun-supabase.phiskel.com",
        authRedirectUri: "mizyun://auth/callback",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toMatchObject({
        kind: "malformed",
        key: "EXPO_PUBLIC_API_URL",
      });
    });
  });
});
