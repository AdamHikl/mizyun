import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  followResolvedInvitation,
  prepareInvitationShare,
} from "./invitation-actions";

const invitation = {
  invitation: {
    id: "id",
    token: "token",
    inviterUserId: "user",
    createdAt: "2026-09-01T00:00:00Z",
    expiresAt: "2026-10-01T00:00:00Z",
    revokedAt: null,
  },
  inviteUrl: "mizyun://community/invite?token=token",
};
describe("invitation actions", () => {
  it("sharing the same unexpired invite again does not consume another invitation quota", async () => {
    const request = vi.fn();
    const result = await prepareInvitationShare(
      { request } as unknown as ApiClient,
      invitation,
      Date.parse("2026-09-30T00:00:00Z"),
    );
    expect(result).toEqual({ ok: true, value: invitation });
    expect(request).not.toHaveBeenCalled();
  });
  it("replaces an expired invite rather than sharing an unusable link", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: invitation });
    await prepareInvitationShare(
      { request } as unknown as ApiClient,
      invitation,
      Date.parse("2026-10-02T00:00:00Z"),
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1/community/invitations",
      }),
    );
  });
  it("does not follow when a previously displayed invitation was revoked", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        kind: "http_error",
        status: 410,
        code: "NOT_FOUND",
        message: "Unavailable",
      },
    });
    expect(
      (
        await followResolvedInvitation(
          { request } as unknown as ApiClient,
          "old-token",
          "expected-user",
        )
      ).ok,
    ).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET" }),
    );
  });
  it("does not follow a different identity from the one the user confirmed", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        inviter: { userId: "other-user" },
        isExpired: false,
        isRevoked: false,
      },
    });
    expect(
      (
        await followResolvedInvitation(
          { request } as unknown as ApiClient,
          "token",
          "expected-user",
        )
      ).ok,
    ).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not follow from a new account when the principal changes during token revalidation", async () => {
    let active = true;
    const request = vi.fn().mockImplementation(async () => {
      active = false;
      return {
        ok: true,
        value: {
          inviter: { userId: "expected-user" },
          isExpired: false,
          isRevoked: false,
        },
      };
    });
    const result = await followResolvedInvitation(
      { request } as unknown as ApiClient,
      "token",
      "expected-user",
      () => active,
    );
    expect(result.ok).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("sends the verified invite token with the follow mutation for atomic non-searchable access", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          inviter: { userId: "expected-user" },
          isExpired: false,
          isRevoked: false,
        },
      })
      .mockResolvedValueOnce({ ok: true, value: { status: "pending" } });
    await followResolvedInvitation(
      { request } as unknown as ApiClient,
      "known-token",
      "expected-user",
    );
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1/community/relationships/follow",
        body: {
          targetUserId: "expected-user",
          invitationToken: "known-token",
          operationId: expect.any(String),
        },
      }),
    );
  });
});
