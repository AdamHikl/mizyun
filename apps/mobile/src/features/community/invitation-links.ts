export function buildCommunityInvitationLink(
  token: string,
  expectedScheme: "mizyun" | "mizyun-dev",
): string | null {
  return /^[A-Za-z0-9_-]{22}$/.test(token)
    ? `${expectedScheme}://invite/${token}`
    : null;
}

/** Custom-scheme links only; HTTPS requires separately accepted app/universal links. */
export function parseCommunityInvitationLink(
  rawUrl: string,
  expectedScheme: "mizyun" | "mizyun-dev",
): string | null {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== `${expectedScheme}:` ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return null;
    let token: string | null = null;
    if (
      url.hostname === "invite" &&
      /^\/[A-Za-z0-9_-]{22}$/.test(url.pathname) &&
      !url.search
    ) {
      token = url.pathname.slice(1);
    } else if (
      ((url.hostname === "community" && url.pathname === "/invite") ||
        (!url.hostname && url.pathname === "/community/invite")) &&
      Array.from(url.searchParams.keys()).every((key) => key === "token") &&
      url.searchParams.getAll("token").length === 1
    ) {
      token = url.searchParams.get("token");
    }
    return token && /^[A-Za-z0-9_-]{22}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}
