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
});
