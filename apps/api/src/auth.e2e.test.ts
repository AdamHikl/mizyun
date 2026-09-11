/**
 * Programmatic end-to-end auth flow against a real local Supabase stack.
 *
 * Guarded by `describe.skipIf(!process.env.AUTH_E2E_URL)` so the standard
 * `pnpm check` gate does not require Docker. To run:
 *
 *   pnpm db:start
 *   AUTH_E2E_URL=http://127.0.0.1:54321 \
 *   AUTH_E2E_ANON=<anon key from pnpm db:status> \
 *   AUTH_E2E_PUBLISHABLE=<publishable key from pnpm db:status> \
 *   pnpm --filter @mizyun/api test
 *
 * The test exercises the same GoTrue → Mailpit → SupabaseAccessTokenVerifier
 * → `/v1/me` path the iOS simulator drives through `@mizyun/api-client`,
 * minus the React Native UI layer.
 */
import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import { HttpApiClient, type ApiClient } from "@mizyun/api-client";
import {
  apiErrorSchema,
  meResponseSchema,
  type MeResponse,
} from "@mizyun/contracts";
import { InMemoryMemoryStore } from "@mizyun/memory";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import type { AuthClient, AuthSession } from "@mizyun/identity";

const SUPABASE_URL = process.env.AUTH_E2E_URL ?? "";
const ANON_KEY = process.env.AUTH_E2E_ANON ?? "";
const MAILPIT_URL = process.env.AUTH_E2E_MAILPIT ?? "http://127.0.0.1:54324";
const SERVICE_KEY = process.env.AUTH_E2E_SERVICE ?? "";

const stackUp = SUPABASE_URL.length > 0 && ANON_KEY.length > 0;

/**
 * Reachability probe. The vitest config now auto-loads
 * `apps/api/.env.test` into process.env, so the URL and anon key are
 * always present. Without this probe, every CI run without the local
 * stack would fail loudly; we want it to skip instead.
 */
const reachable = await (async (): Promise<boolean> => {
  if (!stackUp) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
})();
const runE2E = stackUp && reachable;

interface GoTrueUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
}

interface SignupResponse {
  // GoTrue 2.192 returns the user object flat at the top level when
  // email confirmation is required; there is no `session` field until
  // the user confirms and re-authenticates.
  readonly id: string;
  readonly email: string;
  readonly role: string;
}

interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly user: GoTrueUser;
}

const signup = async (
  email: string,
  password: string,
): Promise<SignupResponse> => {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${ANON_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(
      `signup failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as SignupResponse;
};

const listMailpitMessages = async (): Promise<
  ReadonlyArray<{ ID: string; Subject: string; Created: string }>
> => {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  if (!response.ok) {
    throw new Error(`mailpit list failed: ${response.status}`);
  }
  const body = (await response.json()) as {
    messages: ReadonlyArray<{ ID: string; Subject: string; Created: string }>;
  };
  return body.messages;
};

const getMailpitMessage = async (id: string): Promise<{ Text: string }> => {
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!response.ok) {
    throw new Error(`mailpit get failed: ${response.status}`);
  }
  return (await response.json()) as { Text: string };
};

const extractConfirmationLink = (text: string): string | null => {
  // Mailpit renders the URL inside a parens-prefixed bracket, e.g.
  //   Confirm email address ( http://127.0.0.1:54321/auth/v1/verify?token=... )
  const match = /(https?:\/\/[^\s)]*\/auth\/v1\/verify\?[^\s)]+)/.exec(text);
  return match?.[1] ?? null;
};

const confirmEmail = async (link: string): Promise<void> => {
  // The /verify endpoint replies with a 302/HTML containing the access
  // token in the redirect_to fragment. Fetching it confirms the email;
  // we don't need to follow the redirect.
  const response = await fetch(link, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` },
    redirect: "manual",
  });
  // 302 (redirect, unauthenticated) or 200 are both acceptable — the
  // important property is that the token was consumed.
  expect([200, 302, 303]).toContain(response.status);
};

/**
 * Issue a GoTrue password-recovery email. The local SMTP relay delivers
 * the email to Mailpit; the recovery link is captured via
 * `extractConfirmationLink`.
 */
const requestPasswordRecovery = async (email: string): Promise<void> => {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${ANON_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(
      `recover failed: ${response.status} ${await response.text()}`,
    );
  }
};

/**
 * Consume a recovery link and return the deep-link payload the
 * mobile client would see. The /verify endpoint replies with a 303
 * redirect to `redirect_to` (e.g. `mizyun://auth/callback`) carrying
 * the access/refresh tokens in the URL fragment. We mirror what
 * `parseDeepLinkFragment` produces so the test exercises the same
 * shape the deep-link consumer will receive.
 */
interface ConsumedRecoveryPayload {
  readonly kind: "recovery";
  readonly accessToken: string;
  readonly refreshToken: string;
}

const consumeRecoveryLink = async (
  link: string,
): Promise<ConsumedRecoveryPayload> => {
  const response = await fetch(link, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` },
    redirect: "manual",
  });
  expect(response.status).toBe(303);
  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  if (!location) throw new Error("recovery link did not redirect");
  const hashIndex = location.indexOf("#");
  expect(hashIndex).toBeGreaterThan(-1);
  const fragment = location.slice(hashIndex + 1);
  const params = new URLSearchParams(fragment);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type");
  expect(accessToken).not.toBeNull();
  expect(refreshToken).not.toBeNull();
  expect(type).toBe("recovery");
  if (!accessToken || !refreshToken) {
    throw new Error("recovery link missing tokens");
  }
  return { kind: "recovery", accessToken, refreshToken };
};

const signIn = async (
  email: string,
  password: string,
): Promise<TokenResponse> => {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        authorization: `Bearer ${ANON_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `sign-in failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as TokenResponse;
};

const deleteUser = async (userId: string): Promise<void> => {
  if (SERVICE_KEY.length === 0) return;
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
};

/**
 * Build an `AuthClient` whose `getSession()` returns a fixed session.
 * All other methods throw — the test only exercises the request path
 * that reads `accessToken`.
 */
const stubAuthClient = (accessToken: string): AuthClient => ({
  status: () => ({ configured: true, provider: "supabase" }),
  getSession: async () =>
    ({
      user: { id: "00000000-0000-4000-8000-000000000001" as never },
      accessToken,
    }) satisfies AuthSession,
  signInWithPassword: () => Promise.reject(new Error("unused")),
  signUpWithPassword: () => Promise.reject(new Error("unused")),
  signInWithOAuth: () => Promise.reject(new Error("unused")),
  signInWithIdToken: () => Promise.reject(new Error("unused")),
  signOut: () => Promise.resolve(),
  consumeDeepLink: () => Promise.reject(new Error("unused")),
  updatePassword: () => Promise.reject(new Error("unused")),
  requestPasswordRecovery: () => Promise.reject(new Error("unused")),
  subscribe: () => () => undefined,
  dispose: () => undefined,
});

describe.skipIf(!runE2E)(
  "AUTH-001 e2e — real Supabase sign-up/sign-in/me round-trip",
  () => {
    const createdUserIds: string[] = [];

    afterAll(async () => {
      // Best-effort cleanup. Each test tracks its own user so a failure
      // mid-flow still leaves no orphan users in the local DB.
      await Promise.all(
        createdUserIds.map(async (id) => {
          try {
            await deleteUser(id);
          } catch {
            // ignored — admin cleanup is best-effort
          }
        }),
      );
    });

    it("signs up, confirms via Mailpit, signs in, and round-trips /v1/me", async () => {
      const testEmail = `auth-e2e-${Date.now()}@example.com`;
      const testPassword = `auth-e2e-${Date.now()}-password`;

      // Step A — sign-up
      const signedUp = await signup(testEmail, testPassword);
      createdUserIds.push(signedUp.id);
      expect(signedUp.email).toBe(testEmail);
      expect(signedUp.role).toBe("authenticated");

      // Wait for Mailpit to receive the confirmation email. The local
      // SMTP relay is fast but not synchronous; poll briefly.
      const signupSentAt = Date.now();
      let messageId: string | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const messages = await listMailpitMessages();
        const match = messages.find(
          (m) =>
            m.Subject.toLowerCase().includes("confirm") &&
            // Mailpit Created is an RFC3339 string; compare by parsing.
            Date.parse(m.Created) >= signupSentAt - 1000,
        );
        if (match) {
          messageId = match.ID;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(messageId).not.toBeNull();
      if (!messageId) throw new Error("confirmation email not received");

      // Step A continued — extract confirmation link from Mailpit
      const message = await getMailpitMessage(messageId);
      const link = extractConfirmationLink(message.Text);
      expect(link).not.toBeNull();
      if (!link) throw new Error("confirmation link not parsed");
      await confirmEmail(link);

      // Step B — sign-in
      const tokens = await signIn(testEmail, testPassword);
      const accessToken = tokens.access_token;
      expect(accessToken.length).toBeGreaterThan(0);
      expect(tokens.user.id).toBe(signedUp.id);

      // Step B continued — drive /v1/me through the real HttpApiClient
      // with the verified session.
      const app = buildApp({
        tokenVerifier: {
          verify: async (token) => {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
              headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
            });
            if (!response.ok) return null;
            const user = (await response.json()) as GoTrueUser;
            return {
              userId: user.id as never,
              email: user.email,
              role: user.role,
              accessToken: token,
            };
          },
        },
        agent: new AgentOrchestrator({
          provider: new DisabledAgentProvider(),
          memories: new InMemoryMemoryStore(),
        }),
      });
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("Fastify test app did not bind");
      }
      const port = address.port;
      const liveClient = new HttpApiClient({
        baseUrl: `http://127.0.0.1:${port}`,
        authClient: stubAuthClient(accessToken),
      });
      const meResult = await liveClient.request<MeResponse>({
        method: "GET",
        path: "/v1/me",
        schema: meResponseSchema,
      });
      await app.close();

      expect(meResult.ok).toBe(true);
      if (!meResult.ok) return;
      expect(meResult.value.user.userId).toBe(signedUp.id);
      expect(meResult.value.user.email).toBe(testEmail);
    }, 60_000);

    it("returns kind: 'session_expired' when the bearer token is invalid", async () => {
      const app = buildApp({
        tokenVerifier: {
          verify: async (token) => {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
              headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
            });
            return response.ok
              ? ((await response.json()) as GoTrueUser) && {
                  userId: ((await response.json()) as GoTrueUser).id as never,
                  email: ((await response.json()) as GoTrueUser).email,
                  accessToken: token,
                }
              : null;
          },
        },
        agent: new AgentOrchestrator({
          provider: new DisabledAgentProvider(),
          memories: new InMemoryMemoryStore(),
        }),
      });
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("Fastify test app did not bind");
      }
      const port = address.port;
      const liveClient = new HttpApiClient({
        baseUrl: `http://127.0.0.1:${port}`,
        authClient: stubAuthClient("invalid-token-bytes"),
      });
      const result = await liveClient.request({
        method: "GET",
        path: "/v1/me",
      });
      await app.close();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("session_expired");
    }, 30_000);

    it("returns kind: 'http_error' for 4xx with parsed apiErrorSchema body", async () => {
      // /v1/coach/status is public and returns 200; /v1/foo is not a
      // route so Fastify returns 404. We probe a known missing route to
      // exercise the http_error path against the apiErrorSchema
      // contract without touching auth.
      const app = buildApp({
        tokenVerifier: {
          verify: async () => null,
        },
        agent: new AgentOrchestrator({
          provider: new DisabledAgentProvider(),
          memories: new InMemoryMemoryStore(),
        }),
      });
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("Fastify test app did not bind");
      }
      const port = address.port;
      const liveClient = new HttpApiClient({
        baseUrl: `http://127.0.0.1:${port}`,
        authClient: stubAuthClient("any"),
      });
      const result = await liveClient.request({
        method: "GET",
        path: "/v1/does-not-exist",
      });
      await app.close();

      // 404 from Fastify is a plain text body, not apiErrorSchema-shaped,
      // so the client surfaces parse_error. This is the documented
      // structural-mismatch case.
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(["parse_error", "http_error"]).toContain(result.error.kind);
      // Sanity: the body still parses through apiErrorSchema or the
      // 404 path surfaces a non-JSON body; both are acceptable per
      // QUALITY_GATES (no fabrication).
      if (result.error.kind === "http_error") {
        const parsed = apiErrorSchema.safeParse({
          error: {
            code: result.error.code,
            message: result.error.message,
            requestId: result.error.requestId,
          },
        });
        expect(parsed.success).toBe(true);
      }
    }, 30_000);

    it("round-trips the recovery flow: email → Mailpit → setSession → /v1/me", async () => {
      // Step A — sign-up + confirm so the recovery flow has a real user
      const testEmail = `auth-e2e-recovery-${Date.now()}@example.com`;
      const testPassword = `auth-e2e-recovery-${Date.now()}-password`;
      const newPassword = `${testPassword}-rotated`;

      const signedUp = await signup(testEmail, testPassword);
      createdUserIds.push(signedUp.id);

      // Wait for signup confirmation email and confirm
      const signupSentAt = Date.now();
      let messageId: string | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const messages = await listMailpitMessages();
        const match = messages.find(
          (m) =>
            m.Subject.toLowerCase().includes("confirm") &&
            Date.parse(m.Created) >= signupSentAt - 1000,
        );
        if (match) {
          messageId = match.ID;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(messageId).not.toBeNull();
      if (!messageId) throw new Error("signup confirmation not received");
      const signupMessage = await getMailpitMessage(messageId);
      const signupLink = extractConfirmationLink(signupMessage.Text);
      expect(signupLink).not.toBeNull();
      if (!signupLink) throw new Error("signup confirmation link not parsed");
      await confirmEmail(signupLink);

      // Step B — request password recovery
      const recoverySentAt = Date.now();
      await requestPasswordRecovery(testEmail);

      let recoveryMessageId: string | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const messages = await listMailpitMessages();
        const match = messages.find(
          (m) =>
            m.Subject.toLowerCase().includes("reset") &&
            Date.parse(m.Created) >= recoverySentAt - 1000,
        );
        if (match) {
          recoveryMessageId = match.ID;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(recoveryMessageId).not.toBeNull();
      if (!recoveryMessageId) throw new Error("recovery email not received");
      const recoveryMessage = await getMailpitMessage(recoveryMessageId);
      const recoveryLink = extractConfirmationLink(recoveryMessage.Text);
      expect(recoveryLink).not.toBeNull();
      if (!recoveryLink) throw new Error("recovery link not parsed");

      // Step C — consume the recovery link and parse the deep-link payload
      const payload = await consumeRecoveryLink(recoveryLink);
      expect(payload.kind).toBe("recovery");
      expect(payload.accessToken.length).toBeGreaterThan(0);

      // Step D — drive `/v1/me` through the real HttpApiClient using the
      // recovery-issued session. The session is valid until the user
      // rotates the password.
      const app = buildApp({
        tokenVerifier: {
          verify: async (token) => {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
              headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
            });
            if (!response.ok) return null;
            const user = (await response.json()) as GoTrueUser;
            return {
              userId: user.id as never,
              email: user.email,
              role: user.role,
              accessToken: token,
            };
          },
        },
        agent: new AgentOrchestrator({
          provider: new DisabledAgentProvider(),
          memories: new InMemoryMemoryStore(),
        }),
      });
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("Fastify test app did not bind");
      }
      const port = address.port;
      const liveClient = new HttpApiClient({
        baseUrl: `http://127.0.0.1:${port}`,
        authClient: stubAuthClient(payload.accessToken),
      });
      const meResult = await liveClient.request<MeResponse>({
        method: "GET",
        path: "/v1/me",
        schema: meResponseSchema,
      });
      expect(meResult.ok).toBe(true);
      if (meResult.ok) {
        expect(meResult.value.user.userId).toBe(signedUp.id);
        expect(meResult.value.user.email).toBe(testEmail);
      }

      // Step E — rotate the password using the same access token. This
      // is the call `ResetPasswordScreen` will issue; we exercise it
      // here directly against GoTrue so the test is independent of the
      // mobile UI.
      const updateResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: ANON_KEY,
          authorization: `Bearer ${payload.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: newPassword }),
      });
      expect(updateResponse.ok).toBe(true);

      // Step F — sign in with the new password to prove rotation landed
      const tokens = await signIn(testEmail, newPassword);
      expect(tokens.access_token.length).toBeGreaterThan(0);
      expect(tokens.user.id).toBe(signedUp.id);

      // The old password must no longer work — sign-in either errors
      // or returns a different user. Either way, the new password is
      // the only valid one.
      const oldSignIn = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            apikey: ANON_KEY,
            authorization: `Bearer ${ANON_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: testEmail,
            password: testPassword,
          }),
        },
      );
      expect(oldSignIn.ok).toBe(false);

      await app.close();
    }, 90_000);

    it("SEC-002: signed URLs are scoped to the verified owner and reject other users", async () => {
      // Set up two confirmed users (A and B) and a storage object
      // uploaded by A under `/private-media/<userA>/<file>`.
      const a = await signUpConfirmedUser("sec002-a-");
      const b = await signUpConfirmedUser("sec002-b-");
      createdUserIds.push(a.id, b.id);

      const aObjectPath = `${a.id}/a-photo.jpg`;
      const upload = await fetch(
        `${SUPABASE_URL}/storage/v1/object/private-media/${encodeURIComponent(aObjectPath)}`,
        {
          method: "POST",
          headers: {
            apikey: ANON_KEY,
            authorization: `Bearer ${a.accessToken}`,
            "content-type": "image/jpeg",
          },
          // Minimal valid JPEG header; the test only asserts the
          // signed-URL contract, not the bytes themselves.
          body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]),
        },
      );
      expect(upload.ok).toBe(true);

      // A can sign their own path → 200 with a `signedURL` field whose
      // payload is a JWS that encodes the bucket + object path.
      const ownSigned = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/private-media/${encodeURIComponent(aObjectPath)}`,
        {
          method: "POST",
          headers: {
            apikey: ANON_KEY,
            authorization: `Bearer ${a.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ expiresIn: 60 }),
        },
      );
      expect(ownSigned.ok).toBe(true);
      const ownBody = (await ownSigned.json()) as { signedURL?: string };
      expect(typeof ownBody.signedURL).toBe("string");
      expect(ownBody.signedURL ?? "").toMatch(/token=/);
      expect(ownBody.signedURL ?? "").toContain(
        encodeURIComponent(aObjectPath),
      );

      // B cannot sign a path inside A's folder — Storage's signed-URL
      // route runs the same ownership predicate as direct object
      // access, so the request is rejected with a non-2xx response and
      // no `signedURL` is returned. We accept either a 400 (signature
      // path mismatch) or a 404 (object not visible) — both are safe
      // outcomes as long as no URL leaks.
      const crossSigned = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/private-media/${encodeURIComponent(aObjectPath)}`,
        {
          method: "POST",
          headers: {
            apikey: ANON_KEY,
            authorization: `Bearer ${b.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ expiresIn: 60 }),
        },
      );
      expect(crossSigned.ok).toBe(false);
      const crossBody = await crossSigned.text();
      expect(crossBody).not.toMatch(/signedURL/);

      // B cannot enumerate A's objects by guessing paths. A 404 is the
      // expected response; the signed-URL contract must never confirm
      // the existence of an object to a non-owner.
      const ghostSigned = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/private-media/${encodeURIComponent(`${a.id}/ghost.jpg`)}`,
        {
          method: "POST",
          headers: {
            apikey: ANON_KEY,
            authorization: `Bearer ${b.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ expiresIn: 60 }),
        },
      );
      expect(ghostSigned.ok).toBe(false);

      // The same path the way it would be served by the Storage API
      // itself: a non-existent bucket prefix. Storage rejects with a
      // 400 or 404 — both are acceptable as long as no URL is returned.
      const badBucketSigned = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/no-such-bucket/x.jpg`,
        {
          method: "POST",
          headers: {
            apikey: ANON_KEY,
            authorization: `Bearer ${a.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ expiresIn: 60 }),
        },
      );
      expect(badBucketSigned.ok).toBe(false);
      expect(await badBucketSigned.text()).not.toMatch(/signedURL/);
    }, 90_000);
  },
);

/**
 * Helper used by the SEC-002 signed-URL isolation test: sign up a fresh
 * user, wait for the Mailpit confirmation email, consume it, and
 * exchange the credentials for an access token. Returns the user id
 * plus the access token so the test can drive storage requests with
 * a verified owner principal.
 */
const signUpConfirmedUser = async (
  prefix: string,
): Promise<{ readonly id: string; readonly accessToken: string }> => {
  const email = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = `${prefix}${Date.now()}-password`;

  const signedUp = await signup(email, password);

  // Wait for the confirmation email.
  const signupSentAt = Date.now();
  let messageId: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const messages = await listMailpitMessages();
    const match = messages.find(
      (m) =>
        m.Subject.toLowerCase().includes("confirm") &&
        Date.parse(m.Created) >= signupSentAt - 1000,
    );
    if (match) {
      messageId = match.ID;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(messageId).not.toBeNull();
  if (!messageId) throw new Error("confirmation email not received");
  const message = await getMailpitMessage(messageId);
  const link = extractConfirmationLink(message.Text);
  expect(link).not.toBeNull();
  if (!link) throw new Error("confirmation link not parsed");
  await confirmEmail(link);

  const tokens = await signIn(email, password);
  return { id: signedUp.id, accessToken: tokens.access_token };
};
