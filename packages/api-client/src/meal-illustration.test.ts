import { describe, expect, it, vi } from "vitest";
import type { AuthClient } from "@mizyun/identity";
import { HttpApiClient } from "./http-api-client";
import { DisabledApiClient } from "./disabled-api-client";
function make(response: unknown) {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(response)));
  const auth = {
    getSession: async () => ({
      user: { id: "owner" },
      accessToken: "synthetic-token",
    }),
    signOut: vi.fn(),
  } as unknown as AuthClient;
  return {
    client: new HttpApiClient({
      baseUrl: "https://api.example.test",
      authClient: auth,
      fetch: fetcher,
    }),
    fetcher,
  };
}
describe("meal illustration client boundary", () => {
  it("uses only saved ID with fresh Auth and prevents caller prompt/path overrides", async () => {
    const { client, fetcher } = make({ status: "pending" });
    expect(
      await client.ensureMealIllustration("entry/id", {
        body: { prompt: "private" },
        path: "https://other.test",
        method: "DELETE",
      }),
    ).toEqual({ ok: true, value: { status: "pending" } });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/food-entries/entry%2Fid/illustration",
    );
    expect(fetcher.mock.calls[0]?.[1].method).toBe("POST");
    expect(fetcher.mock.calls[0]?.[1].body).toBeUndefined();
  });
  it("checks capability with Auth and validates responses", async () => {
    const { client, fetcher } = make({ available: false });
    expect(await client.getMealIllustrationCapability()).toEqual({
      ok: true,
      value: { available: false },
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/food-entries/illustrations/capability",
    );
    const bad = make({
      status: "ready",
      image: { url: "https://example.test/private" },
    });
    expect(await bad.client.ensureMealIllustration("entry")).toMatchObject({
      ok: false,
      error: { kind: "validation_error" },
    });
  });
  it("preserves account retirement checks and disabled client behavior", async () => {
    const { client, fetcher } = make({ status: "pending" });
    expect(
      await client.ensureMealIllustration("entry", {
        expectedUserId: "different",
      }),
    ).toMatchObject({ ok: false, error: { kind: "no_session" } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await new DisabledApiClient().ensureMealIllustration(),
    ).toMatchObject({ ok: false, error: { kind: "not_configured" } });
  });
});
