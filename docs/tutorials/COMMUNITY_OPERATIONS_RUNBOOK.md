# Community operations — COMM-14 / #153

Candidate procedure,2026-09-30. No installed worker, live alert, Dev deployment or restore acceptance is claimed. Enrollment remains closed; named coverage/contact was deferred until actual Community functionality is exercised.

## Controls and safe reductions

API environment flags: `COMMUNITY_ENABLED`, `COMMUNITY_ENROLLMENT_ENABLED`, `COMMUNITY_DISCOVERY_ENABLED`, `COMMUNITY_PUBLISH_ENABLED`, `COMMUNITY_ENGAGEMENT_ENABLED`, `COMMUNITY_DELIVERY_ENABLED`. Only exact `true` enables a supplied flag; the global switch and every growth/delivery flag default false. Existing mobile admission decision remains closed. Database singleton `community_operations` independently gates profile growth, exact-handle discovery, invitations, publication, engagement and worker preparation. `cohort_required` restricts growth/delivery to service-managed `community_pilot_cohort`; missing control row fails closed. Set both API and database controls for a freeze; an API process flag cannot protect direct authenticated database access by itself.

The global `COMMUNITY_ENABLED`/database `enabled` switch also stops social browsing, and current database cohort membership is required for social reads/delivery. Individual growth flags can freeze new actions while admitted browsing remains authorized. Forward210000 starts database growth/delivery/global enablement false and `cohort_required=true` with an empty cohort. Activation requires an explicit service-side decision in the exact target environment; mobile settings cannot bypass this boundary.

A freeze leaves report/block/mute/unreact/unpublish/withdraw/export/delete and private tracking available. Cancel/decline/unfollow reductions remain available. Do not reset data or silently turn on a new environment/cohort. Verify exact target host/service/database marker under the deployment skill before operational changes.

## Bounded maintenance and delivery tick

`scripts/community-worker.mjs` performs one bounded tick. It requires `COMMUNITY_WORKER_TARGET=dev|production`, exact matching `COMMUNITY_WORKER_SUPABASE_URL` (`https://mizyun-supabase-dev.phiskel.com` or `https://mizyun-supabase.phiskel.com`) and `COMMUNITY_WORKER_SERVICE_KEY` loaded from the existing environment service secret file, never CLI arguments/mobile/logs. Wrong-target URLs fail before any RPC. Delivery additionally requires `COMMUNITY_DELIVERY_ENABLED=true` plus enabled database delivery/cohort.

A tick polls at most10 withdrawal jobs, each at most20 batches with500-row per-table bounds, runs one500-row per-table retention batch, and claims at most20 push jobs serially, one just before each dispatch. Under service management schedule every minute; an overlapping tick is permitted by claim leases/idempotent withdrawal generation locks, but serialize deploy/database maintenance. A nonzero exit alerts the named operator. Installation/scheduling and real alerts must be verified on Hetzner before admission; the source runner itself is not operational evidence.

Withdrawal immediately hides shares/revokes graph/invitations via existing transactional triggers. Durable generation jobs then remove associated rows; re-enrollment remains blocked until complete. Cleanup retries never touch a newer active generation. Deletion requires the existing exact account-job/worker/live lease; adapter processes up to20 batches before Auth deletion and preserves Auth on incomplete/failed work. Do not bypass these barriers. Existing immediate visibility cleanup is still synchronous; high-degree elapsed-time measurements remain a required capacity gate.

Push claims start a30-second lease immediately before each serial dispatch; later jobs are not leased while earlier sends run. They use a second current-authority check, owner session/generation, recipient/actor eligibility, block/mute, current immutable reaction/version, category/mute/quiet-hours and expiry checks. Five attempts/backoff up to1 hour and1-day expiry bound retry growth. Device registry has five installations/account; inbox500 rows/account, separate30-day dedupe ledger5000/account. Logical effects are transactional/idempotent; external push is at least once. A timeout after provider acceptance can duplicate an OS banner. Generic lock-screen text and opaque event IDs limit disclosure; taps reauthorize. Revocation cannot retract an already handed-off banner or viewed information/screenshots. Expo ticket acceptance is not provider receipt or device delivery evidence. The worker polls at most20 provider receipts every15 minutes within1-day expiry, binds acknowledgement to the exact receipt and token hash, and never removes a newly rotated token for an old invalid response. Real receipt/device behavior must pass separately before enabling delivery.

## Monitoring, budgets and load gates

`community_operations_metrics()` is service-only aggregate queue/report/error data. Oldest queue age uses original event creation time (clamped to zero); retry readiness is a separate count and never resets age. Worker output contains aggregate counts only. Request logs redact Community paths; never log handles, edges, report text, tokens, opaque IDs, workout values or profile content. Routine operational telemetry is distinct from optional product analytics. No Community analytics events are added pending OBS schema/consent review; analytics refusal/failure cannot block participation/private tracking.

Proposed admission thresholds to accept on actual Dev hardware:30 eligible opt-in users;100 approved follows/user maximum;20 cards/page; feed p95<=250ms and error rate<1% during representative burst; delivery queue oldest<15 minutes outside quiet hours; maintenance completed<24 hours; urgent report first response4 hours and normal24 hours per moderation runbook. These are proposed targets, not measured Hetzner results. Alert backlog/repeated worker failures and breached response targets to the verified primary/backup; record cost per active user from aggregate hosting/provider usage with a founder-approved cap before admission.

Source limits include fixed database UTC usage quotas, follow/pending/follower caps, exact discovery, bounded keyset pages, no per-follower activity fanout and no public Explore. Retain SQL plans/dataset/hardware and measure the100-follow fixture before declaring capacity accepted. The feed probes a partial `(user_id,published_at DESC,id DESC)` index for at most100 approved authors plus self and at most one page per author, rather than testing every shared card globally. The existing live graph cap is30;100-follow service fixtures are a stress envelope and do not raise admission limits. Small datasets may legitimately use bounded sequential scans; proving production query scaling requires actual plans rather than source assertions.

## Recovery and admission

Before serving a restored database, keep all growth/delivery/admission controls off. Apply forward migrations and replay all account-deletion tombstones, withdrawal generations, activity revocations, blocks and sanctions newer than the snapshot from a separately durable revocation ledger. Verify with two synthetic principals that no revoked card/graph/push becomes visible. The existing daily encrypted backup RPO/90-day recovery retention is not proof of a complete revocation ledger; missing ledger/restore replay is a launch blocker. Run an outage/restart/lost-response/backlog drill plus #25/#26 restore acceptance, record exact SHA/migrations/environment and operator response times, then record founder go/no-go. Do not reopen a wider pilot using the founder/testing-partner Dev exception.

## Authorized founder Dev functional testing — 2026-09-30

Adam authorized Dev-only testing and identified his existing Dev account. In Dev, enable API/DB browsing, enrollment, discovery, publication and engagement while retaining `cohort_required=true`; add only the explicitly identified Dev principal. Do not auto-enroll or mutate birth year, adult declaration, terms, social identity, graph or publications. The standalone Dev client enables the deliberate form only for exact validated Dev endpoints/variant; Production stays closed. The admission exception is for founder functional testing and does not waive the wider operator/legal/pilot exit criteria.

Install only `mizyun-community-dev-maintenance.service` and `.timer` from this candidate into the Dev host systemd directory. Unit executes `scripts/community-dev-maintenance.mjs` as `mizyun-dev-api` with Dev env, fixedlocalhost8100 and guards for Dev service4100/DB5433/hostmarker. It supplies no push/receipt callbacks, never claims delivery jobs, and fails before network use on target mismatch. The timer runs after30seconds and60seconds after the last completion, with90-second execution timeout; partial transaction-safe batches can resume. Check successful journal counters and active timer, not just installed files. This is privacy maintenance, not a push sender or account-deletion-job resumer.

Keep deliveryfalse for this phase. Use **Account → Privacy & data → Community**, read the rules, deliberately join, then **View following feed**. Private workout saving remains separate from explicit sharing. Add a testing partner only after Adam identifies that Dev account; self-only cohort cannot prove approved-friend journeys.

## Production activation — privacy maintenance and moderation (ADR-0085, 2026-10-27)

Founder steps for #153 (PRIV-03) and #319 (TNS-01). Do them after the commit carrying migration `20261027130000_community_operations_alert_counts` is promoted with `pnpm deploy:production <sha>`. Nothing below is done by the source change. Record redacted evidence (timestamps, SHA, unit status, counts) in `status.md`.

### 1. Enroll the moderator's MFA

The moderator needs a normal Production Mizyun account (sign up in the Production app if it has none). On the Mac, in a terminal you control:

```bash
node scripts/community-staff-session.mjs --env production -- --queue
```

Enter email, password and, on first use, scan the printed `otpauth://` URI into an authenticator app, then enter the 6-digit code. Expected: the helper reaches aal2 and the queue call answers **403**, because the account is not staff yet. A 403 here proves MFA works; it is not a failure.

### 2. Add the staff row and the API allow-list

Find the account's UUID and add it to the registry. Check the Production database container name first with `docker ps --format '{{.Names}}'` (the template uses `supabase-db`; confirm it is the Production one on port 5432, not Dev).

```bash
ssh mizyun-hetzner-ops "docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1 -c \"select id from auth.users where email='<moderator email>';\""
ssh mizyun-hetzner-ops "docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1 -c \"insert into public.community_moderation_staff(user_id,active) values('<uuid>',true) on conflict(user_id) do update set active=true; select user_id,active from public.community_moderation_staff;\""
```

Then add the same UUID to `COMMUNITY_MODERATOR_USER_IDS` (comma-separated) in `/etc/mizyun/production.env` and restart the API: `ssh mizyun-hetzner-ops 'systemctl restart mizyun-api.service && systemctl is-active mizyun-api.service'`. Rerun the step 1 command. Expected: the queue lists open reports (or an empty queue) instead of 403.

### 3. Install the maintenance and attention units

Confirm `/etc/mizyun/alerts.env` has `MIZYUN_ALERT_WEBHOOK_URL` and `/usr/local/sbin/mizyun-send-alert` is installed; without a webhook, alerts reach the journal only. From the Production checkout on the VM:

```bash
ssh mizyun-hetzner-ops 'cd /var/lib/mizyun/repo && install -m 0644 deploy/hetzner/mizyun-community-maintenance.service deploy/hetzner/mizyun-community-maintenance.timer deploy/hetzner/mizyun-community-attention.service deploy/hetzner/mizyun-community-attention.timer deploy/hetzner/mizyun-community-alert@.service /etc/systemd/system/ && systemctl daemon-reload'
ssh mizyun-hetzner-ops 'systemctl start mizyun-community-maintenance.service; journalctl -u mizyun-community-maintenance.service -n 5 --no-pager'
ssh mizyun-hetzner-ops 'systemctl start mizyun-community-attention.service; journalctl -u mizyun-community-attention.service -n 5 --no-pager'
```

Expected: maintenance logs one JSON line such as `{"claims":0,...,"withdrawalJobs":0,"cleanupBatches":0,"retentionRows":0,"mediaCleaned":0,"receipts":0}` and exits 0. Attention logs the counts and exits 0, or exits 3 with "Community needs attention: ..." if reports are already waiting, which also sends an alert. "target mismatch" means `production.env` lacks or differs from a guarded value (`SUPABASE_URL=http://127.0.0.1:8000`, `API_HOST=127.0.0.1`, `API_PORT=4000`, the canonical `MIZYUN_PRODUCTION_DB_URL`, the service key). Fix the environment, never the guard. When both runs are clean:

```bash
ssh mizyun-hetzner-ops 'systemctl enable --now mizyun-community-maintenance.timer mizyun-community-attention.timer && systemctl list-timers "mizyun-community-*" --no-pager'
```

While reports need attention, the attention unit stays in `failed` state between hourly runs, so `systemctl --failed` shows it and the host reads as degraded. That is expected; it clears on the next clean run. Alerts are limited to three per unit per hour; only a failing maintenance unit can reach that limit.

Read counters later with `journalctl -u mizyun-community-maintenance.service --since today --no-pager` and `journalctl -u mizyun-community-attention.service -n 3 --no-pager`. Do not install these units on Dev; Dev keeps `mizyun-community-dev-maintenance`.

### 4. Synthetic report end to end

Use two Production accounts you own other than the moderator (B and C), both joined to Community. The moderator cannot decide a case they reported or are the subject of.

1. In the Production app signed in as B, open C's Community profile and report it with **Spam** (normal priority).
2. `ssh mizyun-hetzner-ops 'systemctl start mizyun-community-attention.service; journalctl -u mizyun-community-attention.service -n 3 --no-pager'`. Expected: exit 3, "new report received", and a message on the webhook.
3. `node scripts/community-staff-session.mjs --env production -- --queue`. Expected: the report is listed. Then run the helper again with `-- --claim <report-uuid>` and once more with `-- --action dismiss --report <report-uuid> --reason "Synthetic Production drill"`.
4. Start the attention check again after the 65-minute new-report window. Expected: exit 0 and `unclaimedReports` back to its earlier value.

Record when you reported, when the alert arrived, and the claim and decision times. This proves the queue, the MFA path and the alert path. It does not prove named backup coverage, appeal review, or that the 4-hour and 24-hour clocks are met over time.

### 5. Close enrollment if moderation cannot be covered

If no moderator can meet the clocks, freeze growth while keeping report, block, withdraw, export and delete available. Set both layers:

```bash
ssh mizyun-hetzner-ops "docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1 -c \"update public.community_operations set enrollment=false,discovery=false,publish=false,engagement=false; select * from public.community_operations;\""
```

Then set `COMMUNITY_ENROLLMENT_ENABLED`, `COMMUNITY_DISCOVERY_ENABLED`, `COMMUNITY_PUBLISH_ENABLED` and `COMMUNITY_ENGAGEMENT_ENABLED` to `false` in `/etc/mizyun/production.env` and restart `mizyun-api.service`. Setting only `enrollment=false` closes new joins and keeps existing members active. `enabled=false` also stops browsing for everyone. Reopen with the same statements set back to `true`. The privacy maintenance timer must keep running during a freeze.
