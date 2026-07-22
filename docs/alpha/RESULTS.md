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
