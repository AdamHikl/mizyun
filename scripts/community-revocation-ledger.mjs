#!/usr/bin/env node
/** Encrypted append sink. The operator must provision independently durable storage.
 * A successful export proves fsync on that destination, not remote replication or
 * completeness after primary loss. Restores always remain quarantined.
 */
import { createHash } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fsyncSync,
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  lstatSync,
  fstatSync,
} from "node:fs";
import { resolve, join, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { assertWorkerTarget, createServiceRpc } from "./community-worker.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const KINDS = new Set([
  "withdrawal",
  "account_erasure",
  "block",
  "sanction",
  "activity",
  "routine",
  "media",
  "comment",
  "message",
  "relationship",
  "invitation",
  "source_workout",
  "group",
  "group_post",
  "challenge",
  "group_membership",
  "messaging_optout",
  "discovery_optout",
  "reaction",
  "challenge_membership",
  "challenge_contribution",
]);
const GENERATION_REQUIRED = new Set([
  "withdrawal",
  "activity",
  "routine",
  "media",
  "comment",
  "message",
  "invitation",
  "group_post",
  "group_membership",
  "messaging_optout",
  "discovery_optout",
  "challenge_membership",
]);
const MAX_JOURNAL_BYTES = 32 * 1024 * 1024;
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");

export function validateEvent(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Object.keys(raw).sort().join(",") !==
      "created_at,event_id,generation,kind,related_user_id,target_id,user_id" ||
    !UUID.test(raw.event_id) ||
    !UUID.test(raw.user_id) ||
    !KINDS.has(raw.kind) ||
    (raw.generation !== null &&
      (!Number.isInteger(raw.generation) ||
        raw.generation < 1 ||
        raw.generation > 2147483647)) ||
    typeof raw.created_at !== "string" ||
    !Number.isFinite(Date.parse(raw.created_at))
  )
    throw new Error("Invalid revocation event");
  for (const key of ["target_id", "related_user_id"])
    if (raw[key] !== null && !UUID.test(raw[key]))
      throw new Error("Invalid revocation reference");
  if (
    (GENERATION_REQUIRED.has(raw.kind) && raw.generation === null) ||
    (raw.kind !== "withdrawal" && raw.target_id === null) ||
    (["block", "relationship"].includes(raw.kind) &&
      (raw.related_user_id === null || raw.related_user_id === raw.user_id))
  )
    throw new Error("Invalid revocation scope");
  return {
    event_id: raw.event_id,
    user_id: raw.user_id,
    kind: raw.kind,
    generation: raw.generation,
    target_id: raw.target_id,
    related_user_id: raw.related_user_id,
    created_at: raw.created_at,
  };
}

function privateFile(path, max = MAX_JOURNAL_BYTES) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.size > max ||
      info.mode & 0o077 ||
      info.uid !== process.getuid()
    )
      throw new Error("Ledger file must be private and bounded");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
function syncDirectory(directory) {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function writeDurable(path, bytes) {
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function directoryPath(directory) {
  if (!isAbsolute(directory) || resolve(directory) !== directory)
    throw new Error("Explicit canonical ledger directory required");
  const info = lstatSync(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.mode & 0o077 ||
    info.uid !== process.getuid()
  )
    throw new Error("Ledger directory must be owned and private");
  // Reject symlink ancestors, including paths which silently redirect storage.
  let parent = directory;
  while (parent !== "/") {
    if (lstatSync(parent).isSymbolicLink())
      throw new Error("Ledger path redirects");
    parent = resolve(parent, "..");
  }
  return directory;
}

export function parseJournal(bytes, environment) {
  if (
    !["dev", "production"].includes(environment) ||
    bytes.length > MAX_JOURNAL_BYTES
  )
    throw new Error("Invalid ledger environment or size");
  const text = bytes.toString("utf8");
  if (text && !text.endsWith("\n"))
    throw new Error("Incomplete ledger journal; keep recovery closed");
  const seen = new Map();
  let previous = "0".repeat(64);
  for (const line of text ? text.slice(0, -1).split("\n") : []) {
    if (!line) throw new Error("Invalid empty ledger record");
    const entry = JSON.parse(line);
    if (
      Object.keys(entry).sort().join(",") !==
      "ciphertext,environment,eventId,hash,previous,schema,sequence"
    )
      throw new Error("Invalid ledger record fields");
    if (
      entry.schema !== 1 ||
      entry.environment !== environment ||
      entry.sequence !== seen.size + 1 ||
      entry.previous !== previous ||
      !UUID.test(entry.eventId) ||
      !HASH.test(entry.hash) ||
      !HASH.test(entry.ciphertext) ||
      seen.has(entry.eventId)
    )
      throw new Error("Invalid ledger chain");
    seen.set(entry.eventId, entry);
    previous = digest(line);
  }
  return { seen, previous };
}
export function ageEncrypt(bytes, recipient) {
  if (typeof recipient !== "string" || !/^age1[a-z0-9]{58}$/.test(recipient))
    throw new Error("Explicit age public recipient required");
  const result = spawnSync("age", ["--encrypt", "--recipient", recipient], {
    input: bytes,
    maxBuffer: 128 * 1024,
    timeout: 10000,
  });
  if (result.status !== 0 || !result.stdout?.length)
    throw new Error("Ledger encryption failed");
  return result.stdout;
}

export async function exportRevocations({
  rpc,
  directory,
  environment,
  recipient,
  encrypt = ageEncrypt,
}) {
  directoryPath(directory);
  const lock = join(directory, ".writer-lock");
  const lockFd = openSync(
    lock,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const journal = join(directory, "journal.jsonl");
    let bytes;
    try {
      bytes = privateFile(journal);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      bytes = Buffer.alloc(0);
    }
    const { seen } = parseJournal(bytes, environment);
    const events = await rpc("community_revocation_pending", { p_limit: 100 });
    if (!Array.isArray(events) || events.length > 100)
      throw new Error("Unbounded revocation batch");
    const acknowledgements = [];
    for (const raw of events) {
      const event = validateEvent(raw);
      const payload = Buffer.from(
        JSON.stringify({ schema: 1, environment, event }),
      );
      const hash = digest(payload);
      const known = seen.get(event.event_id);
      if (known) {
        if (
          known.hash !== hash ||
          digest(
            privateFile(join(directory, event.event_id + ".age"), 128 * 1024),
          ) !== known.ciphertext
        )
          throw new Error("Ledger replay mismatch");
      } else {
        const ciphertext = encrypt(payload, recipient);
        if (
          !Buffer.isBuffer(ciphertext) ||
          !ciphertext.length ||
          ciphertext.length > 128 * 1024
        )
          throw new Error("Invalid ledger ciphertext");
        const temporary = join(directory, event.event_id + ".pending");
        // A previous crashed write is never an acknowledged event. Fail closed
        // for pending files; an operator may inspect/remove the orphan safely.
        writeDurable(temporary, ciphertext);
        renameSync(temporary, join(directory, event.event_id + ".age"));
        syncDirectory(directory);
        const entry = {
          schema: 1,
          environment,
          sequence: seen.size + 1,
          previous: bytes.length
            ? digest(bytes.toString("utf8").trimEnd().split("\n").at(-1))
            : "0".repeat(64),
          eventId: event.event_id,
          hash,
          ciphertext: digest(ciphertext),
        };
        const line = JSON.stringify(entry) + "\n";
        if (bytes.length + Buffer.byteLength(line) > MAX_JOURNAL_BYTES)
          throw new Error(
            "Ledger rotation requires accepted retention procedure",
          );
        const fd = openSync(
          journal,
          constants.O_WRONLY |
            constants.O_APPEND |
            constants.O_CREAT |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          writeFileSync(fd, line);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        syncDirectory(directory);
        bytes = Buffer.concat([bytes, Buffer.from(line)]);
        seen.set(event.event_id, entry);
      }
      acknowledgements.push(event.event_id);
    }
    const checkpoint = digest(bytes);
    if (acknowledgements.length)
      await rpc("community_revocation_ack", {
        p_event_ids: acknowledgements,
        p_checkpoint: checkpoint,
      });
    return {
      environment,
      exported: acknowledgements.length,
      retainedEvents: seen.size,
      checkpoint,
      completenessCertified: false,
      reopenPermitted: false,
    };
  } finally {
    closeSync(lockFd);
    unlinkSync(lock);
    syncDirectory(directory);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const environment = process.env.COMMUNITY_LEDGER_TARGET;
    assertWorkerTarget(environment, process.env.COMMUNITY_LEDGER_SUPABASE_URL);
    const rpc = createServiceRpc({
      url: process.env.COMMUNITY_LEDGER_SUPABASE_URL,
      key: process.env.COMMUNITY_LEDGER_SERVICE_KEY,
    });
    console.log(
      JSON.stringify(
        await exportRevocations({
          rpc,
          environment,
          directory: process.env.COMMUNITY_LEDGER_DIRECTORY,
          recipient: process.env.COMMUNITY_LEDGER_AGE_RECIPIENT,
        }),
      ),
    );
  } catch {
    console.error("Community ledger export failed; recovery remains closed.");
    process.exitCode = 1;
  }
}
