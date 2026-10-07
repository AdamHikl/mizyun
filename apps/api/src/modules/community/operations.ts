import type { CommunityOperationsConfig } from "@mizyun/config";
/** Privacy/safety reductions are never classified as gated engagement. */
export function communityOperationGate(
  method: string,
  url: string,
): keyof CommunityOperationsConfig | null {
  const path = url.split("?")[0] ?? "";
  if (!path.startsWith("/v1/community/")) return null;
  if (
    method === "GET" &&
    (path === "/v1/community/feed" ||
      /^\/v1\/community\/activities\/[^/]+(?:\/reactions)?$/.test(path) ||
      /^\/v1\/community\/profiles\/[^/]+(?:\/activities)?$/.test(path))
  )
    return "browsing";
  if (method === "POST" && path === "/v1/community/profile")
    return "enrollment";
  if (
    (method === "GET" &&
      (path.includes("/discover") ||
        path === "/v1/community/search" ||
        path === "/v1/community/handles/check" ||
        path.includes("/invitation") ||
        path.includes("/handle/") ||
        path.includes("/profile/handle-availability"))) ||
    (method === "POST" && path === "/v1/community/invitations")
  )
    return "discovery";
  if (
    (method === "POST" && path === "/v1/community/activities") ||
    (["PUT", "PATCH"].includes(method) &&
      /^\/v1\/community\/activities\/[^/]+$/.test(path))
  )
    return "publish";
  if (
    (method === "POST" &&
      [
        "/v1/community/relationships/follow",
        "/v1/community/relationships/requests",
      ].includes(path)) ||
    ((method === "POST" || method === "PUT") && /\/reaction(?:s)?$/.test(path))
  )
    return "engagement";
  return null;
}

/** Expansion commands preserve safety reductions while honoring existing server growth switches. */
export function communityExpansionOperationGate(
  method: string,
  url: string,
  body: unknown,
): keyof CommunityOperationsConfig | null {
  const path = url.split("?")[0] ?? "";
  const args =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (
    path === "/v1/community/messaging" ||
    path === "/v1/community/broader-discovery"
  ) {
    if (
      args.operation === "delete" ||
      args.operation === "listMine" ||
      (args.operation === "preferences" && args.enabled !== true)
    )
      return null;
    return ["list", "contacts", "search", "threads", "latest"].includes(
      String(args.operation),
    )
      ? "browsing"
      : "engagement";
  }
  if (
    path === "/v1/community/groups/operations" ||
    path === "/v1/community/challenges"
  ) {
    if (path === "/v1/community/groups/operations" && args.operation === "list")
      return null;
    if (
      [
        "getMine",
        "listMine",
        "leave",
        "disband",
        "deletePost",
        "appeal",
        "cancel",
        "removeContribution",
        "staffAppeals",
        "staffResolveAppeal",
        "remove",
        "ban",
      ].includes(String(args.operation))
    )
      return null;
    return ["list", "get", "read", "inbox", "members", "appeals"].includes(
      String(args.operation),
    )
      ? "browsing"
      : "engagement";
  }
  if (path.includes("/comments")) {
    if (
      method === "DELETE" ||
      path.endsWith("/report") ||
      args.enabled === false ||
      args.mentions === false ||
      args.allowMentions === false
    )
      return null;
    return method === "GET" ? "browsing" : "engagement";
  }
  if (
    method === "GET" &&
    /^(?:\/v1\/community\/(?:routines|media))$/.test(path) &&
    new URL(url, "https://local.invalid").searchParams.get("mine") === "true"
  )
    return null;
  if (
    path.startsWith("/v1/community/media") &&
    (path.includes("/moderation") ||
      path.includes("/reports/") ||
      path.endsWith("/review"))
  )
    return null;
  if (path.startsWith("/v1/community/routines"))
    return method === "DELETE"
      ? null
      : method === "GET"
        ? "browsing"
        : "publish";
  if (path.startsWith("/v1/community/media"))
    return method === "DELETE"
      ? null
      : method === "GET"
        ? "browsing"
        : "publish";
  return null;
}
