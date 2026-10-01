# Community authorized partner admission — 2026-10-01

Adam explicitly authorized one existing partner Dev account for two-account testing. Identities and Auth UUIDs are omitted from this durable record. This is founder/partner Dev testing, not broader pilot admission or feature acceptance.

## Exact target and outcome

- Local clean baseline: `afd9917d7da3c7fab9f4d33a184c37ec5f26f9a5`, branch `codex/community-140-145`. Installed mobile runtime remains `33ba0fbc1ac3095479f5a8547ea51c72be6e1df0`; no new build/install was required.
- Verified root-owned mode444 unique Hetzner host marker; Dev API active with working directory `/var/lib/mizyun/dev/repo` and environment file `/etc/mizyun/dev.env`. Dev checkout pristine at `282d740d93b338fb508cbad2a8fa27f5a605b9c8`.
- Exact database container `mizyun-dev-db`, Postgres published only at `127.0.0.1:5433`. API master/enrollment/discovery/publish/engagement enabled; delivery disabled.
- Read-only preflight resolved exactly one distinct existing eligible partner principal. Founder admitted, partner not admitted, partner Community profiles zero; cohort count1.
- Independent non-author built-in helper reviewed source and the exact transaction before execution. Coordinator held the existing Dev deployment lock, used the Community transaction lock and locked controls/cohort tables. Assertions required exact eligible principals, unchanged expected controls, no unrelated cohort entries, preservation of founder, outsider denial and delivery disabled.
- Only `public.community_pilot_cohort` received the partner row. Transaction committed successfully. Profile, relationship and shared-activity row counts remained unchanged.
- Separate post-commit read-only transaction confirmed cohort count2; founder and authorized partner admitted; partner eligible; partner Community profiles still zero; database master/enrollment/discovery/publish/engagement true, `cohort_required=true`, `delivery=false`. Verification completed before 2026-10-01T08:34:13Z.

No automatic enrollment, consent, profile, follows, workout sharing, email, invitation or account deletion. No deployment, migration, service restart or configuration change. No Production operation or probe. An initial lock-file write-open was denied before SQL execution; using a read-only descriptor of the same lock inode succeeded without changing ownership or permissions.

## Next physical acceptance

1. Partner signs into Mizyun Dev and deliberately joins from Community with a distinct social handle and current declarations. Verify profile persistence and private tracking remains usable.
2. Partner optionally enables exact-handle discovery. Founder requests to follow using that exact handle; partner sees an incoming request. Pending approval must not expose shared cards.
3. Partner approves. Following is directional: reverse access requires a separate reverse request/approval. Verify historical still-shared cards become visible, while private workouts remain private.
4. Deliberately preview/publish a completed workout with only generic category, selected day and optional duration. Verify feed, reaction and in-app inbox; no push banner is expected while delivery is disabled.
5. Unpublish and verify stale-card revocation, then invitations/revocation, mute/removal/block/reporting, restart/offline recovery and accessibility. Leave/rejoin separately; do not delete the founder account. Deletion requires disposable accounts.

Collect exact steps, expected/actual behavior, time/timezone, network state and reproducibility for failures. Device journeys remain unrun in this admission record. #143–145 and #155 retain their original participant, both-platform, operator, legal/contact, restore, push and pilot gates.

## Verification

Admission assertions and independent post-commit read passed. Fresh local `pnpm check` exit0: mobile1023/API730;15 existing credential/policy-gated API skips, typechecks, dual Hermes exports, formatting/navigation/safeguards. Changed-document formatting and `git diff --check` pass. No runtime source changed for this admission; no new physical acceptance claimed.
