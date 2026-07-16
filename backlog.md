# Mizyun backlog

> Executable work inventory. The roadmap and dependency order live in `plan.md`. Keep each item small enough to finish and verify in one focused segment where practical.

## Status and priority

- Status: `ready`, `research`, `active`, `blocked`, `done`
- Priority: P0 blocks safe progress/release; P1 is MVP-critical; P2 is valuable; P3 is optional/later.

## Now — Phase 1

| ID       | Priority | Status | Work item                                               | Done when                                                |
| -------- | -------- | ------ | ------------------------------------------------------- | -------------------------------------------------------- |
| BE-001   | P0       | done   | Choose local/hosted Supabase development workflow       | ADR-0003: local-first with separate hosted integration   |
| TOOL-001 | P0       | done   | Start the installed Docker Desktop runtime              | Docker engine verified and local stack starts            |
| BE-002   | P0       | done   | Configure local development Supabase project            | Local stack starts from committed configuration          |
| BE-003   | P0       | done   | Apply and validate all migrations                       | Clean reset and database lint pass                       |
| SEC-001  | P0       | done   | Add automated RLS isolation tests                       | All current pgTAP schema/RLS assertions pass             |
| SEC-002  | P0       | done   | Complete private-media isolation tests                  | Path tests pass; signed-URL API test remains             |
| CFG-001  | P1       | done   | Add validated API and mobile configuration modules      | Missing/invalid config produces typed, actionable states |
| API-001  | P1       | done   | Create provider-neutral authenticated mobile API client | Tokens attach/refresh; 401 and network errors normalize  |
| AUTH-001 | P1       | done   | Test real sign-up/sign-in/session restore               | Verified against local Supabase in iOS simulator         |
| AUTH-002 | P1       | done   | Add account/settings screen with sign-out               | Signed-in user can explicitly end the session            |
| AUTH-003 | P1       | done   | Implement password recovery and confirmation flows      | Deep-link and error states verified                      |
| OPS-001  | P1       | done   | Establish safe structured API logging/error baseline    | Request IDs present; sensitive bodies/tokens excluded    |
| AND-001  | P1       | ready  | Configure and verify Android emulator                   | Clean Android Metro/runtime launch documented            |

## Next — Phases 2–5

| ID        | Priority | Status   | Work item                                    | Dependency                 |
| --------- | -------- | -------- | -------------------------------------------- | -------------------------- |
| PROF-001  | P1       | blocked  | Profile domain/repository/API slice          | Phase 1 isolation baseline |
| GOAL-001  | P1       | blocked  | Goal model, validation, and history          | PROF-001                   |
| UX-001    | P1       | blocked  | New-user onboarding flow                     | PROF-001, GOAL-001         |
| NUT-001   | P1       | blocked  | Manual food CRUD vertical slice              | Phase 1 repositories       |
| NUT-002   | P1       | blocked  | Daily macro/calorie summary                  | NUT-001                    |
| ENG-001   | P1       | research | Select/version deterministic energy formulas | Profile/goal requirements  |
| ENG-002   | P1       | blocked  | Energy target and balance engine             | ENG-001, NUT-002           |
| EX-001    | P1       | blocked  | Custom exercise CRUD                         | Phase 1 repositories       |
| WO-001    | P1       | blocked  | Workout templates and sessions               | EX-001                     |
| WO-002    | P1       | blocked  | Set logging and previous-performance view    | WO-001                     |
| BODY-001  | P1       | blocked  | Weight/measurement tracking and trends       | Profile vertical slice     |
| MEDIA-001 | P0       | blocked  | Private upload/sign/delete adapter           | SEC-002                    |
| MEDIA-002 | P1       | blocked  | Progress photo timeline/comparison           | MEDIA-001                  |
| DATA-001  | P0       | research | Define export/account deletion lifecycle     | Stable repositories/media  |

## Later — Phases 6–9

| ID             | Priority | Status   | Work item                                    | Entry gate                       |
| -------------- | -------- | -------- | -------------------------------------------- | -------------------------------- |
| IOS-HEALTH-001 | P2       | research | HealthKit permissions and steps adapter      | Phase 5                          |
| AND-HEALTH-001 | P2       | research | Health Connect permissions and steps adapter | Android verified                 |
| MEM-001        | P0       | blocked  | Persistent memory adapter and controls       | AI checklist + isolation tests   |
| AI-001         | P0       | blocked  | Evaluate/select initial model provider       | `docs/BEFORE_TESTING.md`         |
| AI-002         | P1       | blocked  | Text coaching adapter and tool layer         | AI-001, MEM-001                  |
| VISION-001     | P1       | blocked  | Editable text/photo food drafts              | Manual nutrition + AI evaluation |
| VISION-002     | P2       | blocked  | Conservative body-progress observations      | Media + safety evaluation        |
| REL-001        | P0       | blocked  | Privacy/export/deletion release gate         | MVP repositories complete        |
| REL-002        | P0       | blocked  | iOS/Android beta build matrix                | MVP feature complete             |
| REL-003        | P1       | blocked  | Accessibility and poor-network pass          | MVP feature complete             |

## Parking lot

These ideas are not commitments and should not displace MVP work without updating `goals.md` and `plan.md`:

- barcode scanning and external nutrition databases;
- Apple Watch/Wear OS companion experiences;
- coach/client team accounts;
- social sharing, challenges, or leaderboards;
- meal planning and grocery lists;
- advanced periodization and readiness models;
- subscriptions and billing;
- localization beyond architecture readiness.

## Maintenance rules

- Assign a new stable ID; do not renumber existing items.
- Mark an item `active` only when it is the current work package in `status.md`.
- Record blockers as dependencies, not vague notes.
- Move completed implementation detail to Git history; retain the row as `done` until the containing phase completes.
- New durable scope must map to a goal and product requirement before implementation.
