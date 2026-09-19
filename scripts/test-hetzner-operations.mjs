#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = [
  "deploy/hetzner/backup-production-encrypted.sh",
  "deploy/hetzner/pull-backups-from-hetzner.sh",
  "deploy/hetzner/mizyun-production-db-ip",
  "deploy/hetzner/mizyun-deploy-ssh-gate",
  "deploy/hetzner/mizyun-backup-reader-shell",
  "deploy/hetzner/recover-production-after-backup.sh",
];

for (const file of files) {
  const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
  assert.equal(result.status, 0, `${file}: ${result.stderr}`);
}

const backup = readFileSync(files[0], "utf8");
assert.match(backup, /systemctl stop cloudflared\.service/);
assert.match(backup, /systemctl stop mizyun-api\.service/);
assert.ok(
  backup.indexOf("systemctl stop cloudflared.service") <
    backup.indexOf("systemctl stop mizyun-api.service"),
  "the public tunnel must close before application writers stop",
);
assert.match(backup, /pg_dumpall .*--globals-only/);
assert.match(backup, /tar --xattrs --xattrs-include='\*' --acls/);
assert.match(backup, /storage-files\.sha256/);
assert.match(backup, /storage-xattrs\.txt/);
assert.match(backup, /storage-acls\.txt/);
assert.match(backup, /age --encrypt --recipient/);
assert.match(backup, /mv -T -- "\$staging_export" "\$release_dir"/);
assert.match(backup, /MIZYUN_BACKUP_CALLER_HOLDS_LOCK/);
assert.match(backup, /MIZYUN_BACKUP_TEST_FAIL_AFTER_FREEZE/);
assert.match(backup, /\/usr\/local\/sbin\/mizyun-backup-recover/);

const pull = readFileSync(files[1], "utf8");
assert.match(pull, /mktemp -d "\$destination\/\.incoming-/);
assert.match(pull, /sha256sum --check SHA256SUMS/);
assert.match(pull, /mv -T -- "\$candidate" "\$destination\/\$name"/);
assert.match(pull, /--link-dest="\$destination"/);
assert.match(pull, /max_age_seconds=.*21600/);

const productionPromote = readFileSync("scripts/promote-production.sh", "utf8");
assert.match(productionPromote, /mizyun-backup-for-deploy\.service/);
assert.match(productionPromote, /mizyun-production-maintenance\.lock/);
assert.match(productionPromote, /deployment authority/);

const devDriver = readFileSync("scripts/deploy-dev.mjs", "utf8");
const productionDriver = readFileSync("scripts/deploy-remote.mjs", "utf8");
assert.match(devDriver, /origin\/main:scripts\/promote-dev\.sh/);
assert.match(productionDriver, /origin\/main:scripts\/promote-production\.sh/);

console.log("Hetzner operations safeguards passed.");
