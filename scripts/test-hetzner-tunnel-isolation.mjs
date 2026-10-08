#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  tunnelProperties,
  verifyTunnelDependencies,
} from "../deploy/hetzner/verify-shared-tunnel-dependencies.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tunnel = read("deploy/hetzner/cloudflared.service");
const originUnits = ["mizyun-api.service", "mizyun-api-dev.service"];
const startupUnits = ["network-online.target", ...originUnits];

function unitProperties(source) {
  const values = new Map();
  for (const line of source.split("\n")) {
    const match = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (!match) continue;
    assert.ok(
      !values.has(match[1]),
      `fixture does not support repeated ${match[1]}`,
    );
    values.set(match[1], match[2]);
  }
  return values;
}

function snapshot(overrides = {}) {
  const source = unitProperties(tunnel);
  const properties = Object.fromEntries(
    tunnelProperties.map((key) => [key, source.get(key) ?? ""]),
  );
  return Object.entries({
    ...properties,
    Id: "cloudflared.service",
    LoadState: "loaded",
    UnitFileState: "enabled",
    // systemd adds these implicit dependencies to normal service units.
    Requires: "sysinit.target",
    ...overrides,
  })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

test("shared tunnel preserves origin startup ordering and independent transport lifecycle", () => {
  const unit = unitProperties(tunnel);
  for (const key of ["Wants", "After"]) {
    assert.deepEqual(
      unit.get(key).split(/\s+/).sort(),
      [...startupUnits].sort(),
    );
  }
  assert.equal(unit.get("Requires"), undefined);
  assert.equal(unit.get("Type"), "notify");
  assert.equal(unit.get("TimeoutStartSec"), "30");
  assert.equal(unit.get("Restart"), "on-failure");
  assert.equal(unit.get("RestartSec"), "5s");
  assert.equal(
    unit.get("ExecStart"),
    "/usr/bin/cloudflared --no-autoupdate tunnel run --token-file /etc/cloudflared/token",
  );
  assert.equal(unit.get("WantedBy"), "multi-user.target");
  assert.deepEqual(verifyTunnelDependencies(snapshot()), {
    ok: true,
    errors: [],
  });
});

// This narrow fixture models the documented Requires/PartOf/BindsTo stop
// propagation, rather than claiming to run systemd or Cloudflare on the Mac.
function stopClosure(units, stopped) {
  const stop = new Set([stopped]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, properties] of units) {
      const dependencies = [
        "Requires",
        "PartOf",
        "BindsTo",
        "StopPropagatedFrom",
      ].flatMap((key) => (properties.get(key) ?? "").split(/\s+/));
      if (!stop.has(name) && dependencies.some((unit) => stop.has(unit))) {
        stop.add(name);
        changed = true;
      }
    }
  }
  return stop;
}

test("regression fixture reproduces Dev stop leaving the old shared tunnel stopped after Dev restart", () => {
  const old = unitProperties(tunnel);
  old.set("Requires", originUnits.join(" "));
  const stopped = stopClosure(
    new Map([["cloudflared.service", old]]),
    "mizyun-api-dev.service",
  );
  assert.ok(stopped.has("cloudflared.service"));
  // Starting the required API alone never pulls in the units requiring it.
  stopped.delete("mizyun-api-dev.service");
  assert.ok(stopped.has("cloudflared.service"));
  assert.equal(
    verifyTunnelDependencies(snapshot({ Requires: originUnits.join(" ") })).ok,
    false,
  );
});

test("Dev stop/restart fixture keeps the shared transport and Production origin active", () => {
  const units = new Map([
    ["cloudflared.service", unitProperties(tunnel)],
    [
      "mizyun-api.service",
      unitProperties(read("deploy/hetzner/mizyun-api.service")),
    ],
  ]);
  const stopped = stopClosure(units, "mizyun-api-dev.service");
  assert.deepEqual([...stopped], ["mizyun-api-dev.service"]);
  stopped.delete("mizyun-api-dev.service");
  assert.equal(stopped.size, 0);
});

test("resolved dependency validation rejects drop-ins, service aliases, and stop propagation in either direction", () => {
  for (const key of [
    "Requires",
    "Requisite",
    "BindsTo",
    "PartOf",
    "Conflicts",
    "ConflictedBy",
    "PropagatesStopTo",
    "StopPropagatedFrom",
  ]) {
    for (const origin of [...originUnits, "unexpected-alias.service"]) {
      assert.equal(
        verifyTunnelDependencies(snapshot({ [key]: origin })).ok,
        false,
        `${key}: ${origin}`,
      );
    }
  }
});

test("resolved dependency validation fails closed for incomplete or duplicated properties", () => {
  assert.equal(
    verifyTunnelDependencies(snapshot().replace(/^PartOf=.*\n/m, "")).ok,
    false,
  );
  assert.equal(verifyTunnelDependencies(`${snapshot()}\nRequires=`).ok, false);
  assert.equal(verifyTunnelDependencies("garbled").ok, false);
});

test("resolved dependency validation rejects lost boot enablement, transport notification, retry, and ordering", () => {
  for (const overrides of [
    { UnitFileState: "disabled" },
    { Id: "unrelated.service" },
    { LoadState: "not-found" },
    { Type: "simple" },
    { Restart: "no" },
    { After: "network-online.target" },
    { Wants: "network-online.target" },
    { Before: "mizyun-api-dev.service" },
  ]) {
    assert.equal(
      verifyTunnelDependencies(snapshot(overrides)).ok,
      false,
      JSON.stringify(overrides),
    );
  }
});

test("Production backup still explicitly freezes tunnel before application writers and restores API before tunnel", () => {
  const backup = read("deploy/hetzner/backup-production-encrypted.sh");
  assert.ok(backup.indexOf("systemctl stop cloudflared.service") >= 0);
  assert.ok(
    backup.indexOf("systemctl stop cloudflared.service") <
      backup.indexOf("systemctl stop mizyun-api.service"),
  );
  const recovery = read("deploy/hetzner/recover-production-after-backup.sh");
  const positions = [
    "docker compose up -d --wait",
    "systemctl start mizyun-api.service",
    "http://127.0.0.1:4000/v1/health",
    "systemctl start cloudflared.service",
    '"$public_health_url"',
  ].map((token) => recovery.indexOf(token));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
  assert.match(recovery, /Production tunnel did not recover after backup/);
  assert.match(recovery, /Production API did not recover after backup/);
});

test("Dev promotion and rollback remain scoped to the Dev API without gaining shared-tunnel control", () => {
  const dev = read("scripts/promote-dev.sh");
  assert.doesNotMatch(dev, /systemctl (?:start|stop|restart) cloudflared/);
  assert.match(dev, /systemctl stop "\$service_unit"/);
  assert.match(dev, /systemctl restart "\$service_unit"/);
});

test("actual Dev and Production release validators still reject unhealthy or stale candidates", () => {
  const expected = "a".repeat(40);
  const previousInstance = "11111111-1111-1111-1111-111111111111";
  const startedAt = Date.now() - 1000;
  const ready = {
    version: 1,
    ready: true,
    release: {
      sha: expected,
      instanceId: "22222222-2222-2222-2222-222222222222",
      startedAt,
    },
    dependencies: { database: true, auth: true, storage: true },
  };
  for (const path of [
    "scripts/promote-dev.sh",
    "scripts/promote-production.sh",
  ]) {
    const source = read(path).match(
      /<<'READINESS_NODE'\n([\s\S]*?)\nREADINESS_NODE/,
    );
    assert.ok(source, `${path} readiness validator is present`);
    const check = (payload, checkedOut = expected) =>
      spawnSync(
        process.execPath,
        [
          "-",
          expected,
          checkedOut,
          previousInstance,
          String(startedAt),
          JSON.stringify(payload),
        ],
        { input: source[1], encoding: "utf8" },
      ).status;
    assert.equal(check(ready), 0, path);
    assert.equal(check({ ...ready, ready: false }), 1);
    assert.equal(check(ready, "b".repeat(40)), 1);
    assert.equal(
      check({ ...ready, release: { ...ready.release, sha: "b".repeat(40) } }),
      1,
    );
    assert.equal(
      check({
        ...ready,
        release: { ...ready.release, instanceId: previousInstance },
      }),
      1,
    );
    assert.equal(
      check({
        ...ready,
        release: { ...ready.release, startedAt: startedAt - 1 },
      }),
      1,
    );
    for (const dependency of ["database", "auth", "storage"]) {
      assert.equal(
        check({
          ...ready,
          dependencies: { ...ready.dependencies, [dependency]: false },
        }),
        1,
      );
    }
  }
});
