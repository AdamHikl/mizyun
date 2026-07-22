# Founder seven-day dogfood log

Record only workflow evidence—never meals, weights, measurements, photos, exercise values, account identifiers, or export contents. A row counts only after that calendar day's real use; do not pre-fill future dates.

| Day | Date    | Platform/build | Meal    | Workout | Body    | Dashboard/review | Restart restoration | Analytics event count checked | P0/P1 outcome | Evidence note |
| --- | ------- | -------------- | ------- | ------- | ------- | ---------------- | ------------------- | ----------------------------: | ------------- | ------------- |
| 1   | pending | pending        | pending | pending | pending | pending          | pending             |                             0 | pending       | —             |
| 2   | pending | pending        | pending | pending | pending | pending          | pending             |                             0 | pending       | —             |
| 3   | pending | pending        | pending | pending | pending | pending          | pending             |                             0 | pending       | —             |
| 4   | pending | pending        | pending | pending | pending | pending          | pending             |                             0 | pending       | —             |
| 5   | pending | pending        | pending | pending | pending | pending          | pending             |                             0 | pending       | —             |
| 6   | pending | pending        | pending | pending | pending | pending          | pending             |                             0 | pending       | —             |
| 7   | pending | pending        | pending | pending | pending | pending          | pending             |                             0 | pending       | —             |

## Daily procedure

1. Use the installed standalone build, not a web rendering or mocked API.
2. Complete the normal actions genuinely needed that day. A rest day may mark Workout `not applicable`; it must not invent a workout.
3. Confirm the authoritative record/dashboard state before counting an action.
4. Force-stop and relaunch once; confirm session and stored records restore.
5. Open Account and record only the local analytics event count—not the event contents.
6. Log any defect or repeated friction in [`ISSUE_LOG.md`](./ISSUE_LOG.md) with synthetic reproduction steps.
7. If a P0/P1 occurs, mark the row failed, stop external recruitment, fix it, and reverify. Do not erase the failed evidence row.

## End-of-week procedure

- Voluntarily export the identifier-free analytics JSON to an access-controlled local folder outside this repository.
- Validate and aggregate it with `pnpm alpha:analyze -- <path>`.
- Record only aggregate buckets in [`RESULTS.md`](./RESULTS.md).
- Confirm the seven dates are consecutive; a missed day restarts the seven-day completion window rather than being backfilled.
