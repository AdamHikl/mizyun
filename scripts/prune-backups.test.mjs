import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgs, pruneBackups } from "./prune-backups.mjs";

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), "mizyun-retention-"));
}

async function snapshot(root, name, complete = true) {
  const directory = path.join(root, name);
  await mkdir(directory);
  await writeFile(path.join(directory, "database.dump"), "database");
  if (complete) {
    await writeFile(path.join(directory, "private-storage.tar.gz"), "storage");
    await writeFile(path.join(directory, "SHA256SUMS"), "checksums");
  }
  return directory;
}

test("removes complete and incomplete snapshots at exactly 90 days", async () => {
  const root = await fixture();
  await snapshot(root, "20260621T120000Z");
  await snapshot(root, ".incomplete-20260620T120000Z-crash", false);
  await snapshot(root, ".deleting-20260619T120000Z-crash", false);
  await snapshot(root, "20260621T120001Z");

  const removed = await pruneBackups({
    root,
    now: NOW,
    logger: { log() {} },
  });

  assert.deepEqual(removed.sort(), [
    ".deleting-20260619T120000Z-crash",
    ".incomplete-20260620T120000Z-crash",
    "20260621T120000Z",
  ]);
  assert.equal(
    await readFile(
      path.join(root, "20260621T120001Z", "database.dump"),
      "utf8",
    ),
    "database",
  );
});

test("a deletion failure leaves an archive quarantined instead of restoring it", async () => {
  const root = await fixture();
  const name = "20260620T120000Z";
  await snapshot(root, name);

  await assert.rejects(
    () =>
      pruneBackups({
        root,
        now: NOW,
        logger: { log() {} },
        operations: {
          ...fs,
          async rm() {
            throw new Error("simulated removal failure");
          },
        },
      }),
    /simulated removal failure/,
  );

  const entries = await fs.readdir(root);
  assert.equal(entries.includes(name), false);
  assert.equal(
    entries.some((entry) => entry.startsWith(`.deleting-${name}-`)),
    true,
  );
});

test("retention cannot be extended through command-line configuration", () => {
  assert.throws(
    () => parseArgs(["--root", "/safe/backups", "--retention-days", "91"]),
    /fixed at 90 days/,
  );
});

test("ignores malformed names and handles year boundaries from UTC timestamps", async () => {
  const root = await fixture();
  await snapshot(root, "20251231T235959Z");
  await snapshot(root, "20260230T000000Z");
  await mkdir(path.join(root, "notes"));
  await snapshot(
    root,
    "operator-notes.incomplete-20250101T000000Z-do-not-delete",
  );

  const removed = await pruneBackups({
    root,
    now: Date.UTC(2026, 3, 1, 0, 0, 0),
    logger: { log() {} },
  });

  assert.deepEqual(removed, ["20251231T235959Z"]);
  assert.equal(
    await readFile(
      path.join(root, "20260230T000000Z", "database.dump"),
      "utf8",
    ),
    "database",
  );
  assert.equal(
    await readFile(
      path.join(
        root,
        "operator-notes.incomplete-20250101T000000Z-do-not-delete",
        "database.dump",
      ),
      "utf8",
    ),
    "database",
  );
});

test("backup publication refuses an existing target and cleans staging", async () => {
  const root = await fixture();
  const storage = path.join(root, "storage");
  const backupRoot = path.join(root, "backups");
  const fakeBin = path.join(root, "bin");
  const timestamp = "20260919T120000Z";
  await mkdir(storage);
  await mkdir(path.join(backupRoot, timestamp), { recursive: true });
  await mkdir(fakeBin);

  const executable = { mode: 0o755 };
  await writeFile(
    path.join(fakeBin, "date"),
    `#!/bin/sh\nprintf '%s\\n' '${timestamp}'\n`,
    executable,
  );
  await writeFile(
    path.join(fakeBin, "docker"),
    "#!/bin/sh\ncase \"$*\" in *pg_dump*) printf 'dump' ;; esac\n",
    executable,
  );
  await writeFile(
    path.join(fakeBin, "tar"),
    '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "--file" ]; then shift; : > "$1"; fi; shift; done\n',
    executable,
  );
  await writeFile(
    path.join(fakeBin, "sha256sum"),
    '#!/bin/sh\nif [ "$1" = "--check" ]; then exit 0; fi\nprintf "hash  database.dump\\nhash  private-storage.tar.gz\\n"\n',
    executable,
  );
  for (const command of ["node", "flock"]) {
    await writeFile(
      path.join(fakeBin, command),
      "#!/bin/sh\nexit 0\n",
      executable,
    );
  }

  const envFile = path.join(root, "production.env");
  await writeFile(
    envFile,
    `NODE_ENV=production\nMIZYUN_BACKUP_DIR=${backupRoot}\nMIZYUN_STORAGE_DIR=${storage}\nMIZYUN_DB_CONTAINER=fake-db\n`,
  );
  const script = path.resolve("scripts/backup-production.sh");
  const result = await new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", [script], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        MIZYUN_PRODUCTION_ENV_FILE: envFile,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Refusing to replace an existing backup/);
  assert.deepEqual(
    (await readdir(backupRoot)).filter((name) =>
      name.startsWith(".incomplete-"),
    ),
    [],
  );
});

test("rejects unsafe roots and timestamp-shaped symlinks", async () => {
  await assert.rejects(() => pruneBackups({ root: "/" }), /filesystem root/);
  await assert.rejects(
    () => pruneBackups({ root: os.homedir() }),
    /home directory/,
  );

  const root = await fixture();
  const outside = await fixture();
  await symlink(outside, path.join(root, "20250101T000000Z"));
  await assert.rejects(
    () => pruneBackups({ root, now: NOW }),
    /Refusing symlink snapshot/,
  );
});
