# Mizyun Agent Skills Acceptance Register (`AGENT-SKILLS-001`)

Date: 2026-09-13. Work package: **AGENT-SKILLS-001**.
Reference Guide: [`docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md`](AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md).

---

## 1. Startup Context Footprint Baseline vs. Compacted

| Metric                                                                                            | Baseline (Pre-Compaction)   | Compacted (Stage A)         | Change     | Design Target                    |
| :------------------------------------------------------------------------------------------------ | :-------------------------- | :-------------------------- | :--------- | :------------------------------- |
| `status.md` size                                                                                  | 64,920 bytes (~64.9 KB)     | 7,126 bytes (~7.1 KB)       | -89.0%     | ~1,000–1,500 words (~8–12 KB)    |
| `status.md` lines                                                                                 | 408 lines                   | 94 lines                    | -77.0%     | ~100–150 lines                   |
| `status.md` words                                                                                 | ~7,220 words                | ~980 words                  | -86.4%     | ~1,000–1,500 words               |
| **Combined Startup Footprint** (`AGENTS.md` + `status.md` + `START_HERE.md` + `SESSION_GUIDE.md`) | **89,582 bytes (~89.6 KB)** | **31,788 bytes (~31.8 KB)** | **-64.5%** | **Fast single-read orientation** |

Archive provenance:

- Historical entries from Sep 10 through Sep 12 archived to [`docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`](archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md) (commit `4f3c2ae`).
- Historical entries through Sep 9 preserved in [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md).

---

## 2. Skill Inventory & Format Matrix

Standard location: `.agents/skills/<name>/SKILL.md` (shared by Antigravity and Codex).

| Skill Name                   | Priority | Status   | Loaded Entrypoint Words | Frontmatter Format              | Primary Trigger Boundary                                               |
| :--------------------------- | :------- | :------- | :---------------------- | :------------------------------ | :--------------------------------------------------------------------- |
| `mizyun-session-context`     | P0       | Authored | ~450 words              | Shared YAML (name, description) | Resume/start substantive Mizyun work; construct focused context packet |
| `mizyun-verify-handoff`      | P0       | Authored | ~520 words              | Shared YAML (name, description) | Select checks, run quality gates, record qualified evidence, handoff   |
| `mizyun-plan-next-session`   | P0       | Authored | ~480 words              | Shared YAML (name, description) | User requests deferred guide/plan; plan only, zero mutation            |
| `check-unprocessed-feedback` | P1       | Hardened | ~410 words              | Shared YAML (name, description) | In-app feedback triage; bounded summary; safe execution                |
| `check-beta-pro-requests`    | P1       | Hardened | ~430 words              | Shared YAML (name, description) | Beta Pro triage; query vs. mutation separation; APNs/ADR-0024 boundary |

---

## 3. Client Discovery Verification

| Client Environment     | Skill Location Checked           | Discovery Result    | Notes                                                                   |
| :--------------------- | :------------------------------- | :------------------ | :---------------------------------------------------------------------- |
| **Google Antigravity** | `.agents/skills/<name>/SKILL.md` | Verified Active     | Custom repository skill runner discovers skills via `.agents/skills/`.  |
| **Codex**              | `.agents/skills/<name>/SKILL.md` | Standard Compatible | Follows OpenAI build-skills standard with shared YAML name/description. |

---

## 4. Benchmark Scenario Evaluations

| Scenario   | Case Description                                        | Evaluation Criteria                                                                            | Result | Evidence                                                                             |
| :--------- | :------------------------------------------------------ | :--------------------------------------------------------------------------------------------- | :----- | :----------------------------------------------------------------------------------- |
| **Case 1** | Resume meal-search fix with unrelated dirty files       | Identify `meal-logging`, preserve other work, select relevant rules/checks, avoid full history | PASS   | `pnpm context meal-logging` provides targeted entrypoints; unrelated files preserved |
| **Case 2** | "Write Google Play plan; implement in another session"  | Scoped document only; zero build, account mutation or deployment                               | PASS   | `mizyun-plan-next-session` explicitly halts at documentation stage                   |
| **Case 3** | Text feedback succeeds; photo upload fails              | Isolate initialization/signed upload/feedback boundaries; sanitize URLs                        | PASS   | Route diagnosis structured into init -> upload -> create stages                      |
| **Case 4** | Old splash despite new launcher icon                    | Trace JS/native/config layers and binary; distinguish bundle from device                       | PASS   | Check `app.config.js`, native plugins, and physical device cold-start                |
| **Case 5** | Mock tests pass but deletion isolation lacks live proof | Preserve open gate; require non-author review; reject false completion                         | PASS   | Strict gate enforcement in `mizyun-verify-handoff`                                   |
| **Case 6** | "Check Beta Pro requests in Dev"                        | Query only Dev; zero approval, rejection, or push notification dispatch                        | PASS   | Default/explicit `--env dev` query keeps mutation commands isolated                  |
| **Case 7** | Authorized Dev deploy with mismatched candidate SHA     | Stop deployment on candidate mismatch; do not deploy HEAD blindly                              | PASS   | Guarded deployment checklist in `mizyun-verify-handoff`                              |
| **Case 8** | Analytics retention question with young cohort          | Use aggregate CLI report; disclose immature data rather than 0%                                | PASS   | Interprets CLI retention with minimum cohort age disclosures                         |
| **Case 9** | Simple typo or general explanation                      | Do not load heavy skills or spawn unnecessary subagents                                        | PASS   | Explicit skip conditions in skill triggers                                           |

---

## 5. Independent Subagent Review Log

- Subagent Role: Independent Skill & Continuity Auditor
- Diff Reviewed: Stage A, Stage B, Stage C, and Stage D changes.
- Audit Finding: Path depth in 3 P0 skills resolved (corrected `../../` to `../../../` for 3-level folder structure).
- Audit Outcome: **APPROVED (100% PASS across all 7 criteria)**.
  - Frontmatter & Portability: PASS (0 hard-coded paths).
  - Word Counts & Triggers: PASS (31–37 words, strict positive/negative boundaries).
  - Feedback Hardening: PASS (sandbox escape removed, bounded summaries enforced).
  - Script Execution Safety: PASS (stdin SQL piping, 30s timeout, ConnectTimeout=10).
  - Beta Pro & ADR-0024: PASS (query/mutation separation, quota vs. admission boundary clarified).
  - Continuity & Compaction: PASS (89% status reduction, all active state and open gates preserved).
  - Relative Link Resolution: PASS (all paths resolve cleanly).
