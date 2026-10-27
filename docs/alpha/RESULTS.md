# ALPHA-001 aggregate results

> Copy only aggregate counts, coarse analytics buckets, and non-identifying qualitative themes here. Raw exports and participant-level rows remain outside Git.

## Sample status

- Founder consecutive days completed: 0 of 7
- Design partners enrolled: 0
- Design partners completing onboarding: 0
- Design partners completing repeated use: 0
- Voluntary valid analytics exports: 0
- Churned/stopped testers interviewed: 0

## Product analytics

Pending the first valid voluntary exports. Generate the safe aggregate with:

```bash
pnpm alpha:analyze -- /private/path/export-a.json /private/path/export-b.json
```

Record:

- export count and total cataloged events;
- onboarding-completed and activated export counts;
- return-day count distribution;
- per-flow started/completed/failed counts;
- duration and tap buckets;
- coarse feature-view and failure-reason counts.

Do not calculate a percentage with a denominator smaller than the disclosed sample, imply that exports equal unique users without confirming the workflow, or report exact time/tap values from bucketed data.

## First-value path (source-measured, 2026-10-26)

Counted from mobile source, not a device; details in [ACTIVATION_SCORECARD_2026-10-26.md](../ACTIVATION_SCORECARD_2026-10-26.md). Taps from a new account's first Home screen, before → after #335:

- Top Home item: setup wizard, 14 taps before any record → first-run card, 1 tap to a capture.
- Bouldering session saved: 4 → 3. Workout, meal, weight: 3 → 3.
- First Coach answer including AI consent and 18+ confirmation: 5 → 5.
- Device timing to first record and Coach answer: not measured.

Weekly scorecard counts (installs by source, activated, day-7, week-4, MAU with denominators) go in the scorecard ledger once the events ship.

## Qualitative themes

### Repeated value

Pending.

### Repeated friction

Pending.

### Churn/stopping reasons

Pending.

### Privacy/trust comprehension

Pending.

## Decisions

No product decision is supported until founder or participant evidence is recorded.

## Founder usage note — 2026-10-26

Adam states more than two months of daily founder use of the installed app (founder statement in session, not a register entry; the seven-day gate counts above were never updated). Frictions still felt should be listed here before the first external cohort.
