import { describe, expect, it, vi } from "vitest";

const variant = vi.hoisted(() => ({ value: "dev" }));
vi.mock("../../composition/app-variant", () => ({
  getAppVariant: () => variant.value,
}));

import { redirectSystemPath } from "../../app/+native-intent";
import { buildCommunityInvitationLink } from "./invitation-links";

const token = "AbCdEfGhIjKlMnOpQrSt_A";

describe("native invitation route entry", () => {
  it.each([true, false])(
    "routes the actual shared Dev URI before Router resolves it (initial=%s)",
    (initial) => {
      variant.value = "dev";
      const shared = buildCommunityInvitationLink(token, "mizyun-dev")!;
      expect(redirectSystemPath({ path: shared, initial })).toBe(
        `/community/invite?token=${token}`,
      );
    },
  );

  it("uses the installed Production variant without accepting Dev tokens", () => {
    variant.value = "production";
    expect(
      redirectSystemPath({ path: `mizyun://invite/${token}`, initial: true }),
    ).toBe(`/community/invite?token=${token}`);
    expect(
      redirectSystemPath({
        path: `mizyun-dev://invite/${token}`,
        initial: false,
      }),
    ).toBe("/community/invite?token=unavailable");
  });

  it.each([
    `mizyun://invite/${token}`,
    `https://attacker.example/invite/${token}`,
    `mizyun-dev://invite/${token}?redirect=https://attacker.example`,
    `mizyun-dev://community/invite?token=${token}&token=${token}`,
    `mizyun-dev://invite/${token}#access_token=secret`,
    "mizyun-dev://invite/short",
    `mizyun-dev://invite:bad/${token}`,
    `mizyun-dev://community:bad/invite?token=${token}`,
    `mizyun-dev://invite/${token}#access_token=test&refresh_token=test`,
  ])(
    "refuses foreign/ambiguous invitations without exposing the URI",
    (path) => {
      variant.value = "dev";
      expect(redirectSystemPath({ path, initial: false })).toBe(
        "/community/invite?token=unavailable",
      );
    },
  );

  it.each([
    "mizyun-dev://auth/callback#access_token=test&refresh_token=test",
    "mizyun-dev://community/relationships",
    "/settings",
    "not a URL",
  ])("preserves the existing non-invitation handler: %s", (path) => {
    variant.value = "dev";
    expect(redirectSystemPath({ path, initial: true })).toBe(path);
  });
});
