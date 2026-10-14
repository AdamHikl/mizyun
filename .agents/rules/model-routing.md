# Model Routing & Safety Boundaries

> **Updated 2026-10-14 (Adam):** Mizyun development moved from Codex to Claude Code. The coordinator is the Claude Code session; helpers are Claude Code subagents started with the Agent tool. The earlier Antigravity/Gemini coordinator and GPT-6.1 Sol routing are retired. The local Qwen worker remains **paused** (user decision 2026-09-14) and must not receive tasks.

## 1. Roles

### Coordinator (Claude Code session)

- Owns session continuity: `status.md`, `plan.md`, evidence registers and GitHub Issues.
- Decomposes work packages into bounded helper packets with disjoint file ownership.
- Integrates helper results, reads the actual diff and runs final verification (`pnpm check`).
- **Exclusive actions:** only the coordinator (or Adam) commits, pushes, deploys (`deploy:dev`, `deploy:production`), changes credentials or remote configuration, restarts shared services or runs disposable-database checks.

### Helpers (Claude Code subagents)

| Work                                                                                                                                                                             | Agent / model                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Broad read-only source discovery                                                                                                                                                 | `Explore` agent                      |
| Ordinary implementation, tests, focused research, docs                                                                                                                           | `general-purpose`, `model: "sonnet"` |
| Sensitive implementation or review: authentication, authorization, RLS/migrations, account deletion/export, health data, photos, AI access/budgets, provider secrets, deployment | `general-purpose`, `model: "opus"`   |
| Ambiguous cross-module/architectural work, final review before Production promotion                                                                                              | `general-purpose`, `model: "opus"`   |

- Set `model` explicitly on every Agent call; prose does not select a model.
- An independent reviewer must not have authored the reviewed code. Give it a fresh packet: baseline SHA, owned diff, requirements, check results and review boundary.
- Helpers stay within their allowed files and never commit, push, deploy or run destructive commands.
- Adam's explicit override always wins.

## 2. Safety & Data Protection

- **No sensitive data:** never pass user health records, photos, API credentials, service-role keys or production environment variables into helper prompts without sanitization.
- **Sanitized context:** supply sanitized code snippets, type definitions and test expectations.
- **Pristine state:** helpers leave no unverified or dirty files that break `pnpm check`.

## 3. Helper packet and report

Each helper packet includes: objective, allowed files, prohibited actions, verification command, baseline SHA and minimal relevant context/requirements.

Each helper report includes: status (success/failed), files changed, commands run with exit codes and summaries, unresolved risks and suggested next action. A helper's completion message is not acceptance evidence by itself.
