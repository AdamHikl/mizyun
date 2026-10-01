/** Group transport port contains no database, mobile or framework dependency. */
export interface CommunityGroupsRepository {
  execute(
    operation: string,
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown>;
}
export type CommunityGroupRole = "owner" | "moderator" | "member";
export function canManageGroupMember(
  actor: CommunityGroupRole,
  target: CommunityGroupRole,
): boolean {
  return (
    target !== "owner" &&
    (actor === "owner" || (actor === "moderator" && target === "member"))
  );
}
export function canLeaveGroup(
  role: CommunityGroupRole,
  members: number,
): boolean {
  return role !== "owner" || members <= 1;
}
