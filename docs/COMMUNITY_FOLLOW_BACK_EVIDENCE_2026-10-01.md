# Followers follow-back evidence — 2026-10-01 (#166)

## Behavior and scope

Community → Friends → Followers offers a visible Follow back button for followers without an outgoing edge. Pending outgoing requests show Requested; approved outgoing edges show Following. The principal-bound controller loads the full bounded outgoing graph (30 approved/20 pending, each requested with limit50), fails closed on read errors/incomplete pages, serializes mutations and discards stale owner/lifecycle responses. A new operation UUID feeds the existing validated request endpoint. Follow back requires the other person's approval.

An approved incoming follower supplies a narrow request capability even when handle search is disabled. API precheck, in-memory repository and forward migration `20261001130000_community_follow_back.sql` agree. The migration replaces the existing locked RPC, changing only the approved incoming-edge allowance. Current eligibility/block checks, idempotent replay, cooldown and rate/pending limits remain intact. Search visibility and private-data access remain unchanged. [ADR clarification](adr/0030-explicit-community-publication.md) records the decision.

## Baseline and independent review

Runtime baseline `bf02687135356b70cac1d552b9214aa27a95736b`; concurrent documentation commits through `d4c05e3421eaabf8ba9a2bf3c4e86b59c36d0b7b` preserved. New render regression failed against the original screen (3 failed/6 passed). API regression produced404 instead of201 for an approved hidden follower. Original request RPC reproduced `community_unavailable` on the new PostgreSQL regression before the new migration was restored.

Read-only built-in helper independently audited actual API/mobile/SQL diff, mechanically confirmed only one SQL eligibility predicate differs from the original RPC and ran focused API9/mobile21 tests before the additional reverse-read failure parameterization. No blocking findings. Coordinator performed all writes, database setup and final checks.

## Fresh automated checks

- `pnpm --filter @mizyun/mobile test src/features/community/relationships`:22 passed across controller/screen; covers approved/pending/none, both reverse-read failures, double tap, owner retirement and direct accessible action.
- `pnpm --filter @mizyun/api test src/modules/community/relationship-routes.test.ts`:9 passed, including hidden approved follower versus pending follower and separate outgoing pending status.
- `pnpm check`: exit0; mobile1042/API731 passed,15 existing credential-gated API skips; package suites, typechecks, both Hermes exports, navigation/formatting and repository safeguards passed.
- Isolated local `mizyun_follow166_scratch`, restored schema only from existing local `supabase_db_mizyun` plus authenticated ACLs, followed by remaining migrations after20260930120000 through20261001130000. Existing local database not reset or migrated. Coordinator ran `docker exec -i supabase_db_mizyun psql -U postgres -d mizyun_follow166_scratch -v ON_ERROR_STOP=1` against0011/0013/0022:28+24+10=62 pgTAP assertions pass; logs checked for `not ok` and `ERROR` in addition to exits. New SQL checks exercise hidden follower eligibility, pending denial, separate approval, retry, sender forgery denial, cooldown, outsider UUID denial, removal and bilateral blocking. Scratch removed after checks. No full database suite or additional concurrency run claimed.
- `git diff --check`: pass.

## Remaining acceptance

No Dev backend deployment/native install or focused device acceptance yet. Next: exact-candidate Dev migration/API deployment and standalone client installation, then two-account follow back (including search disabled), waiting/approval/Following, error/retry, lifecycle/account-switch and accessibility journey. Production untouched. Existing broader Community issues remain open.
