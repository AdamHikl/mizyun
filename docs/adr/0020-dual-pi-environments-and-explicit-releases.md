# ADR-0020: Dual Pi environments and explicit releases

- Status: superseded as the active host topology by the accepted Hetzner cutover on 2026-09-19; retained for the origin of environment-isolation and explicit-release safeguards
- Date: 2026-09-07
- Related: ADR-0018, current `AGENTS.md` Hetzner policy, INFRA-DUAL-001–005

## Context

The founder wants Dev and Production running independently on the Raspberry Pi, both iPhone variants installed, and one Mac codebase for feature development and releases. The current workflow assumes one remote production environment and promotes each committed segment; existing app identities provide only part of the requested separation.

## Proposed decision

Keep one repository and short `codex/*` feature branches. Use `main` for integration, an explicit accepted SHA for each production release, and a separate Pi Dev checkout/API/Supabase/Auth/Storage/secrets stack. Never merge environment data. Use `com.mizyun.dev` for Metro development and standalone preview modes and `com.mizyun.app` for production distribution. The two Dev modes replace each other while coexisting with Production.

Retain production paths/endpoints during initial Dev provisioning. Gate the second stack on measured capacity and recovery evidence. Run clean destructive schema checks on disposable Mac/CI infrastructure only. Existing infrastructure and external-AI release constraints remain in force.

## Adoption and consequences

This records a target, not a completed environment change. During implementation, amend the per-commit promotion instructions to distinguish feature commits from releases, retire unsafe remote reset tooling, and explicitly supersede obsolete parts of ADR-0018. Preserve production safety rules, exact-SHA verification, forward migrations, and device acceptance.

The Pi remains a shared failure domain. A third staging environment and physically separate hosting become appropriate as reliability needs grow; this decision does not waive the existing paying-user infrastructure gates.

The full configuration matrix, research links, scripts to implement, acceptance criteria and next-session prompt are in [the implementation guide](../tutorials/DEV_PRODUCTION_PI_GUIDE.md).
