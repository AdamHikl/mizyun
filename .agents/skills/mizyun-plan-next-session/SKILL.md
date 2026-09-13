---
name: mizyun-plan-next-session
description: >-
  Prepare a scoped, grounded Mizyun implementation plan or guide for a later coding session. Grounded in current code, dated official sources, and acceptance gates. Use when the user requests a deferred plan; do not implement or mutate code.
---

# Mizyun Plan Next Session Skill

Use this skill when the user requests an implementation plan, architectural guide, or rollout proposal to be executed in a future session.

> [!IMPORTANT]
> **Planning Mode Only**: Do NOT implement feature code, modify database migrations, execute builds, deploy services, or alter credentials when this skill is invoked. The deliverable is a structured planning artifact.

## 1. Inspect Current State Before Planning

Do not plan from assumptions or outdated handoffs:

1. **Inspect Code**: Check current implementation files in the relevant packages (`packages/core`, `apps/api`, `apps/mobile`).
2. **Review Existing Gates**: Check [`status.md`](../../../status.md), [`backlog.md`](../../../backlog.md), and [`docs/REMEDIATION_EVIDENCE_CHECKLIST.md`](../../../docs/REMEDIATION_EVIDENCE_CHECKLIST.md) to distinguish what is already implemented from what is open.
3. **Respect User Scope**: If the user specifies platform boundaries (e.g. "plan Android only", "defer App Store submission"), explicitly mark other platforms as non-goals.

## 2. Research Affected Platforms

Before specifying steps, check official documentation for every external service materially affected:

1. **Primary Sources**: Consult official API docs (Apple Developer, Google Play Console, Supabase, Expo SDK, SES).
2. **Dated Research Log**: Record URL, access date, and key findings in [`docs/RESEARCH_LOG.md`](../../../docs/RESEARCH_LOG.md).
3. **ADR Criteria**: Do not draft a new ADR simply to restate existing engineering rules. Only propose an ADR if making a durable technical choice that changes module boundaries, protocols, or storage patterns.

## 3. Structure the Implementation Plan

Produce the planning document using this canonical structure:

### A. Context & Scope

- **Problem Statement**: Specific defect or feature requirement.
- **In Scope**: Granular deliverables.
- **Non-Goals**: Explicit exclusions (e.g. no deployment, no backend schema changes).

### B. Baseline & Constraints

- Current commit SHA and working tree status.
- Architectural boundaries (`packages/core` pure rules, contracts portability, zero mobile secrets).

### C. Staged Implementation Steps

Group changes logically into sequential stages:

- **Files Affected**: Label each file as `[NEW]`, `[MODIFY]`, or `[DELETE]`.
- **Implementation Detail**: Outline exact contracts, data models, or route changes.
- **Stage Acceptance Criteria**: Specific observable criteria required before advancing to the next stage.

### D. Verification Plan

- **Automated Tests**: Unit, contract, and integration commands.
- **Quality Gates**: Navigation validator (`pnpm navigation:check`), Prettier (`pnpm format:check`), and full check (`pnpm check`).
- **Manual Verification**: Physical device verification requirements.

### E. Next-Session Prompt

Conclude with a self-contained, copyable prompt for the future session that specifies:

- Target plan path and work package ID.
- First exact action.
- Constraints and file ownership.

## 4. Continuity Update

Update [`status.md`](../../../status.md) (or session artifact) noting that the planning guide was authored, with links to the plan and zero runtime mutations performed.
