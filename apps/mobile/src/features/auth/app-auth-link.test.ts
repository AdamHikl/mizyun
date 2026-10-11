import { describe, expect, it } from "vitest";
import { parseAppAuthCallback } from "./app-auth-link";

const fragment = "access_token=ACCESS&refresh_token=REFRESH&type=recovery";
describe("raw app Auth callback boundary", () => {
  it.each(["mizyun-dev://auth/callback", "mizyun-dev:///auth/callback"])(
    "preserves the installed callback: %s",
    (url) => {
      expect(
        parseAppAuthCallback(`${url}#${fragment}`, "mizyun-dev"),
      ).toMatchObject({
        accessToken: "ACCESS",
        refreshToken: "REFRESH",
        kind: "recovery",
      });
    },
  );
  it("preserves the proper Production callback and query response", () => {
    expect(
      parseAppAuthCallback(`mizyun://auth/callback?${fragment}`, "mizyun"),
    ).not.toBeNull();
  });
  it.each([
    "mizyun-dev://invite/AbCdEfGhIjKlMnOpQrSt_A",
    "mizyun-dev://community/invite?token=AbCdEfGhIjKlMnOpQrSt_A",
    "mizyun-dev://invite:bad/AbCdEfGhIjKlMnOpQrSt_A",
    "mizyun://auth/callback",
    "https://attacker.example/auth/callback",
    "mizyun-dev://user@auth/callback",
    "mizyun-dev://auth:123/callback",
    "mizyun-dev://auth/callback/extra",
  ])("refuses Auth-shaped tokens on an unrelated/foreign URI: %s", (url) => {
    expect(parseAppAuthCallback(`${url}#${fragment}`, "mizyun-dev")).toBeNull();
  });
});
