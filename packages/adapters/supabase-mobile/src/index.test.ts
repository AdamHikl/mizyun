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
import type { AuthSession } from "@mizyun/identity";
import type { UserId } from "@mizyun/core";
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
  describe("captured logout and session transitions", () => {
    const alice: AuthSession = {
      user: { id: "alice" as UserId },
      accessToken: "alice-token",
    };
    const bobSession = { access_token: "bob-token", user: { id: "bob" } };
    const aliceSession = { access_token: "alice-token", user: { id: "alice" } };
    it.each(["password", "signup", "idtoken", "deep-link"])(
      "a pending old logout cannot clear a newer %s session",
      async (method) => {
        let session: typeof aliceSession | null = aliceSession;
        let finish!: () => void;
        const waiting = new Promise<void>((done) => {
          finish = done;
        });
        const establish = vi.fn(async () => {
          session = bobSession;
          return { data: { session }, error: null };
        });
        const mockClient = createMockSupabaseClient({
          signOut: vi.fn(async () => {
            await waiting;
            session = null;
            return { error: null };
          }),
          signInWithPassword: establish,
          signUp: establish,
          signInWithIdToken: establish,
          setSession: establish,
        });
        vi.mocked(mockClient.auth.getSession).mockImplementation(
          async () => ({ data: { session }, error: null }) as any,
        );
        const client = new SupabaseMobileAuthClient(mockClient);
        const logout = client.signOut(alice);
        for (let i = 0; i < 10; i++) await Promise.resolve();
        const login =
          method === "password"
            ? client.signInWithPassword({
                email: "bob@example.com",
                password: "password",
              })
            : method === "signup"
              ? client.signUpWithPassword({
                  email: "bob@example.com",
                  password: "password",
                })
              : method === "idtoken"
                ? client.signInWithIdToken({
                    provider: "apple",
                    token: "id-token",
                  })
                : client.consumeDeepLink({
                    kind: "oauth",
                    accessToken: "bob-token",
                    refreshToken: "bob-refresh",
                  });
        finish();
        await logout;
        await login;
        expect((await client.getSession())?.user.id).toBe("bob");
      },
    );
    it("does not invoke SDK logout for an old callback after another account is current", async () => {
      const mockClient = createMockSupabaseClient({});
      vi.mocked(mockClient.auth.getSession).mockResolvedValue({
        data: { session: bobSession },
        error: null,
      } as any);
      await new SupabaseMobileAuthClient(mockClient).signOut(alice);
      expect(mockClient.auth.signOut).not.toHaveBeenCalled();
    });
    it.each(["signup", "deep-link"])(
      "an old logout queued after pending %s cannot clear its result",
      async (method) => {
        let session: typeof aliceSession | null = aliceSession;
        let finish!: () => void;
        const waiting = new Promise<void>((done) => {
          finish = done;
        });
        const establish = vi.fn(async () => {
          await waiting;
          session = bobSession;
          return { data: { session }, error: null };
        });
        const mockClient = createMockSupabaseClient({
          signUp: establish,
          setSession: establish,
        });
        vi.mocked(mockClient.auth.getSession).mockImplementation(
          async () => ({ data: { session }, error: null }) as any,
        );
        const client = new SupabaseMobileAuthClient(mockClient);
        const login =
          method === "signup"
            ? client.signUpWithPassword({
                email: "bob@example.com",
                password: "password",
              })
            : client.consumeDeepLink({
                kind: "oauth",
                accessToken: "bob-token",
                refreshToken: "bob-refresh",
              });
        const logout = client.signOut(alice);
        finish();
        await login;
        await logout;
        expect(mockClient.auth.signOut).not.toHaveBeenCalled();
        expect((await client.getSession())?.user.id).toBe("bob");
      },
    );
    const sessionToken = (sessionId: string) =>
      `header.${btoa(JSON.stringify({ session_id: sessionId }))}.signature`;
    const firstSessionId = "00000000-0000-4000-8000-000000000001";
    const nextSessionId = "00000000-0000-4000-8000-000000000002";
    it.each([true, false])(
      "uses stable session identity for same-user rotated tokens (same session: %s)",
      async (same) => {
        const mockClient = createMockSupabaseClient({});
        vi.mocked(mockClient.auth.getSession).mockResolvedValue({
          data: {
            session: {
              ...aliceSession,
              access_token: sessionToken(same ? firstSessionId : nextSessionId),
            },
          },
          error: null,
        } as any);
        await new SupabaseMobileAuthClient(mockClient).signOut({
          ...alice,
          sessionId: firstSessionId,
        });
        expect(mockClient.auth.signOut).toHaveBeenCalledTimes(same ? 1 : 0);
      },
    );
    it("a failed old logout releases the transition queue for the next login", async () => {
      const mockClient = createMockSupabaseClient({
        signOut: vi.fn(async () => ({ error: new Error("remote failure") })),
      });
      const client = new SupabaseMobileAuthClient(mockClient);
      const logout = client.signOut();
      const login = client.signInWithPassword({
        email: "next@example.com",
        password: "password",
      });
      await expect(logout).rejects.toThrow("remote failure");
      expect((await login).user.id).toBe(
        "00000000-0000-4000-8000-000000000001",
      );
    });
    it("preserves the newer SDK session and auth events across a deferred real SDK logout response", async () => {
      const sdk = await vi.importActual<typeof import("@supabase/supabase-js")>(
        "@supabase/supabase-js",
      );
      const firstUser = "00000000-0000-4000-8000-000000000011";
      const nextUser = "00000000-0000-4000-8000-000000000012";
      let tokenRequests = 0;
      let finishLogout!: (response: Response) => void;
      let reachedLogout!: () => void;
      const waiting = new Promise<Response>((done) => {
        finishLogout = done;
      });
      const started = new Promise<void>((done) => {
        reachedLogout = done;
      });
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/logout")) {
          reachedLogout();
          return waiting;
        }
        if (!url.includes("/token"))
          throw new Error("Unexpected test SDK request");
        const userId = ++tokenRequests === 1 ? firstUser : nextUser;
        const expiresAt = Math.floor(Date.now() / 1000) + 3600;
        const claims = {
          sub: userId,
          exp: expiresAt,
          session_id: userId,
          aud: "authenticated",
        };
        const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify(claims))}.test-signature`;
        return new Response(
          JSON.stringify({
            access_token: token,
            refresh_token: `refresh-${userId}`,
            token_type: "bearer",
            expires_in: 3600,
            expires_at: expiresAt,
            user: {
              id: userId,
              aud: "authenticated",
              app_metadata: {},
              user_metadata: {},
              created_at: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      const supabase = sdk.createClient(
        "https://auth.test.invalid",
        "test-publishable-key",
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
          global: { fetch: fetcher },
        },
      );
      const client = new SupabaseMobileAuthClient(supabase);
      const events: Array<string | null> = [];
      const unsubscribe = client.subscribe((session) =>
        events.push(session?.user.id ?? null),
      );
      try {
        const first = await client.signInWithPassword({
          email: "first@example.test",
          password: "test-password",
        });
        const logout = client.signOut(first);
        await started;
        const next = client.signInWithPassword({
          email: "next@example.test",
          password: "test-password",
        });
        expect(tokenRequests).toBe(1);
        finishLogout(new Response(null, { status: 204 }));
        await logout;
        await next;
        expect((await client.getSession())?.user.id).toBe(nextUser);
        expect(events.at(-1)).toBe(nextUser);
        expect(events.slice(events.indexOf(nextUser))).not.toContain(null);
      } finally {
        unsubscribe();
        client.dispose();
      }
    });
  });
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
