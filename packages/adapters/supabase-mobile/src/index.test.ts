import { describe, expect, it, vi } from "vitest";

vi.mock("react-native-url-polyfill/auto", () => ({}));

vi.mock("react-native", () => ({
  AppState: {
    addEventListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  },
  Platform: {
    OS: "ios",
  },
  NativeModules: {},
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseMobileAuthClient } from "./index.js";

const createMockSupabaseClient = (overrides: {
  signInWithOAuth?: () => Promise<{
    data: { url: string | null; provider: string } | null;
    error: Error | null;
  }>;
  signInWithPassword?: () => Promise<{
    data: { session: any } | null;
    error: Error | null;
  }>;
  signUp?: () => Promise<{
    data: { session: any } | null;
    error: Error | null;
  }>;
  setSession?: () => Promise<{
    data: { session: any } | null;
    error: Error | null;
  }>;
  signOut?: () => Promise<{ error: Error | null }>;
}) => {
  return {
    auth: {
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      startAutoRefresh: vi.fn(),
      stopAutoRefresh: vi.fn(),
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: null }, error: null }),
      signInWithOAuth:
        overrides.signInWithOAuth ??
        vi.fn().mockResolvedValue({
          data: {
            url: "https://auth.supabase.com/oauth/google",
            provider: "google",
          },
          error: null,
        }),
      signInWithPassword:
        overrides.signInWithPassword ??
        vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "mock-access-token",
              expires_at: 1784197009,
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "test@example.com",
              },
            },
          },
          error: null,
        }),
      signUp:
        overrides.signUp ??
        vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "mock-access-token",
              expires_at: 1784197009,
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "test@example.com",
              },
            },
          },
          error: null,
        }),
      setSession:
        overrides.setSession ??
        vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "mock-access-token",
              expires_at: 1784197009,
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "test@example.com",
              },
            },
          },
          error: null,
        }),
      signOut: overrides.signOut ?? vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
    },
  } as unknown as SupabaseClient;
};

describe("SupabaseMobileAuthClient", () => {
  describe("signInWithOAuth", () => {
    it("requests OAuth URL from Supabase with skipBrowserRedirect: true", async () => {
      const mockClient = createMockSupabaseClient({});
      const authClient = new SupabaseMobileAuthClient(
        mockClient,
        "mizyun://auth/callback",
      );

      const result = await authClient.signInWithOAuth({ provider: "google" });

      expect(mockClient.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: {
          redirectTo: "mizyun://auth/callback",
          skipBrowserRedirect: true,
        },
      });
      expect(result).toEqual({ url: "https://auth.supabase.com/oauth/google" });
    });

    it("respects custom redirectTo override", async () => {
      const mockClient = createMockSupabaseClient({});
      const authClient = new SupabaseMobileAuthClient(
        mockClient,
        "mizyun://auth/callback",
      );

      await authClient.signInWithOAuth({
        provider: "google",
        redirectTo: "mizyun-dev://auth/callback",
      });

      expect(mockClient.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: {
          redirectTo: "mizyun-dev://auth/callback",
          skipBrowserRedirect: true,
        },
      });
    });

    it("throws IdentityError when Supabase OAuth request fails", async () => {
      const mockClient = createMockSupabaseClient({
        signInWithOAuth: vi.fn().mockResolvedValue({
          data: null,
          error: new Error("OAuth disabled"),
        }),
      });
      const authClient = new SupabaseMobileAuthClient(mockClient);

      await expect(
        authClient.signInWithOAuth({ provider: "google" }),
      ).rejects.toMatchObject({
        name: "IdentityError",
        code: "AUTH_PROVIDER_ERROR",
      });
    });

    it("throws IdentityError when returned URL is missing", async () => {
      const mockClient = createMockSupabaseClient({
        signInWithOAuth: vi.fn().mockResolvedValue({
          data: { url: null, provider: "google" },
          error: null,
        }),
      });
      const authClient = new SupabaseMobileAuthClient(mockClient);

      await expect(
        authClient.signInWithOAuth({ provider: "google" }),
      ).rejects.toMatchObject({
        name: "IdentityError",
        code: "AUTH_PROVIDER_ERROR",
      });
    });
  });

  describe("consumeDeepLink", () => {
    it("sets session with token pair and returns AuthSession", async () => {
      const mockClient = createMockSupabaseClient({});
      const authClient = new SupabaseMobileAuthClient(mockClient);

      const session = await authClient.consumeDeepLink({
        kind: "oauth",
        accessToken: "access-123",
        refreshToken: "refresh-123",
      });

      expect(mockClient.auth.setSession).toHaveBeenCalledWith({
        access_token: "access-123",
        refresh_token: "refresh-123",
      });
      expect(session).toEqual({
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          email: "test@example.com",
          provider: "email",
        },
        accessToken: "mock-access-token",
        expiresAt: new Date(1784197009 * 1000),
      });
    });
  });
});
