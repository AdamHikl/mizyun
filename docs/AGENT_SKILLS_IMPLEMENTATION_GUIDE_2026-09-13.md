# Shared agent skills: analysis and implementation guide

Date: 2026-09-13. Work package: **AGENT-SKILLS-001**. Status: **proposed; documentation only**. This guide is for a later implementation session. No skills, agent configuration, application code, or remote resources were changed to implement this proposal.

## Recommendation

Use one version-controlled skill library in `.agents/skills/` for Codex and Antigravity. Start with three skills: focused session context, verification and handoff, and future-session planning. Improve the two existing operational skills before adding more. Add deployment, mobile diagnosis, and analytics skills only after the first group demonstrates value.

The largest immediate opportunity is reducing repeated context reconstruction. A skill cannot compensate for a growing status file, stale evidence, or commands that emit excessive output. Improve those underlying resources first, reuse the existing navigation and operations scripts, and measure successful task completion rather than promising a percentage of token savings.

## Evidence and limits

Inspected local source at HEAD `16a1e86132f649ca4718c1699f2bfe2474e102f7` with substantial pre-existing uncommitted changes. Findings about current files describe that working tree, not just the commit. Sampled six Codex session logs from September 7–12 and selected Antigravity session artifacts. This is a purposive sample of recurring work, not an exhaustive audit of all conversations.

Codex evidence below refers to JSONL record line numbers within `/Users/adam/.codex/sessions/2026/09/<day>/`. Local histories remain outside Git; these references are provenance for the founder, not dependencies required to use future skills. Do not copy raw conversations, feedback, photos, account details, or credentials into skill files.

| Evidence                                                                                                  | Observed pattern                                                                                                                                               | Implementation consequence                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `07/rollout-2026-09-07T10-10-05-01a07aea-d61d-76f0-a367-c3e686c0f93b.jsonl`, records 18, 26, 32, 452, 457 | Large combined reads of goals, plan, status and session guidance, followed by more reads. Later requests compare implementation against earlier plans.         | Compact current state, route to feature context, and maintain requirement-to-evidence links for follow-up review.             |
| `09/rollout-2026-09-09T12-48-44-01a085c8-cdb7-79e1-b9c9-f377af6891f9.jsonl`, request record 7             | Text feedback works; image attachment fails. Investigation ended before reproduction or a proven root cause.                                                   | Route diagnosis through upload initialization, signed upload, then feedback creation. Preserve unknowns.                      |
| `11/rollout-2026-09-11T20-53-37-01a091d1-71a7-7022-be9d-75297afd385b.jsonl`, records 61, 68, 78, 121, 345 | `pnpm context identity` followed by feature listing and `pnpm context auth`; user explicitly requests deferred implementation and later Android-only planning. | Resolve feature IDs once; give planning a clear documentation-only mode and preserve platform scope.                          |
| `12/rollout-2026-09-12T19-56-23-01a096c3-6614-71e0-982d-1e7ae6d4f408.jsonl`, records 9, 81, 97            | User first asks whether meal search exists, then authorizes implementation; broad context reads follow.                                                        | Distinguish status inspection from implementation and read the focused feature before expanding.                              |
| `12/rollout-2026-09-12T20-54-06-01a096f8-3fc9-7432-9faf-09f26312a4e9.jsonl`, records 9, 15, 62, 76        | Old startup artwork persists after launcher branding. Work traces Expo configuration, JS overlay and generated native resources.                               | A mobile diagnosis skill should trace all relevant runtime layers and separate source changes from rebuilt-device acceptance. |
| `12/rollout-2026-09-12T22-05-37-01a09739-b62b-7e43-8400-0ffe92328bd3.jsonl`, records 9, 183, 225          | Analytics request includes a CLI for agents; later scope is explicitly narrowed to a future-session guide.                                                     | Reuse deterministic analytics commands and a planning template rather than rediscovering SQL and acceptance structure.        |

A local parser counted output records containing truncation markers: respectively 33, 3, 5, 2, 2 and 3 across the six logs above. These are **truncation markers, not wasted-token measurements**; some logs span multiple tasks and turns. Tool-record counts include both custom and function calls, and do not equal shell-command counts. Historical cumulative token counters contain cached input and varying session scope, so they are unsuitable for a fair Codex-versus-Antigravity cost comparison.

At inspection, `status.md` was 400 lines / 63,318 bytes. Root `AGENTS.md`, `status.md`, `docs/START_HERE.md`, and `docs/SESSION_GUIDE.md` together were 87,980 bytes. These are file bytes, not tokenizer measurements. Required startup reading is already substantial before feature code or history is loaded.

The [September 9 navigation review](AGENT_NAVIGATION_REVIEW_2026-09-09.md) supplies useful failure cases, not a current list of unfixed bugs. Current `scripts/navigation/context.mjs` already surfaces mobile instructions, requirements, open acceptance and staleness; `check.mjs` imports TypeScript, and `impact.mjs` now guards CLI execution. Reproduce any remaining defect before scheduling its repair.

## Antigravity session evidence

A read-only helper inventory found 92 Mizyun-matching Markdown artifacts in 48 session directories under `/Users/adam/.gemini/antigravity/brain/`. These counts describe keyword-matching artifacts, not all Mizyun conversations. The helper inspected selected saved plans, walkthroughs and learning reports; the coordinator read the key excerpts below. Matching conversation databases contain binary step payloads: schema/counts were inspected read-only, but raw chats were not decoded. Consequently, Antigravity conclusions are based on saved session artifacts and author-reported results, with no measured token-cost comparison.

| Local artifact beneath the brain directory                               | Evidence and reusable lesson                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `68c3a938-d00e-4163-b57f-401f55578c8d/walkthrough.md`, lines 45–58       | Reports repair of stale host/provider/completion guidance and missing nested instructions/open gates. Reuse the repaired context tooling and validate freshness rather than building another index.                                                                                                                       |
| `3d4e4adc-4871-4c01-b5dc-038f7475acbc/learning_proposal.md`, lines 12–22 | Records dirty Pi checkout rejection and formatting blockers. Prefer existing preflight safeguards. Its blanket `pnpm format` advice is superseded by current scoped-formatting guidance; do not import old rules verbatim.                                                                                                |
| `958232e4-c437-4a2f-8eb1-7908d051e266/walkthrough.md`, lines 58–76       | Physical-device acceptance remains a next step after backend work. Preserve separate evidence levels and avoid broad completion labels.                                                                                                                                                                                   |
| `b9479186-304c-45b1-a5ac-a2e134961e63/walkthrough.md`, lines 3–13        | Attributes the feedback-photo failure to a signed URL containing the server loopback address. This is a historical reported diagnosis, not a live reproduction here; the earlier Codex investigation was inconclusive. Use the failing-boundary method, not a universal assumption that every image error has this cause. |
| `88481962-75e4-4079-964e-c6524b00cfaf/walkthrough.md`, lines 53–60       | Reports focused review improvements for country search ranking, caching and accessibility. A bounded helper assignment can be useful; embed its template in context/verification skills instead of creating a separate orchestration framework.                                                                           |

Both histories support the same direction: maintain compact current evidence, reuse commands, and turn repeated decision procedures into selectively loaded skills. They do not justify importing entire conversations into every future chat.

## Cross-tool design

Current official documentation identifies `.agents/skills/<name>/SKILL.md` as a repository skill location for both Codex and Antigravity. Use shared YAML `name` and `description` plus ordinary Markdown instructions. Keep tool-specific metadata optional. Skills expose brief metadata first and load detailed instructions when selected. Sources accessed 2026-09-13: [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills) and [Google Antigravity: Skills](https://antigravity.google/docs/skills).

| Layer                   | Location and responsibility                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mandatory rules         | Root/nested `AGENTS.md`; preserve safety, architecture, ownership, authorization and verification requirements.                                                                       |
| Current state           | `status.md`; short current work/evidence summary with links. Older narrative belongs in the existing archive structure.                                                               |
| Feature routing         | `docs/feature-map.json` and existing `pnpm context` / `pnpm impact` commands. No second hard-coded feature map.                                                                       |
| Task procedures         | `.agents/skills/<name>/SKILL.md`; only project-specific decisions and triggers.                                                                                                       |
| Conditional detail      | Small references or templates inside the skill; link to maintained repository runbooks instead of copying them.                                                                       |
| Deterministic execution | Existing `scripts/` entrypoints first; small new helpers only for observed repetition.                                                                                                |
| Tool adaptation         | Optional `agents/openai.yaml` for Codex UI; Antigravity discovery/rules setup only if the installed version requires it. Core procedure must work without vendor-specific tool names. |

Do not install duplicate global copies or build a synchronization system by default. Current Google documentation retains legacy `.agent/skills` compatibility; use the shared plural path for new work and verify actual installed discovery. This checkout currently has the two operational skills under `.agents/skills`; no repository `.agent` directory was found.

Discovery and execution are separate acceptance checks. Start fresh Codex and Antigravity chats from the repository and confirm both discover and read the same file. If an older Antigravity installation does not, inspect that version's supported paths before choosing an adapter. Keep a single maintained source; any required generated mirror must have a drift check and must not cause duplicate discovery. Do not assume symbolic-link discovery or Codex UI metadata works identically in both tools.

For an AI chat without repository/tool access, provide the selected `SKILL.md` together with the small referenced context packet and task evidence. It can plan or review supplied material, but must label unrun commands and unavailable files. Do not imply that ordinary chats automatically discover local skills.

## Proposed skill backlog

Priority here orders this skills work package only; it does not reorder the product roadmap. Estimates are relative authoring effort, not promised completion times.

| Priority | Skill                                 | Trigger and boundary                                                                                                                     | Required inputs → deliverable                                                                                                                          | Effort       |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| P0       | `mizyun-session-context`              | Resume or begin substantive Mizyun work, or reconcile conflicting handoffs. Skip simple explanations and already-established context.    | Request, checkout state, current handoff, feature ID → small work packet containing scope, relevant paths/rules, acceptance, unknowns and owned files. | Medium       |
| P0       | `mizyun-verify-handoff`               | Select checks or close/review a work package. Do not trigger full release audits for ordinary edits.                                     | Actual diff, risk areas, current scripts, requirement IDs → executed checks and evidence ledger, exact remaining gate, concise continuity update.      | Medium       |
| P0       | `mizyun-plan-next-session`            | User requests a guide/plan to implement later. Skip tasks explicitly requesting implementation now.                                      | User scope, inspected implementation, dated official sources → phased plan with files, dependencies, tests and copyable next-session prompt.           | Small        |
| P1       | Existing `check-unprocessed-feedback` | Preserve current feedback-specific trigger. A report request does not authorize marking all entries processed.                           | Explicit environment plus existing CLI → bounded summary and selected detail; scoped ledger update only when authorized.                               | Small–medium |
| P1       | Existing `check-beta-pro-requests`    | Preserve Beta Pro request inspection and explicit grant/reject requests. Do not apply it to ordinary AI-consent admission.               | Environment and request identity → current result; mutation outcome only when requested, with side effects disclosed.                                  | Small–medium |
| P2       | `mizyun-mobile-diagnose`              | Device, attachment, splash, installed-build or environment mismatch symptoms. Skip unrelated backend tasks.                              | Symptom and known working comparison → isolated failure boundary, smallest useful regression, source/build/device evidence.                            | Medium       |
| P2       | `mizyun-deploy-verify`                | Authorized Dev deployment or explicit Production release milestone. Skip documentation planning and local UI-only work.                  | Candidate SHA, current scripts, acceptance and target → verified target/candidate, command outcome and appropriately qualified release evidence.       | High         |
| P2       | `mizyun-product-analytics`            | Usage/navigation/retention questions based on consented telemetry. Skip raw user-health inspection and analytics implementation changes. | Environment, period and question → existing aggregate CLI output interpreted with definitions and data limitations.                                    | Small–medium |

### First three skill specifications

**Session context:** follow mandatory startup once; select the feature through `pnpm context --list` only if its ID is unknown, then `pnpm context <id>`. Read additional files by the relevant section. Use `pnpm impact --since <verified-ref>` as advisory input when changes span features, not permission to omit checks. Include dirty/untracked files and ownership. Historical sessions are a fallback for an unresolved decision, not a standard startup dependency. If a command is truncated, request a targeted remainder rather than repeating the whole read. If fsmonitor fails, use a per-command `git -c core.fsmonitor=false ...`; do not modify global Git settings or repurpose `HOME`.

The packet should include task intent/mode, HEAD and local-change summary, feature/rule links, requirement IDs, evidence status, next action and one bounded helper assignment where required. Existing relevant context should be reused within a turn; reread mutable state when another writer or new commit makes it necessary.

**Verify and handoff:** read the actual diff, classify affected behavior, consult current package scripts and quality gates, run focused checks, and serialize the final gate after helper writes settle. Preserve required `pnpm check`; never substitute an impact report or a cached success. Log command, exit, tested source/working-tree identity, date, environment, relevant device/build identity and unrun checks. Use concise failure excerpts and a local full-log path; an empty or truncated log is not success. Changes after a check must be described accurately and validated as appropriate.

Keep implementation, automated verification, Dev deployed, device accepted and Production released separate. For auth, authorization, deletion/export, migrations/RLS, AI access/budgets and deployment, require a non-author reviewer as root instructions already specify. Review actual evidence and unresolved findings; a helper's approval label is not independent proof of correct behavior.

**Plan next session:** inspect current code and prior acceptance first; research the affected platforms; distinguish implemented portions from remaining work. Produce scope/non-goals, baseline, file ownership, ordered steps, acceptance per step, external dependencies, verification, and first exact action. Preserve explicit user exclusions such as Android-only follow-up. Do not build, deploy, change credentials, or implement the feature when the requested deliverable is a later-session plan. Keep legal/platform policy facts dated and refresh them during implementation. No new ADR merely to repeat existing rules; create one only if a durable design choice meets the repository ADR criteria.

### Operational skill improvements

The existing feedback skill includes a blanket instruction to run outside the sandbox and encourages full feedback/email output. Replace this with normal available execution permissions, escalation only when needed, and bounded output appropriate to the requested task. Validate command options and help text against its real wrapper and script. Separate inspection from marking, preserve prior authorizations, and avoid copying sensitive feedback into Git. Inspect whether the processed ledger is tracked and how its callers use it before proposing any relocation; migration must preserve existing state.

The Beta Pro skill mixes report and mutation examples. Keep explicit environment/target handling, document profile-tier and notification side effects, and ensure a query-only request cannot select approval/rejection. Reuse the existing CLI rather than issuing bespoke SQL. Current consent policy allows eligible users AI access immediately after consent; Beta Pro tier approval must not become a manual AI access allowlist.

The future analytics skill should call the inspected `scripts/product-analytics.mjs` interface, not invent flags. Read query definitions only for the requested report, use aggregate output, and explain how opt-in coverage, time window, retention and cohort maturity constrain the answer. Do not claim the backend is deployed based on CLI source presence.

## Context and token budget design

These are initial design targets, to tune using measurement; they are not platform limits or authority to omit required evidence.

- Keep each new description to roughly 30–60 words, with a discriminating trigger. Aim for 400–800 words per loaded entrypoint; a small skill can be shorter.
- Keep current `status.md` near 1,000–1,500 words. Archive older detailed entries with their evidence and correctly rebased links; retain current environment state, active blockers and pointers to all unfinished work. Do not discard unresolved gates to meet a size target.
- Aim for a context packet around 1,000–2,000 words excluding source snippets and mandatory rules. Do not read every reference for every task.
- Keep full command output in a local log when long; return outcome, exit, relevant failures and log location. Do not poll unchanged output rapidly or rerun a successful expensive gate without new changes, failures or unresolved evidence.
- Use one useful bounded helper where required, with disjoint ownership and focused inputs. Prefer minimal history when tools support it. Measure total coordinator plus helper use; parallelism may reduce elapsed time while increasing tokens.
- Never save tokens by skipping current official research required by AGENTS, hiding denied-access failures, weakening device/privacy acceptance, or treating historical tests as fresh.

Do not add a generic TypeScript skill, a copy of the entire architecture guide, a universal 'be efficient' skill, a skill for each screen, or an automatic session-mining service. They add discovery cost without enough project-specific benefit. Do not create a repository vector store merely to index a small set of well-routed Markdown documents.

## Implementation sequence for a later session

### Stage A — Baseline and context hygiene

1. Read current instructions and dirty state; confirm which concurrent session owns shared files. Capture baseline skill inventory and client versions.
2. Record the benchmark below before changes. Recheck current navigation functionality instead of assuming September 9 defects persist.
3. Compact `status.md` using the existing archive convention. Preserve historical text, unresolved evidence, and relative links. Keep the active product work visible; adding skills must not accidentally switch the operational deployment target or roadmap.
4. Reconcile duplicated procedural prose by linking to the authoritative guide, while retaining mandatory rules in always-loaded instructions. If an Antigravity rule is needed to read root AGENTS, make it a short pointer and verify discovery; do not duplicate the whole policy.
5. Use current context/impact output first. Extend existing navigation scripts only if a benchmark demonstrates a missing field or unusable output; no new context tool by default.

Acceptance: existing current-state facts and open gates remain recoverable, archive links resolve, no unrelated edits are lost, and required startup information is smaller without becoming ambiguous.

### Stage B — Author and evaluate the three P0 skills

Create each `.agents/skills/<name>/SKILL.md` with the shared format below. Add one reference/template only when it reduces repeated writing. Paths to repository resources must resolve from the skill directory or be explicitly identified as repository-relative. Use repository-local runtime commands and no hard-coded founder home directory.

```markdown
---
name: mizyun-plan-next-session
description: Prepare a Mizyun implementation guide for a later session, grounded in current code, dated sources and acceptance gates. Use when the user asks for a deferred plan; do not implement the planned feature.
---

# Plan a later implementation session

Read applicable repository instructions and the relevant feature context.
Identify what exists, what has current evidence, and what remains unknown.
Research the affected platforms using current official documentation.
Write scoped stages with owned files, dependencies and observable acceptance.
Record planning evidence and the next exact action in continuity documents.
Use the user's requested scope and preserve existing authorization boundaries.
```

This is an illustrative starter inside the guide, not an installed skill. The final skills should add their specific decision points from this document rather than reproduce it wholesale. Optional Codex metadata must not contain core behavior needed by Antigravity.

Acceptance: parseable frontmatter, unique names, real links, no placeholders/secrets, positive and negative selection tests in both clients, and independent scenario review. Structural skill validation alone is insufficient.

### Stage C — Refine existing operations

Inspect both existing scripts and their current callers before editing the two operational skills. Add output limiting or structured summaries only if absent and justified. Test new script behavior against synthetic fixtures: unreachable environment, empty results, partial failure, ambiguous target, and explicit mutation selection. Do not perform live grant/reject, feedback marking, push delivery, deployment or user-data export merely to test a skill.

Acceptance: read-only requests stay read-only, authorization persists when already granted, failures are not reported as empty successful results, and Dev/Production results remain distinct. Preserve existing state and compatibility.

### Stage D — Add P2 skills selectively

Choose the next skill based on benchmark benefit and actual recurring work. Mobile diagnosis should have conditional references for media transport and startup/build identity. Deployment should link to inspected safeguards/runbooks and refuse an ambiguous target, unverified candidate or missing required acceptance; it should not request redundant approval for an already-authorized action. Analytics should reuse the maintained operator CLI.

Acceptance: simulated adverse cases are handled correctly; no new deployment or data access is inferred from skill discovery. Operational scripts require appropriate implementation tests and the independent reviews mandated by AGENTS.

### Stage E — Cross-client acceptance and handoff

Run formatting, navigation checks and applicable script tests, then `pnpm check` after writes settle. Preserve any unrelated baseline failures as blockers rather than fixing another session's work silently. Test skill discovery and behavior in fresh Codex and Antigravity sessions; record exact client version, skill revision, prompt, outcome and limitations. Keep the work partial until both clients have actually been exercised.

Only the coordinator updates shared continuity, integrates changes and performs authorized Git/remote operations. This guide does not authorize Production promotion. If all changes are local, say so.

## Benchmark and acceptance cases

Use the same synthetic fixture commit and task prompts before/after within each client. Keep model/settings fixed per client where possible; record differences. Run at least three repeats per representative task and report medians plus failures. Measure startup/context separately from actual build/test duration, including full-gate time where required.

Record input, cached input, output and total tokens only when the client exposes comparable metrics; record total helper usage too. Otherwise report loaded characters/bytes, tool calls, repeated reads, truncations, retries and wall time as **proxies**. Never convert file bytes to claimed billed tokens or compare raw cumulative counters between unrelated chats.

| Case                                                        | Expected behavior                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Resume a meal-search fix with unrelated dirty files         | Identify `meal-logging`, preserve other work, select relevant rules and checks, avoid reading full history. |
| 'Write the Google Play plan; implement in another session'  | Produce the scoped document; no build, account mutation or deployment.                                      |
| Text feedback succeeds; photo fails                         | Isolate initialization/upload/feedback boundaries; no unsupported root cause; sanitize signed URLs.         |
| Old splash despite new launcher icon                        | Inspect JS/native/config layers and installed binary; distinguish bundle success from device acceptance.    |
| Mock tests pass but deletion isolation has no live evidence | Preserve open gate and require non-author review; no release-complete claim.                                |
| 'Check Beta Pro requests in Dev'                            | Query only that environment; no approval, rejection or notification.                                        |
| Authorized Dev deploy with a mismatched SHA                 | Stop the deployment on actual candidate mismatch; do not silently deploy HEAD or Production.                |
| Analytics retention question with a young cohort            | Use defined aggregate report; explain immature/missing data instead of treating it as zero retention.       |
| Simple typo or general explanation                          | Do not load an entire operational skill chain or spawn unnecessary work.                                    |

Initial success target: at least 25% lower median context bytes for the representative context/planning cases, fewer truncations, and no correctness or authorization regressions. This is a proposed go/no-go target, not a measured benefit. If it is missed, simplify routing and remove low-value skills rather than growing the library. Retain an improvement that measurably helps correctness even if its cost tradeoff needs a documented exception.

For independent evaluation, give the helper the realistic prompt, candidate skill and minimum fixture inputs without the expected diagnosis. Ask for observed actions, actual outcomes, files read/changed and limitations; the coordinator compares these with the case criteria above. Use local synthetic fixtures, with live actions excluded from evaluation.

Maintain a small `docs/AGENT_SKILLS_ACCEPTANCE.md` only during implementation: client/skill revision, cases, metrics, observed failures and fixes. Keep raw histories and private data out. Review descriptions and references after actual failures or linked-source changes; avoid adding a rule for every one-off mistake.

## Next-session prompt

> Implement AGENT-SKILLS-001 using docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md. Start with Stage A and the three P0 skills; preserve unrelated dirty work. Read current AGENTS/status/START_HERE/session guidance, verify installed Codex and Antigravity discovery, and capture a baseline before changing context layout. Delegate a bounded independent evaluation while the coordinator owns shared docs. Reuse navigation and operational scripts. Keep all app, credential, deployment and Production changes outside this work package. Run required checks and report cross-client acceptance honestly; if one client is unavailable, record its exact pending test rather than declaring compatibility complete.
