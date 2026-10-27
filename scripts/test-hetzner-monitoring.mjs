#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const script = (name) =>
  new URL(`../deploy/hetzner/${name}`, import.meta.url).pathname;

// Stub commands read their behaviour from files in the fixture directory and
// append their arguments to calls.log, so no real host state is touched.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "mizyun-monitoring-"));
  const bin = join(dir, "bin");
  const stubs = {
    curl: `printf 'curl %s ' "$*" >> "$FIXTURE/calls.log"
cat >> "$FIXTURE/calls.log"
while [ $# -gt 0 ]; do
  if [ "$1" = "-d" ]; then printf '%s' "$2" > "$FIXTURE/payload.json"; fi
  shift
done
exit "$(cat "$FIXTURE/curl-status" 2>/dev/null || echo 0)"`,
    logger: `printf 'logger %s\\n' "$*" >> "$FIXTURE/calls.log"`,
    df: `printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\n/dev/sda1 100 1 1 %s%% /\\n' "$(cat "$FIXTURE/disk")"`,
    systemctl: `unit="$2"; property="\${3#--property=}"
file="$FIXTURE/$unit.$property"
if [ -f "$file" ]; then cat "$file"; elif [ "$property" = ActiveState ]; then echo active; else echo 0; fi`,
    docker: `case "$*" in
  *status=restarting*) cat "$FIXTURE/restarting" 2>/dev/null ;;
  *) cat "$FIXTURE/unhealthy" 2>/dev/null ;;
esac
exit 0`,
    lslocks: `cat "$FIXTURE/locks" 2>/dev/null; exit 0`,
    alert: `printf '%s|%s\\n' "$1" "$2" >> "$FIXTURE/alerts.log"`,
  };
  spawnSync("mkdir", ["-p", bin]);
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(dir, "disk"), "40");
  writeFileSync(
    join(dir, "meminfo"),
    "MemTotal:       4000000 kB\nMemAvailable:   2000000 kB\n",
  );
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    FIXTURE: dir,
    MIZYUN_ALERT_ENV_FILE: join(dir, "alerts.env"),
    MIZYUN_WATCH_STATE_DIR: join(dir, "state"),
    MIZYUN_WATCH_MEMINFO: join(dir, "meminfo"),
    MIZYUN_WATCH_ALERT_COMMAND: join(bin, "alert"),
    MIZYUN_PRODUCTION_LOCK_FILE: "/run/lock/mizyun-production-maintenance.lock",
  };
  const file = (name) => {
    try {
      return readFileSync(join(dir, name), "utf8");
    } catch {
      return "";
    }
  };
  return {
    dir,
    run: (name, args = [], extra = {}) =>
      spawnSync("bash", [script(name), ...args], {
        encoding: "utf8",
        env: { ...env, ...extra },
      }),
    set: (name, value) => {
      writeFileSync(join(dir, name), value);
      chmodSync(join(dir, name), 0o600);
    },
    alerts: () => file("alerts.log").split("\n").filter(Boolean),
    calls: () => file("calls.log"),
    payload: () => file("payload.json"),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("shell scripts parse", () => {
  for (const name of [
    "mizyun-send-alert.sh",
    "mizyun-heartbeat.sh",
    "mizyun-host-watch.sh",
  ]) {
    const result = spawnSync("bash", ["-n", script(name)], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test("send-alert posts valid JSON for Slack and Discord even with quotes and newlines", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set(
    "alerts.env",
    "MIZYUN_ALERT_WEBHOOK_URL=https://hooks.example.test/x\n",
  );
  const result = f.run("mizyun-send-alert.sh", [
    "unit.service",
    'Failed "badly"\\ on\nline two',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(f.payload());
  assert.equal(body.text, body.content);
  assert.match(body.text, /Failed "badly"\\ on\nline two/);
  assert.match(f.calls(), /url = "https:\/\/hooks\.example\.test\/x"/);
  assert.doesNotMatch(
    f.calls().split("\n")[1] ?? "",
    /hooks\.example/,
    "the webhook URL never appears in curl argv",
  );
});

test("alert scripts ignore a group- or world-writable env file", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set(
    "alerts.env",
    "MIZYUN_ALERT_WEBHOOK_URL=https://hooks.example.test/x\n",
  );
  chmodSync(join(f.dir, "alerts.env"), 0o666);
  const result = f.run("mizyun-send-alert.sh", ["unit.service", "message"]);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Ignoring .*alerts\.env/);
  assert.doesNotMatch(f.calls(), /curl/);
  f.set("alerts.env", "MIZYUN_HEARTBEAT_URL_BACKUP=https://hc-ping.com/x\n");
  chmodSync(join(f.dir, "alerts.env"), 0o620);
  f.run("mizyun-heartbeat.sh", ["backup"]);
  assert.doesNotMatch(f.calls(), /curl/);
});

test("send-alert only logs when no webhook is configured", (t) => {
  const f = fixture();
  t.after(f.clean);
  const result = f.run("mizyun-send-alert.sh", ["unit.service", "message"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.calls(), /^logger /);
  assert.doesNotMatch(f.calls(), /curl/);
});

test("heartbeat is a no-op when unset and pings the per-check URL when set", (t) => {
  const f = fixture();
  t.after(f.clean);
  assert.equal(f.run("mizyun-heartbeat.sh", ["backup-pull"]).status, 0);
  assert.equal(f.calls(), "");

  f.set(
    "alerts.env",
    "MIZYUN_HEARTBEAT_URL_BACKUP_PULL=https://hc-ping.com/abc-123\n",
  );
  assert.equal(f.run("mizyun-heartbeat.sh", ["backup-pull"]).status, 0);
  assert.match(f.calls(), /url = "https:\/\/hc-ping\.com\/abc-123"/);
  assert.match(f.calls(), /^curl [^\n]*--config - [^\n]*url = /);
  assert.equal(f.run("mizyun-heartbeat.sh", ["backup"]).status, 0);
  assert.equal(f.calls().match(/curl/g).length, 1);
});

test("heartbeat never fails its caller", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set("alerts.env", "MIZYUN_HEARTBEAT_URL_BACKUP=http://insecure.test/x\n");
  assert.equal(f.run("mizyun-heartbeat.sh", ["backup"]).status, 0);
  assert.doesNotMatch(f.calls(), /curl/);

  f.set("alerts.env", "MIZYUN_HEARTBEAT_URL_BACKUP=https://hc-ping.com/x\n");
  f.set("curl-status", "7");
  assert.equal(f.run("mizyun-heartbeat.sh", ["backup"]).status, 0);
  assert.equal(f.run("mizyun-heartbeat.sh", ["Bad Name"]).status, 0);
});

test("host watch confirms, repeats hourly and reports recovery of low disk", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set("disk", "91");
  assert.equal(f.run("mizyun-host-watch.sh").status, 0);
  assert.deepEqual(f.alerts(), [], "one observation is not confirmed");
  f.run("mizyun-host-watch.sh");
  assert.equal(f.alerts().length, 1);
  assert.match(f.alerts()[0], /Disk \/ is 91% full/);
  f.run("mizyun-host-watch.sh");
  assert.equal(f.alerts().length, 1, "no repeat inside the hour");
  f.run("mizyun-host-watch.sh", [], { MIZYUN_WATCH_REPEAT_MINUTES: "0" });
  assert.equal(f.alerts().length, 2, "repeats once the interval passes");
  f.set("disk", "50");
  f.run("mizyun-host-watch.sh");
  assert.match(f.alerts()[2], /Recovered: disk-_/);
  f.run("mizyun-host-watch.sh");
  assert.equal(f.alerts().length, 3);
});

test("host watch alerts on low memory, unhealthy containers and inactive units", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set("meminfo", "MemTotal:       4000000 kB\nMemAvailable:    200000 kB\n");
  f.set("unhealthy", "supabase-db\n");
  f.set("restarting", "supabase-auth\n");
  f.set("cloudflared.service.ActiveState", "inactive\n");
  f.run("mizyun-host-watch.sh");
  f.run("mizyun-host-watch.sh");
  const alerts = f.alerts().join("\n");
  assert.match(alerts, /Only 5% memory available/);
  assert.match(alerts, /Container supabase-db is unhealthy/);
  assert.match(alerts, /Container supabase-auth is restarting/);
  assert.match(alerts, /Unit cloudflared\.service is inactive/);
});

test("host watch alerts at once on automatic restarts", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set("mizyun-api-dev.service.NRestarts", "3\n");
  f.run("mizyun-host-watch.sh");
  assert.deepEqual(f.alerts(), [], "first run records a baseline");
  f.set("mizyun-api-dev.service.NRestarts", "5\n");
  f.run("mizyun-host-watch.sh");
  assert.match(
    f.alerts().join("\n"),
    /mizyun-api-dev\.service restarted automatically 2 time/,
  );
  f.set("mizyun-api-dev.service.NRestarts", "9\n");
  f.run("mizyun-host-watch.sh");
  assert.equal(f.alerts().length, 1, "a crash loop alerts once per interval");
  f.set("mizyun-api-dev.service.NRestarts", "10\n");
  f.run("mizyun-host-watch.sh", [], { MIZYUN_WATCH_REPEAT_MINUTES: "0" });
  assert.equal(f.alerts().length, 2, "and again once the interval passes");
  f.set("mizyun-api-dev.service.NRestarts", "0\n");
  f.run("mizyun-host-watch.sh");
  assert.equal(f.alerts().length, 2, "a counter reset is not a restart");
});

test("the Dev deploy lock pauses only Dev unit checks", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set("locks", "/tmp/mizyun-deploy-dev.lock\n");
  f.set("mizyun-api-dev.service.ActiveState", "inactive\n");
  f.set("mizyun-api.service.ActiveState", "inactive\n");
  f.run("mizyun-host-watch.sh");
  f.run("mizyun-host-watch.sh");
  const alerts = f.alerts().join("\n");
  assert.match(alerts, /Unit mizyun-api\.service is inactive/);
  assert.doesNotMatch(alerts, /mizyun-api-dev\.service/);
});

test("host watch does not count stopped units during Production maintenance", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set("locks", "/run/lock/mizyun-production-maintenance.lock\n");
  f.set("mizyun-api.service.ActiveState", "inactive\n");
  f.run("mizyun-host-watch.sh");
  f.run("mizyun-host-watch.sh");
  assert.deepEqual(f.alerts(), []);
  f.set("locks", "");
  f.run("mizyun-host-watch.sh");
  assert.deepEqual(
    f.alerts(),
    [],
    "needs fresh confirmation after maintenance",
  );
  f.set("mizyun-api.service.ActiveState", "active\n");
  f.run("mizyun-host-watch.sh");
  assert.deepEqual(f.alerts(), [], "unconfirmed conditions clear silently");
});

test("an explicitly empty unit list disables unit checks (Pi)", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set("alerts.env", "MIZYUN_WATCH_UNITS=\n");
  f.set("cloudflared.service.ActiveState", "inactive\n");
  f.run("mizyun-host-watch.sh");
  f.run("mizyun-host-watch.sh");
  assert.deepEqual(f.alerts(), []);
});

test("host watch exits non-zero when an alert cannot be dispatched", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set("disk", "99");
  const failing = join(f.dir, "bin", "false-alert");
  writeFileSync(failing, "#!/bin/sh\nexit 1\n");
  chmodSync(failing, 0o755);
  f.run("mizyun-host-watch.sh", [], { MIZYUN_WATCH_ALERT_COMMAND: failing });
  const result = f.run("mizyun-host-watch.sh", [], {
    MIZYUN_WATCH_ALERT_COMMAND: failing,
  });
  assert.equal(result.status, 1);
});

test("a failed recovery alert keeps the condition for a retry", (t) => {
  const f = fixture();
  t.after(f.clean);
  f.set("disk", "95");
  f.run("mizyun-host-watch.sh");
  f.run("mizyun-host-watch.sh");
  assert.equal(f.alerts().length, 1);
  f.set("disk", "40");
  const failing = join(f.dir, "bin", "false-alert");
  writeFileSync(failing, "#!/bin/sh\nexit 1\n");
  chmodSync(failing, 0o755);
  const result = f.run("mizyun-host-watch.sh", [], {
    MIZYUN_WATCH_ALERT_COMMAND: failing,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not dispatch 1 alert/);
  f.run("mizyun-host-watch.sh");
  assert.match(f.alerts()[1], /Recovered: disk-_/);
});

test("units wire failure alerts without hooks on the Dev API", () => {
  for (const unit of [
    "mizyun-api.service",
    "mizyun-supabase.service",
    "mizyun-supabase-dev.service",
    "cloudflared.service",
    "mizyun-host-watch.service",
  ]) {
    assert.match(
      read(`deploy/hetzner/${unit}`),
      /^OnFailure=mizyun-alert@%n\.service$/m,
      unit,
    );
  }
  // scripts/backup-dev-encrypted.py refuses to freeze a Dev API that has
  // stop or completion hooks; restarts there are watched by the timer.
  assert.doesNotMatch(
    read("deploy/hetzner/mizyun-api-dev.service"),
    /^(OnFailure|OnSuccess|ExecStop|ExecStopPost)=/m,
  );
  const alertUnit = read("deploy/hetzner/mizyun-alert@.service");
  assert.match(
    alertUnit,
    /^ExecStart=\/usr\/local\/sbin\/mizyun-send-alert "%i" /m,
  );
  assert.match(alertUnit, /^StartLimitBurst=3$/m);
  const timer = read("deploy/hetzner/mizyun-host-watch.timer");
  assert.match(timer, /^Unit=mizyun-host-watch\.service$/m);
  assert.match(timer, /^WantedBy=timers\.target$/m);
  const watch = read("deploy/hetzner/mizyun-host-watch.sh");
  assert.doesNotMatch(watch, /flock -n/, "the watch must not take the lock");
});

test("backups ping their dead-man check only after success", () => {
  const backup = read("deploy/hetzner/backup-production-encrypted.sh");
  assert.ok(
    backup.indexOf('"$heartbeat_command" backup') >
      backup.indexOf('echo "Encrypted Production backup created'),
  );
  assert.match(backup, /caller_holds_lock" == "false" && -x/);
  const pull = read("deploy/hetzner/pull-backups-from-hetzner.sh");
  assert.ok(
    pull.indexOf('"$heartbeat_command" backup-pull') >
      pull.indexOf('echo "Verified VM backup on Pi'),
  );
});
