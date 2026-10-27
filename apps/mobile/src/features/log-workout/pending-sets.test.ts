import { describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiError } from "@mizyun/api-client";
import type { WorkoutSet } from "@mizyun/contracts";

import {
  createPendingSetStore,
  flushPendingSets,
  MAX_PENDING_SETS,
  mergePendingSets,
  pendingSetCommand,
  pendingSetsNotice,
  type PendingSetCommand,
} from "./pending-sets";

const WORKOUT = "33333333-3333-4333-8333-333333333333";
const EXERCISE = "44444444-4444-4444-8444-444444444444";
let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const user = () => `user-${uuid()}`;
const always = () => true;

const backend = () => {
  const map = new Map<string, string>();
  return {
    map,
    failWrites: false,
    async getItemAsync(key: string) {
      return map.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      if (this.failWrites) throw new Error("keychain unavailable");
      map.set(key, value);
    },
    async deleteItemAsync(key: string) {
      map.delete(key);
    },
  };
};

const command = (
  sequence: number,
  op = uuid(),
  completedAt = `2026-10-27T10:0${sequence}:00.000Z`,
): PendingSetCommand =>
  pendingSetCommand(
    WORKOUT,
    {
      exerciseId: EXERCISE,
      sequence,
      repetitions: 5,
      loadKg: 100,
      completedAt,
    },
    op,
    new Date("2026-10-27T10:00:00.000Z"),
  )!;

/**
 * An API double with server-side retry identity: a replayed operation id
 * returns the row it already saved. `drop` loses the response after saving
 * (the lost-response failure); `offline` fails before anything is sent.
 */
const server = () => {
  const rows = new Map<string, WorkoutSet>();
  const state = {
    rows,
    offline: false as boolean | ApiError,
    drop: 0,
    sent: [] as unknown[],
  };
  const client = {
    status: () => ({ configured: true, baseUrl: "https://example.test" }),
    request: vi.fn(async (options: any) => {
      if (state.offline)
        return {
          ok: false,
          error:
            state.offline === true
              ? { kind: "network_error", cause: new Error("offline") }
              : state.offline,
        };
      state.sent.push(options.body);
      const op = options.body.clientOperationId as string;
      let row = rows.get(op);
      if (!row) {
        row = {
          id: uuid(),
          userId: "server-user",
          workoutId: WORKOUT,
          exerciseId: options.body.exerciseId,
          sequence: options.body.sequence,
          setType: "normal",
          repetitions: options.body.repetitions ?? null,
          loadKg: options.body.loadKg ?? null,
          durationSeconds: null,
          distanceMeters: null,
          perceivedExertion: null,
          completedAt: options.body.completedAt,
          createdAt: "2026-10-27T10:10:00.000Z",
        };
        rows.set(op, row);
      }
      if (state.drop > 0) {
        state.drop--;
        return {
          ok: false,
          error: { kind: "network_error", cause: new Error("lost") },
        };
      }
      return { ok: true, value: { workoutSet: row } };
    }),
  } as unknown as ApiClient & { request: ReturnType<typeof vi.fn> };
  return { client, state };
};

describe("pending live-workout sets (REL-02)", () => {
  it("replays a set whose response was lost without saving it twice", async () => {
    const id = user();
    const store = createPendingSetStore(backend());
    const { client, state } = server();
    const set = command(1);
    expect(await store.enqueue(id, set, always)).toEqual({ ok: true });

    state.drop = 1;
    const lost = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store,
    });
    expect(lost.synced).toEqual([]);
    expect(lost.blocked).toMatchObject({ kind: "network_error" });
    expect(lost.remaining).toEqual([set]);
    expect(state.rows.size).toBe(1);

    const replay = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store,
    });
    expect(replay.blocked).toBeNull();
    expect(replay.synced).toHaveLength(1);
    expect(state.rows.size).toBe(1);
    // Both sends carried the same operation id.
    expect(state.sent.map((b: any) => b.clientOperationId as string)).toEqual([
      set.body.clientOperationId,
      set.body.clientOperationId,
    ]);
    expect((await store.load(id)).commands).toEqual([]);
  });

  it("keeps sets in order while offline and sends them in order on reconnect", async () => {
    const id = user();
    const store = createPendingSetStore(backend());
    const { client, state } = server();
    const sets = [command(1), command(2), command(3)];
    for (const set of sets) await store.enqueue(id, set, always);

    state.offline = true;
    const offline = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store,
    });
    expect(offline.remaining).toEqual(sets);
    expect(offline.dropped).toEqual([]);
    expect(pendingSetsNotice(3, offline.blocked)).toBe(
      "3 sets are saved on this device and will sync when you're back online.",
    );

    state.offline = false;
    const online = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store,
    });
    expect(online.remaining).toEqual([]);
    expect(online.synced.map((s) => s.workoutSet?.sequence)).toEqual([1, 2, 3]);
  });

  it("stops at the first failure so a later set never overtakes an earlier one", async () => {
    const id = user();
    const store = createPendingSetStore(backend());
    const { client } = server();
    const sets = [command(1), command(2)];
    for (const set of sets) await store.enqueue(id, set, always);
    client.request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "http_error", status: 503, code: "X", message: "busy" },
    });
    const outcome = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store,
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(outcome.remaining).toEqual(sets);
  });

  it("keeps pending sets across an app restart and shows them before they sync", async () => {
    const id = user();
    const disk = backend();
    const set = command(1);
    await createPendingSetStore(disk).enqueue(id, set, always);

    // A fresh store over the same device storage models a cold start.
    const restarted = createPendingSetStore(disk);
    const { commands } = await restarted.load(id);
    expect(commands).toEqual([set]);
    const shown = mergePendingSets([], commands, WORKOUT, id);
    expect(shown).toEqual([
      expect.objectContaining({
        id: set.body.clientOperationId,
        sequence: 1,
        repetitions: 5,
        loadKg: 100,
      }),
    ]);

    const { client } = server();
    const outcome = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store: restarted,
    });
    expect(outcome.synced).toHaveLength(1);
    expect((await restarted.load(id)).commands).toEqual([]);
  });

  it("keeps sets waiting when Auth cannot refresh or the user is signed out", async () => {
    const id = user();
    const store = createPendingSetStore(backend());
    const { client, state } = server();
    const set = command(1);
    await store.enqueue(id, set, always);
    for (const error of [
      { kind: "network_error", cause: new Error("refresh unreachable") },
      { kind: "no_session" },
      { kind: "session_expired" },
      { kind: "context_changed" },
      { kind: "http_error", status: 503, code: "AUTHENTICATION_UNAVAILABLE" },
    ] as ApiError[]) {
      state.offline = error;
      const outcome = await flushPendingSets(id, {
        client,
        isCurrent: always,
        store,
      });
      expect(outcome.remaining).toEqual([set]);
      expect(outcome.dropped).toEqual([]);
    }
    expect(pendingSetsNotice(1, { kind: "no_session" })).toBe(
      "1 set is saved on this device. Sign in to sync it.",
    );
    state.offline = false;
    expect(
      (await flushPendingSets(id, { client, isCurrent: always, store })).synced,
    ).toHaveLength(1);
  });

  it("discards only sets the server can never accept, and reports them", async () => {
    const id = user();
    const store = createPendingSetStore(backend());
    const { client } = server();
    const gone = command(1);
    const conflict = command(2);
    const kept = command(3);
    for (const set of [gone, conflict, kept])
      await store.enqueue(id, set, always);
    client.request
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "http_error", status: 404, code: "NOT_FOUND" },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "http_error", status: 409, code: "CONFLICT" },
      });
    const outcome = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store,
    });
    expect(outcome.dropped.map((d) => d.command)).toEqual([gone, conflict]);
    expect(outcome.synced.map((s) => s.command)).toEqual([kept]);
  });

  it("keeps a set waiting on a proxy's bare 404 and stops resending a saved set with an unreadable reply", async () => {
    const id = user();
    const store = createPendingSetStore(backend());
    const { client } = server();
    const saved = command(1);
    const later = command(2);
    await store.enqueue(id, saved, always);
    await store.enqueue(id, later, always);
    client.request.mockResolvedValueOnce({
      ok: false,
      // A non-JSON 404 from a proxy during a deploy is not our API's answer.
      error: { kind: "http_error", status: 404, code: "INTERNAL_ERROR" },
    });
    const proxy = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store,
    });
    expect(proxy.dropped).toEqual([]);
    expect(proxy.remaining).toEqual([saved, later]);

    client.request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "validation_error", issues: [] },
    });
    const outcome = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store,
    });
    expect(outcome.dropped).toEqual([]);
    expect(outcome.synced).toEqual([
      { command: saved, workoutSet: null },
      expect.objectContaining({ command: later }),
    ]);
    expect((await store.load(id)).commands).toEqual([]);
  });

  it("resends without the key to an API that predates set retry identity", async () => {
    const id = user();
    const store = createPendingSetStore(backend());
    const set = command(1);
    await store.enqueue(id, set, always);
    const { client } = server();
    client.request.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "http_error",
        status: 422,
        code: "VALIDATION_ERROR",
        message:
          "Invalid workout set create: <root>: Unrecognized key(s) in object: 'clientOperationId'",
      },
    });
    const outcome = await flushPendingSets(id, {
      client,
      isCurrent: always,
      store,
    });
    expect(outcome.synced).toHaveLength(1);
    const keyless = client.request.mock.calls[1]![0].body;
    expect(keyless).not.toHaveProperty("clientOperationId");
    // The server picks the next free sequence, so it cannot collide.
    expect(keyless).not.toHaveProperty("sequence");
  });

  it("never sends another account's sets or continues after an account change", async () => {
    const alice = user();
    const bob = user();
    const store = createPendingSetStore(backend());
    await store.enqueue(alice, command(1), always);
    const { client } = server();
    let current = true;
    client.request.mockImplementationOnce(async () => {
      current = false;
      return {
        ok: false,
        error: { kind: "network_error", cause: new Error("x") },
      };
    });
    const outcome = await flushPendingSets(alice, {
      client,
      isCurrent: () => current,
      store,
    });
    expect(outcome.blocked).toEqual({ kind: "context_changed" });
    expect((await store.load(alice)).commands).toHaveLength(1);
    expect(
      (await flushPendingSets(bob, { client, isCurrent: always, store }))
        .synced,
    ).toEqual([]);
  });

  it("never overwrites an unreadable slot and bounds the queue", async () => {
    const id = user();
    const disk = backend();
    const store = createPendingSetStore(disk);
    for (let i = 1; i <= MAX_PENDING_SETS; i++)
      expect(
        await store.enqueue(
          id,
          command(
            i,
            uuid(),
            new Date(Date.UTC(2026, 9, 27, 10, i)).toISOString(),
          ),
          always,
        ),
      ).toEqual({ ok: true });
    expect(
      await store.enqueue(
        id,
        command(MAX_PENDING_SETS + 1, uuid(), "2026-10-27T12:00:00.000Z"),
        always,
      ),
    ).toEqual({ ok: false, reason: "full" });

    const key = [...disk.map.keys()][0]!;
    disk.map.set(key, "{not json");
    await expect(store.load(id)).rejects.toThrow();
    expect(await store.enqueue(id, command(1), always)).toEqual({
      ok: false,
      reason: "storage",
    });
    expect(disk.map.get(key)).toBe("{not json");
    const { client } = server();
    expect(
      (await flushPendingSets(id, { client, isCurrent: always, store }))
        .blocked,
    ).toBe("storage");
    expect(client.request).not.toHaveBeenCalled();
  });

  it("reports a failed device write instead of pretending the set was saved", async () => {
    const id = user();
    const disk = backend();
    disk.failWrites = true;
    expect(
      await createPendingSetStore(disk).enqueue(id, command(1), always),
    ).toEqual({ ok: false, reason: "storage" });
  });

  it("shows a pending set once when the server already has it under a new sequence", () => {
    const id = user();
    const set = command(2);
    const saved: WorkoutSet = {
      id: "server-row",
      userId: id,
      workoutId: WORKOUT,
      exerciseId: EXERCISE,
      sequence: 3,
      setType: "normal",
      repetitions: 5,
      loadKg: 100,
      durationSeconds: null,
      distanceMeters: null,
      perceivedExertion: null,
      completedAt: set.body.completedAt!,
      createdAt: "2026-10-27T10:10:00.000Z",
    };
    expect(mergePendingSets([saved], [set], WORKOUT, id)).toEqual([saved]);
    const otherWorkout = { ...set, workoutId: uuid() };
    expect(mergePendingSets([], [otherWorkout], WORKOUT, id)).toEqual([]);
  });
});
