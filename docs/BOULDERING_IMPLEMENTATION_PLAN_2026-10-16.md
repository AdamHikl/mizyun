# Indoor bouldering implementation plan

> Planned 2026-10-16 (Claude Code). Package [BOULDER-001/#276](https://github.com/AdamHikl/mizyun/issues/276). Planning only: no runtime code, migration, build, deployment or provider call was made. Stages BLD-00 to BLD-06 below are proposals until each stage's exit criteria are evidenced.

## Implementation progress (2026-10-16, Claude Code)

Source-level implementation of BLD-00 to BLD-06 (challenge days) is committed on branch `worktree-bridge-cse_018Ygr4LHdqMb1XUUaMc7i8W`; nothing is deployed. Each stage is one commit: BLD-00 `1a7c2d42`, BLD-01 `4af310c2`, BLD-02 `c9014780`, BLD-03 `68fe626c`, BLD-04 `94206c73` (+ Coach route fix `2d95a404`), BLD-05 `c872098e`, BLD-06 (this commit). Migrations `20261016140000`, `20261016160000`, `20261016180000`, `20261016200000`; pgTAP `0048`–`0051`. Independent non-author Opus reviews of BLD-02, BLD-04 (server) and BLD-05 (server) found no blockers; their should-fix items are resolved. Decisions that differ from this plan are recorded in [ADR-0066](adr/0066-indoor-bouldering-sessions.md) and [ADR-0067](adr/0067-explicit-community-bouldering-publication.md): cross-kind active-session blocking is a client rule; projects are removed with their last boulder and Try again accepts archived projects; Community cards are sent only to clients declaring the kind; edits that don't change shared data don't revoke a card.

Adam accepted ADR-0066 and its sketches on 2026-10-16 (BLD-00 exit met). `pnpm db:verify` passed on `641549ed`. Open exits: iOS simulator and paired-simulator journeys; Dev deployment and iPhone acceptance; Android; VoiceOver/largest text. The photo-on-card part of BLD-06 is deferred: it needs a new ADR and Adam's decision after using BLD-05.

## A. Context and scope

### Product decision

Adam (2026-10-16) wants climbers to log indoor boulders in Workouts, see their grades improve over time, find it fun and rewarding, and share it with others through Community. The first audience is Adam and the testing partners on Dev. Grades use the **Fontainebleau (Font)** scale. Bouldering is a mode inside Workouts, not a new tab.

This is a deliberate founder-cohort extension. [goals.md](../goals.md) and [BUSINESS_ALIGNMENT.md](BUSINESS_ALIGNMENT.md) keep core private tracking as the priority; this package must not displace active P1 work or change Production availability. Under the Dev feature policy in `AGENTS.md`, implemented stages stay enabled on Dev while acceptance continues.

### User journey (first complete release)

1. Workouts → **Start bouldering**. A session starts at once (no form). Optional gym name.
2. Log a boulder in 2–3 taps:
   - **Grade**: one horizontal row of Font chips, pre-selected to the last grade used in this session (or the user's most frequent recent grade).
   - **Result**: **Flash**, **Sent** (attempts stepper starting at 2), or **Not yet** (attempts optional, defaults to 1).
   - **More** (collapsed): hold colour tag, short note, photo.
   - Save. A **Same again** chip repeats the last grade and colour with the result left unselected.
3. The session list shows each boulder as a row (grade badge, result icon + text, colour swatch + name, photo thumbnail). Rows can be edited or deleted.
4. **Finish** shows a summary: sends, flashes, attempts, top grade, and a celebratory **New personal best: 6C** or **First flash at 6B+** card when it is true. No streaks, no daily-consistency pressure.
5. **Not yet** boulders are saved as **projects** by default. Next session, **Projects** offers **Try again**; a later send shows **Sent after 4 sessions**.
6. **Progress**: a grade pyramid (sends per grade, 30 days / 90 days / all time), hardest send per session over time, and the projects list.
7. From the summary or history, **Share session** publishes a preview-confirmed card to approved followers. A bouldering session also counts as a workout day in existing cooperative group challenges.

### In scope

- Font bouldering grades 3 to 8C+, stored with the scale name so another scale could be added later.
- Session lifecycle with server-authoritative saves and recovery like active workouts (ADR-0009).
- Private photo per boulder via the existing private-media pipeline.
- Projects across sessions, personal-best detection, pyramid and timeline views.
- Explicit Community session card and challenge-day eligibility.
- Account export, account deletion and local-data cleanup for every new record.

### Non-goals

Outdoor crags, GPS and locations; rope routes or sport/trad grades; V-scale or any grade conversion; route/problem databases (theCrag, 27 Crags, Mountain Project); video; public leaderboards, rankings or discovery; streaks; calorie burn for bouldering; Coach advice about climbing; photos on Community cards in the first sharing stage; group-audience activity cards; Apple Watch / Wear OS bouldering controls; Health imports; Production release or Store work.

## B. Baseline and constraints

Baseline observed: `main` at `25402d4024bdbdf5c07388f5803306dbf6d86fbd`, clean worktree. Latest migration `20261015130000_recurring_meal_suggestion_weekly.sql`. Current SHAs and acceptance belong to [status.md](../status.md), not this plan. Re-check both at implementation start.

### Reuse confirmed by source inspection

| Existing source                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Reuse and limit                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual running ([ADR-0046](adr/0046-manual-running-authority.md), [plan](RUNNING_IMPLEMENTATION_PLAN_2026-10-06.md), migration `20261006120000_manual_running.sql`, commit `2ea23093`)                                                                                                                                                                                                                                                                                                  | Closest precedent. A run is one `workouts` row tagged `details.activityType = "running"` with a versioned summary, written only through security-definer RPCs with owner receipts, and guarded by `run_workout_guard` / `run_child_guard`. Copy the shape; bouldering differs because a session has many child records and a live in-progress state.                                                           |
| `workouts` table and `packages/core/src/workout-lifecycle.ts`                                                                                                                                                                                                                                                                                                                                                                                                                           | Sessions are `workouts` rows (`completed_at` null while active; `details.workoutLifecycle.kind = "session"`). Bouldering sessions use the same envelope with `details.activityType = "bouldering"`.                                                                                                                                                                                                            |
| `excludeRunning` in the workout repository port, Supabase/in-memory adapters, `apps/api/src/modules/coach/grounding.ts`, `coach/tools.ts`, `community/publication-routes.ts`                                                                                                                                                                                                                                                                                                            | Must be generalised (for example `excludeActivityTypes: ["running", "bouldering"]`) so bouldering sessions never appear as zero-set strength workouts or affect resistance progression.                                                                                                                                                                                                                        |
| ADR-0009 active workout recovery; `apps/mobile/src/features/workouts/active-workout-state.ts:26` (`findIncompleteWorkout`), `active-workout-context.tsx`, `components/active-workout-mini-bar.tsx`                                                                                                                                                                                                                                                                                      | Server-authoritative per-record saves and recovery of the newest incomplete session. `findIncompleteWorkout` must distinguish bouldering from strength sessions so each resumes into the right screen, and starting one kind while the other is active needs an explicit rule (BLD-00).                                                                                                                        |
| Private media: `media_assets` (`purpose` already allows `'workout'`), `POST /v1/media/upload-url`, `apps/mobile/src/features/progress-photos/progress-photo-data.ts` (`uploadProgressPhoto`), `progress-photos-screen.tsx:55-71` (2048 px edge, JPEG re-encode)                                                                                                                                                                                                                         | Reuse purpose `workout`, upload ticket and re-encode. Re-encoding via ImageManipulator is the metadata-removal step; Expo's `exif: false` only controls the returned object (see F). Byte deletion on account erasure is covered by `sweepUserMedia` for anything recorded in `media_assets`.                                                                                                                  |
| Community publication ([ADR-0030](adr/0030-explicit-community-publication.md), [ADR-0056](adr/0056-explicit-community-meal-publication.md), meal commit `e2452f01`)                                                                                                                                                                                                                                                                                                                     | `shared_activities.activity_kind` (`workout`, `meal`) plus a details snapshot rebuilt by an allowlisted DB projection under `community_lock()`, source-change revocation trigger, ADR-0052 reduction capture, export/feed wrappers. A `bouldering` kind follows the nine-step meal recipe. Audience is owner + approved followers only; there is no group audience for cards today. Meal cards exclude photos. |
| Cooperative challenges (`20261001205000_community_challenges.sql`)                                                                                                                                                                                                                                                                                                                                                                                                                      | Day-count only: one `workout` or `rest` contribution per user per day, validated against a completed workout. Running is blocked by `run_challenge_guard`. Allowing completed bouldering sessions as `workout` days needs no new metric. A sends-count metric is a later, separate change.                                                                                                                     |
| Mobile UI: `src/components/ui` (`Chip`, `SegmentedControl`, `ListRow`, `Card`, `Notice`, `EmptyState`), `src/constants/theme.ts`, `exercise-progression-modal.tsx` (`ProgressionChart`, View-built bars)                                                                                                                                                                                                                                                                                | No chart library is installed. Build the pyramid and timeline from Views like `ProgressionChart`; adding `react-native-svg` is not justified for these two charts.                                                                                                                                                                                                                                             |
| Feature gating: `apps/mobile/src/composition/app-variant.ts` (`isProgressPhotosEnabled`), server env flags such as `MIZYUN_MEAL_RECIPES_ENABLED` (`apps/api/src/app.ts`)                                                                                                                                                                                                                                                                                                                | Add `isBoulderingEnabled()` (Dev on, Production off unless an explicit `extra` flag) and a server `MIZYUN_BOULDERING_ENABLED` flag, enabled on Dev.                                                                                                                                                                                                                                                            |
| Lifecycle registries: `supabase/tests/database/0001_schema_security.test.sql:32-45`; account export across `packages/adapters/supabase-server/src/account-repository.ts`, `packages/core/src/account.ts`, `packages/contracts/src/account.ts`, `apps/api/src/modules/account/routes.ts`, in-memory `apps/api/src/account-repository.ts`; [ACCOUNT_EXPORT_INVENTORY](ACCOUNT_EXPORT_INVENTORY.md); `apps/mobile/src/features/settings/account-data-management.ts` (`clearLocalUserData`) | Every new table and local draft must be registered in all of these. Mutation RPCs reject callers with an `account_deletion_jobs` row in progress/failed/completed (pattern: `manual_running.sql:68`).                                                                                                                                                                                                          |

Nothing about climbing, boulders or grades exists in source today (only catalog exercises like "Rope Climb").

### Font grade scale

Ordered values (23): `3, 4, 4+, 5, 5+, 6A, 6A+, 6B, 6B+, 6C, 6C+, 7A, 7A+, 7B, 7B+, 7C, 7C+, 8A, 8A+, 8B, 8B+, 8C, 8C+`, ranks 0–22. Nothing above 8C+ in this release. Store `grade_scale = 'font'`, the canonical `grade_code` and a server-derived `grade_rank` (ordinal). Comparisons, personal bests and charts use `grade_rank` only. Uppercase letters are canonical; input parsing accepts `6a+` and normalises. Gym grades are setter opinions; the UI never claims cross-gym comparability. The pure scale lives in `packages/core/src/bouldering-grades.ts`. Changing the list later is a versioned contract change.

### Data model (proposed; BLD-00 records it in an ADR)

**Session** — one `workouts` row:

```ts
type BoulderSessionDetailsV1 = {
  activityType: "bouldering";
  workoutLifecycle: { kind: "session" };
  boulderSession: {
    version: 1;
    gradeScale: "font";
    recordingTimezone: string; // IANA, captured at start
    activityDate: string; // YYYY-MM-DD local start day
    gymName: string | null; // ≤60 chars, optional
  };
};
```

`started_at` / `completed_at` are real observed instants (unlike date-only runs). Session notes reuse `workouts.notes`.

**Boulder** — new table `public.boulder_ascents` (name is a proposal):

| Column                                                                                                                | Rule                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `id uuid pk`, `user_id uuid not null references auth.users on delete cascade`                                         | Owner. Index `(user_id, logged_at desc)`.                                                                     |
| `workout_id uuid not null`, FK `(workout_id, user_id) → workouts(id, user_id) on delete cascade`                      | Ownership preserved (SEC-02). The session must be a bouldering session (trigger/RPC check).                   |
| `client_operation_id uuid not null`, unique `(user_id, client_operation_id)`                                          | Create idempotency (REL-01).                                                                                  |
| `sequence int > 0`, unique `(workout_id, sequence)`                                                                   | Display order.                                                                                                |
| `grade_scale text = 'font'`, `grade_code text` (check in list), `grade_rank smallint` (derived, 0–22)                 | Server derives rank from code; client value is never trusted.                                                 |
| `result text in ('flash','sent','not_yet')`                                                                           |                                                                                                               |
| `attempts smallint null`                                                                                              | `flash` → 1; `sent` → 2–99 or null (unknown); `not_yet` → 1–99 or null. Constraint enforces the combinations. |
| `hold_colour text null` in a fixed list (`red, orange, yellow, green, blue, purple, pink, black, white, grey, other`) | Always rendered as swatch **and** text (UX-01).                                                               |
| `note text null` ≤280                                                                                                 |                                                                                                               |
| `photo_asset_id uuid null → media_assets(id) on delete set null`                                                      | RPC checks the asset is owned by the caller, purpose `workout`, not deleted.                                  |
| `project_id uuid null → boulder_projects` (added in BLD-04)                                                           |                                                                                                               |
| `logged_at timestamptz`, `created_at`, `updated_at`, `revision int`                                                   | Edit compare-and-swap.                                                                                        |

**Receipts** — `public.boulder_operation_receipts` modelled on `run_operation_receipts` (operation id, kind create/update/delete, ascent id, payload digest, accepted revision, deleted flag; no notes or grades). Prevents a delayed create from resurrecting a deleted boulder and makes lost-response retries return the same row. Owner-select RLS, service-role writes, cascade on account erasure, listed in the lifecycle inventory.

**Projects** (BLD-04) — `public.boulder_projects`: `id, user_id, grade_code, grade_rank, hold_colour, label ≤40, status in ('open','sent','archived'), first_logged_at, sent_at, sent_ascent_id, created_at, updated_at`. A `not_yet` ascent creates or joins a project. Sending a linked ascent sets status `sent`. **Sent after N sessions** = number of distinct sessions with linked ascents, including the sending one. Indoor problems are reset by setters, so projects can be archived manually and are grouped as **Older than 6 weeks** in the UI; nothing is auto-deleted.

All writes go through authenticated RPCs (`boulder_session_start`, `boulder_ascent_create/update/remove`, `boulder_session_finish/discard`, later `boulder_project_*`) with a per-user advisory lock like `run_admit`. Follow current repo RPC conventions and the Supabase guidance in F (`(select auth.uid())`, fixed empty `search_path`, schema-qualified names, explicit principal checks, restricted `execute`). Guard triggers must block: `workout_sets` on bouldering sessions; routine conversion/copy; generic `PUT/DELETE /v1/workouts/:id` changing the discriminator; existing workout-card publication of a bouldering session (until BLD-05 adds its own kind).

### Calculation rules (pure, `packages/core/src/bouldering.ts`)

- A **send** is `flash` or `sent`. Pyramid counts sends per `grade_rank` in a window of local activity dates. Repeated sends of the same problem count each time (disclosed in help text: "Every logged send counts").
- **Hardest send per session** = max `grade_rank` of sends; sessions with no sends show "No sends" rather than zero.
- **Personal best** at finish: the session's hardest send rank is greater than the maximum send rank across all **earlier completed** sessions. **First flash at grade G**: no earlier flash at rank G. The very first session shows "First session logged", not a fake PB.
- Windows are 30 days, 90 days and all time by `activityDate` in the session's captured timezone.
- Bouldering never feeds resistance progression, estimated 1RM, routine suggestions (#255), energy targets or calorie burn.

## C. Staged implementation steps

Each stage is a separately reviewable commit set. Stages BLD-01 to BLD-03 are the private first version (Adam's "step 1"). BLD-04 adds progress and projects (step 2). BLD-05 and BLD-06 add sharing (step 3).

### BLD-00 — Decisions, requirements and ADR (documentation only)

**Files:** [NEW] `docs/adr/0065-indoor-bouldering-sessions.md` (number checked at start); [MODIFY] `docs/adr/README.md`; [MODIFY] `docs/PRODUCT_REQUIREMENTS.md` (new `BOULDER-001` section, text in D); [MODIFY] `docs/feature-map.json` (new `bouldering` feature, or extend `workouts-sets`); [MODIFY] `docs/RESEARCH_LOG.md`; [MODIFY] this plan.

Decide and record: storage shape above; one active session at a time across strength and bouldering (recommended: block starting the other kind and offer **Resume** / **Finish** for the active one); ascent receipts vs simpler create-only idempotency; media purpose reuse (`workout`) vs a new `bouldering` purpose; project matching rule. Show Adam two quick sketches (logging sheet and summary) before code, since this is a new mobile layout.

**Exit:** ADR accepted by Adam; requirement text added; no open choice changes stored semantics.

**Progress (2026-10-16):** [ADR-0066](adr/0066-indoor-bouldering-sessions.md) (0065 was taken by Health run imports) records the decisions and both sketches; BOULDER-01–05 added to the requirements and feature map. Baseline moved to `79e8e75c` (adds `20261016120000_running_health_imports.sql`; no media or Community change). Adam asked to implement every stage in sequence, so later stages proceed; Adam's acceptance of the ADR and sketches remains open.

### BLD-01 — Pure grade scale, contracts and calculations

**Files:** [NEW] `packages/core/src/bouldering-grades.ts`, `bouldering.ts` and tests; [NEW] `packages/core/src/bouldering-repository.ts` (port); [NEW] `packages/contracts/src/bouldering.ts` and tests; [MODIFY] both `src/index.ts`; [MODIFY] `packages/core/src/workout.ts` (generalised activity-type exclusion) and tests.

Contracts: session start/finish, ascent create/update (with `expectedRevision`)/delete, list ascents for a session, paginated sessions list with summaries, progress query (`window: "30d" | "90d" | "all"`), and a strict parser for `details.boulderSession`. Corrupt or unknown versions produce an explicit unavailable state, never a silent strength conversion.

**Exit:** grade normalisation/ordering, every result/attempts combination, PB/first-flash/first-session, pyramid windows across timezone edges, empty and no-send sessions pass. Legacy workouts and runs parse unchanged. No framework/database import in core.

### BLD-02 — Persistence, RLS, API and lifecycle (sensitive: independent Opus review)

**Files:** [NEW] `supabase/migrations/<fresh_ts>_indoor_bouldering.sql`; [NEW] `supabase/tests/database/00NN_bouldering.test.sql`; [MODIFY] `supabase/tests/database/0001_schema_security.test.sql`; [NEW] `packages/adapters/supabase-server/src/bouldering-repository.ts` and test; [MODIFY] adapter `index.ts` and `workout-repository.ts` (activity-type exclusion); [NEW] `apps/api/src/bouldering-repository.ts` (in-memory); [NEW] `apps/api/src/modules/bouldering/routes.ts` and `routes.test.ts`; [MODIFY] `apps/api/src/app.ts` (registration at `/v1/bouldering`, flag); [MODIFY] workout and workout-set routes, `coach/grounding.ts`, `coach/tools.ts`, `community/publication-routes.ts` for exclusion; [MODIFY] account export across core/contracts/adapters/API/in-memory and `docs/ACCOUNT_EXPORT_INVENTORY.md`; [MODIFY] `packages/api-client` if typed helpers are used.

Routes (proposal): `POST /v1/bouldering/sessions`, `GET /v1/bouldering/sessions` (cursor), `GET /v1/bouldering/sessions/:id`, `POST /v1/bouldering/sessions/:id/finish`, `DELETE /v1/bouldering/sessions/:id` (discard/delete), `POST /v1/bouldering/sessions/:id/ascents`, `PUT|DELETE /v1/bouldering/ascents/:id`, `GET /v1/bouldering/progress`. Owner always comes from the verified principal; a body `userId` is rejected. Feature flag off returns a stable `FEATURE_DISABLED` error while preserving export and deletion.

**Exit:** disposable local database only (`pnpm db:verify` on the Mac, never Hetzner/Pi). pgTAP proves RLS, grants and two-user denial for select/insert/update/delete on every new table, plus the photo-ownership check (another user's `media_assets` id is rejected). HTTP tests prove lost-response replay returns one row, changed payload → 409, stale revision → conflict, delete replay cannot resurrect, generic workout/set routes cannot mutate a bouldering session, legacy lists and Coach exclude bouldering before pagination, export contains sessions/ascents/receipts, account erasure removes them. Independent non-author Opus review with no unresolved finding.

### BLD-03 — Mobile logging, photo and summary (private first version)

**Files:** [NEW] `apps/mobile/src/features/bouldering/` (`index.ts`, `client.ts`, `bouldering-session-screen.tsx`, `log-boulder-sheet.tsx`, `grade-chips.tsx`, `session-summary-screen.tsx`, `boulder-photo.ts`, `presentation.ts`, tests); [NEW] route wrappers `apps/mobile/src/app/bouldering/session.tsx`, `bouldering/summary/[id].tsx`, `bouldering/[id].tsx`; [MODIFY] `src/app/_layout.tsx`; [MODIFY] `workouts-hub-screen.tsx` and `workouts-hub-data.ts` (a **Start bouldering** row beside **Log run** at about L680–718, recent bouldering sessions in history); [MODIFY] `active-workout-state.ts`, `active-workout-context.tsx`, `active-workout-mini-bar.tsx` (resume into the right screen); [MODIFY] `logging-draft-storage.ts` and `account-data-management.ts` for the per-account pending-ascent slot; [MODIFY] `app-variant.ts` (`isBoulderingEnabled`).

Behaviour:

- Grade chips: horizontal scroll, ≥44 pt targets, selected state announced to screen readers, last grade pre-selected and scrolled into view.
- Save persists a pending command locally (operation id + canonical payload) before sending, like `run-draft.ts`; a row shows **Saved on this device · Waiting to sync** only after the durable local write. Persistence failure keeps the sheet open with an explanation.
- Photo: camera or library → resize to 2048 px and re-encode JPEG (as in progress photos) → upload ticket → PUT → link. Upload failure keeps the boulder saved without the photo and offers **Retry photo**. Removing a photo or deleting a boulder deletes the media asset (best effort, with the orphan listed in export and swept on account erasure).
- Summary: sends / flashes / attempts / top grade, PB or first-flash card with a light haptic, **Done**, and (from BLD-05) **Share**.
- Every state handled: loading, empty session, offline, retry, account switch mid-session, app killed mid-save, feature disabled.

**Exit:** focused mobile tests for the sheet, pending-command replay, resume after restart, account switch, photo failure and summary maths. iOS simulator journey (`test-ios-simulator` skill) with light/dark and largest text. Then Dev delivery for Adam's iPhone check: start → log 5 boulders (one with a photo) → kill app → resume → finish → see summary.

### BLD-04 — Progress screens and projects

**Files:** [NEW] migration `<fresh_ts>_bouldering_projects.sql` + pgTAP; [MODIFY] core/contracts/adapters/API for projects and progress; [NEW] `apps/mobile/src/features/bouldering/{progress-screen.tsx,grade-pyramid.tsx,hardest-send-timeline.tsx,projects-list.tsx}` and tests; [MODIFY] export/erasure registries and inventory.

- **Grade pyramid:** horizontal bars per grade (hardest at top), count label on every bar, segmented 30 days / 90 days / All, flash portion shown as a pattern + legend, not colour alone. Screen-reader summary such as "6B: 7 sends, 3 flashes".
- **Hardest send per session:** View-built dot/bar timeline, last 20 sessions, PB sessions marked with an icon and text.
- **Projects:** open projects with grade, colour, attempts and sessions so far; **Try again** in an active session; **Archive**; sent projects show **Sent after N sessions**.

**Exit:** progress maths matches core fixtures; projects lifecycle tested for link/unlink on edit/delete of the linked ascent; two-user denial for projects; accessibility checks. Opus review of the migration.

### BLD-05 — Community session card (explicit sharing)

**Files:** follow the nine steps from meal publication (`e2452f01`): migration extending `shared_activities.activity_kind` with `bouldering`, `source_workout_id` reuse or a dedicated source FK, `bouldering_details jsonb`, projection `community_bouldering_details()`, publish/revoke RPCs, source-changed trigger, ADR-0052 reduction capture, re-wrapped feed/get/author/export/snapshot functions, pgTAP; contracts/core/adapters/in-memory repositories; `apps/api/src/modules/community/bouldering-publication-routes.ts` + tests; mobile share modal, details renderer, activity card/detail, feed/profile/read-cache updates; account export; [NEW] ADR (extension of ADR-0030/0056); `docs/COMMUNITY_PRODUCT_CONTRACT.md` note.

Allowlisted snapshot (COMMUNITY-07): local day, top grade, number of sends and flashes, and an optionally selected grade breakdown (sends per grade). Excluded: gym name, notes, photos, hold colours, attempts per boulder, times. Exact preview before publish; audience is the owner plus approved followers (testing partners must follow each other). Editing or deleting the source session revokes the card. Bouldering sessions remain blocked from the generic workout-card publication path.

**Exit:** two-user and follower/non-follower/blocked/withdrawn pgTAP; idempotent publish replay; revocation on edit/delete; export contains the published projection; iOS two-simulator share journey (`test-ios-simulator-pair` skill); independent Opus review.

### BLD-06 — Challenges and optional photo on cards

- **Challenge days (small):** allow a completed bouldering session as a `workout` contribution (no `run_challenge_guard` equivalent); verify `community_challenge_artifact_valid` with bouldering rows. pgTAP + challenge route tests.
- **Photo on a shared card (needs a new decision):** ADR-0056 excludes photos from activity cards and community media is a separate moderated, quarantined flow. Attaching a boulder photo requires a new ADR covering re-upload into `community-media`, rights confirmation, alt text, moderation and revocation. Do this only if Adam still wants it after using BLD-05.
- **Later, demand-based:** sends-count challenge metric, group-audience cards, V-scale option, Coach bouldering context.

## D. Verification plan

### Proposed requirement text (added in BLD-00)

- **BOULDER-01:** A user can start an indoor bouldering session from Workouts and log each boulder with a Font grade, a result (flash, sent with attempts, not yet), and optional hold colour, note and private photo. Every save is server-authoritative, idempotent and recoverable after restart.
- **BOULDER-02:** Finishing shows sends, flashes, attempts and top grade, and a personal-best or first-flash moment only when true against earlier completed sessions.
- **BOULDER-03:** Progress shows a send pyramid (30/90/all days), hardest send per session and projects with sessions-to-send, using canonical grade ranks; no streaks, rankings or calorie claims.
- **BOULDER-04:** Bouldering records are owner-only (RLS), excluded from strength progression and Coach strength context, included in export and removed on account deletion.
- **BOULDER-05:** Sharing a session publishes only an explicitly previewed allowlisted snapshot to approved followers under COMMUNITY-01–16.

### Focused commands (confirm names at implementation start)

```sh
pnpm --filter @mizyun/core test src/bouldering-grades.test.ts src/bouldering.test.ts src/workout.test.ts
pnpm --filter @mizyun/contracts test src/bouldering.test.ts
pnpm --filter @mizyun/supabase-server test src/bouldering-repository.test.ts src/account-repository.test.ts
pnpm --filter @mizyun/api test src/modules/bouldering src/modules/workouts src/modules/workout-sets src/modules/coach src/modules/account src/modules/community
pnpm --filter @mizyun/mobile test src/features/bouldering src/features/workouts src/features/log-workout src/features/settings
pnpm db:verify            # disposable local Mac database only
pnpm navigation:check
pnpm format:check
pnpm check                # once, on the settled candidate, before commit
```

These are planned commands, not evidence.

### Manual and device acceptance

- iOS simulator (BLD-03/04) and paired simulators (BLD-05) with synthetic Dev accounts.
- Adam's iPhone Dev app: the BLD-03 journey above, progress screens after at least three sessions, and one shared card viewed from a testing partner's account.
- Android is a separate acceptance (UX-04) and is not implied by iOS.
- VoiceOver, largest text, light/dark and offline/retry are recorded per stage.

### Ownership

The coordinator owns shared docs, issues, integration, commits and Dev deployment. Helpers get disjoint files: for example a Sonnet helper for BLD-01 pure core/contracts while the coordinator drafts the migration; a fresh non-author Opus reviewer for BLD-02, BLD-04 migrations and BLD-05. Deployment to Dev is a separate explicit step after `pnpm check` passes; Production is not part of this package.

### Effort guide

BLD-00: short session. BLD-01 + BLD-02: one substantial session including review. BLD-03: one session plus device check. BLD-04: one session. BLD-05: one to two sessions (largest surface). BLD-06 challenge days: small.

## E. Next-session prompt

```text
Start BOULDER-001 (#276) from docs/BOULDERING_IMPLEMENTATION_PLAN_2026-10-16.md. Read AGENTS.md, status.md, the plan, ADR-0046 (running), ADR-0009, ADR-0012/0013 and the running migration 20261006120000_manual_running.sql. Confirm main has not moved past the plan baseline in ways that affect workouts, media or community; record the new baseline. First action: BLD-00 — draft ADR-0065 (indoor bouldering sessions) and the BOULDER-01–05 requirement text, and show Adam two sketches (log-a-boulder sheet and session summary) for approval before any code. Then BLD-01 (pure Font grade scale, contracts, calculations) with a Sonnet helper while the coordinator drafts the BLD-02 migration. Grades are Font 3–8C+. Indoor only. Dev only; Production unchanged. Migrations/RLS need an independent non-author Opus review; never run destructive database checks on Hetzner or the Pi. Preserve unrelated and concurrent work.
```

## F. Primary sources checked 2026-10-16

| Primary source                                                                                       | Implementation consequence                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Expo SDK 57 ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/)                   | `exif` only controls whether EXIF is returned to JS; the docs do not promise stripping metadata from file bytes (iOS camera EXIF omits GPS, library assets may not). Keep the ImageManipulator re-encode as the stripping step and verify an uploaded object has no GPS tags. Camera use needs runtime permission; existing config plugin strings apply.           |
| [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) | Use `(select auth.uid())`, index every policy column with `user_id` leading, prefer per-operation policies with explicit `to authenticated`, and keep security-definer functions on an empty `search_path` with schema-qualified names and restricted exposure. BLD-02 reviews where existing repo patterns differ (the original `*_own_all` loop uses `for all`). |

No authority publishes the Font scale; the ordered list above is the common gym convention and is a product choice, not a cited standard.

## G. Planning evidence

Coordinator read `status.md`, product requirements (WO, COMMUNITY-01–16, SEC, REL, UX), the running plan and ADR-0046, open issues, and the ADR index. Two read-only Explore helpers independently mapped (1) the workouts/running/mobile implementation and (2) private media, Community publication, challenges and lifecycle registries; their file references are summarised in B. Created tracking issue #276. No code, migration, build, install, deployment or provider call occurred; the full gate is not claimed for this documentation-only change.
