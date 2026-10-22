# Evening stretch: every session counts, plan prepared at reminder time (#298, 2026-10-22)

## Problem

Adam's Oct 22 plan after a 25-set push workout and a bouldering session matched the push workout alone.

- `GET /v1/workouts` has excluded bouldering since BLD-02 (Oct 16), and the stretch never read `/v1/bouldering/sessions`.
- Muscles were ranked by total sets, so a large session crowded out smaller ones: a second workout, a run, or a Log activity entry.
- Typed custom activities that the catalog can't resolve counted for nothing unless the AI tagged them.
- The screen built the plan, then tailored it with AI, on every open.

## Change

- **`fetchTodayTraining`**
  - Reads today's finished bouldering sessions. When bouldering is turned off, that counts as no sessions, not as unknown.
  - Keeps each workout as its own `session`.
  - Marks non-`load_reps` exercises as `timed` and passes `catalogId`.
- **Core `buildEveningStretchSession`**
  - Each source (workout, activity) gets a stretch for one of its top two muscles, and its top stretched muscle is listed in the focus.
  - An untagged custom timed activity adds a fixed full-body load.
  - Single-source plans are unchanged.
- **`stretchPlanCoversEverySource`**
  - Tailored plans that leave out a source, fresh or cached, are rejected on the device, and the deterministic plan is kept.
  - The AI prompt (`stretch-refine-v2`) asks for coverage. It takes effect only after an API deploy.
- **Tonight's plan**
  - The runtime prepares it once the reminder time (default 21:00) has passed, or sets a timer for that time while the app is open.
  - It runs on return to the app and on a notification tap. JS cannot run at the exact time while the app is closed (Expo SDK 57 notifications and background-task docs).
  - The screen shows the cached tailored plan directly when the account is still eligible.
- **Load safety**
  - One load per account at a time, so the attempt cap is never raced.
  - Consent and the current account are rechecked before the request and before caching.
  - Preparation runs in the background, so a settings save never waits on it.

## Evidence

- Focused tests: mobile evening-stretch 120, core evening-stretch 41, agent-runtime stretch-refinement 12, gemini stretch-refinement 6. All pass.
- The new regressions fail without their fixes: the single-source focus order, and the attempt race.
- Independent Opus review found 2 blockers and 6 other issues. All were fixed except the accepted "any non-`load_reps` untagged exercise counts as timed".
- The bounded Opus re-review found no blockers. Its finding B was fixed: the attempt write no longer restores an older plan.
- The isolated `pnpm check` result is recorded in `status.md`.

## Known limits (non-blocking)

- A load that joins one already in flight uses the first caller's account check. An account switch then wastes that attempt, without leaking anything.
- The api-client has no request timeout, so a hung refine request delays later loads for that account.
- The coverage check uses a source's top two muscles. A source whose top two muscles have no allowed stretch would never take an AI plan. No real input that does this was found.

## Open

- API deploy to Dev for prompt v2.
- iPhone Dev check of push plus bouldering, a Log activity entry, and opening at or after 21:00.

Previous status line: 9 PM training-day reminder → 4–6 stretches; Home row; device-only (ADR0072). 2 reviews; gatePASS(3259mobile/1195API+15skips); Dev 35e226f4 health200; iPhone installed 17:59Z.
