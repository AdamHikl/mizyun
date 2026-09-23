# Mizyun backlog

> ⚠️ **MIGRATED TO GITHUB ISSUES (2026-09-14)**
>
> Task tracking and executable inventory have moved to [**GitHub Issues**](https://github.com/AdamHikl/mizyun/issues).
> Do not add new tasks here. Use GitHub Issues (`gh issue`) for discovering, tracking, updating, and completing tasks.
> For completed historical tasks prior to this migration, see [`completed-backlog.md`](completed-backlog.md).

## Quick CLI Reference

```bash
# List all open tasks
gh issue list --state open

# Filter by priority or status
gh issue list --label "priority:P0"
gh issue list --label "status:active"
gh issue list --label "status:ready"
gh issue list --label "status:blocked"

# Filter by functional area
gh issue list --label "area:google-play"
gh issue list --label "area:apple-store"
gh issue list --label "area:coach"
gh issue list --label "area:session"
gh issue list --label "area:infra"
gh issue list --label "area:remediation"

# View a specific issue
gh issue view <issue-number>

# Create a new task
gh issue create --title "[<ID>] <Task Title>" \
  --body "### Work Item\n...\n### Exit / Acceptance Criteria\n..." \
  --label "priority:P1,status:ready,area:<area>"

# Close an issue upon completion
gh issue close <issue-number> --reason completed
```

## Active Tasks Mapping (GitHub Issues #1–#54)

| Issue | ID                     | Priority | Status   | Work item                                                                  | Link                                                |
| ----- | ---------------------- | -------- | -------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| #1    | `PLAY-001`             | P1       | ready    | Publisher/account and testing eligibility                                  | [#1](https://github.com/AdamHikl/mizyun/issues/1)   |
| #2    | `PLAY-002`             | P1       | ready    | Safe signed Production AAB                                                 | [#2](https://github.com/AdamHikl/mizyun/issues/2)   |
| #3    | `PLAY-003`             | P1       | ready    | Android compatibility and device acceptance                                | [#3](https://github.com/AdamHikl/mizyun/issues/3)   |
| #4    | `PLAY-004`             | P1       | ready    | Policy behavior and listing                                                | [#4](https://github.com/AdamHikl/mizyun/issues/4)   |
| #5    | `PLAY-005`             | P1       | ready    | Internal/closed testing                                                    | [#5](https://github.com/AdamHikl/mizyun/issues/5)   |
| #6    | `PLAY-006`             | P1       | ready    | Review and intentional publication                                         | [#6](https://github.com/AdamHikl/mizyun/issues/6)   |
| #7    | `APPLE-004`            | P1       | ready    | Accept Apple login on Dev iPhone                                           | [#7](https://github.com/AdamHikl/mizyun/issues/7)   |
| #8    | `STORE-002`            | P1       | ready    | Upload and accept TestFlight candidate                                     | [#8](https://github.com/AdamHikl/mizyun/issues/8)   |
| #9    | `STORE-003`            | P1       | ready    | App Review and explicit public release                                     | [#9](https://github.com/AdamHikl/mizyun/issues/9)   |
| #10   | `BRAND-ICON-001`       | P3       | active   | Apply approved ribbon-M icon across launcher and startup                   | [#10](https://github.com/AdamHikl/mizyun/issues/10) |
| #11   | `BRAND-SPLASH-001`     | P2       | active   | Calibrate splash & animated launch screen background to brand palette      | [#11](https://github.com/AdamHikl/mizyun/issues/11) |
| #12   | `AI-BUDGET-001`        | P1       | active   | Decoupled AI token & photo draft budgets                                   | [#12](https://github.com/AdamHikl/mizyun/issues/12) |
| #13   | `BETA-PRO-001`         | P1       | active   | Beta Pro Pass request flow & approval CLI                                  | [#13](https://github.com/AdamHikl/mizyun/issues/13) |
| #14   | `OFFLINE-CACHE-001`    | P1       | ready    | Offline profile & dashboard cache for instant startup                      | [#14](https://github.com/AdamHikl/mizyun/issues/14) |
| #15   | `FIX-COACH-INTENT-001` | P1       | done     | Disambiguate Coach workout logging intents from meal drafts                | [#15](https://github.com/AdamHikl/mizyun/issues/15) |
| #16   | `DOCS-NAV-001`         | P1       | ready    | Reconcile current guidance, archive history, and introduce focused startup | [#16](https://github.com/AdamHikl/mizyun/issues/16) |
| #17   | `DOCS-NAV-002`         | P1       | ready    | Add feature manifest and bounded context command                           | [#17](https://github.com/AdamHikl/mizyun/issues/17) |
| #18   | `DOCS-NAV-003`         | P1       | ready    | Add advisory impact analysis and navigation/boundary checks                | [#18](https://github.com/AdamHikl/mizyun/issues/18) |
| #19   | `DOCS-NAV-004`         | P1       | ready    | Independently accept new-session navigation                                | [#19](https://github.com/AdamHikl/mizyun/issues/19) |
| #20   | `INFRA-DUAL-001`       | P1       | ready    | Restore access, inventory Pi and adopt environment/release design          | [#20](https://github.com/AdamHikl/mizyun/issues/20) |
| #21   | `INFRA-DUAL-002`       | P1       | ready    | Separate Pi Dev API/Supabase/Auth/Storage and HTTPS                        | [#21](https://github.com/AdamHikl/mizyun/issues/21) |
| #22   | `INFRA-DUAL-003`       | P1       | ready    | Both iPhone variants with guarded local/EAS profiles                       | [#22](https://github.com/AdamHikl/mizyun/issues/22) |
| #23   | `INFRA-DUAL-004`       | P1       | ready    | Exact-SHA Dev and Production promotion with safe CI                        | [#23](https://github.com/AdamHikl/mizyun/issues/23) |
| #24   | `INFRA-DUAL-005`       | P1       | ready    | Dual-environment acceptance and operational handoff                        | [#24](https://github.com/AdamHikl/mizyun/issues/24) |
| #25   | `REL-AUD-001`          | P1       | ready    | Persistent complete account export/deletion (R1; REL-001)                  | [#25](https://github.com/AdamHikl/mizyun/issues/25) |
| #26   | `REL-AUD-002`          | P1       | ready    | Mobile account data controls and accurate disclosures (R2)                 | [#26](https://github.com/AdamHikl/mizyun/issues/26) |
| #27   | `REL-AUD-003`          | P1       | ready    | Reproducible signed tester build profiles (R3; REL-002)                    | [#27](https://github.com/AdamHikl/mizyun/issues/27) |
| #28   | `REL-AUD-004`          | P1       | active   | Resolve iOS Google-login parity (R4)                                       | [#28](https://github.com/AdamHikl/mizyun/issues/28) |
| #29   | `REL-AUD-005`          | P0       | ready    | Current Gemini external eligibility/consent/evaluation gate (R5)           | [#29](https://github.com/AdamHikl/mizyun/issues/29) |
| #30   | `REL-AUD-006`          | P1       | ready    | Protect AI tier authority and budget every provider path (R6)              | [#30](https://github.com/AdamHikl/mizyun/issues/30) |
| #31   | `REL-AUD-007`          | P1       | ready    | Idempotent authoritative logging retries (R7)                              | [#31](https://github.com/AdamHikl/mizyun/issues/31) |
| #32   | `REL-AUD-008`          | P1       | ready    | Current candidate device/operations acceptance (R8; REL-002/003)           | [#32](https://github.com/AdamHikl/mizyun/issues/32) |
| #33   | `REL-AUD-010`          | P2       | ready    | Reconcile stale operational/AI/product documents                           | [#33](https://github.com/AdamHikl/mizyun/issues/33) |
| #34   | `MOB-AND-001`          | P2       | ready    | Split the founder Android APK per ABI                                      | [#34](https://github.com/AdamHikl/mizyun/issues/34) |
| #35   | `AI-GOV-001`           | P0       | active   | Mistral privacy, policy, DPA, ZDR, and commercial gate                     | [#35](https://github.com/AdamHikl/mizyun/issues/35) |
| #36   | `AI-MOB-001`           | P1       | active   | Native Coach conversation experience                                       | [#36](https://github.com/AdamHikl/mizyun/issues/36) |
| #37   | `ALPHA-001`            | P0       | ready    | Founder week plus 10–30 design-partner alpha                               | [#37](https://github.com/AdamHikl/mizyun/issues/37) |
| #38   | `BILL-001`             | P1       | blocked  | Premium packaging and mobile subscription billing                          | [#38](https://github.com/AdamHikl/mizyun/issues/38) |
| #39   | `IOS-HEALTH-001`       | P2       | research | HealthKit permissions and steps adapter                                    | [#39](https://github.com/AdamHikl/mizyun/issues/39) |
| #40   | `AND-HEALTH-001`       | P2       | research | Health Connect permissions and steps adapter                               | [#40](https://github.com/AdamHikl/mizyun/issues/40) |
| #41   | `MEM-001`              | P0       | active   | Persistent memory adapter and controls                                     | [#41](https://github.com/AdamHikl/mizyun/issues/41) |
| #42   | `AI-001`               | P0       | active   | Evaluate/select initial Mistral model                                      | [#42](https://github.com/AdamHikl/mizyun/issues/42) |
| #43   | `AI-002`               | P1       | active   | Text coaching adapter and read-only tools                                  | [#43](https://github.com/AdamHikl/mizyun/issues/43) |
| #44   | `VISION-001`           | P1       | done     | Editable text/photo food drafts                                            | [#44](https://github.com/AdamHikl/mizyun/issues/44) |
| #45   | `VISION-002`           | P2       | blocked  | Conservative body-progress observations                                    | [#45](https://github.com/AdamHikl/mizyun/issues/45) |
| #46   | `REL-001`              | P0       | blocked  | Privacy/export/deletion release gate                                       | [#46](https://github.com/AdamHikl/mizyun/issues/46) |
| #47   | `REL-002`              | P0       | blocked  | iOS/Android beta build matrix                                              | [#47](https://github.com/AdamHikl/mizyun/issues/47) |
| #48   | `REL-003`              | P1       | blocked  | Accessibility and poor-network pass                                        | [#48](https://github.com/AdamHikl/mizyun/issues/48) |
| #49   | `AUTH-SMTP-001`        | P1       | active   | Domain-authenticated Auth & transactional email delivery                   | [#49](https://github.com/AdamHikl/mizyun/issues/49) |
| #50   | `INFRA-WIN-001`        | P0       | active   | Provision Windows/WSL2 founder-production backend                          | [#50](https://github.com/AdamHikl/mizyun/issues/50) |
| #51   | `INFRA-SELFHOST-001`   | P0       | active   | Self-hosted Mizyun-operated Supabase on Adam's Slovakia PC (alpha)         | [#51](https://github.com/AdamHikl/mizyun/issues/51) |
| #52   | `INFRA-PORT-001`       | P1       | blocked  | Managed-to-self-hosted portability and restore lab                         | [#52](https://github.com/AdamHikl/mizyun/issues/52) |
| #53   | `INFRA-CUTOVER-001`    | P2       | blocked  | Rehearse and execute production data-plane migration                       | [#53](https://github.com/AdamHikl/mizyun/issues/53) |
| #54   | `AGENT-SKILLS-001`     | P1       | ready    | Shared agent skills implementation guide and evaluation                    | [#54](https://github.com/AdamHikl/mizyun/issues/54) |
