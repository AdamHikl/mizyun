import { parseDeepLinkFragment } from "@mizyun/identity";

/** The raw Linking listener must not treat invitation parameters as a login. */
export function parseAppAuthCallback(
  rawUrl: string,
  scheme: "mizyun" | "mizyun-dev",
) {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== `${scheme}:` ||
      url.username ||
      url.password ||
      url.port ||
      !(
        (url.hostname === "auth" && url.pathname === "/callback") ||
        (!url.hostname && url.pathname === "/auth/callback")
      )
    )
      return null;
    return parseDeepLinkFragment(rawUrl);
  } catch {
    return null;
  }
}
