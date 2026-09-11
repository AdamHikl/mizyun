import { describe, expect, it } from "vitest";

import {
  DisabledAuthClient,
  IdentityError,
  RejectingAccessTokenVerifier,
  parseDeepLinkFragment,
} from "./index.js";

describe("disabled identity adapters", () => {
  it("rejects sign-in explicitly when configuration is absent", async () => {
    const client = new DisabledAuthClient();

    await expect(
      client.signInWithPassword({
        email: "person@example.com",
        password: "password",
      }),
    ).rejects.toMatchObject({
      code: "AUTH_NOT_CONFIGURED",
    });
  });

  it("does not authenticate arbitrary bearer tokens", async () => {
    await expect(
      new RejectingAccessTokenVerifier().verify("token"),
    ).resolves.toBeNull();
  });

  it("rejects deep link consumption when configuration is absent", async () => {
    const client = new DisabledAuthClient();
    await expect(
      client.consumeDeepLink({
        kind: "signup",
        accessToken: "a",
        refreshToken: "r",
      }),
    ).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
  });

  it("rejects password update when configuration is absent", async () => {
    const client = new DisabledAuthClient();
    await expect(
      client.updatePassword({ password: "newpass" }),
    ).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
  });

  it("rejects password recovery request when configuration is absent", async () => {
    const client = new DisabledAuthClient();
    await expect(
      client.requestPasswordRecovery({ email: "person@example.com" }),
    ).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
  });

  it("rejects OAuth sign-in request when configuration is absent", async () => {
    const client = new DisabledAuthClient();
    await expect(
      client.signInWithOAuth({ provider: "google" }),
    ).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
  });

  it("rejects ID token sign-in request when configuration is absent", async () => {
    const client = new DisabledAuthClient();
    await expect(
      client.signInWithIdToken({
        provider: "apple",
        token: "mock-identity-token",
      }),
    ).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
  });
});

describe("parseDeepLinkFragment", () => {
  const urlWithFragment = (fragment: string): string =>
    `mizyun://auth/callback#${fragment}`;

  it("returns null when the URL has no fragment or query", () => {
    expect(parseDeepLinkFragment("mizyun://auth/callback")).toBeNull();
  });

  it("returns null when the fragment is empty", () => {
    expect(parseDeepLinkFragment("mizyun://auth/callback#")).toBeNull();
  });

  it("returns null when access_token is missing", () => {
    expect(
      parseDeepLinkFragment(
        urlWithFragment("refresh_token=reoz&type=recovery"),
      ),
    ).toBeNull();
  });

  it("returns null when refresh_token is missing", () => {
    expect(
      parseDeepLinkFragment(urlWithFragment("access_token=abc&type=recovery")),
    ).toBeNull();
  });

  it("parses a recovery callback with expires_at", () => {
    const payload = parseDeepLinkFragment(
      urlWithFragment(
        "access_token=ACCESS&refresh_token=REFRESH&type=recovery&expires_at=1784197009",
      ),
    );
    expect(payload).toEqual({
      kind: "recovery",
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
      expiresAt: new Date(1784197009 * 1000),
    });
  });

  it("parses a signup callback without expires_at", () => {
    const payload = parseDeepLinkFragment(
      urlWithFragment("access_token=ACCESS&refresh_token=REFRESH&type=signup"),
    );
    expect(payload).toEqual({
      kind: "signup",
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
    });
  });

  it("parses a magiclink callback", () => {
    const payload = parseDeepLinkFragment(
      urlWithFragment(
        "access_token=ACCESS&refresh_token=REFRESH&type=magiclink",
      ),
    );
    expect(payload).toEqual({
      kind: "magiclink",
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
    });
  });

  it("parses an oauth callback with explicit type=oauth", () => {
    const payload = parseDeepLinkFragment(
      urlWithFragment(
        "access_token=ACCESS&refresh_token=REFRESH&type=oauth&provider_token=P_TOKEN",
      ),
    );
    expect(payload).toEqual({
      kind: "oauth",
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
    });
  });

  it("parses an oauth callback without type (implicit OAuth fragment)", () => {
    const payload = parseDeepLinkFragment(
      urlWithFragment(
        "access_token=ACCESS&refresh_token=REFRESH&provider_token=P_TOKEN&token_type=bearer",
      ),
    );
    expect(payload).toEqual({
      kind: "oauth",
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
    });
  });

  it("parses query parameters when delivered with query string instead of fragment", () => {
    const payload = parseDeepLinkFragment(
      "mizyun://auth/callback?access_token=ACCESS&refresh_token=REFRESH&type=oauth",
    );
    expect(payload).toEqual({
      kind: "oauth",
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
    });
  });

  it("parses an email_change callback", () => {
    const payload = parseDeepLinkFragment(
      urlWithFragment(
        "access_token=ACCESS&refresh_token=REFRESH&type=email_change",
      ),
    );
    expect(payload).toEqual({
      kind: "email_change",
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
    });
  });

  it("classifies an unknown type as kind: 'unknown' and preserves the type", () => {
    const payload = parseDeepLinkFragment(
      urlWithFragment("access_token=ACCESS&refresh_token=REFRESH&type=invite"),
    );
    expect(payload).toEqual({
      kind: "unknown",
      type: "invite",
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
    });
  });
});
