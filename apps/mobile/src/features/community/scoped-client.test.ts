import { describe, expect, it, vi } from "vitest";
import { HttpApiClient, type ApiClient } from "@mizyun/api-client";
import type { AuthClient } from "@mizyun/identity";
import { scopeCommunityClient } from "./scoped-client";

describe("community principal scopes", () => {
  it("binds the displayed principal and preserves a live transport guard", async () => {
    let active = true;
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { id: "card" } });
    const scoped = scopeCommunityClient(
      { request } as unknown as ApiClient,
      "alice",
      () => active,
    );
    await scoped.request({ method: "POST", path: "/v1/community/activities" });
    const options = request.mock.calls[0]![0];
    expect(options.expectedUserId).toBe("alice");
    expect(options.isCurrent()).toBe(true);
    active = false;
    expect(options.isCurrent()).toBe(false);
  });
  it("does not send requests from a retired or signed-out scope", async () => {
    const request = vi.fn();
    for (const scoped of [
      scopeCommunityClient(
        { request } as unknown as ApiClient,
        "alice",
        () => false,
      ),
      scopeCommunityClient(
        { request } as unknown as ApiClient,
        null,
        () => true,
      ),
    ]) {
      expect(
        (
          await scoped.request({
            method: "DELETE",
            path: "/v1/community/profile",
          })
        ).ok,
      ).toBe(false);
    }
    expect(request).not.toHaveBeenCalled();
  });
  it("suppresses identity-bearing results if the account changes while a request is pending", async () => {
    let active = true;
    const request = vi.fn().mockImplementation(async () => {
      active = false;
      return { ok: true, value: { handle: "alice" } };
    });
    const scoped = scopeCommunityClient(
      { request } as unknown as ApiClient,
      "alice",
      () => active,
    );
    expect(
      await scoped.request({ method: "GET", path: "/v1/community/profile" }),
    ).toEqual({ ok: false, error: { kind: "context_changed" } });
  });
  it("the real transport does not use another account's session resolved asynchronously", async () => {
    const fetch = vi.fn();
    const auth = {
      getSession: async () => ({
        user: { id: "bob", email: "bob@example.invalid" },
        accessToken: "bob-token",
      }),
    } as unknown as AuthClient;
    const transport = new HttpApiClient({
      baseUrl: "https://api.example.invalid",
      authClient: auth,
      fetch,
    });
    const scoped = scopeCommunityClient(transport, "alice", () => true);
    expect(
      await scoped.request({
        method: "POST",
        path: "/v1/community/activities",
      }),
    ).toEqual({ ok: false, error: { kind: "no_session" } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("the real transport checks the UI scope after awaiting same-account session resolution", async () => {
    let active = true;
    const fetch = vi.fn();
    const auth = {
      getSession: async () => {
        active = false;
        return {
          user: { id: "alice", email: "alice@example.invalid" },
          accessToken: "alice-token",
        };
      },
    } as unknown as AuthClient;
    const transport = new HttpApiClient({
      baseUrl: "https://api.example.invalid",
      authClient: auth,
      fetch,
    });
    const scoped = scopeCommunityClient(transport, "alice", () => active);
    expect(
      (
        await scoped.request({
          method: "POST",
          path: "/v1/community/relationships/follow",
        })
      ).ok,
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
