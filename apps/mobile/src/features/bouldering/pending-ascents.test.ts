import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { boulderAscentCreateSchema } from "@mizyun/contracts";

import {
  createBoulderPendingStore,
  flushBoulderCommands,
  MAX_PENDING_BOULDER_COMMANDS,
  type BoulderPendingCommand,
} from "./pending-ascents";

const SESSION = "33333333-3333-4333-8333-333333333333";
const ASCENT = "22222222-2222-4222-8222-222222222222";
let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const user = () => `user-${uuid()}`;

const backend = () => {
  const map = new Map<string, string>();
  const log: string[] = [];
  return {
    map,
    log,
    failWrites: false,
    async getItemAsync(key: string) {
      return map.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      if (this.failWrites) throw new Error("keychain unavailable");
      log.push(`write:${key}`);
      map.set(key, value);
    },
    async deleteItemAsync(key: string) {
      map.delete(key);
    },
  };
};

const create = (op = uuid()): BoulderPendingCommand => ({
  kind: "create",
  sessionId: SESSION,
  // Parsed through the contract, so the canonical shape tracks the schema.
  body: boulderAscentCreateSchema.parse({
    clientOperationId: op,
    grade: "6A",
    result: "flash",
    attempts: 1,
  }),
  queuedAt: "2026-10-16T10:00:00.000Z",
});

const ascentRecord = (op: string) => ({
  id: ASCENT,
  sessionId: SESSION,
  sequence: 1,
  gradeScale: "font",
  grade: "6A",
  gradeRank: 5,
  result: "flash",
  attempts: 1,
  holdColour: null,
  note: null,
  photoAssetId: null,
  projectId: null,
  loggedAt: "2026-10-16T10:00:00.000Z",
  revision: 1,
  createdAt: "2026-10-16T10:00:00.000Z",
  updatedAt: "2026-10-16T10:00:00.000Z",
  _op: op,
});

const clientWith = (
  respond: (options: any) => unknown,
  log: string[] = [],
): ApiClient & { request: ReturnType<typeof vi.fn> } =>
  ({
    status: () => ({ configured: true, baseUrl: "https://example.test" }),
    request: vi.fn(async (options: any) => {
      log.push(
        `send:${options.method}:${options.body?.clientOperationId ?? ""}`,
      );
      return respond(options);
    }),
  }) as any;

const ok = (value: unknown) => ({ ok: true, value });
const httpError = (status: number, code: string) => ({
  ok: false,
  error: { kind: "http_error", status, code, message: code },
});

describe("pending ascent store", () => {
  it("persists the command before it is sent and clears it after success", async () => {
    const storage = backend();
    const store = createBoulderPendingStore(storage);
    const owner = user();
    const command = create();
    const op = (command as any).body.clientOperationId;
    expect((await store.enqueue(owner, command, () => true)).ok).toBe(true);
    const client = clientWith(() => {
      // The durable copy already exists when the request leaves.
      expect(
        storage.map.get(`mizyun.logging-draft.${owner}.bouldering`),
      ).toContain(op);
      return ok({ ascent: ascentRecord(op) });
    }, storage.log);
    const outcome = await flushBoulderCommands(owner, {
      client,
      isCurrent: () => true,
      store,
    });
    expect(storage.log[0]).toBe(
      `write:mizyun.logging-draft.${owner}.bouldering`,
    );
    expect(storage.log[1]).toBe(`send:POST:${op}`);
    expect(outcome.synced).toHaveLength(1);
    expect(outcome.blocked).toBeNull();
    expect((await store.load(owner)).commands).toEqual([]);
  });

  it("reports a storage failure so nothing is sent", async () => {
    const storage = backend();
    storage.failWrites = true;
    const store = createBoulderPendingStore(storage);
    const result = await store.enqueue(user(), create(), () => true);
    expect(result).toEqual({ ok: false, reason: "storage" });
  });

  it("replays the same operation after an app restart (new store instance)", async () => {
    const storage = backend();
    const owner = user();
    const command = create();
    await createBoulderPendingStore(storage).enqueue(
      owner,
      command,
      () => true,
    );
    // App killed before the response: offline first attempt keeps the command.
    const offline = clientWith(() => ({
      ok: false,
      error: { kind: "network_error", cause: new Error("offline") },
    }));
    const first = await flushBoulderCommands(owner, {
      client: offline,
      isCurrent: () => true,
      store: createBoulderPendingStore(storage),
    });
    expect(first.blocked?.kind).toBe("offline");
    expect(first.remaining).toHaveLength(1);

    const restarted = createBoulderPendingStore(storage);
    expect((await restarted.load(owner)).commands).toEqual([command]);
    const online = clientWith((options) =>
      ok({ ascent: ascentRecord(options.body.clientOperationId) }),
    );
    const second = await flushBoulderCommands(owner, {
      client: online,
      isCurrent: () => true,
      store: restarted,
    });
    expect(online.request).toHaveBeenCalledTimes(1);
    expect(online.request.mock.calls[0]![0].body.clientOperationId).toBe(
      (command as any).body.clientOperationId,
    );
    expect(second.synced).toHaveLength(1);
  });

  it("drops a command answered 410 BOULDER_REMOVED or 409 CONFLICT with a notice", async () => {
    const storage = backend();
    const store = createBoulderPendingStore(storage);
    const owner = user();
    await store.enqueue(owner, create(), () => true);
    await store.enqueue(
      owner,
      {
        kind: "update",
        sessionId: SESSION,
        ascentId: ASCENT,
        replacedPhotoAssetId: null,
        queuedAt: "2026-10-16T10:00:00.000Z",
        body: {
          clientOperationId: uuid(),
          expectedRevision: 1,
          grade: "6B",
          result: "sent",
          attempts: 2,
          holdColour: null,
          note: null,
          photoAssetId: null,
        },
      },
      () => true,
    );
    const responses = [
      httpError(410, "BOULDER_REMOVED"),
      httpError(409, "CONFLICT"),
    ];
    const client = clientWith(() => responses.shift());
    const outcome = await flushBoulderCommands(owner, {
      client,
      isCurrent: () => true,
      store,
    });
    expect(outcome.dropped.map((d) => d.failure.kind)).toEqual([
      "removed",
      "conflict",
    ]);
    expect(outcome.blocked).toBeNull();
    expect((await store.load(owner)).commands).toEqual([]);
  });

  it("keeps commands on a disabled feature or server outage", async () => {
    const storage = backend();
    const store = createBoulderPendingStore(storage);
    const owner = user();
    await store.enqueue(owner, create(), () => true);
    const outcome = await flushBoulderCommands(owner, {
      client: clientWith(() => httpError(503, "FEATURE_DISABLED")),
      isCurrent: () => true,
      store,
    });
    expect(outcome.blocked?.kind).toBe("disabled");
    expect((await store.load(owner)).commands).toHaveLength(1);
  });

  it("never sends or shows another account's pending commands", async () => {
    const storage = backend();
    const store = createBoulderPendingStore(storage);
    const alice = user();
    const bob = user();
    await store.enqueue(alice, create(), () => true);
    expect((await store.load(bob)).commands).toEqual([]);
    const client = clientWith(() => ok({ ascent: ascentRecord("x") }));
    const outcome = await flushBoulderCommands(bob, {
      client,
      isCurrent: () => true,
      store,
    });
    expect(client.request).not.toHaveBeenCalled();
    expect(outcome.synced).toEqual([]);
    expect((await store.load(alice)).commands).toHaveLength(1);
  });

  it("stops without consuming the command when the account changes mid-send", async () => {
    const storage = backend();
    const store = createBoulderPendingStore(storage);
    const owner = user();
    await store.enqueue(owner, create(), () => true);
    let current = true;
    const client = clientWith(() => {
      current = false; // Sign-out/switch while the request is in flight.
      return ok({ ascent: ascentRecord("x") });
    });
    const outcome = await flushBoulderCommands(owner, {
      client,
      isCurrent: () => current,
      store,
    });
    expect(outcome.blocked?.kind).toBe("context_changed");
    expect((await store.load(owner)).commands).toHaveLength(1);
  });

  it("refuses to enqueue for a retired account", async () => {
    const store = createBoulderPendingStore(backend());
    expect(await store.enqueue(user(), create(), () => false)).toEqual({
      ok: false,
      reason: "account",
    });
  });

  it("bounds the queue", async () => {
    const store = createBoulderPendingStore(backend());
    const owner = user();
    for (let i = 0; i < MAX_PENDING_BOULDER_COMMANDS; i++)
      expect((await store.enqueue(owner, create(), () => true)).ok).toBe(true);
    expect(await store.enqueue(owner, create(), () => true)).toEqual({
      ok: false,
      reason: "full",
    });
  });

  it("never overwrites an unreadable slot", async () => {
    const storage = backend();
    const owner = user();
    const key = `mizyun.logging-draft.${owner}.bouldering`;
    storage.map.set(key, '{"version":99}');
    const store = createBoulderPendingStore(storage);
    await expect(store.load(owner)).rejects.toThrow();
    expect(await store.enqueue(owner, create(), () => true)).toEqual({
      ok: false,
      reason: "storage",
    });
    expect(storage.map.get(key)).toBe('{"version":99}');
  });

  it("deletes the media of a deleted boulder after the delete syncs", async () => {
    const storage = backend();
    const store = createBoulderPendingStore(storage);
    const owner = user();
    const photo = uuid();
    await store.enqueue(
      owner,
      {
        kind: "delete",
        sessionId: SESSION,
        ascentId: ASCENT,
        operationId: uuid(),
        photoAssetId: photo,
        queuedAt: "2026-10-16T10:00:00.000Z",
      },
      () => true,
    );
    const orphan = vi.fn();
    await flushBoulderCommands(owner, {
      client: clientWith(() => ok({ removed: true })),
      isCurrent: () => true,
      store,
      onMediaOrphan: orphan,
    });
    expect(orphan).toHaveBeenCalledWith(photo);
  });
});
