# ADR 0010: Weight trend semantics

- Status: accepted
- Date: 2026-07-19

## Context

Scale weight is noisy and users measure at irregular intervals. BODY-02 requires both raw measurements and a clearly labeled trend. A row-count moving average would implicitly pretend every observation has equal time spacing, while displaying a regression from too little data would create false precision.

## Decision

The pure core trend summary:

- filters to confirmed, finite weight observations and preserves raw rows separately;
- calculates the displayed smooth weight with elapsed-time exponential smoothing and a seven-day half-life;
- calculates weekly change by least-squares regression over observations in the newest 28 days;
- returns `weeklyChangeKg: null` and `status: "insufficient"` until at least three weights in that window span seven days;
- rounds canonical outputs to three decimal places and converts only for display.

## Consequences

- Irregular gaps affect smoothing by elapsed time rather than row count.
- The UI can explain exactly what is smoothed, what time window produced the rate, and when evidence is insufficient.
- Raw observations remain the authority and are never replaced by the trend.
- This is a descriptive wellness trend, not a diagnosis or a claim about body composition.
