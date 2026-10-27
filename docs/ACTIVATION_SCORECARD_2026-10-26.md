# Two-minute first value and the Monday scorecard (#335)

> 2026-10-26, Claude Code. Decision record: [ADR-0084](adr/0084-activation-scorecard-telemetry.md). Definitions: [InVenture plan](INVENTURE_PROGRAM_PLAN_2026-09-23.md). Implemented and automatically verified; not deployed, no device acceptance.

## 1. First-value path, measured from source

Counted from the mobile source at baseline `a3947503` (not on a device or simulator). A tap is a button, row, chip or alert press; each required text field counts as one tap plus typing. Start: a new account's first Home screen after sign-up.

| Path to                                        | Before: screens / taps                                 | After: screens / taps                                            |
| ---------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Top Home item                                  | "Set up Mizyun" wizard: 6 / 14 before any record       | "What do you want to log first?" card: 1 tap away from a capture |
| Bouldering session (finished, no boulders yet) | 3 / 4 (Workouts tab, Start bouldering, Finish, Finish) | 2 / 3 (card row, Finish, Finish)                                 |
| Bouldering session with one boulder            | 3 / 7                                                  | 2 / 6                                                            |
| Strength workout (finished)                    | 2 / 3 (Start workout, Finish, Finish & Save)           | 2 / 3 (card row instead of quick-log row)                        |
| Meal (name only)                               | 2 / 3                                                  | 2 / 3                                                            |
| Weight                                         | 2 / 3                                                  | 2 / 3                                                            |
| First Coach answer (incl. AI consent and 18+)  | 2 screens + consent modal / 5                          | unchanged: 5 (consent and adult checks kept)                     |

Optional first-run taps that do not block a capture: units (0 when metric), analytics consent (0–1), source question (0–1, after consent). The 14-tap wizard is now deferred: it stays on Home as "Set up Mizyun" after the first choice. A two-minute first record plus Coach answer is plausible at 3 + 5 taps, but no timing has been measured on a device.

## 2. Events

All strict, consent-gated and payload-free (enum values and coarse buckets only). See [OBSERVABILITY.md](OBSERVABILITY.md).

| Event                         | When                                                 | Properties                             |
| ----------------------------- | ---------------------------------------------------- | -------------------------------------- |
| `first_run_completed`         | A first-run choice, including "Just look around"     | `choice`, bucketed `duration`          |
| `acquisition_source_selected` | With the first-run choice, if a source was picked    | `source` (fixed list, no free text)    |
| `first_confirmed_record`      | First confirmed meal/workout/weight/bouldering save  | `recordKind`                           |
| `return_milestone_reached`    | First core action on local days 1–7 / 22–28 after it | `milestone` day_7/day_28, `cohortWeek` |
| `core_record_created`         | Existing; now also a confirmed bouldering session    | `recordKind` (+ `bouldering_session`)  |

"Onboarding" for activation is the first run. Core actions are confirmed saves through Log meal, Start/Finish workout, Log weight and a finished bouldering session. Not yet counted: Log run, Log activity, past workouts, review-only visits (MAU is therefore a lower bound).

## 3. Running the scorecard

`scripts/analytics-dashboard/scorecard.sql` is read-only and returns only counts. Run it on the Production database host with the same read-only access the dashboard collector uses, never against a Dev/Production checkout working tree:

```sql
SET mizyun.scorecard_report_date = '2026-11-30'; -- snaps to its ISO Monday; default today (UTC)
\i scripts/analytics-dashboard/scorecard.sql
```

| Metric                                       | Cohort                                                                   | Numerator / denominator                               |
| -------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `installs` (by source and `all`)             | First runs in the report week by accounts that signed up ≤7 days earlier | count / —                                             |
| `activated` (by source and `all`)            | First runs 14–8 days before                                              | first record within 7 days / cohort first runs        |
| `first_record_kind`                          | First records in the last 7 days                                         | count per kind / —                                    |
| `day_7_return`                               | Activations (first record ≤7 days after first run) 14–8 days before      | with a `day_7` return / activated cohort              |
| `week_4_return`                              | ISO week of first records 35–29 days before (`dimension`)                | `day_28` returns with that cohort week / **ledger**   |
| `first_record_cohort`                        | ISO week of the last 7 days                                              | activated count — record it; week-4 denominator later |
| `mau`                                        | 30 days before the report date                                           | accounts with a core action / consenting accounts     |
| `registrations`                              | Auth signups in the report week (all accounts, consent-independent)      | count / —                                             |
| `registered_accounts`, `consenting_accounts` | At the report date                                                       | coverage context                                      |

Every count is limited to accounts whose current consent is granted and whose events belong to the current consent epoch. An empty cohort is an explicit 0/0 row; `NULL` means "not computable from retained events" and must never be reported as zero. Events are kept 30 days, so run it every Monday and copy the rows (counts only) into the ledger below; a missed week leaves that week-4 denominator unavailable.

### Ledger (counts only)

| Report Monday | Installs                                                     | Activated / cohort | Day-7 / cohort | First-record cohort (week) | Week-4 / cohort (week) | MAU / consenting | Registered |
| ------------- | ------------------------------------------------------------ | ------------------ | -------------- | -------------------------- | ---------------------- | ---------------- | ---------- |
| —             | No production data yet: the events ship with the next build. |                    |                |                            |                        |                  |            |

## 4. Verification

- `pnpm analytics:scorecard:verify-db` runs the query against `scripts/analytics-dashboard/scorecard-fixture.sql` (9 synthetic accounts covering activation inside/outside 7 days, "Just look around", a revoked consent, a stale consent epoch, an older account seeing the card on a new device, a day-7 return, a week-4 return, an out-of-window and an old-account cohort label, MAU edges, a mid-week report date and an empty week) in a disposable `postgres:17-alpine` container that is removed afterwards. 2026-10-26: PASS, 15 aggregate rows, mid-week date equals its Monday, empty week reported as 0/0, write attempt rejected by the read-only transaction.
- `scripts/analytics-dashboard/scorecard.test.mjs` (in `pnpm test:analytics-dashboard`) checks the query stays read-only, consent/epoch-scoped and ID-free, and that the parser accepts only aggregate rows.

## 5. Open

- Release order: deploy the API before shipping a mobile build with these events (an older API rejects `activation-v1` and the new event names).
- Device acceptance: first-run card on a new Dev account (iPhone and Android), each capture path, the source question after consent, and a Coach answer inside two minutes.
- First weekly scorecard run on Production after a build with these events is released.
- Instrument Log run, Log activity, past workouts and weekly review as core actions if MAU should include them.
