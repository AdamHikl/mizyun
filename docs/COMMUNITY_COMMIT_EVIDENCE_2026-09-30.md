# Community #140–145 combined commit evidence — 2026-09-30

Source base: `877d1898e9205c4be19c6344e1cf1d533f4ff312`; branch `codex/community-140-145`. User explicitly authorized committing and pushing the combined work in meaningful multiple commits. Earlier package manifests are historical snapshots; this document records integration verification of the current combined candidate.

## Integration fixes and independent review

Read-only non-author `community_commit_review` inspected the authorization/migration/lifecycle boundaries and current source manifests. Found one P1 integration defect: profile POST used enrolled-only discovery before enrollment. Reproduced two API regressions (first enrollment and withdrawn-account return: expected201, actual404); removed redundant lookup and kept atomic save/unique-handle collision authority. All20 profile API regressions now pass; reviewer approved the exact fix.

Fresh combined database tests initially passed326 assertions but relationship race cleanup reproduced Auth deletion failing when an AFTER DELETE request trigger reinserted a cooldown referencing its deleted Auth parent. Deterministic SQL regression reproduced7/14 failures: declined/canceled requester/target deletion and residues. New forward `20260930160000_community_account_deletion_cooldowns.sql` skips capture if either Auth parent is absent, preserving ordinary live-account cooldowns and restricted execution. No applied migration rewritten. Non-author reviewed the exact migration; strengthened ordinary block/withdraw tests clear preexisting cooldowns to require fresh capture.

## Verification disposition

Fresh final `pnpm check` PASS (exit0): formatting/typechecks, iOS/Android Metro bundle exports, mobile851 tests, API656 tests/15 credential-gated E2E skips, core316, contracts123, Supabase adapter117, shared transport37, deployment/build/signing safeguards and56 offline AI invariants. Navigation0 errors/24 existing advisory warnings. Log: `/private/tmp/community-commit-check-final.log` (durable qualified results here; local log is not an acceptance dependency).

Fresh isolated `mizyun_commit_community_scratch` cloned schema only and application ACLs from local baseline100000/110000/120000, forward applied130000/140000/150000/160000: **341 assertions across16 SQL files PASS**, including strengthened15-assertion real Auth erasure suite. Three concurrency scripts pass: enrollment claims, seven relationship races, three publication races. All synthetic fixtures cleaned, scratch database removed in `finally`; no shared local or remote migration. Real SQL also proves discovery rejects first/return enrollment while atomic save succeeds at generation1/2. Current API regression proves the route no longer invokes discovery; no new combined Auth/PostgREST or native acceptance is inferred from these tiers. Log: `/private/tmp/community-commit-db-final.log`.

Independent non-author reviewed exact API fix, forward migration and deterministic tests. Suggested clearing ordinary fixture cooldowns before block/withdraw; strengthened regression proves fresh cooldown creation, not merely retention. Final tests cover both Auth participant deletions, stale residue, ordinary safety cooldown preservation and restricted EXECUTE grants.

Runtime behavior unchanged after the final full repository gate. A staged whitespace check found only an extra EOF blank line in the older PostgREST test harness; removed it and confirmed Python syntax, with its final byte hash recorded. Documentation reconciliation after it uses targeted formatting and whitespace checks. Combined source manifest records exact SHA-256s for all committed runtime/test/dependency files; historical manifests remain intact.

## Evidence tiers and remaining exits

Design and #141–145 source implementation are present. Genuine adult target-user study (#140), physical installed Dev journeys (#142–145), reporting/contact/moderation (#148), feed/delivery (#146/#149), monitored retention/export/restore (#151/#152), legal/age assurance/admission/pilot (#153–155) remain unaccepted. Enrollment stays closed. A push neither closes these evidence gaps nor authorizes pilot/Production release.

No Dev/Production migration/deployment, device installation/acceptance, Store action or public admission by this task. Shared local Auth/database data remains unchanged. Only empty Mac schema-only scratch with synthetic fixtures is used for DB verification, and it is removed in finally.

## Commit organization and push target

Meaningful segments: product/UX contract; shared contracts/domain; isolated database migrations/regressions; server/adapters/principal-bound transport; mobile enrollment/relationships/invitations/publication; evidence/navigation/handoff. Existing shared work preserved, no forced history rewrite. `main` pushes touching Supabase can trigger `.github/workflows/db-push-dev.yml`; publish to the feature branch to keep migration deployment separate. No PR merge or environment approval is performed.

## Commit receipt

Source candidate: `4155a6628849da7a1e17844e33d7230421e46638`; final evidence/navigation handoff follows in its own documentation commit. Exact source hashes match the committed candidate.

- `1b4b633e87c6` — docs(community): define opt-in product and UX contract (#140)
- `236652afe2d0` — feat(community): add versioned contracts and pure domain policies (#141)
- `1520b0c6ac1e` — feat(community): enforce isolated SQL lifecycle and concurrent operations (#141–145)
- `4d26c04a5186` — feat(api): add community routes and principal-bound transport (#142–145)
- `4155a6628849` — feat(mobile): add optional community enrollment and sharing journeys (#142–145)

Publish the complete six-commit set to `origin/codex/community-140-145`; verify remote HEAD equals final local HEAD and record that final receipt on #140–145. No automatic closing keywords, merge, deployment or external admission.
