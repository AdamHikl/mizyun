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
      /^\/v1\/community\/profiles\/[^/]+$/.test(path))
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
