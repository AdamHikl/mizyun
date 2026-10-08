import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  buildCommunityInvitationFallbackLink,
  COMMUNITY_INVITATION_FALLBACK_URL,
  parseCommunityInvitationFallbackFragment,
  parseCommunityInvitationFallbackLink,
  type CommunityInvitationEnvironment,
} from "./invitation-fallback";
import { parseCommunityInvitationLink } from "./invitation-links";

const token = "AbCdEfGhIjKlMnOpQrSt_A";
const base = COMMUNITY_INVITATION_FALLBACK_URL;
const html = readFileSync(
  new URL(
    "../../../../../docs/community-closure-2026-10-08/invitation-fallback.html",
    import.meta.url,
  ),
  "utf8",
);
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

/** Run the shipped page script; network, persistence and auto-navigation fail. */
function openPage(fragment: string, clearingFails = false) {
  if (!script) throw new Error("Landing page script missing");
  const calls: unknown[][] = [];
  let cleared = false;
  const elements: Record<
    string,
    { hidden: boolean; textContent: string; href?: string }
  > = {
    invalid: { hidden: false, textContent: "" },
    valid: { hidden: true, textContent: "" },
    error: { hidden: false, textContent: "" },
    variant: { hidden: false, textContent: "" },
    "open-app": { hidden: false, textContent: "" },
  };
  let appLink: string | undefined;
  Object.defineProperty(elements["open-app"], "href", {
    get: () => appLink,
    set: (value: string) => {
      if (!cleared) throw new Error("Capability exposed before URL clearing");
      appLink = value;
    },
  });
  const forbidden = () => {
    throw new Error("Page must not use network, persistence or navigation");
  };
  runInNewContext(script, {
    window: {
      location: {
        hash: fragment,
        pathname: "/community/invite",
        assign: forbidden,
        replace: forbidden,
      },
      history: {
        replaceState: (...args: unknown[]) => {
          calls.push(args);
          if (clearingFails) throw new Error("History denied");
          cleared = true;
        },
      },
      fetch: forbidden,
      localStorage: { setItem: forbidden, getItem: forbidden },
      sessionStorage: { setItem: forbidden, getItem: forbidden },
      open: forbidden,
    },
    fetch: forbidden,
    console: { log: forbidden, error: forbidden, warn: forbidden },
    document: { getElementById: (id: string) => elements[id] },
  });
  return { elements, calls, appLink };
}

describe("prepared invitation fallback contract", () => {
  it.each(["dev", "production"] as const)(
    "round trips only its exact %s environment with a fragment-only capability",
    (environment) => {
      const link = buildCommunityInvitationFallbackLink(token, environment)!;
      expect(link).toBe(`${base}#${environment}/${token}`);
      expect(parseCommunityInvitationFallbackLink(link, environment)).toEqual({
        environment,
        token,
      });
      const url = new URL(link);
      expect(url.search).toBe("");
      expect(url.pathname).toBe("/community/invite");
      expect(url.pathname).not.toContain(token);
      expect(
        parseCommunityInvitationFallbackLink(
          link,
          environment === "dev" ? "production" : "dev",
        ),
      ).toBeNull();
    },
  );

  it.each([
    `http://www.phiskel.com/community/invite#dev/${token}`,
    `https://phiskel.com/community/invite#dev/${token}`,
    `https://www.phiskel.com.attacker.example/community/invite#dev/${token}`,
    `https://user@www.phiskel.com/community/invite#dev/${token}`,
    `https://www.phiskel.com:443/community/invite#dev/${token}`,
    `https://www.phiskel.com/x/../community/invite#dev/${token}`,
    `${base}/#dev/${token}`,
    `${base}?token=${token}#dev/${token}`,
    `${base}?redirect=https://attacker.example#dev/${token}`,
    `${base}#prod/${token}`,
    `${base}#DEV/${token}`,
    `${base}#dev/${token}/extra`,
    `${base}#dev/${token}?redirect=https://attacker.example`,
    `${base}#dev/%41${token.slice(1)}`,
    `${base}#dev/${token}\n`,
    ` ${base}#dev/${token}`,
    "not a URL",
  ])("rejects foreign or ambiguous fallback URLs: %s", (raw) => {
    expect(parseCommunityInvitationFallbackLink(raw, "dev")).toBeNull();
  });

  it.each(["short", `${token}\n`, `${token}/`, "A".repeat(23), "é".repeat(22)])(
    "never builds a capability from malformed token %s",
    (invalid) => {
      expect(buildCommunityInvitationFallbackLink(invalid, "dev")).toBeNull();
      expect(
        parseCommunityInvitationFallbackFragment(`#dev/${invalid}`),
      ).toBeNull();
    },
  );

  it("rejects unknown runtime environments without changing existing sharing", () => {
    expect(
      buildCommunityInvitationFallbackLink(
        token,
        "prod" as CommunityInvitationEnvironment,
      ),
    ).toBeNull();
    expect(
      parseCommunityInvitationLink(`${base}#dev/${token}`, "mizyun-dev"),
    ).toBeNull();
  });
});

describe("actual invitation landing page boundary", () => {
  it.each([
    ["dev", "mizyun-dev", "Mizyun Dev"],
    ["production", "mizyun", "Mizyun"],
  ] as const)(
    "clears the %s capability before offering its explicit matching app link",
    (environment, scheme, name) => {
      const page = openPage(`#${environment}/${token}`);
      expect(page.calls).toEqual([[null, "", "/community/invite"]]);
      expect(page.appLink).toBe(`${scheme}://invite/${token}`);
      expect(parseCommunityInvitationLink(page.appLink!, scheme)).toBe(token);
      expect(page.elements["open-app"]!.textContent).toBe(`Open ${name}`);
      expect(page.elements.valid!.hidden).toBe(false);
      expect(page.elements.invalid!.hidden).toBe(true);
      expect(page.elements.variant!.textContent).not.toContain(token);
    },
  );

  it.each([
    "",
    `#prod/${token}`,
    `#dev/${token}\n`,
    `#dev/${token}/extra`,
    `#dev/${token}?token=${token}`,
    "#dev/<script>alert(1)</script>",
    `#dev/%41${token.slice(1)}`,
  ])(
    "clears invalid fragment without revealing identity or building a link",
    (fragment) => {
      const page = openPage(fragment);
      expect(page.calls).toEqual([[null, "", "/community/invite"]]);
      expect(page.appLink).toBeUndefined();
      expect(page.elements.valid!.hidden).toBe(true);
      expect(page.elements.variant!.textContent).toBe("");
    },
  );

  it("fails closed when history replacement is denied", () => {
    const page = openPage(`#dev/${token}`, true);
    expect(page.appLink).toBeUndefined();
    expect(page.elements.valid!.hidden).toBe(true);
    expect(page.elements.error!.textContent).toContain("could not safely open");
    expect(page.elements.error!.textContent).not.toContain(token);
  });

  it("ships without external assets, trackers, automatic redirects or persistence", () => {
    expect(html).toContain('name="referrer" content="no-referrer"');
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toMatch(
      /<script[^>]+src=|<iframe|<img|http-equiv="refresh"/i,
    );
    expect(html).not.toMatch(/localStorage|sessionStorage|sendBeacon|fetch\(/);
    expect(html).toContain("reopen the original invitation");
  });
});
