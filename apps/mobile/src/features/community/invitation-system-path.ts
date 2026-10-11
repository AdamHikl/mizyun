import { parseCommunityInvitationLink } from "./invitation-links";

/** Map the shared URI before Expo Router attempts to resolve /invite/:token. */
export function invitationSystemPath(
  path: string,
  scheme: "mizyun" | "mizyun-dev",
): string {
  const token = parseCommunityInvitationLink(path, scheme);
  if (token) return `/community/invite?token=${token}`;

  try {
    const url = new URL(path, `${scheme}:///`);
    if (
      url.hostname === "invite" ||
      url.pathname === "/invite" ||
      url.pathname === "/community/invite" ||
      url.pathname.startsWith("/invite/")
    ) {
      // Never let a foreign/malformed invitation become a valid local token,
      // or expose its raw URL on Router's unmatched-route screen.
      return "/community/invite?token=unavailable";
    }
  } catch {
    // Even unparseable invitation authorities must not reach the error page
    // with a bearer token (for example, an invalid port on the invite host).
    if (
      /^(?:[a-z][a-z0-9+.-]*:\/\/|\/)(?:[^/?#]*@)?(?:invite(?:[/:?#]|$)|community(?::[^/?#]*)?\/invite(?:[/?#]|$))/i.test(
        path,
      )
    )
      return "/community/invite?token=unavailable";
    return "/";
  }
  return path;
}
