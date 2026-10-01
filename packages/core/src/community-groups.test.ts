import { describe, expect, it } from "vitest";
import { canLeaveGroup, canManageGroupMember } from "./community-groups";
describe("group ownership safeguards", () => {
  it.each(["owner", "moderator", "member"] as const)(
    "%s cannot manage an owner",
    (actor) => expect(canManageGroupMember(actor, "owner")).toBe(false),
  );
  it("keeps moderator authority limited to regular members", () => {
    expect(canManageGroupMember("moderator", "member")).toBe(true);
    expect(canManageGroupMember("moderator", "moderator")).toBe(false);
    expect(canManageGroupMember("member", "member")).toBe(false);
  });
  it("requires ownership transfer when another member would be orphaned", () => {
    expect(canLeaveGroup("owner", 2)).toBe(false);
    expect(canLeaveGroup("owner", 1)).toBe(true);
    expect(canLeaveGroup("member", 2)).toBe(true);
  });
});
