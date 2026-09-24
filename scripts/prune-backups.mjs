#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BACKUP_RETENTION_DAYS = 90;
const TIMESTAMP_SOURCE = "(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z";
const SNAPSHOT_PATTERNS = [
  new RegExp(`^${TIMESTAMP_SOURCE}$`),
  new RegExp(`^\\.incomplete-${TIMESTAMP_SOURCE}-[A-Za-z0-9]+$`),
  new RegExp(
    `^\\.deleting-(?:\\.incomplete-)?${TIMESTAMP_SOURCE}-[A-Za-z0-9-]+$`,
  ),
];

function parseSnapshotTime(name) {
  const match = SNAPSHOT_PATTERNS.map((pattern) => pattern.exec(name)).find(
    Boolean,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const millis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const canonical = new Date(millis)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".000", "");
  return canonical === `${year}${month}${day}T${hour}${minute}${second}Z`
    ? millis
    : null;
}

function assertSafeRoot(input, resolved) {
  if (!path.isAbsolute(input)) throw new Error("Backup root must be absolute.");
  if (resolved === path.parse(resolved).root)
    throw new Error("Refusing filesystem root as backup root.");
  if (resolved === os.homedir())
    throw new Error("Refusing the home directory as backup root.");
}

export async function pruneBackups({
  root,
  now = Date.now(),
  logger = console,
  operations = { lstat, readdir, realpath, rename, rm },
}) {
  const rootStat = await operations.lstat(root);
  if (rootStat.isSymbolicLink())
    throw new Error("Refusing a symlink backup root.");
  if (!rootStat.isDirectory())
    throw new Error("Backup root is not a directory.");

  const resolvedRoot = await operations.realpath(root);
  assertSafeRoot(root, resolvedRoot);
  const cutoff = now - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = await operations.readdir(resolvedRoot, {
    withFileTypes: true,
  });
  const removed = [];

  for (const entry of entries) {
    const createdAt = parseSnapshotTime(entry.name);
    if (createdAt === null) continue;
    const candidate = path.join(resolvedRoot, entry.name);
    const candidateStat = await operations.lstat(candidate);
    if (candidateStat.isSymbolicLink())
      throw new Error(`Refusing symlink snapshot: ${entry.name}`);
    if (!candidateStat.isDirectory())
      throw new Error(`Refusing non-directory snapshot: ${entry.name}`);
    if (createdAt > cutoff) continue;

    const alreadyQuarantined = entry.name.startsWith(".deleting-");
    const deleting = alreadyQuarantined
      ? candidate
      : path.join(
          resolvedRoot,
          `.deleting-${entry.name}-${process.pid}-${randomUUID()}`,
        );
    if (!alreadyQuarantined) await operations.rename(candidate, deleting);
    await operations.rm(deleting, { recursive: true, force: false });
    removed.push(entry.name);
    logger.log(`Expired backup removed: ${entry.name}`);
  }

  return removed;
}

export function parseArgs(argv) {
  const args = { root: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") args.root = argv[++index] ?? null;
    else if (argv[index] === "--retention-days")
      throw new Error("Retention is fixed at 90 days.");
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.root) throw new Error("--root is required.");
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await pruneBackups(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
