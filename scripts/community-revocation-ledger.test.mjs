import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  chmodSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import {
  exportRevocations,
  parseJournal,
  digest,
  validateEvent,
} from "./community-revocation-ledger.mjs";

const event = {
  event_id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  kind: "withdrawal",
  generation: 1,
  target_id: null,
  related_user_id: null,
  created_at: "2026-10-08T12:00:00.000Z",
};
function fixture(t) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "community-ledger-test-")),
  );
  chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const encryption = (bytes) =>
  Buffer.concat([Buffer.from("synthetic-encrypted:"), bytes]);
function options(directory, rpc) {
  return {
    directory,
    rpc,
    environment: "dev",
    recipient: "synthetic",
    encrypt: encryption,
  };
}

test("durably writes ciphertext and chain before acknowledging; retry after lost ACK deduplicates", async (t) => {
  const directory = fixture(t);
  let fail = true;
  const rpc = async (name, args) => {
    if (name === "community_revocation_pending") return [event];
    assert.equal(name, "community_revocation_ack");
    assert.deepEqual(args.p_event_ids, [event.event_id]);
    const journal = readFileSync(join(directory, "journal.jsonl"));
    assert.equal(args.p_checkpoint, digest(journal));
    assert.equal(parseJournal(journal, "dev").seen.size, 1);
    assert.ok(readFileSync(join(directory, event.event_id + ".age")).length);
    if (fail) throw new Error("lost response");
  };
  await assert.rejects(
    exportRevocations(options(directory, rpc)),
    /lost response/,
  );
  const before = readFileSync(join(directory, "journal.jsonl"));
  fail = false;
  const result = await exportRevocations(options(directory, rpc));
  assert.deepEqual(readFileSync(join(directory, "journal.jsonl")), before);
  assert.equal(result.exported, 1);
  assert.equal(result.completenessCertified, false);
  assert.equal(result.reopenPermitted, false);
});
test("late-committing older event is exported because pending reads use ACK state", async (t) => {
  const directory = fixture(t);
  let batch = [event];
  const rpc = async (name) =>
    name === "community_revocation_pending" ? batch : null;
  await exportRevocations(options(directory, rpc));
  batch = [
    {
      ...event,
      event_id: "33333333-3333-4333-8333-333333333333",
      created_at: "2026-10-07T12:00:00Z",
    },
  ];
  const result = await exportRevocations(options(directory, rpc));
  assert.equal(result.retainedEvents, 2);
  assert.equal(
    parseJournal(readFileSync(join(directory, "journal.jsonl")), "dev").seen
      .size,
    2,
  );
});
test("ciphertext corruption or changed immutable event prevents ACK", async (t) => {
  const directory = fixture(t);
  let batch = [event];
  let acks = 0;
  const rpc = async (name) =>
    name === "community_revocation_pending" ? batch : ++acks;
  await exportRevocations(options(directory, rpc));
  batch = [{ ...event, generation: 2 }];
  await assert.rejects(exportRevocations(options(directory, rpc)), /mismatch/);
  batch = [event];
  writeFileSync(join(directory, event.event_id + ".age"), "corrupt", {
    mode: 0o600,
  });
  await assert.rejects(exportRevocations(options(directory, rpc)), /mismatch/);
  assert.equal(acks, 1);
});
test("partial journal and wrong environment fail closed before reading RPC", async (t) => {
  const directory = fixture(t);
  const rpc = async () => {
    throw new Error("RPC must not run");
  };
  writeFileSync(join(directory, "journal.jsonl"), "{", { mode: 0o600 });
  await assert.rejects(
    exportRevocations(options(directory, rpc)),
    /Incomplete/,
  );
  assert.throws(() => parseJournal(Buffer.alloc(0), "unknown"), /environment/);
});
test("encryption failure leaves event unacknowledged and no plaintext file", async (t) => {
  const directory = fixture(t);
  let acks = 0;
  const rpc = async (name) =>
    name === "community_revocation_pending" ? [event] : ++acks;
  await assert.rejects(
    exportRevocations({
      ...options(directory, rpc),
      encrypt: () => {
        throw new Error("encryption offline");
      },
    }),
    /offline/,
  );
  assert.equal(acks, 0);
  assert.deepEqual(readdirSync(directory), []);
});
test("private target, symlinks and concurrent writer locks are rejected", async (t) => {
  const directory = fixture(t);
  let calls = 0;
  const rpc = async () => {
    calls++;
    return [];
  };
  chmodSync(directory, 0o755);
  await assert.rejects(exportRevocations(options(directory, rpc)), /private/);
  chmodSync(directory, 0o700);
  writeFileSync(join(directory, ".writer-lock"), "", { mode: 0o600 });
  await assert.rejects(exportRevocations(options(directory, rpc)), /EEXIST/);
  rmSync(join(directory, ".writer-lock"));
  symlinkSync(join(directory, "missing"), join(directory, "journal.jsonl"));
  await assert.rejects(exportRevocations(options(directory, rpc)), /ELOOP/);
  assert.equal(calls, 0);
});
test("event projection excludes content and validates references", () => {
  assert.throws(
    () => validateEvent({ ...event, notes: "private workout" }),
    /Invalid/,
  );
  assert.deepEqual(
    validateEvent({
      ...event,
      kind: "account_erasure",
      generation: null,
      target_id: event.user_id,
    }),
    {
      ...event,
      kind: "account_erasure",
      generation: null,
      target_id: event.user_id,
    },
  );
  for (const patch of [
    { user_id: "invalid" },
    { generation: -1 },
    { target_id: "../../secret" },
    { kind: "publish" },
    { created_at: "invalid" },
  ])
    assert.throws(() => validateEvent({ ...event, ...patch }), /Invalid/);
});
