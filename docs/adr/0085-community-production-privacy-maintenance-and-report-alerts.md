# ADR-0085 — Community Production privacy maintenance and report alerts

- Status: accepted for implementation, 2026-10-27 (review findings PRIV-03 and TNS-01; #153, #319). Not installed on Hetzner by this ADR: Adam installs the units after the migration reaches Production.
- Amends: ADR-0078 (Production feature release), which opened Community to every Production user without a Production maintenance runner or a reachable moderator.

## Context

Since ADR-0078, Community is open to all Production users. Two gaps remained:

- **PRIV-03.** Withdrawn profiles, the retention windows (365-day cards, 30-day revoked cards and receipts, 180-day closed-case evidence, inbox limits) and removed-media cleanup are applied only by `runCommunityTick` in `scripts/community-worker.mjs`. Its only runner, `mizyun-community-dev-maintenance`, is pinned to Dev. In Production nothing ran, although the privacy policy promises these windows.
- **TNS-01.** Reports are stored, but no Production moderator can use them yet (no aal2 MFA factor, no staff row, no `COMMUNITY_MODERATOR_USER_IDS`), and nothing tells the founder that a report arrived or is overdue. The moderation runbook targets a first response within 4 hours (urgent) and 24 hours (normal).

## Decision

1. **Separate Production systemd units, not an in-API job.** `mizyun-community-maintenance.service/.timer` runs `scripts/community-production-maintenance.mjs maintenance` every five minutes as the `mizyun` user with `/etc/mizyun/production.env`. It mirrors the Dev runner: fixed `http://127.0.0.1:8000`, the root-owned Hetzner host marker, Production API/database markers, and it refuses any Dev marker (`:8100`, `:5433`, port 4100, `MIZYUN_DEV_DB_URL`) before any network use. It never claims push jobs or contacts a provider: delivery stays off under ADR-0078.
   - We chose units over the API's in-process pattern (`createAnalyticsRetentionWorker`) because a unit gives a nonzero exit that systemd can alert on, a journal of per-run counters, and a lifecycle independent of API restarts and deploys. The in-process worker only logs a failure.
   - Five minutes instead of Dev's one minute. Each tick takes `community_lock()`, and the retention windows are measured in days. A tick handles up to 10 withdrawal generations, so Production throughput stays far above the 24-hour completion target.
   - `OnCalendar` timers keep firing after a failed run. `runCommunityTick` now also returns `withdrawalJobs`, `retentionRows` and `mediaCleaned`.
2. **Hourly attention check.** The service-only function `community_operations_alert_counts(p_new_window_seconds)` returns aggregate counts and ages only: open, unclaimed, urgent unclaimed, past first-response clock, open over 7 days, new in the window, and the pending withdrawal backlog. It never returns ids, text or user identifiers. `mizyun-community-attention.service/.timer` calls it hourly and exits 3 when there is an urgent unclaimed report, a report past its first-response clock, a new report in the last 65 minutes, an unclaimed report older than 12 hours (which catches reports whose new-report window passed while the check was down), a withdrawal pending for more than 24 hours, or, once a day at 08:00 UTC, an open case older than 7 days (the runbook's weekly overdue review). The journal keeps the counts. A report that arrives near an hour boundary can alert twice.
3. **Alerting reuses `mizyun-send-alert`.** Both units use `OnFailure=mizyun-community-alert@%n.service`, which runs the existing `/usr/local/sbin/mizyun-send-alert` (journald plus the optional `/etc/mizyun/alerts.env` webhook). The template allows at most three alerts per failing unit per hour, which the hourly attention check never reaches, so a new urgent report is never throttled. The alert text names the unit and the `journalctl` command only. It is separate from the backup alert template and from the general OPS-01 alerting units.
4. **Moderator activation stays a manual founder step.** The runbook section "Production activation" in `docs/tutorials/COMMUNITY_OPERATIONS_RUNBOOK.md` lists the TOTP enrollment, the staff row, `COMMUNITY_MODERATOR_USER_IDS`, unit installation, a synthetic end-to-end report, and how to close enrollment through `community_operations`. No staff identity or MFA factor is created by code.

## Consequences and limits

- These are source changes. Production retention is not applied until the migration is promoted and Adam installs and enables the units and confirms a successful journal entry. TNS-01 is not closed until a named moderator completes the synthetic report drill in Production.
- The alert channel is only as good as `/etc/mizyun/alerts.env`. Without a webhook, alerts reach journald/syslog only, which nobody reads in real time.
- "New report" alerts tell the founder to look; they are not a response-time guarantee. The coverage, backup-moderator and appeal-reviewer gaps in `COMMUNITY_MODERATION_RUNBOOK.md` remain open.
- The attention check reads counts with the service role over localhost Supabase. It does not inspect reports, so it creates no moderation audit entries.
