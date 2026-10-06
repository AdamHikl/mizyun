import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { sendRunCommand, isRunDraft, type RunDraft } from "./run-draft";
const body = {
  clientOperationId: "11111111-1111-4111-8111-111111111111",
  activityDate: "2026-10-01",
  recordingTimezone: "Europe/Bratislava",
  startedAt: null,
  durationSeconds: 1500,
  distanceMeters: null,
  environment: "treadmill" as const,
  perceivedExertion: null,
  name: "Run",
  notes: null,
};
const draft: RunDraft = {
  version: 1,
  form: {
    activityDate: body.activityDate,
    recordingTimezone: body.recordingTimezone,
    minutes: "25",
    seconds: "0",
    distance: "",
    unit: "km",
    environment: "treadmill",
    effort: "",
    notes: "",
  },
  editingRunId: null,
  expectedRevision: null,
  pending: { kind: "create", body },
};
const client = (
  request: unknown = vi.fn(async () => ({
    ok: false,
    error: { kind: "network_error", cause: "lost response" },
  })),
) =>
  ({
    request,
    status: () => ({ configured: false, reason: "fixture" }),
  }) as unknown as ApiClient;
const store = () => ({
  load: vi.fn(async () => draft),
  save: vi.fn(async (_userId: string, _draft: RunDraft) => true),
  clear: vi.fn(async () => true),
});
describe("durable running mutations", () => {
  it("does not transmit when encrypted draft persistence fails", async () => {
    const storage = store();
    storage.save.mockResolvedValue(false);
    const api = client();
    const result = await sendRunCommand(
      "owner-a",
      draft,
      api,
      () => true,
      storage,
    );
    expect(result.ok).toBe(false);
    expect(api.request).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
  });
  it("replays the same operation and exact payload after a lost response and restart", async () => {
    const storage = store();
    const request = vi.fn(async () => ({
      ok: false,
      error: { kind: "network_error", cause: "lost response" },
    }));
    await sendRunCommand(
      "owner-a",
      draft,
      client(request),
      () => true,
      storage,
    );
    const restored = JSON.parse(JSON.stringify(draft)) as RunDraft;
    await sendRunCommand(
      "owner-a",
      restored,
      client(request),
      () => true,
      storage,
    );
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    expect(storage.clear).not.toHaveBeenCalled();
    expect(storage.save.mock.calls[0]?.[0]).toBe("owner-a");
  });
  it("does not dispatch when account switches during persistence", async () => {
    let active = true;
    const storage = store();
    storage.save.mockImplementation(async () => {
      active = false;
      return true;
    });
    const api = client();
    await sendRunCommand("owner-a", draft, api, () => active, storage);
    expect(api.request).not.toHaveBeenCalled();
  });
  it("does not consume late success or clear the original draft after account switch", async () => {
    let active = true;
    const storage = store();
    const request = vi.fn(async () => {
      active = false;
      return { ok: true, value: { run: { id: "accepted" } } };
    });
    const result = await sendRunCommand(
      "owner-a",
      draft,
      client(request),
      () => active,
      storage,
    );
    expect(result.ok).toBe(false);
    expect(storage.clear).not.toHaveBeenCalled();
  });
  it("cancels a pending create with the original operation and can retry after restart", async () => {
    const storage = store();
    const cancel = {
      ...draft,
      pending: { kind: "cancel" as const, operationId: body.clientOperationId },
    };
    const request = vi.fn(async () => ({
      ok: false,
      error: { kind: "network_error", cause: "lost response" },
    }));
    await sendRunCommand(
      "owner-a",
      cancel,
      client(request),
      () => true,
      storage,
    );
    await sendRunCommand(
      "owner-a",
      JSON.parse(JSON.stringify(cancel)),
      client(request),
      () => true,
      storage,
    );
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    expect(
      (request.mock.calls[0] as unknown as [{ path: string }])[0].path,
    ).toBe(`/v1/runs/operations/${body.clientOperationId}`);
    expect(storage.save).toHaveBeenCalledWith("owner-a", cancel);
  });
  it("retires late create success after an in-flight cancellation supersedes it", async () => {
    let finish!: (v: unknown) => void;
    let generation = 1;
    const storage = store();
    const api = client(
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ) as never,
    );
    const create = sendRunCommand(
      "owner-a",
      draft,
      api,
      () => generation === 1,
      storage,
    );
    await Promise.resolve();
    await Promise.resolve();
    generation = 2;
    finish({ ok: true, value: { run: { id: "late" } } });
    expect((await create).ok).toBe(false);
    expect(storage.clear).not.toHaveBeenCalled();
  });
  it("retains compare-and-swap revision on conflict", async () => {
    const storage = store();
    const edit = {
      ...draft,
      editingRunId: "run-id",
      expectedRevision: 3,
      pending: {
        kind: "edit" as const,
        runId: "run-id",
        body: { ...body, expectedRevision: 3 },
      },
    };
    const request = vi.fn(async () => ({
      ok: false,
      error: {
        kind: "http_error",
        status: 409,
        code: "run_conflict",
        message: "Conflict",
      },
    }));
    const result = await sendRunCommand(
      "owner-a",
      edit,
      client(request) as ApiClient,
      () => true,
      storage,
    );
    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(storage.clear).not.toHaveBeenCalled();
    expect(
      (
        request.mock.calls[0] as unknown as [
          { body: { expectedRevision: number } },
        ]
      )[0].body.expectedRevision,
    ).toBe(3);
  });
  it("rejects corrupt pending requests when restoring secure storage", () => {
    expect(isRunDraft(draft)).toBe(true);
    expect(
      isRunDraft({
        ...draft,
        pending: { kind: "create", body: { ...body, durationSeconds: 0 } },
      }),
    ).toBe(false);
  });
});
