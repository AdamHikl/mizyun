import { describe, expect, it } from "vitest";
import {
  buildCommunityInvitationLink,
  parseCommunityInvitationLink,
} from "./invitation-links";
const token = "AbCdEfGhIjKlMnOpQrSt_A";
describe("community invitation deep links", () => {
  it("accepts the exact invitation route for the installed variant", () => {
    expect(
      parseCommunityInvitationLink(`mizyun://invite/${token}`, "mizyun"),
    ).toBe(token);
    expect(
      parseCommunityInvitationLink(
        `mizyun-dev://invite/${token}`,
        "mizyun-dev",
      ),
    ).toBe(token);
    expect(
      parseCommunityInvitationLink(
        `mizyun://community/invite?token=${token}`,
        "mizyun",
      ),
    ).toBe(token);
    expect(
      parseCommunityInvitationLink(
        `mizyun:///community/invite?token=${token}`,
        "mizyun",
      ),
    ).toBe(token);
  });
  it.each([
    `mizyun-dev://invite/${token}`,
    `https://mizyun.app/invite/${token}`,
    `https://attacker.example/invite/${token}`,
    `mizyun://other/invite/${token}`,
    `mizyun://invite/${token}/extra`,
    `mizyun://invite/${token}?redirect=https://attacker.example`,
    `mizyun://community/invite?token=${token}&token=${token}`,
    `mizyun://community/invite?token=${token}&access_token=secret`,
    `mizyun://community/invite?token=${token}#access_token=secret`,
    `mizyun://community/invite?token=%2F${token}`,
    `mizyun://invite/short`,
    `mizyun://community/inviter?token=${token}`,
    "not a URL",
  ])("rejects a foreign or ambiguous route: %s", (url) => {
    expect(parseCommunityInvitationLink(url, "mizyun")).toBeNull();
  });
  it("builds round-tripping links for the installed Dev and Production schemes", () => {
    const dev = buildCommunityInvitationLink(token, "mizyun-dev");
    const production = buildCommunityInvitationLink(token, "mizyun");
    expect(dev).toBe(`mizyun-dev://invite/${token}`);
    expect(production).toBe(`mizyun://invite/${token}`);
    expect(parseCommunityInvitationLink(dev!, "mizyun-dev")).toBe(token);
    expect(parseCommunityInvitationLink(production!, "mizyun")).toBe(token);
  });
  it("never builds a link from a malformed invitation token", () => {
    expect(buildCommunityInvitationLink("short", "mizyun-dev")).toBeNull();
    expect(buildCommunityInvitationLink(`${token}/extra`, "mizyun")).toBeNull();
  });
});
