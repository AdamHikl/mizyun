# Shared tunnel dependency correction — issue #229

Date: 2026-10-08. Scope: local correction and separately authorized live dependency installation/manager reload. Actual Dev stop/restart routing observations are recorded below; full reboot/failure/recovery acceptance remains unrun. Authorization came directly from Adam, not this document.

## Failure and correction

[Issue #229](https://github.com/AdamHikl/mizyun/issues/229) records that stopping the Dev API during promotion stopped the shared `cloudflared.service`. Starting Dev afterward left the tunnel stopped and public requests returned Cloudflare 1033. The source unit required both APIs.

[`cloudflared.service`](../deploy/hetzner/cloudflared.service) now uses `Wants=network-online.target mizyun-api.service mizyun-api-dev.service` and preserves the same `After=` ordering. A start transaction pulls in both origins and waits for their systemd start jobs to finish. Stopping or restarting one origin no longer propagates through an API `Requires=` dependency to the shared connector. An unavailable Dev origin can fail its own requests while Production continues to use the running connector.

This is a transport lifecycle correction. `Type=simple` on the APIs means startup ordering does not prove application readiness. `Type=notify`, the token-file command, startup timeout, retry policy, and multi-user boot enablement on the connector are preserved. The shared process remains a common transport failure boundary.

Use a **full unit replacement**, after inspecting the effective host unit and preserving its installation-specific configuration. systemd cannot remove dependency entries with an empty `Requires=` in a drop-in. Existing drop-ins, aliases, and `.requires/` links can also introduce dependencies, so a correct repository file alone is insufficient acceptance evidence. No replacement has been installed in this session.

## Readiness and recovery

Dev and Production promotion scripts remain unchanged. Their actual release-readiness validators still require a fresh instance, an exact requested/checked-out/running SHA, a valid startup timestamp, and healthy database/Auth/Storage dependencies. A running or connected tunnel cannot satisfy those checks. Dev deployer permissions remain limited to its API; this correction adds no shared-tunnel control to Dev promotion or rollback.

Production backup explicitly closes the tunnel before stopping application writers. The existing recovery script waits for Compose, starts Production API, waits for local health, explicitly starts the tunnel, and then checks service state and public health. Removing the API requirement does not bypass that explicit freeze or recovery sequence. The backup health check is its existing recovery check; it does not replace exact release readiness. An intentionally stopped tunnel must still be explicitly started by the authorized recovery path; starting an API alone does not pull in a unit that wants that API.

## Local verification inventory

Coordinator verification on 2026-10-08: `pnpm test:hetzner-operations` passed, including the existing operations safeguards and all nine new tunnel tests. The full gate is recorded in the [ten-issue batch evidence](LATEST_TEN_ISSUES_EVIDENCE_2026-10-08.md). Formatting completed successfully. Physical Linux/shared-routing acceptance remains unrun.

```bash
node --test scripts/test-hetzner-tunnel-isolation.mjs
node scripts/test-hetzner-operations.mjs
pnpm exec prettier --write deploy/hetzner/verify-shared-tunnel-dependencies.mjs scripts/test-hetzner-tunnel-isolation.mjs docs/HETZNER_SHARED_TUNNEL_ISOLATION_2026-10-08.md
pnpm check
git -c core.fsmonitor=false diff --check
```

The focused suite contains nine tests: source startup/lifecycle contracts; an old-`Requires` stop/restart failure fixture; corrected Dev stop/restart isolation; rejection of resolved service coupling in both directions; fail-closed snapshot parsing; boot/notification/retry/ordering failures; explicit backup/recovery order; Dev promotion scope; and execution of the unchanged release-readiness validators with unhealthy, stale-instance, stale-timestamp, and mismatched-SHA inputs.

The stop/restart fixtures model documented dependency behavior. They do not execute systemd, run cloudflared, make public requests, or prove host isolation. Backup ordering assertions are source contracts, not a fresh backup or recovery drill. Only the authorized Linux/live acceptance below can establish those outcomes.

## Separately authorized installation and live acceptance

Before installation, record the accepted exact source SHA, passing local full gate, non-author deployment review, intended Hetzner host marker, Linux/systemd/cloudflared versions, unit fragment/drop-ins, dependency links, effective token-file command, boot state, tunnel/API PIDs, and both environments' public health/readiness baselines. Preserve the effective old unit and links for rollback. Never include token contents in evidence. Inspect transitive lifecycle dependencies and target aliases: the snapshot validator is a direct-property safeguard, not a full graph proof.

Prepare and review the exact full-unit diff against the live installation. Use `systemd-analyze verify` on the staged unit and its installed dependencies. Only the separately authorized operator may install it, reload the manager, or change shared services. Preserve token/ingress configuration and API release-readiness policy. If the live command or dependency graph differs from the expected source, resolve that difference before installation rather than overwriting it blindly.

After the authorized manager reload, capture the resolved properties with this read-only command:

```bash
systemctl show cloudflared.service --property=Id,LoadState,UnitFileState,After,Before,Wants,Requires,Requisite,BindsTo,PartOf,Conflicts,ConflictedBy,PropagatesStopTo,StopPropagatedFrom,Type,Restart > tunnel-systemctl-show.txt
```

Validate the redacted captured file locally:

```bash
node deploy/hetzner/verify-shared-tunnel-dependencies.mjs --snapshot tunnel-systemctl-show.txt
```

The validator requires loaded/enabled/notify/on-failure state, startup ordering and pull-in of both APIs/network, complete nonduplicate property data, and no direct service requirement, conflict, or stop/restart propagation. The pass must be accompanied by the effective unit/configuration inspection and live evidence.

Complete these acceptance checks in the authorized work package:

1. Continuously sample Production public readiness before, throughout, and after a Dev API stop/restart. Assert its expected SHA and database/Auth/Storage readiness; record every sample/time/failure. Record unchanged Production API PID and connector PID/start timestamp. During Dev downtime, verify Production remains routable while Dev cannot report readiness. After restart, require the Dev expected SHA and a fresh instance before accepting recovery.
2. Verify on a disposable Linux/systemd environment that boot/start pulls in both origins before connector notification, and that a failed Dev origin does not prevent the Production route. Separately exercise a connector failure/restart, wait for its notification, and check both routes. Fixtures and local source checks cannot substitute for these systemd jobs.
3. Verify intentional stop/recovery ordering on the disposable environment and the next separately authorized recovery drill: Compose readiness, Production API health, explicit connector start/notification, then public recovery. Exact release-readiness checks remain required for a promotion.
4. Record boot enablement and effective dependency graph on the host. A real host reboot, Production API stop, backup freeze, or tunnel restart is another shared/Production operation requiring its own authorized scope; do not perform it merely to fill this checklist.

On a failure, restore the captured full unit and relevant links using the authorized operator and manager reload. Recover service state through the approved recovery procedure, then verify both public routes. Keep #229 open until independent review, effective host dependencies, live Dev stop/restart routing, and startup/recovery evidence meet its acceptance criteria. No Production/shared change or live routing proof occurred in this implementation session.

## Primary sources checked 2026-10-08

- [systemd v255 unit documentation](https://github.com/systemd/systemd/blob/v255/man/systemd.unit.xml): `Wants=` pulls in startup jobs without making their failure invalidate the wanting unit; `Requires=` couples explicit stops/restarts. Ordering is separate. Dependencies in drop-ins cannot be reset to empty. v255 is a bounded reference for the Ubuntu 24.04 target; the actual installed version remains an external check.
- [systemd v255 service documentation](https://github.com/systemd/systemd/blob/v255/man/systemd.service.xml): `simple` startup and `notify` readiness have different completion boundaries. Preserve connector notification while keeping application readiness in the release validator.
- [Cloudflare Linux service documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/): cloudflared runs as its own Linux system service, with explicit service start/status operations. Local implementation consequence: origin lifecycle does not need to own the shared connector lifecycle.

The `Wants=` choice and acceptance sequence are implementation conclusions drawn from these sources and the observed issue. The sources do not prove the installed unit or public routing behavior. The coordinator owns the corresponding research-log entry and continuity/evidence updates.

## Read-only effective-host inspection — 2026-10-08

Coordinator inspected the root-owned unique Hetzner marker, resolved unit properties and command metadata without changing services or reading token contents. Live systemd is255.4-1ubuntu8.17; the connector is loaded/enabled/active/notify/on-failure, PID2515930. It still requires both `mizyun-api-dev.service` and `mizyun-api.service`, and wants only network-online; the new direct-property validator rejects this snapshot with the four expected dependency errors. There are no reported drop-ins. Token-file command and every normalized nondependency directive match the reviewed local template. Production API PID3086051 and Dev API PID2496699 were observed, not restarted.

This makes the replacement difference concrete: change only Requires/Wants dependencies while retaining the reviewed installation directives. It does not prove uninterrupted routing, authorize installation or waive effective dependency/alias/link review at installation time. Redacted property/checksum evidence is retained with the batch record.

## Authorized live installation and Dev promotion — 2026-10-08

Adam explicitly approved the minimal dependency correction/manager reload while preserving command/token/routes/processes. Exact source1b9b5f61ca5123ebeb079b85cf670fdc2016326e passed fresh clean-candidate gates and was published. The independently reviewed installer checked the unique root-owned marker, exact old directive/checksum correspondence, absence of drop-ins, staged systemd syntax, rollback backup and all3 active/nonzero PIDs/start times. Rollback file: `/var/backups/mizyun-cloudflared-20261008-before-dependency-correction.service`, root-owned mode0600. It installed the corrected full unit and reloaded; effective dependency validator PASS and identical all3 process snapshots. No service start/stop/restart was part of this correction. Subsequent authorized Dev promotion stopped/restarted only Dev:251Production health samples all200,4Dev502 samples then fresh ready new SHA. Production/tunnel PID and starts unchanged. Stronger Production readiness is unavailable on legacy source; boot/connector failure/intentional backup recovery remain unrun. #229 closed at Adam’s direction with those unobserved gates preserved. Earlier unrun/open statements describe the original local-only phase. [Current delivery evidence](MAIN_DEV_DELIVERY_2026-10-08.md).
