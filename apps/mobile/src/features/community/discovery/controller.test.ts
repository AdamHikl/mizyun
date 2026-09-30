import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { DiscoveryController } from "./controller";
const friend = {
  userId: "friend",
  handle: "friend",
  displayName: "Friend",
  avatarSymbol: "F",
  bio: null,
  createdAt: "2026-09-30T00:00:00Z",
};
const invitation = {
  id: "invite-id",
  token: "A".repeat(22),
  inviterUserId: "owner",
  expiresAt: "2099-09-30T00:00:00Z",
  revokedAt: null,
  createdAt: "2026-09-30T00:00:00Z",
};
const ok = (value: unknown) => ({ ok: true, value });
function setup(
  request = vi.fn().mockResolvedValue(ok({ items: [] })),
  token?: string,
  principal: string | null = "owner",
) {
  return {
    request,
    controller: new DiscoveryController(
      { request } as unknown as ApiClient,
      principal,
      token,
    ),
  };
}
describe("memory-only discovery boundary", () => {
  it("never requests identities for a signed-out principal", async () => {
    const { controller, request } = setup(undefined, invitation.token, null);
    await controller.resume();
    await controller.search("friend");
    expect(request).not.toHaveBeenCalled();
  });
  it("normalizes exact handles and rejects email lookup without a request", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok({ items: [] }))
      .mockResolvedValueOnce(ok({ profiles: [friend] }));
    const { controller } = setup(request);
    await controller.resume();
    await controller.search("  @FRIEND ");
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/v1/community/search?q=friend&limit=1",
        expectedUserId: "owner",
      }),
    );
    expect(controller.getState().result).toEqual(friend);
    await controller.search("friend@example.com");
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.getState().result).toBeNull();
  });
  it("drops identities and tokens on background and ignores late responses even after resume", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok({ items: [invitation] }))
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(ok({ items: [] }));
    const { controller } = setup(request);
    await controller.resume();
    controller.show(invitation.id);
    const search = controller.search("friend");
    const inflight = request.mock.calls[1]![0] as { isCurrent: () => boolean };
    controller.pause();
    expect(controller.getState().displayedInvitation).toBeNull();
    await controller.resume();
    expect(inflight.isCurrent()).toBe(false);
    resolve(ok({ profiles: [friend] }));
    await search;
    expect(controller.getState().result).toBeNull();
    expect(controller.getState().invitations).toEqual([]);
  });
  it("revalidates the invitation before a deliberate follow and sends nothing when revoked", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok({ items: [] }))
      .mockResolvedValueOnce(
        ok({ inviter: friend, isExpired: false, isRevoked: false }),
      )
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "http_error", status: 404, code: "NOT_FOUND" },
      });
    const { controller } = setup(request, invitation.token);
    await controller.resume();
    expect(
      request.mock.calls.every(([options]) => options.method === "GET"),
    ).toBe(true);
    await controller.follow(controller.getState().inviter!, true);
    expect(request).toHaveBeenCalledTimes(3);
    expect(
      request.mock.calls.every(([options]) => options.method === "GET"),
    ).toBe(true);
    expect(controller.getState().inviter).toBeNull();
  });
  it("binds invitation revalidation and follow to the displayed principal and ignores duplicate taps", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok({ items: [] }))
      .mockResolvedValueOnce(
        ok({ inviter: friend, isExpired: false, isRevoked: false }),
      )
      .mockResolvedValueOnce(
        ok({ inviter: friend, isExpired: false, isRevoked: false }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
    const { controller } = setup(request, invitation.token);
    await controller.resume();
    const user = controller.getState().inviter!;
    const first = controller.follow(user, true);
    await controller.follow(user, true);
    await Promise.resolve();
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "POST",
        expectedUserId: "owner",
        body: expect.objectContaining({
          targetUserId: "friend",
          invitationToken: invitation.token,
          operationId: expect.any(String),
        }),
      }),
    );
    resolve(ok({ status: "pending" }));
    await first;
    expect(controller.getState().inviter?.relationshipWithViewer).toBe(
      "pending_outgoing",
    );
  });
  it("revokes the listed owner invitation without changing search settings", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok({ items: [invitation] }))
      .mockResolvedValueOnce(ok({ revoked: true }));
    const { controller } = setup(request);
    await controller.resume();
    controller.show(invitation.id);
    await controller.revoke(invitation.id);
    expect(controller.getState().displayedInvitation).toBeNull();
    expect(controller.getState().invitations[0]?.revokedAt).not.toBeNull();
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/v1/community/invitations/invite-id",
        method: "DELETE",
        expectedUserId: "owner",
      }),
    );
  });
  it("never displays an expired or malformed incoming invitation", async () => {
    const { controller, request } = setup(undefined, "invalid");
    await controller.resume();
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.getState().inviter).toBeNull();
  });
});
