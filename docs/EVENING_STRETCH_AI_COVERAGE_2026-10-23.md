# Evening stretch: AI coverage and tailoring wait (#298, 2026-10-23)

## Trigger

On Adam's Dev iPhone (pull day: lat pulldown 4, seated cable row 3, single-arm DB row 2, lateral raise 3, incline DB curl 2, incline hammer curl 2, straight-arm pulldown 3), the tailored plan was Child's Pose, Puppy Pose, Cross-Body Shoulder and Kneeling Wrist. That is two lat stretches and nothing for the biceps. Separately, while tailoring was in flight the screen showed a different list ("yesterday's session"), then swapped it.

## Change (commit dc64d2bd, local main, not pushed or deployed)

- `stretchRequiredMuscles` (core) returns up to three of the most-worked muscles that a bodyweight stretch can reach, each with at least 25% of the top load. Model muscle tags are ignored. For this pull day it returns rear shoulders, lats and chest; the biceps reach the chest through the remap.
- `stretchPlanFromChoice` (server and device) completes a choice that misses a required muscle. It appends the deterministic stretch at 30 s. At six stretches it first swaps out the last redundant pick, and it returns null when no pick is redundant. Replaying the reported choice now adds the Doorway Chest Stretch, and the focus reads "Rear shoulders, lats and chest".
- The prompt is now `stretch-refine-v3`. It receives `requiredMuscles` and is told to stretch each worked muscle once before giving any muscle a second stretch.
- Screen: when the account may tailor and nothing is cached, the screen shows only "Tailoring to today's training…" until a result, a failure, a consent decision or 15 s. ADR-0076 amendments cover both changes.

## Evidence

- New tests failed against HEAD first: 4 in core coverage and 3 in tailoring wait.
- Focused tests: core 48, agent-runtime 12, API stretch-plans 32, mobile evening-stretch 123, Gemini and Anthropic providers all passed. tsc passed for core, api and mobile.
- Full gate: `pnpm check` PASS, input SHA-256 `fd597891ee81a0ec56668f46724c4d6a570b50e9d3175f48b17e3abd00c44293`.
- Review: an independent Opus review found no blockers. Its medium finding (server and device disagreeing on required muscles when model tags are present) is resolved by ignoring tags. Its low findings (focus order, spinner label) are fixed.
- A helper's data-layer guard against stale snapshots was not merged because it was unproven as the cause and added latency. The finding is tracked in #325.

## Open

- Push and deploy to Dev.
- Install the Dev iPhone build.
- Adam's device check: the pull-day plan includes a chest/biceps stretch, and the first open after training shows the tailoring wait, not a swapped list.
- Live model quality is not proven (`docs/BEFORE_TESTING.md`).
