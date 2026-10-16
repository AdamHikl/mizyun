import { describe, expect, it, vi } from "vitest";
import {
  createImportedRunSummary,
  createRunSummary,
  type UserId,
} from "@mizyun/core";
import { SupabaseRunRepository } from "./run-repository.js";
import type { RepositorySupabaseClient } from "./index.js";
const user = "00000000-0000-4000-8000-000000000001" as UserId;
const input = {
  clientOperationId: "00000000-0000-4000-8000-000000000002",
  name: "Run",
  notes: null,
  summary: createRunSummary({
    activityDate: "2026-10-01",
    recordingTimezone: "UTC",
    startedAt: null,
    durationSeconds: 1800,
    distanceMeters: null,
    environment: "unspecified",
    perceivedExertion: null,
  }),
};
describe("SupabaseRunRepository", () => {
  it("uses one authenticated RPC for each atomic mutation and no direct row writes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const clientFor = vi.fn(
      () => ({ rpc }) as unknown as RepositorySupabaseClient,
    );
    const repo = new SupabaseRunRepository(clientFor);
    await repo.cancel(user, input.clientOperationId, { accessToken: "owner" });
    await repo.remove(user, input.clientOperationId, { accessToken: "owner" });
    expect(clientFor).toHaveBeenNthCalledWith(1, "owner");
    expect(rpc).toHaveBeenNthCalledWith(1, "run_cancel", {
      p_operation: input.clientOperationId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "run_remove", {
      p_id: input.clientOperationId,
    });
  });
  it.each([
    ["P0003", "removed"],
    ["PT409", "conflict"],
    ["40001", "conflict"],
    ["42501", "not_found"],
    ["22023", "invalid"],
  ])("maps %s without exposing health payloads", async (code, kind) => {
    const repo = new SupabaseRunRepository(
      () =>
        ({
          rpc: vi.fn().mockResolvedValue({
            data: [],
            error: { code, message: "private values" },
          }),
        }) as unknown as RepositorySupabaseClient,
    );
    await expect(
      repo.create(user, input, { accessToken: "owner" }),
    ).rejects.toMatchObject({ kind });
  });
  it("refuses unexpected-owner responses", async () => {
    const repo = new SupabaseRunRepository(
      () =>
        ({
          rpc: vi
            .fn()
            .mockResolvedValue({ data: [{ user_id: "other" }], error: null }),
        }) as unknown as RepositorySupabaseClient,
    );
    await expect(
      repo.create(user, input, { accessToken: "owner" }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
  const importInput = {
    clientOperationId: "00000000-0000-4000-8000-000000000005",
    name: "Run",
    notes: null,
    summary: createImportedRunSummary({
      provider: "health_connect",
      sourceAppId: "com.example.watch",
      sourceAppName: null,
      externalId: "hc-1",
      startedAt: "2026-10-01T06:00:00Z",
      recordingTimezone: "UTC",
      durationSeconds: 1800,
      durationBasis: "active",
      distanceMeters: null,
      environment: "outdoor",
    }),
  };
  const row = (operation: string) => ({
    id: "00000000-0000-4000-8000-000000000009",
    user_id: user,
    client_operation_id: operation,
    name: "Run",
    started_at: "2026-10-01T06:00:00+00:00",
    completed_at: "2026-10-01T06:30:00+00:00",
    notes: null,
    source: "health_import",
    details: {
      activityType: "running",
      workoutLifecycle: { kind: "session" },
      runSummary: importInput.summary,
    },
    created_at: "2026-10-01T07:00:00+00:00",
    updated_at: "2026-10-01T07:00:00+00:00",
  });
  it("imports through one RPC and distinguishes created from an existing copy", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [row(importInput.clientOperationId)],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [row("00000000-0000-4000-8000-000000000006")],
        error: null,
      });
    const repo = new SupabaseRunRepository(
      () => ({ rpc }) as unknown as RepositorySupabaseClient,
    );
    const created = await repo.importRun(user, importInput, {
      accessToken: "owner",
    });
    expect(created.created).toBe(true);
    expect(rpc).toHaveBeenCalledWith("run_import", {
      p_operation: importInput.clientOperationId,
      p_name: "Run",
      p_summary: importInput.summary,
    });
    const existing = await repo.importRun(user, importInput, {
      accessToken: "owner",
    });
    expect(existing.created).toBe(false);
    expect(existing.workout.id).toBe(row("").id);
  });
  it.each([
    ["P0003", "removed"],
    ["PT409", "conflict"],
    ["23505", "conflict"],
    ["22023", "invalid"],
    ["P0002", "not_found"],
  ])("maps import error %s to %s", async (code, kind) => {
    const repo = new SupabaseRunRepository(
      () =>
        ({
          rpc: vi.fn().mockResolvedValue({
            data: [],
            error: { code, message: "private values" },
          }),
        }) as unknown as RepositorySupabaseClient,
    );
    await expect(
      repo.importRun(user, importInput, { accessToken: "owner" }),
    ).rejects.toMatchObject({ kind });
  });
  it("refuses another owner's import response", async () => {
    const repo = new SupabaseRunRepository(
      () =>
        ({
          rpc: vi.fn().mockResolvedValue({
            data: [{ ...row(importInput.clientOperationId), user_id: "other" }],
            error: null,
          }),
        }) as unknown as RepositorySupabaseClient,
    );
    await expect(
      repo.importRun(user, importInput, { accessToken: "owner" }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
  it("lists manual runs by default and imports only on request", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repo = new SupabaseRunRepository(
      () => ({ rpc }) as unknown as RepositorySupabaseClient,
    );
    await repo.list(user, { limit: 10, accessToken: "owner" });
    await repo.list(user, {
      limit: 10,
      accessToken: "owner",
      includeImports: true,
    });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_include_imports: false });
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_include_imports: true });
  });
});
