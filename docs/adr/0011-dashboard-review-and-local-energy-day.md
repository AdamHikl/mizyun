# ADR 0011: Dashboard review and local energy day

- Status: accepted
- Date: 2026-07-21

## Context

MOB-DASH-001 must turn persisted nutrition, training, body, goal, and profile records into an honest daily energy state plus week/month progress reviews. A server-UTC definition of “today” would disagree with meal logging near midnight. A single current timezone offset applied to a historical month can also misclassify entries across a daylight-saving transition. Finally, partially specified nutrition must not be summed as though missing calories were zero.

## Decision

- The energy-summary query carries an explicit positive-east `utcOffsetMinutes`; the API derives the user's local date and queries that local day's UTC bounds.
- Onboarding collects height, birth year, activity level, and the formula sex input alongside baseline weight and the active goal. Existing users get the same editable inputs through a dedicated Home-stack route.
- The dashboard requests each day in the selected week-to-date or month-to-date review with that calendar date's own offset. This preserves local-day meaning across an offset transition.
- Review calories are `null` when any logged day has incomplete calorie data; empty days do not count as logged days.
- Training reviews count only completed workouts. Active or abandoned sessions do not inflate progress.
- The energy card exposes formula version, BMR, activity multiplier, TDEE, goal adjustment, target, confirmed inputs, and the engine's incomplete reason. It labels the result advisory and never fabricates a missing value.

## Consequences

- A month review can make up to 31 small summary requests. This is acceptable for the manual alpha and avoids silently wrong DST grouping; a future batched API may preserve the same per-date offset semantics if latency becomes material.
- Existing users can recover from an incomplete energy state without repeating onboarding.
- The dashboard remains a deterministic view over authoritative records. It does not promote model output or an inferred photo value into the calculation.
