# Review fixes merge — 2026-10-28

A read-only multi-agent review of the app at `a3947503` (2026-10-26) produced 17 high-severity findings. Adam asked for one Claude Code session per finding group; twelve sessions fixed them on separate branches, and the coordinator merged all twelve into local `main` on 2026-10-28. The review report is a private claude.ai artifact ("Mizyun App Review").

## Result

- Local `main` at `081724f35879dc8964dcf019fad5172c12cb7709`, 29 commits ahead of `origin/main`. **Not pushed, not deployed.**
- Integration branch `claude/integration-high-fixes` (worktree `.claude/worktrees/integration-high-fixes`), fast-forwarded into `main`.
- `pnpm check` PASS on the merged tree (input SHA-256 `d1013f7caa13615aa3bda5bf27cb844ef74ac23e7e51721c594142484bbb52fe`): mobile 3911, API 1496 passed + 15 skipped, all package and tooling gates.
- `pnpm db:verify` **not run** on the combined migrations. Session SQL tests ran in rolled-back transactions on the shared local database only.

## Branches merged

| Findings           | Branch                            | Commits                | Change                                                                                                                                        |
| ------------------ | --------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| HLTH-01, HLTH-03   | `claude/blissful-torvalds-6783c8` | `6a6ea3c4`             | Production Android declares only READ_STEPS/READ_EXERCISE/READ_DISTANCE; release-manifest allowlist check; Production HealthKit strings fixed |
| A11Y-01            | `claude/youthful-curie-f8899d`    | `ce9e1bcf`             | Home calorie card and body rows speak their values                                                                                            |
| A11Y-02            | `claude/loving-taussig-955e7a`    | `fd6de1b1`             | iOS VoiceOver announcements for Notice, FormStatus, Coach replies and saves                                                                   |
| OPS-01             | `claude/vigilant-sammet-a6737c`   | `00ce732e`             | OnFailure alerts, host watch timer, backup dead-man pings, alert script fixes; crash-reporting draft ADR-0085 (#342)                          |
| TNS-01, PRIV-03    | `claude/unruffled-rubin-801f81`   | `c47fc44a`             | Production Community privacy maintenance units and hourly report alert; ADR-0086                                                              |
| SEC-02             | `claude/zealous-satoshi-cdd4b3`   | `51c08ef2`             | Per-owner private-media quota (10,000 objects / 3 GiB), size-spoof block, upload-url rate limit                                               |
| REL-01             | `claude/sleepy-wu-80afd8`         | `d528b0b1`             | Device time zone header and profile sync; Coach and Log run stop using UTC                                                                    |
| AI-01, L10N-01     | `claude/youthful-bohr-b80cd8`     | `2fd24878`             | Coach safety screen rebuilt (EN/SK/CS, 231 must-block / 132 must-allow)                                                                       |
| AI-02, AI-06       | `claude/competent-dhawan-863e59`  | `823d1e79`, `15ae73e7` | Coach metered in messages (free 5, paid 50), smaller cached prompt; ADR-0087                                                                  |
| PRIV-01, PRIV-02   | `claude/great-nightingale-361aba` | `be881092`, `3926d3fc` | Health-data consent step, 18+ on device and server, policy/Terms links, legal drafts; ADR-0088                                                |
| REL-02, #290, #291 | `claude/exciting-yalow-04a31b`    | `170541ab`             | Device-first workout sets with idempotent replay                                                                                              |
| DROID-03           | `claude/confident-hawking-6200f8` | `13b4c30c`             | Android keyboard inset for meal, weight and live workout forms                                                                                |

## Integration changes by the coordinator

- Conflicts resolved: `docs/adr/README.md` and `docs/RESEARCH_LOG.md` (kept both sides), `packages/contracts/src/client-compat.ts` (compat level `2026-10-27` plus both new constants).
- Renumbered (`254e88c8`): migrations `20261027120100_private_media_quota`, `20261027120200_coach_message_allowance`, `20261027120300_health_data_consent` (`20261027120000_workout_set_retry_identity` unchanged); ADR-0086 Community, ADR-0087 Coach allowance, ADR-0088 health consent (ADR-0085 crash reporting unchanged). References and the ADR index updated.
- `081724f3`: stubbed the health-consent gate screens in `auth-time-zone-sync.test.tsx` after both branches met in `SessionGate`.

## Open gates and founder steps

- **Decisions:** #345 safeguarding wording and cut-offs; legal drafts in `docs/legal-drafts/`; cached-token pricing in the AI cost ledger.
- **Before any deploy:** push decision; `pnpm db:verify` on the merged tree.
- **Servers (after deploy):** OPS-01 monitoring setup ([guide](tutorials/HETZNER_BACKEND_GUIDE.md)); ADR-0086 Production activation ([runbook](tutorials/COMMUNITY_OPERATIONS_RUNBOOK.md)) including moderator MFA; storage gateway block for unfinished resumable uploads (SEC-02).
- **Stores:** rebuild and re-sign the 1.0.10 AAB (HLTH-01); App Store 16+, Play content rating from IARC, Play target audience 18+.
- **Device acceptance:** workout lock/airplane/force-quit, VoiceOver and TalkBack announcements, Home card VoiceOver, Android 15+ keyboard, Coach "today" vs Home.
