import { describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("react-native-url-polyfill/auto", () => ({}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
  processLock: vi.fn(),
}));

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
import {
  createSupabaseMobileAuthClient,
  SupabaseMobileAuthClient,
} from "./index.js";

const createMockSupabaseClient = (overrides: {
  signInWithOAuth?: () => Promise<{
    data: { url: string | null; provider: string } | null;
    error: Error | null;
  }>;
  signInWithIdToken?: (params?: any) => Promise<{
    data: { session: any } | null;
    error: Error | null;
  }>;
  signInWithPassword?: () => Promise<{
    data: { session: any } | null;
    error: Error | null;
  }>;
  signUp?: (params?: any) => Promise<{
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
      signInWithIdToken:
        overrides.signInWithIdToken ??
        vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "mock-id-token-access",
              expires_at: 1784197009,
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "id-token-user@example.com",
                app_metadata: { provider: "apple" },
              },
            },
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
  describe("factory configuration", () => {
    it("preserves the app variant redirect URI for OAuth", async () => {
      const mockClient = createMockSupabaseClient({});
      createClientMock.mockReturnValue(mockClient);

      const authClient = createSupabaseMobileAuthClient({
        url: "https://mizyun-supabase-dev.phiskel.com",
        publishableKey: "test-publishable-key",
        redirectUri: "mizyun-dev://auth/callback",
      });

      await authClient.signInWithOAuth({ provider: "google" });

      expect(mockClient.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: {
          redirectTo: "mizyun-dev://auth/callback",
          skipBrowserRedirect: true,
        },
      });
    });
  });

  describe("signUpWithPassword", () => {
    it.each(["mizyun://auth/callback", "mizyun-dev://auth/callback"])(
      "sends email confirmation back to app variant %s",
      async (redirectUri) => {
        const mockClient = createMockSupabaseClient({});
        const authClient = new SupabaseMobileAuthClient(
          mockClient,
          redirectUri,
        );

        await authClient.signUpWithPassword({
          email: "test@example.com",
          password: "strong-password",
        });

        expect(mockClient.auth.signUp).toHaveBeenCalledWith({
          email: "test@example.com",
          password: "strong-password",
          options: {
            emailRedirectTo: redirectUri,
          },
        });
      },
    );

    it("prefers explicit emailRedirectUri over redirectUri for email confirmation", async () => {
      const mockClient = createMockSupabaseClient({});
      const authClient = new SupabaseMobileAuthClient(
        mockClient,
        "mizyun://auth/callback",
        "https://www.phiskel.com/mizyun/auth/callback",
      );

      await authClient.signUpWithPassword({
        email: "test@example.com",
        password: "strong-password",
      });

      expect(mockClient.auth.signUp).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "strong-password",
        options: {
          emailRedirectTo: "https://www.phiskel.com/mizyun/auth/callback",
        },
      });
    });
  });

  describe("requestPasswordRecovery", () => {
    it("uses default redirectUri when emailRedirectUri is omitted", async () => {
      const mockClient = createMockSupabaseClient({});
      const authClient = new SupabaseMobileAuthClient(
        mockClient,
        "mizyun://auth/callback",
      );

      await authClient.requestPasswordRecovery({ email: "user@example.com" });

      expect(mockClient.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        {
          redirectTo: "mizyun://auth/callback",
        },
      );
    });

    it("uses explicit emailRedirectUri when provided", async () => {
      const mockClient = createMockSupabaseClient({});
      const authClient = new SupabaseMobileAuthClient(
        mockClient,
        "mizyun://auth/callback",
        "https://www.phiskel.com/mizyun/auth/callback",
      );

      await authClient.requestPasswordRecovery({ email: "user@example.com" });

      expect(mockClient.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        {
          redirectTo: "https://www.phiskel.com/mizyun/auth/callback",
        },
      );
    });
  });

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

  describe("signInWithIdToken", () => {
    it("signs in with ID token and returns converted AuthSession", async () => {
      const mockClient = createMockSupabaseClient({});
      const authClient = new SupabaseMobileAuthClient(mockClient);

      const session = await authClient.signInWithIdToken({
        provider: "apple",
        token: "apple-id-token",
      });

      expect(mockClient.auth.signInWithIdToken).toHaveBeenCalledWith({
        provider: "apple",
        token: "apple-id-token",
      });
      expect(session).toEqual({
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          email: "id-token-user@example.com",
          provider: "apple",
        },
        accessToken: "mock-id-token-access",
        expiresAt: new Date(1784197009 * 1000),
      });
    });

    it("forwards nonce and access_token when provided", async () => {
      const mockClient = createMockSupabaseClient({});
      const authClient = new SupabaseMobileAuthClient(mockClient);

      await authClient.signInWithIdToken({
        provider: "google",
        token: "google-id-token",
        nonce: "test-nonce-123",
        accessToken: "google-access-token-456",
      });

      expect(mockClient.auth.signInWithIdToken).toHaveBeenCalledWith({
        provider: "google",
        token: "google-id-token",
        nonce: "test-nonce-123",
        access_token: "google-access-token-456",
      });
    });

    it("throws IdentityError when Supabase returns an error", async () => {
      const mockClient = createMockSupabaseClient({
        signInWithIdToken: vi.fn().mockResolvedValue({
          data: null,
          error: new Error("Invalid ID token"),
        }),
      });
      const authClient = new SupabaseMobileAuthClient(mockClient);

      await expect(
        authClient.signInWithIdToken({
          provider: "apple",
          token: "invalid-token",
        }),
      ).rejects.toMatchObject({
        name: "IdentityError",
        code: "AUTH_PROVIDER_ERROR",
        message: "Invalid ID token",
      });
    });

    it("throws AUTH_SESSION_MISSING when sign-in returns no session", async () => {
      const mockClient = createMockSupabaseClient({
        signInWithIdToken: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
      });
      const authClient = new SupabaseMobileAuthClient(mockClient);

      await expect(
        authClient.signInWithIdToken({
          provider: "apple",
          token: "valid-token-no-session",
        }),
      ).rejects.toMatchObject({
        name: "IdentityError",
        code: "AUTH_SESSION_MISSING",
        message: "Sign-in returned no session.",
      });
    });
  });
});
