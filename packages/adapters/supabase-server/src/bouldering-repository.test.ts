import { describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import { SupabaseBoulderingRepository } from "./bouldering-repository.js";
import type { RepositorySupabaseClient } from "./index.js";

const user = "00000000-0000-4000-8000-000000000001" as UserId;
const other = "00000000-0000-4000-8000-000000000009";
const session = "00000000-0000-4000-8000-000000000003";
const input = {
  clientOperationId: "00000000-0000-4000-8000-000000000002",
  grade: "6A+" as const,
  result: "sent" as const,
  attempts: 3,
  holdColour: "blue" as const,
  note: null,
  photoAssetId: null,
};
const ascentRow = (userId: string) => ({
  id: "00000000-0000-4000-8000-000000000004",
  user_id: userId,
  workout_id: session,
  client_operation_id: input.clientOperationId,
  sequence: 1,
  grade_scale: "font",
  grade_code: "6A+",
  grade_rank: 6,
  result: "sent",
  attempts: 3,
  hold_colour: "blue",
  note: null,
  photo_asset_id: null,
  logged_at: "2026-10-16T10:00:00.000Z",
  revision: 1,
  created_at: "2026-10-16T10:00:00.000Z",
  updated_at: "2026-10-16T10:00:00.000Z",
});
const withRpc = (rpc: ReturnType<typeof vi.fn>) =>
  new SupabaseBoulderingRepository(
    () => ({ rpc }) as unknown as RepositorySupabaseClient,
  );

describe("SupabaseBoulderingRepository", () => {
  it("writes ascents through one authenticated RPC and maps the row", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [ascentRow(user)], error: null });
    const ascent = await withRpc(rpc).createAscent(user, session, input, {
      accessToken: "owner",
    });
    expect(rpc).toHaveBeenCalledWith("boulder_ascent_create", {
      p_session: session,
      p_operation: input.clientOperationId,
      p_grade: "6A+",
      p_result: "sent",
      p_attempts: 3,
      p_colour: "blue",
      p_note: null,
      p_photo: null,
      p_project: null,
    });
    expect(ascent).toMatchObject({
      sessionId: session,
      grade: "6A+",
      gradeRank: 6,
      projectId: null,
    });
  });

  it("rejects a row owned by another user", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [ascentRow(other)], error: null });
    await expect(
      withRpc(rpc).createAscent(user, session, input, {
        accessToken: "owner",
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("treats an empty remove result as already removed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await expect(
      withRpc(rpc).removeAscent(user, "x", { accessToken: "owner" }),
    ).resolves.toBeNull();
  });

  it.each([
    ["PT409", "boulder_session_active", "active_session"],
    ["P0003", "boulder_removed", "removed"],
    ["PT409", "boulder_conflict", "conflict"],
    ["P0002", "boulder_not_found", "not_found"],
    ["22023", "boulder_invalid", "invalid"],
  ])("maps %s %s", async (code, message, kind) => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [], error: { code, message } });
    await expect(
      withRpc(rpc).startSession(
        user,
        {
          clientOperationId: input.clientOperationId,
          recordingTimezone: "UTC",
          gymName: null,
        },
        { accessToken: "owner" },
      ),
    ).rejects.toMatchObject({ kind });
  });

  it("does not expose database messages for unknown failures", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [],
      error: { code: "XX000", message: "private values" },
    });
    await expect(
      withRpc(rpc).finishSession(
        user,
        session,
        { clientOperationId: input.clientOperationId, notes: null },
        { accessToken: "owner" },
      ),
    ).rejects.toThrow("Bouldering persistence unavailable");
  });

  it("passes an explicit project link and maps the linked row", async () => {
    const project = "00000000-0000-4000-8000-000000000005";
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...ascentRow(user), project_id: project }],
      error: null,
    });
    const ascent = await withRpc(rpc).createAscent(
      user,
      session,
      { ...input, result: "not_yet", attempts: null, projectId: project },
      { accessToken: "owner" },
    );
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_project: project });
    expect(ascent.projectId).toBe(project);
  });
});

const projectId = "00000000-0000-4000-8000-000000000005";
const projectRow = (userId: string, status = "sent") => ({
  id: projectId,
  user_id: userId,
  grade_scale: "font",
  grade_code: "6B",
  grade_rank: 7,
  hold_colour: "blue",
  status,
  first_logged_at: "2026-10-01T10:00:00.000Z",
  sent_at: status === "sent" ? "2026-10-16T10:00:00.000Z" : null,
  sent_ascent_id:
    status === "sent" ? "00000000-0000-4000-8000-000000000004" : null,
  revision: 3,
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-16T10:00:00.000Z",
});

/** Records every builder call per table and resolves with the table's result. */
const fakeClient = (
  results: Record<string, { data: unknown; error: unknown }>,
) => {
  const calls: [string, string, unknown[]][] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "range"])
      builder[method] = (...args: unknown[]) => {
        calls.push([table, method, args]);
        return builder;
      };
    builder.then = (resolve: (value: unknown) => unknown) =>
      resolve(results[table] ?? { data: [], error: null });
    return builder;
  };
  return {
    calls,
    repo: new SupabaseBoulderingRepository(
      () => ({ from }) as unknown as RepositorySupabaseClient,
    ),
  };
};

describe("SupabaseBoulderingRepository projects", () => {
  it("lists owner projects by status with their linked boulders, bounded", async () => {
    const { calls, repo } = fakeClient({
      boulder_projects: { data: [projectRow(user)], error: null },
      boulder_ascents: {
        data: [{ ...ascentRow(user), project_id: projectId }],
        error: null,
      },
    });
    const listed = await repo.listProjects(user, {
      accessToken: "owner",
      status: "sent",
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.project).toMatchObject({
      id: projectId,
      grade: "6B",
      status: "sent",
      sentAscentId: "00000000-0000-4000-8000-000000000004",
    });
    expect(listed[0]?.project.sentAt?.toISOString()).toBe(
      "2026-10-16T10:00:00.000Z",
    );
    expect(listed[0]?.ascents.map((a) => a.projectId)).toEqual([projectId]);
    expect(calls).toContainEqual(["boulder_projects", "eq", ["user_id", user]]);
    expect(calls).toContainEqual([
      "boulder_projects",
      "eq",
      ["status", "sent"],
    ]);
    expect(calls).toContainEqual(["boulder_projects", "limit", [500]]);
    expect(calls).toContainEqual([
      "boulder_ascents",
      "in",
      ["project_id", [projectId]],
    ]);
  });

  it("does not filter status for all and skips ascents when nothing is listed", async () => {
    const { calls, repo } = fakeClient({});
    await expect(
      repo.listProjects(user, { accessToken: "owner", status: "all" }),
    ).resolves.toEqual([]);
    expect(
      calls.some(
        ([table, method, args]) =>
          table === "boulder_projects" &&
          method === "eq" &&
          args[0] === "status",
      ),
    ).toBe(false);
    expect(calls.some(([table]) => table === "boulder_ascents")).toBe(false);
  });

  it("rejects a project row owned by another user", async () => {
    const { repo } = fakeClient({
      boulder_projects: { data: [projectRow(other)], error: null },
    });
    await expect(
      repo.listProjects(user, { accessToken: "owner", status: "all" }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("hides database messages when a projects read fails", async () => {
    const { repo } = fakeClient({
      boulder_projects: { data: null, error: { message: "private" } },
    });
    await expect(
      repo.listProjects(user, { accessToken: "owner", status: "open" }),
    ).rejects.toThrow("Bouldering projects unavailable");
  });

  it("archives through the RPC and maps conflicts and absence", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [projectRow(user, "archived")], error: null });
    const archived = await withRpc(rpc).setProjectArchived(
      user,
      projectId,
      true,
      { accessToken: "owner" },
    );
    expect(rpc).toHaveBeenCalledWith("boulder_project_set_archived", {
      p_id: projectId,
      p_archived: true,
    });
    expect(archived).toMatchObject({ status: "archived", sentAt: null });
    for (const [code, kind] of [
      ["PT409", "conflict"],
      ["P0002", "not_found"],
    ]) {
      const failing = vi.fn().mockResolvedValue({
        data: [],
        error: { code, message: "boulder" },
      });
      await expect(
        withRpc(failing).setProjectArchived(user, projectId, true, {
          accessToken: "owner",
        }),
      ).rejects.toMatchObject({ kind });
    }
    const foreign = vi
      .fn()
      .mockResolvedValue({ data: [projectRow(other, "open")], error: null });
    await expect(
      withRpc(foreign).setProjectArchived(user, projectId, false, {
        accessToken: "owner",
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});
