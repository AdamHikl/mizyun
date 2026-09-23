# Mizyun status history — 2026-09-13 through 2026-09-22

> Archived verbatim from the former live `status.md` during `SIMPLIFY-01` on 2026-09-22. Entries retain their original evidence scope and may describe superseded topology or next actions. Use [`../../../status.md`](../../../status.md) for the current snapshot.

> Fast-changing operational snapshot. Last updated: **2026-09-22**.
> For historical logs, audit entries, and prior session handoffs, see:
>
> - [`docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`](../../archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md) (Handoffs from Sep 10 through Sep 12)
> - [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](../../archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md) (Handoffs through Sep 9)

## Planning handoff — Codebase simplification (`CODEBASE-SIMPLIFY-001`, 2026-09-22)

- Authored [the researched staged plan](../../CODEBASE_SIMPLIFICATION_PLAN_2026-09-22.md): compact and reconcile startup guidance, repair existing navigation, introduce narrow feature interfaces, prove a Settings extraction, then selectively refactor larger workflows. Primary sources recorded in `docs/RESEARCH_LOG.md`.
- Baseline: `ed70df727fdb38940b686b1dd2647d519f8478cd` with 80 pre-existing dirty/untracked entries; preserved prior work. Independent read-only navigation audit: 27/27 tests pass; validator reports 0 errors and 14 stale-review warnings. Reproduced obsolete Pi/Qwen context and broken typo suggestions despite passing checks.
- Documentation-only planning; no runtime edits, builds, deployments, issue mutations or fresh full `pnpm check`. Existing implementation/device/release claims below retain their original scope. Implementation has not started.
- **Next exact action:** follow the plan's Stage 1 prompt; re-read current #33 acceptance, compact status with linked archives, and reconcile active guidance. Coordinate existing work before any shared-file refactor. Stage 5 meal changes depend on settled #102/#117 ownership; all release gates remain separate.

## Implemented & verified handoff — Keyset cursor pagination and full-history search beyond 200 meals (#117) (2026-09-22)

- **Issue #117 implemented and automatically verified**:
  - Contracts (`@mizyun/contracts`): updated `foodEntryListQuerySchema` to accept optional `cursor` (string) and `search` (max 100 characters); updated `foodEntryListResponseSchema` to expose `nextCursor` (nullable string) and `cutoffDateIsPartial` (boolean). All 75 tests passing.
  - Core (`@mizyun/core`): updated `FoodEntryRepository.list` to accept `cursor: { consumedAt: Date; id: string }` and `search?: string | null`. Pure domain boundary preserved.
  - Database adapter (`@mizyun/adapter-supabase-server`):
    - Added `.or()` and `.ilike()` to `RepositoryQueryBuilder`.
    - Applied keyset ordering: `order("consumed_at", { ascending: false }).order("id", { ascending: false })`.
    - Filtered cursor via `.or("consumed_at.lt...,and(consumed_at.eq...,id.lt...)")` for deterministic tie-breaking on identical timestamps without duplicates or skips.
    - Sanitized SQL LIKE wildcards (`%`, `_`, `\`) for strict substring matching.
    - Preserved tenant isolation and RLS via JWT bearer headers and explicit `.eq("user_id", userId)`.
    - All 81 adapter tests passing.
  - In-memory repository (`apps/api`): aligned `InMemoryFoodEntryRepository.list` with date bounds, entry-name search matching, descending timestamp sort, and `id` descending tie-breaker.
  - API routes (`apps/api`):
    - Queried `cappedLimit + 1` to compute pagination boundary.
    - Computed `nextCursor` from the boundary entry encoded as base64url JSON (`{ c: isoString, i: id }`).
    - Validated UUID format on cursor ID to prevent query injection.
    - Computed `cutoffDateIsPartial`: compares local calendar day (`utcOffsetMinutes`) between the limit-th entry and the (limit+1)-th entry.
    - Regression test suite covers: 200/201 boundaries, identical timestamps tie-breaking, grandma's lentil soup search across 205 entries, split cutoff-day detection, and cursor validation. All 559 API tests passing.
  - Mobile app (`@mizyun/mobile`):
    - Added `mergeFoodEntries` helper preserving newest-first order and deduplicating by ID.
    - Updated `fetchFoodHistoryWith` and `fetchFoodHistory` to support `cursor`, `search`, and `limit`.
    - `groupFoodEntriesByDay` flags the boundary group as `isPartial = true` only when cutoff date is partial and more pages exist.
    - In `meal-list-screen.tsx`:
      - Day headers display a "Partial" badge and day totals display "Partial totals · ...".
      - Debounced server-side search (250ms) enables full-history search beyond the loaded 200 items.
      - Distinguishes "Searching entire meal history…", "No meals match '<query>'", and partial/continuation results.
      - History continuation footer provides "Load older meals" / "Load more matching meals", spinner, split cutoff notice ("Cutoff day is split across pages. Load older meals to complete totals"), and "All meals loaded (N total)" notices.
      - Preserved meal grouping, renaming, ungrouping, portion adjustment modal, copy meal, delete meal, and edit navigation from #102.
    - All 493 mobile tests passing.
  - Independent code review completed; all recommendations addressed (cursor UUID validation, error handling in `loadMoreSearch`, name-only search scoping, SQL wildcard escaping).
  - Complete repository quality gate `pnpm check` passed cleanly across all 15 workspaces (typechecks, lints, formatting, all test suites, Hermes native bundles, deployment safeguards, and 56/56 offline AI screener invariants).
- **Acceptance status / next exact action:** Implemented and automatically verified with passing quality gate. Next exact action is to test on Dev with synthetic data using the `deploy-dev` skill once changes are committed, and close GitHub issue #117.

## Implemented & verified handoff — Native client photo/text meal draft acceptance (#44) (2026-09-22)

- **Physical device acceptance recorded** (`VISION-001`, Issue #44):
  - Validated on physical iOS device running `com.mizyun.dev` connected to Hetzner Dev backend (`https://mizyun-api-dev.phiskel.com`).
  - End-to-end journey verified: native photo capture / library picking, text description inputs, draft generation via `POST /v1/food-entries/draft` (Gemini vision provider), and display of candidate nutrition breakdowns with uncertainty warnings.
  - Manual editability before saving verified: user confirmed adjustments for portion sizes and macro values satisfy core product principle `goals.md:99,146` ("User-confirmed facts beat AI guesses").
  - Single authoritative record creation confirmed upon user save; systematic weighed-meal accuracy benchmarking remains tracked separately under #29 / Gate `BEFORE_TESTING.md:44`.
  - Issue #44 closed with evidence and labeled `status:done`.
- **Acceptance status / next exact action:** implemented, verified on native iOS device, and closed. Next exact action is to proceed with the highest priority ready backlog items (P0 account export/deletion #25 and founder loop #37, or P1 Hetzner/Auth/AI items #49, #41, #36, #31, #30, #26).

## Implemented & verified handoff — Production auth callback acceptance & HTTPS email bridge (#99) (2026-09-22)

- **HTTPS Auth Bridge deployed live on public website** (`WEB-MIZYUN-003`, Issue #99):
  - Created `/mizyun/auth/callback` in `mizyun-website` (`app/mizyun/auth/callback/page.tsx`, `bridge.tsx`) deployed to Cloudflare Workers (`Version ID: 59793d7e-fd2b-4275-9d8b-681e38e885bf`).
  - Safe token handling: reads fragment `#access_token=...` purely client-side; zero tokens are ever sent to HTTP server logs or external telemetry.
  - Token scrubbing: cleanses URL fragment and query strings via `window.history.replaceState` immediately on mount, preventing token persistence in browser history and address bars.
  - Privacy & indexing guards: configured `robots: { index: false, follow: false }` and `Referrer-Policy: no-referrer`.
  - Desktop UX: renders a clear, branded confirmation page ("Email Confirmed" / "Reset Link Verified") explaining that Mizyun is mobile-only, instructing the user to launch or download the app on their phone without triggering raw browser protocol errors.
  - Mobile UX: automatically trampolines to native app deep links (`mizyun://auth/callback` or `mizyun-dev://` via `?scheme=mizyun-dev`), providing an explicit "Open Mizyun App" button as a manual fallback.
  - Single-use & error resilience: parses `error`, `error_code`, and `error_description` (with safe try-catch decoding against `URIError`) and displays clear guidance for expired or reused links (`otp_expired`) with direct link to `support@mizyun.phiskel.com`.
  - Direct visit guard: visitors without tokens receive a neutral informational page rather than false-positive confirmation.
  - Route tests & proxy: updated `proxy.ts` and `tests/routes.test.mjs`; all 10 website tests passed cleanly, and live HTTPS endpoint `https://www.phiskel.com/mizyun/auth/callback` returns HTTP 200.
- **Mobile adapter & composition root updated**:
  - Added optional `emailRedirectUri` to `SupabaseMobileConfiguration` and `SupabaseMobileAuthClient` in `@mizyun/adapter-supabase-mobile`, with 19/19 passing tests.
  - Wired `emailRedirectUri` in `apps/mobile/src/composition/auth-client.ts` to route email confirmations and password recovery to the HTTPS bridge according to app variant (`resolveAppVariant()`).
  - Documented the HTTPS bridge, desktop behavior, and test procedures in `docs/AUTH_VERIFICATION.md`.
- **Hetzner Production & Dev Supabase configuration updated**:
  - Production (`/srv/mizyun/supabase/.env`): preserved `SITE_URL=mizyun://auth/callback` for existing mobile clients and updated `ADDITIONAL_REDIRECT_URLS=mizyun://auth/callback,https://www.phiskel.com/mizyun/auth/callback`. Auth container recreated and healthy; effective `GOTRUE_URI_ALLOW_LIST` verified.
  - Dev (`/var/lib/mizyun/dev/supabase/.env`): preserved `SITE_URL=mizyun-dev://auth/callback` and updated `ADDITIONAL_REDIRECT_URLS=https://mizyun-supabase-dev.phiskel.com/auth/v1/callback,mizyun-dev://auth/callback,https://www.phiskel.com/mizyun/auth/callback`. Dev auth container recreated and healthy.
  - Verified public Auth and API health on both Production (`https://mizyun-api.phiskel.com/v1/health`) and Dev (`https://mizyun-api-dev.phiskel.com/v1/health`).
- **Multi-agent collaboration & verification**:
  - Dispatched independent review subagent. Addressed all findings (defensive error decoding, accessToken presence validation, mobile composition wiring, scheme parameter support).
  - Full repository `pnpm check` passed cleanly across all 15 workspaces (typechecks, native Hermes bundles, 489 mobile tests, 536 API tests, deployment safeguards, and 56/56 offline AI invariants).
- **Acceptance status / next exact action:** implemented, deployed to Cloudflare, configured on Hetzner, and automatically verified. Next exact action is to close GitHub issue #99 with qualified evidence and proceed to the highest priority backlog items (P0 account export/deletion #25 and founder loop #37, or P1 items #7, #49, #44).

## Implemented & verified handoff — Clean-checkout CI gate (#109, #110) and decoupled dashboard refresh (#114) (2026-09-21)

- Decoupled portable quality gate from ambient generated native files (#109):
  - Updated `scripts/test-build-matrix.mjs` to evaluate Android release signing directly using the authoritative Expo config plugin (`apps/mobile/plugins/with-android-release-signing.js`) against a controlled fixture, without requiring ambient `apps/mobile/android/app/build.gradle`.
  - Added support for `MIZYUN_REPO_ROOT` to enable hermetic candidate worktree testing.
  - Added regression test in `scripts/test-deployment-safeguards.mjs` verifying clean-checkout execution without ignored native folders (39/39 passing).
- Checked-in PR application quality gate workflow (#110):
  - Created `.github/workflows/quality-gate.yml` running on `pull_request` and `push` to `main` for application, package, script, and CI paths.
  - Authoritative pinned environment: `ubuntu-latest`, Node.js `22.13.0`, pnpm `10.33.0`.
  - Runs `pnpm install --frozen-lockfile` and the complete secret-free repository quality gate: `pnpm check`.
  - Unambiguously named `quality-gate / Clean Checkout Application Quality Gate` for branch protection rules.
- Decoupled dashboard section loading & bounded review requests (#114):
  - Split `loadMetrics` in `apps/mobile/src/features/dashboard/dashboard-screen.tsx` into independent resolution tiers:
    - Tier 1 (Immediate Daily Signals): Today's nutrition (`fetchDailySummary`), latest weight (`fetchLatestWeight`), and energy balance (`fetchEnergySummary`) resolve and update UI immediately without waiting for historical aggregations.
    - Tier 2 (Period Review Signals): Workout count (`fetchWorkoutCountForPeriod`) and historical nutrition review (`fetchNutritionReviewSummaries`).
  - Added granular section status tracking (`sectionStatus: { nutritionToday, weight, energy, review }`).
  - Replaced 31-request client fanout with the existing API range query contract (`/v1/food-entries/summary?from=...&to=...&utcOffsetMinutes=...`), bounding a 31-day month review to **1 single range query** and reducing total dashboard network calls from **35 to 5**.
  - Deduplicated Today's fetch: historical review bounds queries strictly up to yesterday, combining historical summaries with Today via `combineNutritionReview`. On period start (Monday/1st), historical request is skipped (0 requests).
  - Preserved daylight saving time and local-day semantics with noon-anchored traversal and `utcOffsetMinutes`.
  - Scoped fallback and cache protection: historical review failure **never** reverts fresh daily calories or weight to older cached snapshots. Cache persistence is guarded against saving partial error states.
  - Integrated native `RefreshControl` on `<ScrollView>` supporting pull-to-refresh.
  - Added 18 new unit and regression tests in `apps/mobile/src/features/dashboard/dashboard-data.test.ts` (40/40 passing), including exact 1-request assertions and DASH-LOAD-001 failure/delay regressions.
- Verification & Multi-Agent Collaboration:
  - Independent code reviews conducted and approved for #109, #110, #112, #113, and #114.
  - Full repository `pnpm check` passed cleanly across all 15 workspaces: typechecks, native iOS/Android Hermes bundles, 489 mobile tests, 536 API tests, 39 deployment safeguards, and 56/56 offline AI invariants.
  - GitHub issues #109, #110, #112, #113, #114, and #15 commented with evidence and closed.
- **Acceptance status / next exact action:** implemented and automatically verified. Next exact action is to proceed with the highest priority ready issues in the backlog (P0 account export/deletion #25 and founder loop #37, or P1 Hetzner/Auth/AI items #99, #49, #44, #41, #36, #31, #30, #26, #23, #21, #4).

## Implemented & verified handoff — Dashboard nutrition trust (#112) and cache scoping (#113) (2026-09-21)

- Resolved daily nutrition trust failure (#112):
  - Created pure `computeDailyNutritionDisplay` helper in `apps/mobile/src/features/dashboard/dashboard-data.ts` and integrated it with `DailyNutritionCard` and `MacroBar` in `dashboard-screen.tsx`.
  - When calories are unknown (`caloriesToday === null`) with logged entries, remaining allowance is withheld (`remainingKcal: null`) rather than falsely reporting that 100% of the target allowance remains.
  - The allowance badge displays `Needs nutrition` with warning styling (`#D97706`), accompanied by an actionable prompt (`Some meals have unconfirmed nutrition · Review in Meals Hub →`).
  - Missing/incomplete macros display `—` with 0% fill instead of misleading `0g`.
  - Zero-entry days display `status: "no_entries"` with 0 consumed and full target allowance.
  - Confirmed zero days display `status: "complete"` with 0 consumed and 0g macros.
- Resolved cache mismatch and out-of-order request races (#113):
  - Segmented dashboard cache keys by `(userId, localDate, reviewPeriod)`: `mizyun.offline-cache.dashboard.${userId}.${localDate}.${reviewPeriod}`.
  - Added user index tracking (`mizyun.offline-cache.dashboard-keys.${userId}`) with promise-chained mutex lock queue (`withIndexLock`) to serialize concurrent multi-period writes and ensure clean complete multi-key purge on sign-out via `purgeOfflineCache`.
  - Updated `loadCachedDashboard` to default `requireExactDate: true` and enforce `reviewPeriod` matching, preventing yesterday's metrics or cross-period summaries from being loaded as current.
  - Added `activeRequestId` monotonic ref guard across `loadMetrics`, cache pre-population, network fetch, and offline fallback to drop superseded responses and eliminate race conditions during rapid period toggles.
- Verification:
  - 8 new unit tests in `src/features/dashboard/dashboard-data.test.ts` (19/19 passed) and 4 new tests in `src/features/offline-cache/offline-cache-storage.test.ts` (13/13 passed).
  - Independent non-author review approved the nutrition calculations, cache scoping, and lifecycle guards with no blocking findings.
  - Full repository `pnpm check` passed with 0 errors: all 15 workspace typechecks, iOS Hermes bundle (6.3 MB), Android Hermes bundle (6.6 MB), 470 mobile tests, 38 deployment safeguards, and 56/56 offline AI invariants.
  - Navigation checks passed with 0 errors.
- **Acceptance status / next exact action:** implemented and automatically verified. Visual acceptance on Dev app pending next build. Next exact action is to make the clean-checkout gate portable under #109 before enabling PR enforcement under #110.

## Completed audit — Dev app review and GitHub backlog reconciliation (2026-09-21)

- Reviewed current product source, goals, information architecture, coding workflow and the full open GitHub backlog. The durable findings and evidence are in `docs/DEV_APP_REVIEW_2026-09-21.md`.
- Rebuilt and installed the current dirty-working-tree Dev app on the iPhone 17 simulator over a September 14 bundle. The app launched and retained the synthetic Dev account. Embedded bundle SHA-256: `c719f7f37558bccbb2a96e7085ec656077bed89d80062fdc31335face0c7efd4`; source fingerprint: `50859e478c7d35cb6cefe48db30351ca4704d5c239d749879c2362a462ab37c2`. The user stopped further simulator inspection; no physical-device acceptance is claimed.
- Rewrote 36 surviving issues around the current Hetzner, Gemini, local native-build and store-release path. Closed 18 obsolete/duplicate issues as superseded and #17/#18 as completed after fresh navigation checks. Created findings #109–#114 and #117. The final 44 open issues each have a priority, status and area label.
- Fresh `pnpm check` passed, including all workspace typechecks, both native bundle exports, repository test suites, release/operations safeguards and 56/56 offline AI invariants. No Production mutation, backend deployment, store upload or physical-device work occurred.
- **Next exact action:** address trust failures #112 and #113 first, then make the clean-checkout gate portable under #109 before enabling PR enforcement under #110. Keep release-gate acceptance in #25, #27, #29 and #32 distinct from source completion.

## Implemented & device-verified handoff — Fast non-interactive mobile install engine & skills for iOS and Android (2026-09-21)

- Built a unified, non-interactive mobile installation engine in `scripts/mobile-device-install.sh` supporting four concrete platform/variant targets:
  - iOS Dev (`pnpm mobile:install:ios:dev` / `com.mizyun.development`)
  - iOS Production (`pnpm mobile:install:ios:production` / `com.mizyun.app`)
  - Android Dev (`pnpm mobile:install:android:dev` / `com.mizyun.dev`)
  - Android Production (`pnpm mobile:install:android:production` / `com.mizyun.app`)
- Solved key agent bottlenecks that caused exploratory token waste, hangs, or failures:
  - Bypassed `expo run` to eliminate foreground Metro bundler hangs and interactive device prompts.
  - Automatic variant synchronization: detects bundle ID or package ID drift in native folders and automatically triggers clean prebuild if needed.
  - Non-interactive device resolution: auto-detects paired physical iPhone via CoreDevice (`xcrun devicectl`) and Android device via ADB (`adb devices -l`), with clear actionable guidance if locked or unauthorized.
  - Signing & profile renewal: compiles iOS with `itinn s.r.o.` (`LQJNDVBL43`) and `-allowProvisioningUpdates`; configures Android with `MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true` for test sideloading.
  - Kill rogue Metro on 8081 before launching to guarantee standalone Mac-off verification.
  - Emits formatted Markdown evidence ready for `status.md`.
- Created four compact agent skills in `.agents/skills/`:
  - `.agents/skills/install-ios-dev/SKILL.md`
  - `.agents/skills/install-ios-production/SKILL.md`
  - `.agents/skills/install-android-dev/SKILL.md`
  - `.agents/skills/install-android-production/SKILL.md`
- Updated `docs/PHYSICAL_DEVICE_ACCEPTANCE_GUIDE.md` with Apple Developer Team `LQJNDVBL43` (`itinn s.r.o.`) and the new 1-step workflow table.
- Live verification:
  - Dry runs (`--dry-run`) passed for all 4 targets in <1s.
  - Live iOS install: `pnpm mobile:install:ios:dev` compiled standalone Release app, signed with `itinn s.r.o.`, installed onto physical iPhone 16 Pro (`00008140-001114501A86801C`), and launched `com.mizyun.development` without Metro.
  - Safeguards & build matrix: all 38 deployment safeguards and all build matrix tests passed cleanly.
- **Acceptance status / next exact action:** implemented, automated, and live device verified on physical iPhone. Any agent or developer across tools can now execute 1-step installs via `pnpm mobile:install:<platform>:<variant>`.

## Implemented handoff — Dedicated deployment skills & instant preflights for Dev & Production (2026-09-21)

- Created two standardized agent skills under `.agents/skills/deploy-dev/SKILL.md` and `.agents/skills/deploy-production/SKILL.md` to eliminate token-heavy exploratory research across sessions and external AI tools (Claude Code, Cursor, OpenCode, Aider, terminal CLI).
- Created two non-destructive, sub-second preflight CLI checkers:
  - `scripts/preflight-dev-deploy.mjs` (`pnpm deploy:dev:preflight [sha]`): validates working tree cleanliness, candidate commit, origin push status, `mizyun-hetzner-dev` SSH connectivity, Hetzner primary marker, and current public Dev API health (`https://mizyun-api-dev.phiskel.com/v1/health`), returning immediate diagnostic feedback and the exact command to run.
  - `scripts/preflight-production-deploy.mjs` (`pnpm deploy:production:preflight <sha>`): validates explicit 40-character SHA requirement, verifies ancestry against `origin/main`, tree cleanliness, `mizyun-hetzner` SSH connectivity, Hetzner primary marker, and current public Production API health (`https://mizyun-api.phiskel.com/v1/health`).
- Registered both preflights in `package.json` and documented both workflows in `docs/tutorials/HETZNER_BACKEND_GUIDE.md`.
- Automated checks: `pnpm navigation:check` passed with 0 errors; all 38 deployment safeguard tests passed; both preflight scripts tested against live hosts; independent tool review completed.
- **Acceptance status / next exact action:** implemented and verified. Both human operators and any AI agent can now run `pnpm deploy:dev:preflight` or `pnpm deploy:production:preflight <sha>` for instant guidance before deploying.

## Implemented & verified handoff — Durable private-repository fetch path for Hetzner Dev (#116, 2026-09-21)

- Resolved the 2026-09-21 migration drift where Hetzner Dev (`/var/lib/mizyun/dev/repo`) origin pointed to an unreadable or static snapshot bundle. Provisioned a dedicated read-only ed25519 GitHub Deploy Key (`mizyun-dev-deploy@hetzner`, ID `163997847`) on `AdamHikl/mizyun` at `/home/mizyun-dev-deploy/.ssh/id_ed25519`, pinned `github.com` host keys, configured `origin` remote to `git@github.com:AdamHikl/mizyun.git`, and safely purged the temporary `/var/lib/mizyun/dev/origin.bundle`. Live verification as `mizyun-dev-deploy` demonstrated successful remote branch fetch and verified that `git push` fails closed with read-only rejection.
- Codified repaired Dev runtime assumptions into `scripts/promote-dev.sh`:
  - Enforced `safe.directory`: strictly restricts Git access to `/var/lib/mizyun/dev/repo` and rejects dangerous wildcard `*` with exit code 2.
  - Non-interactive execution: exports `CI=true` and runs all `pnpm install` calls with `CI=true --frozen-lockfile`. Also passed `CI: "true"` in `scripts/deploy-dev.mjs` candidate worktree.
  - Sudoers-aligned systemd unit: defaults `MIZYUN_API_SERVICE` to `mizyun-api-dev.service`, normalizes to `.service`, and rejects unauthorized services, matching `deploy/hetzner/mizyun-deployers.sudoers`.
  - Origin remote preflight: validates `origin` exists, rejects ephemeral `.bundle` or `/root/` paths, and sets `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=15"` to prevent hanging.
  - Updated `DEPLOYMENT_MANIFEST.dev.serviceName` to `"mizyun-api-dev.service"` and documented procedures in `docs/tutorials/HETZNER_BACKEND_GUIDE.md`.
- Automated & remote verification:
  - Added 5 new safeguard and regression tests to `scripts/test-deployment-safeguards.mjs` (covering safe.directory wildcard rejection, `CI=true` non-interactive execution, `.service` normalization, ephemeral bundle rejection, and failed fetch closed-fail). All 38/38 deployment safeguard tests passed.
  - Independent non-author security & deployment review approved all changes with no blocking findings.
  - Full repository `pnpm check` passed: formatting, 15 workspace typechecks, iOS/Android Hermes bundles, 458 mobile tests, 536 API tests (15 gated E2E tests skipped per policy), deployment/backup/OAuth/build-matrix/IPA safeguards, and 56/56 offline AI invariants.
  - Remote Hetzner verification: `git ls-remote origin HEAD` on `/var/lib/mizyun/dev/repo` succeeded over SSH as `mizyun-dev-deploy`, and public health routes on both Dev and Production returned HTTP 200 `{"status":"ok"}`.
- **Acceptance status / next exact action:** implemented, automatically verified, and remotely verified on Hetzner Dev. Issue #116 is ready for closure upon commit.

## Prepared handoff — Google Play phone screenshots from physical Android captures (#4, 2026-09-21)

- Composed the seven founder-provided Huawei captures from `screenshots/google-play/captured/` into the same ordered marketing story and headline treatment as the approved iOS set. Final assets are in `screenshots/google-play/phone-9x16/`; the reproducible AppKit/ImageIO exporter and provenance notes are in `screenshots/google-play/source/export.swift` and `screenshots/google-play/README.md`.
- Founder-requested layout revision removed the small top `mizyun` wordmark and reduced the left/right phone whitespace by approximately half in both store sets while retaining their exact canvas sizes and aspect ratios: iPhone remains 1320 × 2868 and Android remains 1440 × 2560. Measured dark-frame margins changed from about 191 px to 93 px on iPhone and from about 254 px to 124 px on Android. The iPhone captures remain fully visible; the taller Android captures are uniformly scaled and clip overflow without distortion. Android screenshot 7 is bottom-aligned so its Protein, Carbs, and Fat fields remain visible beneath the `Review your macros` headline.
- Follow-up founder revision restored every Android capture in full without cropping or stretching. The Android frame side margins increased to approximately 195 px so the complete 1440 × 3120 source fits beneath the headline inside the unchanged 1440 × 2560 output. The small top marketing wordmark remains removed; in-app branding is untouched.
- Added the required Google Play feature graphic at `screenshots/google-play/feature-graphic.png`. It is a reproducible, opaque 24-bit sRGB PNG at exactly 1024 × 500 with centered safe-area typography, Mizyun blue/macro colors, no device imagery, no app-icon duplication, and no personal or Dev/BETA content. Suggested Console alt text and the standalone export command are documented in `screenshots/google-play/README.md`.
- Fresh validation confirmed all seven files are opaque, 8-bit RGB PNGs at 1440 × 2560 (9:16), with file sizes from 377,718 to 645,597 bytes. All seven were inspected individually at rendered size and together in `screenshots/google-play/preview.png`. Source app pixels were scaled uniformly and rounded only at the outer screen mask; no in-app text, values, status bars, or functionality were generated or rewritten.
- Current Google Play guidance was checked on 2026-09-21: these files meet its format, size, dimension, and aspect-ratio requirements and its recommendation for four or more 1080px portrait screenshots. No Play Console upload or publication occurred.
- **Acceptance status / next exact action:** artwork is locally prepared and technically validated, but the captures show `Mizyun Dev`/BETA state and include the founder's first name/body metric; the workout view also contains captured truncation/grammar, and the nutrition-review view exposes provider/version wording. Founder must explicitly approve that public content and confirm it matches the submitted Production build before uploading the seven PNGs in filename order. If not approved, take replacement Production Android captures and rerun the exporter.

## Installed handoff — Android Dev updated on physical Huawei LYA-L29 (2026-09-21)

- Built a fresh standalone Dev Release APK from current working-tree source (HEAD `5c79721` with uncommitted meal-day group meals fix, workout start fix, portion estimate improvements, and stacked Android adaptive icon) via clean prebuild and Gradle `assembleRelease` using the local debug-keystore test override. Artifact: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` (111,046,860 bytes; SHA-256 `be0cd3296cde9d59949ffd213250418e82e5c06eaf440db4523bad02a8457162`). `apkanalyzer` confirmed `com.mizyun.dev` version `1.0.0` (code `1`).
- Installed the APK over USB on the authorized Huawei LYA-L29 (`LHS0218C04000645`). Device package manager updated `com.mizyun.dev` (`lastUpdateTime=2026-09-21 19:06:12`).
- Launch verification: Started `com.mizyun.dev/.MainActivity` (PID `32673`). React Native initialized Hermes and logged `Running "main"` with no crashes and without Metro. The authenticated session remained intact; dashboard rendered with "Welcome back, Adam" and active quick-log cards.
- **Acceptance status / next exact action:** installed and launch-verified on physical Huawei device. Founder can exercise any updated features on the Huawei.

## Installed handoff — Meal-day “Group meals” action contained on iPhone (#102, 2026-09-21)

- The founder's iPhone 16 Pro capture showed the meal-day date, count badge, and `＋ Group meals` action exceeding the card width. React Native row children default to `flexShrink: 0`; the header forced all three intrinsic widths onto one line. The title now owns and yields the remaining width, while the outer header, right-side controls, action, and action text can shrink/wrap with a 100% width ceiling. This keeps normal and large Dynamic Type content inside the card without truncating the label.
- Fresh verification: mobile typecheck and targeted formatting passed; independent read-only layout review approved the final normal-width and Dynamic Type-safe styles; the final repository-wide `pnpm check` passed, including formatting, all workspace typechecks, iOS/Android Hermes exports, 458 mobile tests, 536 API tests with 15 existing gated E2E tests skipped, safeguards, and 56/56 offline AI invariants.
- Built the final current dirty-tree Dev source (HEAD `5c79721`; binary diff SHA-256 `418eb3a506d9e3633203ffdb5e1cc5edb09bf385f16cf3563ec2b9902f6a9496`) as a signed embedded-bundle Release app and installed it over `com.mizyun.development` on the paired iPhone 16 Pro `00008140-001114501A86801C`. Xcode reported `Build Succeeded`; after deliberately stopping Metro, `devicectl` relaunched `Mizyun Dev` 1.0.0 (build 1) and confirmed process `MizyunDev` running. The app is therefore installed and launch-verified without Metro.
- **Acceptance status / next exact action:** implemented, automatically verified, and installed; the founder still needs to visually confirm the `Group meals` action is contained at the pictured text size (and ideally one large Dynamic Type size). No backend deployment was needed or performed because this is presentation-only; public Dev API health remained HTTP 200.

## Implemented handoff — Native Dev session start no longer sticks on “Starting…” (#115, 2026-09-21)

- Diagnosed the native-only failure boundary in all workout start paths: the UI entered its busy state and then used the browser-style global `crypto.randomUUID()`. React Native does not supply that browser global, and the routine-card call happened before its `try/finally`, so the exception skipped cleanup and left “Starting…” displayed indefinitely. Workout operation IDs now use the installed Expo SDK 57 `expo-crypto` native module.
- Routine, blank-workout, and routine deep-link/Coach entry paths now keep UUID/request work inside cleanup-protected blocks, always clear their busy guard on unexpected rejection, and show a retryable error instead of silently swallowing it. A regression removes `globalThis.crypto` and proves both blank and routine starts still submit valid UUIDv4 operation IDs.
- Fresh evidence at source HEAD `5c79721` plus the uncommitted working-tree fix: public Dev API health returned HTTP 200; the focused/full mobile run passed 47 files / 458 tests; mobile typecheck passed; `pnpm navigation:check` passed with 0 errors and 14 stale-review warnings; and the final repository-wide `pnpm check` passed, including formatting, all workspace typechecks, iOS/Android Hermes bundle exports, 536 API tests with 15 existing provider-gated E2E tests skipped, deployment/Hetzner/backup/OAuth/build-matrix/IPA-tooling safeguards, and 56/56 offline AI invariants. `git diff --check` passed. The independent read-only investigation agreed with the root cause and fix scope.
- The current dirty-tree Dev source was built as a signed embedded-bundle Release app, installed over `com.mizyun.development` on the paired iPhone 16 Pro, relaunched after Metro was stopped, and observed running through `devicectl`. The founder exercised session start and reported “It works,” satisfying the reported defect's physical-device gate.
- **Acceptance status / next exact action:** implemented, automatically verified, installed, and founder device-accepted. No backend deployment was needed or performed because the fix is mobile-only and public Dev health remained HTTP 200. Close #115; retain request-timeout hardening only as a separate resilience enhancement if desired.

## Implemented handoff — AI meal portion-weight estimates (#102, 2026-09-21)

- AI photo/text meal drafts now return `portionWeightG`, the estimated total edible portion represented by the same calorie/macro totals. Gemini's bounded structured-output schema and prompts explicitly exclude containers/tableware, require the actual inferred serving rather than a generic 100 g, keep the estimate aligned during refinement, and use prompt versions `nutrition-draft-v3` / `nutrition-draft-refine-v2`. Older saved/API drafts remain valid because the shared field is optional.
- The Log Meal form surfaces that estimate as an editable `Portion weight (g)` field with explicit AI-estimate copy. Draft recovery retains the reviewed weight; ambiguous retry comparison includes it; saving promotes the confirmed value to `details.grams` while preserving the AI candidate/provenance. Logged-meal refinement seeds and updates the same weight baseline.
- Removed the hidden 100 g fallback from the history portion dialog. A legacy/manual meal with unknown weight now starts blank; the first entered weight establishes its baseline without changing the existing total calories/macros. Subsequent changes scale from the recorded baseline normally.
- Fresh focused evidence: contracts 10/10, Gemini provider 18/18, API food-draft routes 27/27, agent runtime 47/47 before the final added regression and 48/48 inside the repository gate, log-meal mobile tests 77/77 before the final added baseline regression and all affected mobile tests passed inside the repository gate; all 15 workspace typechecks passed. iOS and Android Hermes bundle exports passed at 6.3 MB and 6.6 MB.
- `pnpm check` passed navigation, formatting, all typechecks, both native bundles, and all non-mobile package suites reached before the mobile runner reported unrelated worker/test timeouts in `feedback-data.test.ts` and `progress-photo-data.test.ts`. An immediate isolated rerun of both suites passed 15/15 in 2.02 s, supporting transient runner pressure rather than a source failure; the aggregate command still has exit 1 and was not represented as passed.
- The backend-only portion estimate was committed and pushed as `ed70df727fdb38940b686b1dd2647d519f8478cd` (`fix(ai): return meal portion weight estimates (#102)`). Fresh exact-candidate `pnpm check` runs passed before promotion, including 74 contract tests, 48 agent-runtime tests, 37 Gemini-provider tests, 27 food-draft route tests, 455 mobile tests, 535 API tests with 15 existing gated E2E tests skipped, 33 deployment safeguards, both native bundle exports, and 56/56 offline AI invariants. Independent non-author review approved the contract/runtime/provider scope and the final tenth-gram refinement rounding regression.
- Hetzner Dev now runs exact SHA `ed70df727fdb38940b686b1dd2647d519f8478cd`; the standard deployment reconciled an already-current migration ledger, restarted `mizyun-api-dev.service`, and returned HTTP 200 from the public `/v1/health` smoke check. Migration-era deployment drift had to be repaired first: the restricted deploy user now trusts only `/var/lib/mizyun/dev/repo`, the root-only snapshot origin was replaced by a checksum-verified readable bundle containing this accepted commit, `CI=true` makes dependency installation non-interactive, and `MIZYUN_API_SERVICE=mizyun-api-dev.service` matches the existing narrow sudoers rule. The live API remained healthy through failed pre-restart attempts. [#116](https://github.com/AdamHikl/mizyun/issues/116) tracks a durable private-repository fetch path for future commits; the current bundle contains this deployment candidate only.
- **Acceptance status / next exact action:** implemented, automatically verified, and deployed to Dev. No iPhone build, install, or device interaction occurred, per founder instruction. No authenticated live Gemini draft was generated from the coordinator, so the founder should retry a photo/text meal draft in the already-installed Dev app and confirm the portion field receives a plausible non-100 g estimate; then edit/save it, reopen the portion dialog to verify the confirmed baseline, and report any remaining failure. Production was not deployed.

## Implemented handoff — Portion modal keyboard reachability (#102, 2026-09-21)

- Reproduced the failure boundary from the founder's iPhone capture: the auto-focused grams input opened the numeric keyboard over a centered, fixed-height modal, leaving the nutrition preview and `Cancel` / `Apply & Save` actions obscured and unreachable.
- `AdjustPortionModal` now uses an iOS-padding `KeyboardAvoidingView` and a bounded `ScrollView` with handled taps and platform-appropriate drag dismissal. The card remains centered when space permits and becomes scrollable when the keyboard, a smaller screen, or larger text reduces the viewport.
- Corrected the same action path's stale-state defect: `Apply & Save` now passes the currently entered grams directly to persistence instead of scheduling a state update and immediately reading the previous value.
- Fresh automated evidence: `pnpm --filter @mizyun/mobile typecheck` passed; all log-meal tests passed (76/76); `pnpm --filter @mizyun/mobile bundle:check:ios` exported a 6.3 MB Hermes bundle; targeted Prettier and `git diff --check` passed. An independent read-only review confirmed the root cause and reviewed the final approach. No backend, deployment, store upload, or device installation occurred.
- **Acceptance status / next exact action:** implemented and automatically verified, but not device accepted. No iPhone was visible to Xcode and CoreSimulator was unavailable in the current sandbox. Build/install the Dev iPhone app from this source, open a saved meal's portion dialog, and verify with the keyboard open that the sheet scrolls and both actions are reachable, the first chip/action tap registers, and the entered grams plus recalculated macros persist after `Apply & Save`. Smoke-check Android keyboard-open behavior separately.

## Completed handoff — Android Coach composer bottom spacing fixed (#108, 2026-09-20)

- The physical Huawei comparison showed that Android left a large blank region between the Coach composer and native tab bar, while iOS placed the composer directly above its tab bar. The Coach screen was adding the full manual `BottomTabInset` on Android even though Expo Router native tabs already reserve Android tab space. The composer wrapper now uses 8 dp on Android while retaining the existing iOS/default inset behavior; iOS source behavior is unchanged.
- Fresh verification after the final source change: mobile typecheck, targeted formatting and `git diff --check` passed, followed by a full `pnpm check` pass covering formatting, all workspace typechecks, iOS/Android bundle exports, 455 mobile tests, 536 API tests with the existing 15 provider-gated E2E tests skipped, 33 deployment safeguards, Hetzner/backup/OAuth/build-matrix/IPA-tooling checks, and all 56 offline AI invariants. Independent non-author review approved the Android-specific fix with no blocking finding.
- Built and installed a fresh standalone Dev Release APK over `com.mizyun.dev` on the Huawei LYA-L29. Artifact: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, 111,043,756 bytes, SHA-256 `5134c5abb5fd3ef7c0b8aa9499be1bdc25bda61c1871cc995ae2aa9297cfcdd7`; it uses the explicit local-only debug-keystore override and is not a Play upload artifact. Physical-device captures confirm the composer now sits immediately above the native tab bar, moves immediately above SwiftKey when focused, and returns correctly after keyboard dismissal. Suggested-check-in copy also remains intact at this viewport.
- **Next exact action:** founder accepts the attached Huawei capture or reports any preferred fine-tuning. iOS was intentionally not rebuilt because the change preserves its existing source branch. No upload, backend deployment, Production release or commit was performed.

## Completed handoff — Android action-card text wrapping fixed (#107, 2026-09-20)

- Reproduced the defect on the physical Huawei LYA-L29 at its native 360 dp viewport and normal `font_scale=1.0`. The Home Quick Log and Coach suggested-check-in grids forced two columns while each card also reserved horizontal space for padding, icon, gaps and a trailing plus/arrow, leaving only about 55–65 dp for copy and splitting words such as “workout,” “specialized,” “Progress,” and “minute.”
- Added a 240 dp content basis to both shared card layouts while retaining wrapping, proportional growth and the existing minimum width. Phone-width layouts now use one full-width card per row; two columns return only when the content area is wide enough. No copy was truncated, font scaling was not disabled, and the existing accessible Pressable labels and touch targets are unchanged. The dated React Native/Expo layout consequence is recorded in `docs/RESEARCH_LOG.md`.
- Fresh full `pnpm check` passed after the final source change: formatting, all workspace typechecks, iOS/Android bundle exports, 455 mobile tests, 536 API tests with the existing 15 provider-gated E2E tests skipped, 33 deployment safeguards, Hetzner/backup/OAuth/build-matrix/IPA-tooling checks, and all 56 offline AI invariants. `git diff --check` passed. Independent non-author review initially identified and then verified resolution of a too-narrow explicit breakpoint; the final content-driven implementation is approved with no blocking finding.
- Built and installed a fresh standalone Dev Release APK over `com.mizyun.dev` on the Huawei. Final artifact: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, 111,043,752 bytes, SHA-256 `63e70605193f05919eb03d386297e79734aa7cfc3af7ccdcf61493b9fa2ff92d`; it uses the explicit local-only debug-keystore override and is not a Play upload artifact. The authenticated session remained available. Final device captures show all four Home Quick Log cards and all four Coach cards with intact words, no clipping or horizontal overflow, and preserved icons/actions.
- **Next exact action:** founder visually accepts the installed layout or reports any preferred density change. No upload, backend deployment, Production release or commit was performed.

## Completed handoff — Dev Google OAuth repaired and device accepted (2026-09-20)

- The physical Huawei reproduced `400 validation_failed: Unsupported provider: provider is not enabled`. Hetzner Dev Auth had Google hard-disabled and no Google credentials/callback environment. The live Dev Supabase stack now receives the existing ignored Google OAuth client credentials, enables Google, and uses `https://mizyun-supabase-dev.phiskel.com/auth/v1/callback`; restrictive rollback copies remain beside its `.env` and compose file. Dev Auth health returns 200 with the Dev publishable key, public settings report `external.google=true`, the authorize route returns Google, and both Dev and Production APIs remained HTTP 200. No Production Auth configuration changed.
- The existing Google Cloud Web client had only Production and localhost entries. Added and saved the Dev JavaScript origin `https://mizyun-supabase-dev.phiskel.com` and exact Dev callback above. A fresh browser flow now reaches Google's account chooser instead of `redirect_uri_mismatch`; no Google account was selected and no new Auth user/session was created during browser verification.
- Fixed `createSupabaseMobileAuthClient` to preserve the configured variant redirect instead of silently falling back to `mizyun://auth/callback`; the regression proves the Dev factory sends `mizyun-dev://auth/callback`. The shared self-hosted Dev compose remains fail-closed unless all Google environment values are explicitly supplied, and the runbook now distinguishes Google's Supabase callback from the final app deep link.
- Verification: focused adapter tests passed 16/16; the new environment guard passed 6/6 cases covering disabled-by-default, each missing required field, cross-environment callback rejection and valid Dev configuration; adapter typecheck and compose rendering passed. The final full `pnpm check` passed, including iOS/Android bundle exports, repository tests, 33 deployment safeguards, Hetzner/backup safeguards, the new OAuth guard, build-matrix checks and 56 offline AI invariants. Independent non-author auth review approved the implementation and live isolation evidence after its two safeguard/runbook findings were resolved. A fresh standalone Dev Release APK built successfully after clean prebuild at `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` (111,043,740 bytes; SHA-256 `9a2ca26210b0bcce77a4292af2b5adcbd1ebe836ea2f6762f7b20cb1c6d987c4`); `apkanalyzer` confirms `com.mizyun.dev` version `1.0.0`. Generated Android resources include adaptive and round launcher icons, and the manifest registers `mizyun-dev`.
- Installed the rebuilt APK successfully over `com.mizyun.dev` on the Huawei LYA-L29. The corrected Android sign-in screen renders Google's official multicolor-G button; tapping it reached Google's account chooser without either former HTTP 400 error. The founder selected the account, Chrome returned into Mizyun Dev through the callback, the dashboard rendered, and an observed force-stop/relaunch retained the authenticated session. The founder then reported that everything works. The APK uses the explicit local-only debug-keystore override and is not a Play upload artifact; sign-out was intentionally not forced after acceptance.
- **Next exact action:** no OAuth/device blocker remains. Keep these changes stacked for the founder's chosen commit/deployment boundary; do not treat this locally signed Dev APK or Dev Auth acceptance as a Production mobile release.

## Stacked change — Android adaptive launcher icon (2026-09-20)

- Added an Android adaptive-icon configuration using the existing transparent Mizyun mark and splash blue background. This lets supported launchers, including Huawei/EMUI, apply their native rounded mask instead of presenting the legacy asset as a sharp square. The legacy Android icon remains as the fallback; iOS is unchanged.
- The later founder-authorized Android build/install included this stacked configuration and applied it to the connected Huawei. The Coach-layout acceptance did not independently return to the EMUI launcher to capture or judge the launcher mask, so launcher appearance remains unaccepted. No upload occurred. **Next exact action:** inspect the installed icon on the Huawei launcher when the founder wants to accept the stacked icon change.

## Completed website implementation — `WEB-MIZYUN-002` (#106, 2026-09-20)

- Implemented and publicly released the improvement guide in the separate `/Users/adam/Documents/mizyun-website` checkout. Website source commit: `57807bccc9a9362cce6abbbcf8fb7850f9a12af5`; Cloudflare Worker `mizyun-website` version: `21f4ae14-7f28-44b5-8f23-e2a29240c516`. Previous rollback version: `b85ae584-3673-49ed-bc34-6cf5494c78de`. No website Git remote is configured, so the source commit is local; public publication used the existing direct Wrangler workflow.
- The founder explicitly approved publishing existing app captures including personal names/fitness values and identified `screenshots/app-store/iphone-6.9/`. Dashboard, meal-review and workout WebPs preserve the UI/beta labels; combined payload is 118,824 bytes. Updated copy/actions, meaningful image alternatives, header/main/footer landmarks and skip focus, 44px navigation targets, page descriptions and a social-share image. Legal policy bodies, existing redirect status codes, exact-host isolation and retired Phiskel service responses were preserved.
- Fresh website checks: `npm test` 9/9, `npm run lint`, `npm run build`, targeted Prettier and diff check all passed. Independent non-author review found no blocking issues. Full app-repository `pnpm check` passed on the existing working tree, including native bundle exports, 33 deployment safeguards, Hetzner/backup safeguards and 56 offline AI invariants; gated integration suites remained skipped (including 15 API e2e tests), not counted as passed. No app/backend was deployed.
- Browser verification: 320/375/768/1280px landing widths fit; approved images loaded; narrow deletion page wraps; keyboard skip focuses MAIN#main beyond navigation. Live 375px page shows the updated content, loaded hero, correct canonical and share metadata. Twenty public HTTPS checks passed: all five pages, five exact-hash assets, roots and retired API/Auth paths on all three existing website hosts, and missing-asset 404. Evidence is retained in the website `docs/public-verification-2026-09-20.json` and `docs/release-evidence.md`.
- No DNS, Pi, Hetzner, credentials, mobile code or app-repository unrelated changes were made by this implementation. Physical-device browser acceptance, true 200% text zoom, screen-reader speech and field performance remain unverified; no score or compliance certification is claimed. Public store listings were not verified, so no download badges were invented.
- **Next exact action:** inspect the live website on physical iPhone Safari/Android Chrome and add verified store links once publicly available. Website implementation/release is complete; device/field checks remain qualified follow-ups.

## Planning handoff — Live website improvement review (`WEB-MIZYUN-002`, 2026-09-20)

- Created the prioritized improvement guide after live desktop/375 px browser inspection of `https://www.phiskel.com/mizyun` and its privacy, terms, support and deletion pages. Public website reachability is freshly observed; older private-only website handoffs below are historical. Exact deployed SHA and full retired-host acceptance were not checked.
- Current website source is clean at `1336d28f470417afc89b1bad498b9ca3ae820da1` in `/Users/adam/Documents/mizyun-website`; its current README identifies direct Cloudflare Workers deployment. Independent source review informed recommendations for real approved screenshots, availability/CTA, simpler copy, landmarks, social metadata and asset allowlist tests. No code, website publication, DNS or backend change; no Pi/Hetzner connection.
- Existing unrelated legal, mobile, backup, screenshot and documentation work was preserved. GitHub #103 reads failed twice with `error connecting to api.github.com`; follow-up issue tracking is pending. Performance scores, physical-device acceptance and full accessibility compliance were not measured or claimed.
- **Guide verification:** targeted Prettier and `git diff --check` passed; `pnpm navigation:check` passed (0 errors, 14 existing review-date warnings). Independent guide review found no material errors; its accessibility/lint suggestions were incorporated. No website build/tests or full app check was needed for this documentation-only review.
- **Next exact action:** inspect the website checkout and follow the guide; verify current release availability and select approved demo captures, then implement copy/semantic improvements and explicit asset-route tests. Keep current hosting/retirement rules and shared legal work intact.

## Completed handoff — Android Dev installed on physical Huawei (2026-09-20)

- Regenerated the ignored Android native project for the Dev variant from the current working tree at HEAD `5c79721` (including pre-existing uncommitted work), then built a standalone Release APK with the explicit local-only debug-keystore override. This was not a Play-signed artifact and did not require Metro. The APK is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` (106 MiB; SHA-256 `e501f16e8d5244be40a655e778de034a0142123185daa18f253de8577b16c7e3`).
- Installed the APK successfully over USB on the authorized Huawei LYA-L29 device (`LHS0218C04000645`). `apkanalyzer` and the generated Gradle configuration both identified `com.mizyun.dev`; device package state reported version `1.0.0` / version code `1` and install/update time `2026-09-20 14:19:09` local.
- Launch verification passed: `com.mizyun.dev/.MainActivity` was the resumed activity, the app process remained alive, React Native logged `Running "main"`, and the captured launch log contained no Mizyun fatal exception. This proves installation and automated launch, not a founder-observed feature journey. **Next exact action:** visually inspect Mizyun Dev on the Huawei and exercise the desired Dev journey; record any Huawei/EMUI-specific behavior, especially notifications on devices without Google Mobile Services.

## Completed handoff — Hetzner cutover and daily encrypted Pi backup (#104/#105, 2026-09-19)

- Public Dev and Production backend traffic now terminates on the Helsinki Hetzner CX23. The VM runs Production SHA `43917fa4b69acff04b931c4ef927dab21466a932` and Dev SHA `dc8aa016fa1a3236a38f42f89a814acf4c29f49a`, matching the former Pi checkouts. The existing four hostnames are unchanged. `cloudflared.service` is active/enabled only on Hetzner; the Pi tunnel, both Pi API units, all Pi Production application containers, and the old Pi Production database container are stopped so they cannot accept split-brain writes. The Pi Production port 5432 has no listener. No Pi file, database volume, archive, checkout, or secret was deleted; only the isolated Dev database container remains running there.
- The source was frozen before the final snapshots. Production backup `/srv/mizyun/backups/20260919T082908Z` and Dev backup `/srv/mizyun/backups/dev-20260919T082959Z` remain on the Pi and were copied checksum-clean to `/srv/mizyun/migration/final/` on the VM. The final restore preserved database owners/ACLs, global-role evidence, database row counts, extension versions, Storage file checksums, and Storage filesystem extended attributes. The original backup script's `--no-owner --no-privileges` dump and ordinary tar were insufficient for a clean restore: Dev Auth exposed the missing ACLs, and a restored media read exposed missing Storage xattrs. Full dumps and `tar --xattrs --xattrs-include='*' --acls` corrected both before public cutover. Retained rehearsal/no-xattr directories were not deleted.
- Automated evidence: normalized table counts match exactly except two new zero-row Realtime daily partitions created during VM startup; extension versions and every Storage file checksum match; Production and Dev Auth health return 200 with their own keys and 401 with the opposite environment's key; a restored Production object downloaded through both authenticated and signed public Storage paths at the expected 3,751,336 bytes. All VM database, gateway and API listeners are loopback-only. Public API health and keyed Supabase Auth health return 200 for all four hostnames, and the VM API journal records the public hostname request. A prior cold reboot recovered both stacks. Current VM headroom is about 1.4 GiB available RAM and 24 GiB free root storage.
- Repository verification: fresh `pnpm check` passed before cutover, including formatting, typechecks, tests, iOS/Android bundle exports, 30 deployment safeguards, build matrix and offline AI evaluation. Independent deployment review required the full write freeze, explicit single-authority tunnel switch, immutable Pi snapshot, and reverse-transfer/reconciliation before any rollback after new VM writes; those controls were applied. Final documentation formatting/diff checks remain to be recorded after this handoff edit.
- **Important:** the old Pi Production state is now a frozen rollback source, not a writable replica. After any accepted VM write, traffic must not simply be pointed back to the Pi; freeze and reverse-transfer/reconcile first. Daily VM-to-Pi disaster-recovery automation remains separate issue [#104](https://github.com/AdamHikl/mizyun/issues/104), so writes made after cutover do not yet have the intended ongoing off-host backup.
- Founder device acceptance (2026-09-19): the founder tested both the installed Dev and Production apps after public cutover and reported that both appear to work. This is founder-reported journey acceptance; the exact exercised paths were not independently observed or enumerated. Public server-side API/Auth/Storage evidence remains recorded above.
- #105 deployment operations now default to role-specific, non-interactive Hetzner identities. A root-owned unique-host marker and same-connection check prevent Pi/wrong-host mutation; promotion protocol comes from canonical `origin/main`; Production/Dev use fixed checkouts and narrowly scoped sudo. Harmless exact-protocol probes passed through both aliases, including Dev API restart and the fixed Production DB-IP helper; arbitrary SSH commands were rejected. Both public APIs returned HTTP 200 afterward.
- #104 daily backup is active: Hetzner runs `mizyun-backup.timer` at 02:15 UTC and the Pi runs `mizyun-backup-pull.timer` at 03:15 UTC. The VM freezes public Production writers, records a full owner/ACL database dump plus globals and Storage/config bytes/xattrs/ACLs, resumes and verifies local/public health, age-encrypts atomically, and retains seven days. The Pi pulls through a command-gated read-only key, verifies checksum and six-hour freshness, publishes atomically, and retains 90 days. The legacy Mac LaunchAgent is disabled. The Pi application source/data remain intact and its app/tunnel services remain stopped.
- Accepted encrypted recovery point `20260919T103343Z` was pulled to the Pi at age 86 seconds. VM/Pi ciphertext SHA-256 matched (`fc58923f…d944`). A Pi-sourced copy decrypted with the Mac-only age identity; every inner checksum passed. Globals were applied before a clean `template0` PostgreSQL 17 restore; all 76 table counts matched, including aggregate 9 Auth users and 3 Storage objects. Isolated Linux Storage extraction matched all three file hashes, three xattr records, eleven ACL/ownership records. Disposable plaintext, container and volume were removed afterward. A forced failure after the write freeze initially exposed and then verified the recovery helper: Supabase, API, Cloudflare and the public Production health route all recovered automatically.
- Full `pnpm check` passed after the final implementation: formatting, typechecks, iOS/Android bundles, all enabled tests, 33/33 deployment safeguards, Hetzner operations safeguards, six backup-retention tests, build matrix, IPA tooling, and offline AI evaluation. Provider-gated E2E suites remain skipped under existing policy. Independent non-author review findings were resolved.
- The private recovery identity remains only at `/Users/adam/Backups/mizyun/keys/hetzner-backup-age-identity.txt`; the founder said it will be added to a password manager. **Next exact action:** founder confirms the password-manager attachment can be retrieved; then monitor the first unattended 02:15/03:15 UTC run and add external alert delivery if desired. Daily backups provide roughly a 24-hour RPO, not zero-loss replication. Move Pi backups to dedicated storage before its current 7.5 GiB free space approaches the one-GiB safety floor.

## WEB-MIZYUN-001 website publication handoff (2026-09-19)

- Founder decisions are recorded: operator Adam Hikl, email-only public contact, and a standard 90-day operational-backup retention period. The website privacy/terms/deletion pages use conservative provider, deletion and cleanup-outage wording; the unapproved workout capture remains removed. The app source and store disclosures are reconciled, but the API/mobile changes are not deployed in this website-only checkpoint.
- Backup retention now has fixed 90-day pruning, exact-name safety, incomplete/quarantine cleanup, fail-quarantined deletion, pre-generation pruning and existing-target collision refusal. Focused retention tests passed 6/6, independent review approved the candidate, and the full repository `pnpm check` passed before the final exact-name/collision regressions; those final focused checks and `git diff --check` also passed.
- The final website is now deployed directly to Cloudflare Workers, not served from OpenAI Sites. Website commit `1336d28` adds the checked-in Wrangler deployment configuration; Worker version `b85ae584-3673-49ed-bc34-6cf5494c78de` owns `www.phiskel.com`, apex `phiskel.com`, and `app.phiskel.com`. The three Sites custom-domain bindings and their ten temporary DNS/validation records were removed, while API, Supabase, email and unrelated tunnel records were left untouched. The former Sites copy remains retained but owner-only; an unauthenticated request to `https://mizyun.adoh811.chatgpt.site/mizyun` returns HTTP 401.
- Production verification: `https://www.phiskel.com/` returns 302 to `/mizyun`; the landing, privacy, terms, support and delete-account pages return HTTP 200; apex and app landing requests redirect to the canonical www hostname; retired `/auth`, `/api` and `/graphql` probes return HTTP 410. Public DNS resolvers return Cloudflare addresses for all three hosts. Both Production and Dev API health endpoints continued returning HTTP 200 after cutover. Fresh website lint/build passed and the route suite passed 8/8.
- **Next exact action:** no launch blocker remains. Monitor initial Worker traffic and errors; before future website changes, run `npm test`, `npm run lint`, and `npm run build` in `/Users/adam/Documents/mizyun-website`, then deploy with `npm run deploy:cloudflare`.

## Planning handoff — Hetzner CX23 live inventory and backup audit (2026-09-18)

- Founder refinement (2026-09-18): long planned downtime is acceptable; no acknowledged Production data should be lost in the host move. Issue #53's 90-day staging/two-rehearsal gate is waived for this lift-and-shift only; a complete isolated restore, paired DB/Storage consistency validation, security review and device acceptance remain. The Pi is the proposed daily backup destination after cutover, but its root has only about 7.8 GiB free and needs dedicated encrypted storage, restricted private transfer, retention, freshness alerts, restore tests and another independent copy. Daily backups alone can lose almost 24 hours of writes after an unexpected VM failure. No Pi, VM, DNS, credential, issue or app state changed in this planning refinement.
- Updated [the Hetzner backend migration plan](../../HETZNER_BACKEND_MIGRATION_PLAN_2026-09-17.md) from read-only Pi, Hetzner VM and Mac backup evidence, with independent local-script audit. Local `main` was clean at `42244b4` before this documentation edit. Pi Production is `43917fa4b69acff04b931c4ef927dab21466a932`; Pi Dev is `dc8aa016fa1a3236a38f42f89a814acf4c29f49a`. The new Helsinki CX23 has Ubuntu 24.04.4 x86-64, 3.7 GiB usable RAM, a 38 GiB root filesystem, no swap or Docker, and SSH-only local listener. The planner did not change any service, credential, DNS, database or VM configuration; the pre-existing Mac backup schedule independently ran during inspection.
- Production's pre-deploy script makes a PostgreSQL custom dump plus private Storage archive and checksums. The Mac's loaded LaunchAgent attempts a daily fresh Pi backup and copies archives to `/Users/adam/Backups/mizyun`. Its 2026-09-18 10:01 CEST run created/copied backup `20260918T080150Z`; both files exist on Pi and Mac, and the Mac log reports checksum success. **A restore has not been demonstrated.** No scripted retention, archive-level encryption, freshness alert or independent backup destination is evidenced; the Mac script can sync old archives when generation fails. Do not infer complete disaster recovery from checksums.
- Documentation checks: targeted Prettier, repository-wide `pnpm format:check`, `pnpm navigation:check` (0 errors, 14 stale-review warnings), and `git -c core.fsmonitor=false diff --check` passed. `pnpm check`, a native build, restore and deployment were not run for this planning-only package.
- **Next exact action:** choose the separate post-cutover disaster RPO/RTO and Pi backup retention/capacity, then perform an isolated, access-controlled database-plus-Storage restore and complete non-secret source manifest before installing or migrating Production to Hetzner. Keep the Pi authoritative until the explicit cutover gate passes; use a full write freeze and final verified restore for the eventual migration.

## Active handoff — Offline profile & dashboard cache for instant startup (`OFFLINE-CACHE-001`, #14, 2026-09-17)

- **Context & Requirement:** GitHub Issue [#14](https://github.com/AdamHikl/mizyun/issues/14):
  1. Instant authenticated startup renders cached profile and dashboard snapshot data immediately during network outage or slow connection, eliminating layout shifts, flash-of-empty-content, and accidental onboarding redirects.
  2. Strict owner-scoping and cross-user isolation: all keys and payloads are partitioned by `userId` and fail-closed against mismatched or corrupted data.
  3. iOS Keychain size limit mitigation: standard `SecureStore` enforces 2048 bytes; reused `ChunkedStorage` with 1800-byte chunks and manifests to prevent keychain write failures.
  4. Staleness bounding & eviction: 48-hour default max age; expired snapshots return null and are eagerly evicted from storage.
  5. Purge lifecycle: cache is completely cleared on sign-out and account deletion (`clearLocalUserData`).
  6. Accessible UI: offline snapshot banner includes `accessibilityRole="alert"` and `accessibilityLiveRegion="polite"`, with timestamp and refresh action, while suppressing duplicate error rows.
- **Verification Evidence:**
  - `apps/mobile/src/features/offline-cache/offline-cache-storage.test.ts`: 9/9 tests pass (save/load profile & dashboard, owner isolation, corruption auto-purge, 48h staleness & eviction, purge lifecycle, offline startup & reconnect sync, large payload chunking).
  - `apps/mobile/src/features/settings/account-data-management.test.ts`: 15/15 tests pass (including offline cache and workout preferences purging).
  - Mobile test suite: 47 test files / 455 tests pass in `@mizyun/mobile`.
  - Repository check (`pnpm check`): 100% PASS (navigation check with 0 errors, Prettier formatting, all 15 workspace typechecks, Hermes iOS/Android bundle exports, all unit/integration tests, deployment safeguards, build matrix, and AI evaluation offline invariants).
  - Independent subagent review: Completed and approved (`Final Verdict: APPROVE`).
  - Dev deployment on Raspberry Pi: `pnpm deploy:dev dc8aa01` completed cleanly; deployed commit `dc8aa016fa1a3236a38f42f89a814acf4c29f49a` to `/var/lib/mizyun/dev/repo`; applied migration `20260917120000_workout_lifecycle_queries_and_idempotency.sql` to Dev database; restarted `mizyun-api-dev.service`.
  - Public Dev health verified: `https://mizyun-api-dev.phiskel.com/v1/health` returned HTTP 200 `{"status":"ok","service":"mizyun-api","timestamp":"2026-09-17T19:46:05.559Z"}`.
  - GitHub Issues [#14](https://github.com/AdamHikl/mizyun/issues/14) and [#102](https://github.com/AdamHikl/mizyun/issues/102) closed.
- **Next exact action:** Test on the installed `com.mizyun.development` iPhone app against the public Dev API/Supabase hosts (verifying offline startup and reconnect sync, meal grouping and portion resizing, AI meal refine, and routine session-start idempotency), or select the next priority backlog issue.

## Active handoff — Raspberry Pi backend services restored online (2026-09-17)

- **Incident & Root Cause:** Raspberry Pi 5 (`rpserver`) booted up following power downtime. During initial boot, concurrent initialization of Docker containers for both Dev and Production Supabase stacks caused race conditions with Postgres startup; `docker compose up -d --wait` in `mizyun-supabase.service` and `mizyun-supabase-dev.service` timed out on `supabase-studio` and `mizyun-dev-rest` before their PostgREST/Studio reconnection backoffs settled. As a result, both Supabase systemd units entered failed state, preventing `mizyun-api.service` and `mizyun-api-dev.service` from starting due to systemd unit `Requires=` constraints.
- **Remediation:**
  - Verified Docker container convergence once database engines stabilized (all 16 containers across Dev and Production reached healthy status).
  - Started `mizyun-supabase.service` and `mizyun-supabase-dev.service` via `sudo systemctl start`, bringing both units to `active`.
  - Started `mizyun-api.service` and `mizyun-api-dev.service`, bringing both API services to `active`.
  - Verified Tailscale connectivity (`rpserver` 100.116.142.1) and SSH transport over Tailscale.
- **Verification Evidence:**
  - Systemd unit states on Pi: `mizyun-supabase.service` (active), `mizyun-supabase-dev.service` (active), `mizyun-api.service` (active), `mizyun-api-dev.service` (active), `cloudflared.service` (active), `tailscaled.service` (active).
  - Docker container state: all 16 containers healthy (`mizyun-dev-db`, `mizyun-dev-auth`, `mizyun-dev-kong`, `mizyun-dev-storage`, `mizyun-dev-imgproxy`, `mizyun-dev-rest`, `realtime-dev`, `supabase-db`, `supabase-auth`, `supabase-storage`, `supabase-edge-functions`, `supabase-meta`, `supabase-pooler`, `supabase-rest`, `supabase-kong`, `supabase-studio`, `supabase-imgproxy`).
  - Local Pi endpoints: `http://127.0.0.1:4000/v1/health` (HTTP 200 `{"status":"ok","service":"mizyun-api"}`), `http://127.0.0.1:4100/v1/health` (HTTP 200 `{"status":"ok","service":"mizyun-api"}`).
  - Public Cloudflare ingress verified from Mac:
    - `https://mizyun-api.phiskel.com/v1/health` -> HTTP 200 `{"status":"ok","service":"mizyun-api"}`
    - `https://mizyun-api-dev.phiskel.com/v1/health` -> HTTP 200 `{"status":"ok","service":"mizyun-api"}`
    - `https://mizyun-supabase.phiskel.com/auth/v1/health` -> Kong gateway active
    - `https://mizyun-supabase-dev.phiskel.com/auth/v1/health` -> Kong gateway active
  - Working tree checkouts on Pi verified clean: Dev at `8e3853d`, Production at `43917fa`.
- **Next exact action:** Resume deferred tasks now that Pi is online (e.g. `pnpm deploy:dev` to deploy commits #97, #95, #101, #102 to Dev, and verify on physical iOS device `com.mizyun.development`).

## Active handoff — Public Mizyun website candidate (`WEB-MIZYUN-001`, #103, 2026-09-17)

- **Founder decision and scope:** The Phiskel chat app is retired from public use, but its code and data must be retained. Read-only Cloudflare DNS and browser checks on 2026-09-17 found it still publicly reachable on **`www.phiskel.com`, `app.phiskel.com` and apex `phiskel.com`**; the latter two would survive a www-only cutover. Each hostname has four proxied A records; the zone Workers Routes list showed none. No public DNS/rule change or old-app deletion was performed, so the app remains accessible today. Other provider/origin entry points are not yet inventoried.
- **Implemented privately:** The separate Sites checkout `/Users/adam/Documents/mizyun-website` now handles those three exact hosts in its candidate route handler. Old pages redirect to `https://www.phiskel.com/mizyun`; retired `/auth`, `/api`, `/graphql`, `/socket.io` and `/ws` service prefixes return non-cacheable 410; unrelated Mizyun API/Supabase/email hosts are untouched. The rollback runbook now forbids restoring old Phiskel DNS as routine rollback. Source `d521e8ee389d24f6cfac5da2a31651ed20cf4d5a` was pushed and saved as Site version 2; owner-only deployment `appgdep_6aac43ac32ac81918c70d98ff47cf484` succeeded at origin `https://mizyun.adoh811.chatgpt.site`, with the working review route `https://mizyun.adoh811.chatgpt.site/mizyun` (the provider origin root returns the intentional Site 404). The Site remains private to Adam; no custom domain is attached.
- **Verification:** Website `npm test` passed 7/7 local HTTP route tests across exact host headers after restarting an unresponsive dev server; final Vinext build and targeted Prettier check passed. Independent non-author review found no source-level pass-through to the retired origin but emphasized that live Cloudflare and alternate-origin checks are still required. App-repository `pnpm check` passed freshly on this checkout before this status update, including repository formatting, typechecks, bundles, tests and safeguards. Earlier mobile-browser preview at 375/768/1440 px is prior evidence, not a fresh public/device acceptance check.
- **Public gate and next exact action:** Decide whether to hide the old app immediately behind a neutral public holding page or wait for a full Mizyun launch; in either case do not expose the current **draft** privacy/terms or unapproved workout screenshot publicly. Reconcile provider retention/deletion claims, verify the support mailbox, approve the asset, inventory provider/origin alternate access and edge rules, and prepare a known-good public rollback target. Then activate public Site audience, bind all three website hostnames with provider-returned DNS/validation records, verify TLS and old routes live, and promote temporary redirects only after acceptance. Vinext still emits 308 rather than planned 301 for trailing slashes; resolve or explicitly accept this difference before cutover. Pi and Mizyun backend deployments are outside this package.

## Planning handoff — Public Mizyun website (`WEB-MIZYUN-001`, 2026-09-17)

- Prepared [the next-session website implementation plan](../../MIZYUN_WEBSITE_IMPLEMENTATION_PLAN_2026-09-17.md) for `https://www.phiskel.com/mizyun`, with ordinary legacy www redirects, explicit legal/asset exceptions, independent hosting, phased implementation, verification and rollback. Baseline source: `ed4a19784a66082a59558388fe29688545887441`.
- A read-only helper audited local product claims, screenshot privacy, legal URLs and native Auth callbacks. The coordinator incorporated its findings and dated primary-source research. Existing unrelated mobile/offline-cache and Hetzner planning work was preserved.
- Planning only: no website code, build, Site registration, deployment, DNS/account/runtime change or Pi connection. Current hosting/domain configuration and public app availability remain unverified. GitHub issue listing failed twice with `error connecting to api.github.com`; issue tracking remains pending.
- **Planning verification:** targeted Prettier and `git -c core.fsmonitor=false diff --check` passed. `pnpm navigation:check` passed internal links and architecture boundaries but failed the pre-existing untracked offline-cache feature-map coverage gap; no unrelated fix or full build/check was attempted.
- **Next exact action:** inspect current working tree and read the linked plan, then resolve current www hosting/DNS ownership from control-plane data without contacting the Pi. Implement in a separate website checkout; complete preview and routing tests before custom-domain cutover. The Pi remains off-limits until the founder explicitly confirms availability.

## Planning handoff — Hetzner backend relocation (2026-09-17)

- Prepared [a planning-only migration guide](../../HETZNER_BACKEND_MIGRATION_PLAN_2026-09-17.md) from local commit `ed4a19784a66082a59558388fe29688545887441` and dated official-source research. Founder clarification: the current Pi 5 has 4 GB RAM and has hosted both environments. CX23 is therefore a plausible like-for-like pilot; CX33 in NBG1 is the preferred €3/month headroom choice, contingent on availability and measured two-stack capacity. The user's Hetzner screen marked all listed plans unavailable.
- The Raspberry Pi is temporarily down per founder instruction and was not contacted. Live resource use, latest backup, and current Production state remain unverified. No infrastructure, DNS, credentials, database, or runtime was changed. Existing unrelated mobile/offline-cache work was preserved.
- Documentation verification: targeted Prettier check passed for the plan, research log, and status; `git -c core.fsmonitor=false diff --check` passed. `pnpm navigation:check` verified all markdown links and architecture boundaries but failed feature-map directory coverage for the pre-existing untracked `apps/mobile/src/features/offline-cache`; no feature-map edit or full `pnpm check` was attempted for this planning-only package.
- **Next exact action:** inventory available off-Pi backups and current target configuration without connecting to the Pi; when the founder confirms the Pi is back online, collect live capacity and recovery evidence before provisioning or cutover. Production data migration requires a verified database **and** Storage restore and an explicit recovery-point decision if the Pi stays unavailable.

## Active handoff — Routine query hardening and session-start idempotency (#97, 2026-09-17)

- **Context & Requirement:** GitHub Issue [#97](https://github.com/AdamHikl/mizyun/issues/97):
  1. Routine Discovery & Server Filtering: Ensure old routines remain discoverable regardless of intervening session volume (prevent routines dropping outside the limit window).
  2. Session-Start Idempotency: Guard against duplicate session snapshots created by lost-response retries or app restarts when starting a session from a routine.
  3. Routine Reference & Ownership Hardening: Reject cross-user, non-existent, or invalid routine references.
- **Implemented:**
  - Added database migration `supabase/migrations/20260917120000_workout_lifecycle_queries_and_idempotency.sql` adding `client_operation_id uuid null`, partial unique index `workouts_user_client_op_idx`, and compound expression index `workouts_user_lifecycle_kind_idx` on `(user_id, (details->'workoutLifecycle'->>'kind'), started_at desc)`.
  - Added `clientOperationId` to `workoutSchemaBase` and `workoutCreateSchema`, and optional `kind: z.enum(["routine", "session"])` to `workoutListQuerySchema` in `packages/contracts/src/workout.ts`.
  - Added `clientOperationId` to `StoredWorkout`, `WorkoutRepository.findByClientOperationId`, and `kind?: "routine" | "session" | undefined` to `WorkoutRepository.list` in `packages/core/src/workout.ts`.
  - Implemented `findByClientOperationId` and JSON-path expression filtering on `details->workoutLifecycle->>kind` in `packages/adapters/supabase-server/src/workout-repository.ts` and `RepositoryQueryBuilder` in `packages/adapters/supabase-server/src/index.ts`.
  - Updated `InMemoryWorkoutRepository` in `apps/api/src/workout-repository.ts` to support `findByClientOperationId` and kind filtering with legacy fallback.
  - Hardened `POST /v1/workouts` and `GET /v1/workouts` in `apps/api/src/modules/workouts/routes.ts`:
    - Replays matching workout with HTTP 200 on identical `clientOperationId`, or rejects differing payloads with HTTP 409 Conflict.
    - Validates routine references: rejects invalid UUIDs, non-existent routines, routines belonging to other users, or targets that are not routines (400 Bad Request).
    - Defaults new workouts to session lifecycle if unassigned.
  - Updated Coach tools and grounding in `apps/api/src/modules/coach/tools.ts` and `apps/api/src/modules/coach/grounding.ts` to query routines specifically with `kind: "routine"`.
  - Updated mobile `fetchWorkoutsHubData` in `apps/mobile/src/features/workouts/workouts-hub-data.ts` to query `kind=routine&limit=200` in parallel with recent sessions and merge; skips redundant sets fetching for routines.
  - Updated `startRoutineSessionWith` and `createBlankWorkoutWith` to omit `startedAt` on initial creation so the server assigns canonical timestamp, avoiding millisecond timestamp conflicts across network retries.
  - Handled persistent operation IDs in `apps/mobile/src/features/workouts/workouts-hub-screen.tsx`, resetting on error to prevent stuck state.
- **Automated Verification:**
  - Added unit and integration tests in `packages/core/src/workout.test.ts`, `packages/adapters/supabase-server/src/workout-repository.test.ts`, `apps/api/src/modules/workouts/routes.test.ts`, and `apps/mobile/src/features/workouts/workouts-hub-data.test.ts`.
  - All 528 API tests and 416 mobile tests passed.
  - Full repository `pnpm check` passed cleanly (15 workspace typechecks, linters, Hermes exports, build matrix, and AI evaluation offline invariants).
- **Independent Review:**
  - Independent subagent review approved with verdict APPROVE after verifying routine isolation, idempotency replay, and routine reference authorization.
- **Deployment & Acceptance Status:**
  - The Raspberry Pi server is temporarily down (user confirmed). Remote promotion to Dev (`pnpm deploy:dev`) and physical device acceptance on `com.mizyun.development` are held until the Pi is online.
- **Next exact action:**
  - Once the Raspberry Pi is back online, deploy commits to Pi Dev (`pnpm deploy:dev`), run forward migrations, and verify routine discovery and session starting on device.

## Active handoff — Full AI meal calculation persistence and refinement of logged meals (#95, 2026-09-17)

- **Context & Requirement:** GitHub Issue [#95](https://github.com/AdamHikl/mizyun/issues/95):
  1. Add the full text that the AI gives us for the meal calculation into the meal we save, so it can be accessed later.
  2. Add the refine feature to meals that are already logged.
- **Implemented:**
  - Added optional nullable `calculation` field to `foodDraftCandidateSchema` in `packages/contracts/src/food-entry.ts`.
  - Added `calculation?: string | null | undefined` to `VisionDraftCandidate` in `packages/agent-runtime/src/index.ts` and deterministic test calculations to `StubVisionProvider`.
  - Added `calculation` extraction, JSON schema (`type: STRING, nullable: true`), itemized breakdown system policies, and `Current calculation:` context injection in `refineUserPrompt` in `packages/providers/gemini/src/vision.ts`.
  - Preserved `details.calculationText`, `details.aiDraft.calculation`, and `details.mealDescription` in `submitMeal` in `apps/mobile/src/features/log-meal/log-meal-screen.tsx`.
  - Rendered a dedicated "✨ AI Meal Calculation" card (with confidence percentage and assumptions bullet points) in `apps/mobile/src/features/log-meal/edit-meal-screen.tsx`.
  - Implemented "✨ Refine with AI" on already logged meals in `apps/mobile/src/features/log-meal/edit-meal-screen.tsx` with `useAiConsentController`, `AiConsentModal`, auto-syncing portion grams if changed, updating nutrition values and calculation text, and saving via `updateFoodEntry`.
  - Rendered an interactive "✨ AI Calc" badge in `apps/mobile/src/features/log-meal/meal-list-screen.tsx` for entries with calculation text, which navigates directly to `EditMealScreen` to inspect the breakdown.
- **Automated Verification:**
  - Unit tests in `packages/providers/gemini/src/vision.test.ts` verifying calculation extraction, refine user prompt injection, and safety policy rejection handling.
  - Tests in `apps/mobile/src/features/log-meal/meal-form.test.ts` verifying `isRecoverableMealDraft` with calculation.
  - Tests in `apps/mobile/src/features/log-meal/meal-lifecycle-data.test.ts` verifying `updateFoodEntryWith` sends and preserves `details.calculationText` and `details.aiDraft.calculation`.
  - Full suite of 76 tests in `apps/mobile/src/features/log-meal/` passed (100%).
  - Full repository `pnpm check` passed cleanly (Prettier, 15 workspace typechecks, iOS/Android Hermes bundle exports, deployment safeguards, build matrix, IPA tooling, and offline AI screener).
- **Independent Review:**
  - Independent feature review by subagent approved with zero blocking findings, validating schema compliance, AI safety consent gating, mutation safety, gram scaling baseline updates, and accessibility. Non-blocking suggestions (defensive empty-string schema transform and auto-syncing portion grams from draft name) were incorporated.
- **Deployment & Acceptance Status:**
  - The Raspberry Pi server is temporarily down (user confirmed). Remote promotion to Dev (`pnpm deploy:dev`) and physical device acceptance on `com.mizyun.development` are held until the Pi is online.
- **Next exact action:**
  - Once the Raspberry Pi is back online, deploy commit to Pi Dev (`pnpm deploy:dev`) and verify device journey on `com.mizyun.development`: log a meal with AI, verify `✨ AI Calc` badge on meal list, tap into edit meal, view full calculation text, refine with AI instruction ("add 1 egg"), and save changes.

## Active handoff — Remote promotion script stdin isolation hardened (#101, 2026-09-17)

- **Context & Requirement:** GitHub Issue [#101](https://github.com/AdamHikl/mizyun/issues/101): Production promotion previously streamed `promote-production.sh` to remote `bash -s` via stdin. An interactive child prompt consumed subsequent script lines, skipping the API restart while the outer health check passed against the old running process. Defense in depth required materializing the candidate script remotely, disconnecting standard input from `/dev/null`, ensuring automatic temporary file cleanup, and adding orchestration regressions.
- **Implemented:**
  - Added and exported `buildRemotePromotionCommand({ remoteDir, targetSha, environment })` in `scripts/deployment-manifest.mjs`. It materializes the exact candidate script into an isolated temporary file (`/tmp/mizyun-promote-<env>-XXXXXX.sh`) with permissions `0700`, installs an automated cleanup trap (`trap 'rm -f "$remote_script"' EXIT INT TERM`), and executes `bash "$remote_script" "$targetSha" < /dev/null`.
  - Updated `scripts/deploy-remote.mjs` and `scripts/deploy-dev.mjs` to use `buildRemotePromotionCommand` and added `-o ConnectTimeout=10` to SSH preflight checks.
  - Added internal fail-closed defense `exec 0</dev/null` immediately following `set -Eeuo pipefail` in `scripts/promote-production.sh` and `scripts/promote-dev.sh`, ensuring stdin is disconnected from interactive streams even if called directly.
  - Added `--yes` flag to `pnpm exec supabase db push` in `scripts/promote-dev.sh` to prevent dev migration prompts.
- **Automated Verification:**
  - Unit tests for `buildRemotePromotionCommand` validating absolute path checking, SHA format validation, and shell command structure.
  - Negative orchestration regression reproducing the vulnerability: under legacy `bash -s` streaming, a child prompt consumes subsequent release lines from stdin and skips release execution while exiting 0.
  - Positive orchestration regression proving that under the materialized runner, an unexpected child prompt receives EOF from `/dev/null`, fails closed with non-zero exit, triggers the error trap, and cleans up the temporary script immediately.
  - End-to-end regression proving that an unflagged prompt in `promote-production.sh` fails closed, triggers `rollback_code`, restores previous code, and writes a `rolled_back` journal entry without skipping steps.
  - Safeguard test suite expanded from 24 to 30 tests (all 30/30 pass).
  - Full repository `pnpm check` passed cleanly (navigation, Prettier, all 15 workspace typechecks, iOS and Android Hermes bundle exports, deployment safeguards, build matrix, and offline AI screener).
- **Independent Review:**
  - Independent deployment review by subagent approved with zero findings, validating commit immutability, two-layer stdin isolation, trap cleanup guarantees, rollback execution, and POSIX shell compatibility.
- **Next exact action:**
  - Once the Raspberry Pi server is back online, deploy candidate to Pi Dev (`pnpm deploy:dev`) and promote to Production (`pnpm deploy:production <sha>`).

## Active handoff — Group and resize saved meals (#102, 2026-09-17)

- **Context & Requirement:** GitHub Issue [#102](https://github.com/AdamHikl/mizyun/issues/102): Users wanted the ability to group individual saved meals into bigger meals while keeping each one editable, and to adjust the portion weight (grams) of a food after saving with values updating dynamically.
- **Implemented:**
  - Added pure scaling and portion extraction utilities in `apps/mobile/src/features/log-meal/meal-scale.ts` (`extractGramsFromName`, `updateGramsInName`, `scaleNutrition`, `withMealGrams`, `withMealGroup`).
  - Added `clusterDayEntries` and meal grouping/ungrouping mutation helpers in `apps/mobile/src/features/log-meal/meal-lifecycle-data.ts`. Forwarded `details` in `patchFromForm`.
  - Added portion weight (grams) input with quick adjustment steppers (`-50g`, `-10g`, `+10g`, `+50g`, `0.5x`, `1.5x`, `2x`) and live dynamic nutrition recalculation in `edit-meal-screen.tsx`. Added meal group assignment selector.
  - Added multi-select meal grouping flow in `meal-list-screen.tsx` allowing users to group 2+ individual meals into bigger meals. Grouped meals render aggregated calories/macros while keeping each item independently editable, resizable, and ungroupable.
  - Added quick interactive portion resizing modal (`AdjustPortionModal`) with real-time recalculation of calories/macros and instant server persistence.
  - Added `mealgroup` and `mealgroupname` to searchable keys in `meal-history-filter.ts`.
- **Automated Verification:**
  - Unit tests in `meal-scale.test.ts` (12/12 pass).
  - Lifecycle tests in `meal-lifecycle-data.test.ts` (16/16 pass).
  - Filter tests in `meal-history-filter.test.ts` (6/6 pass).
  - All mobile log-meal tests (74/74 pass).
  - All API food-entries tests (74/74 pass).
  - Full repository `pnpm check` passed cleanly (navigation, Prettier, all 15 workspace typechecks, iOS and Android Hermes bundle exports, deployment safeguards, build matrix, and offline AI screener).
- **Deployment & Acceptance Status:**
  - The Raspberry Pi server is temporarily down (user confirmed). Remote promotion to Dev (`pnpm deploy:dev`) and physical device acceptance on `com.mizyun.development` are held until the Pi is online.
- **Next exact action:**
  - Once the Raspberry Pi is back online, deploy commit to Pi Dev (`pnpm deploy:dev`) and perform device acceptance on the installed Dev iPhone build: verify multi-select meal grouping into a bigger meal, portion resizing with dynamic macro updates, and editing individual items within the group.

## Active handoff — Onboarding analytics and automatic Beta Pro requests (#100, 2026-09-15)

- **Confirmed failures:** Production analytics PUT committed its update but failed response serialization with `RangeError: Invalid time value` at `routes.ts:106`; subsequent attempts returned HTTP 409 because the client retained the previous revision. Automatic notification registration called the same POST endpoint as an explicit Beta Pro request and created a pending row without a button press.
- **Implemented:** Separate SQL RPC snapshot mapping now reads camelCase consent timestamps; table reads retain snake_case mapping. Mutation results no longer claim an unavailable creation timestamp. Mobile consent saves refresh and retry a conflicting revision once; pending denials stay off through failures, restart, and sync. Automatic notification registration uses authenticated `PUT /v1/beta-pro/push-token`, backed by an UPDATE-only repository method that cannot insert requests or change review state. Explicit request submission retains its existing endpoint.
- **Regression evidence:** Adapter tests reproduced two failures before the date fix and now pass 6/6. The API test sends the actual RPC JSON shape through the adapter and HTTP response serializer. Mobile recovery tests cover lost responses, repeated conflict, failed refresh, durable denial, and denial during a controlled in-flight 51-event flush without restoring the queued remainder. Beta tests cover no-request registration, authenticated ownership, unchanged review state, and zero-row updates after deletion. A fresh repository-wide `pnpm check` passed: navigation and formatting, all workspace typechecks, iOS/Android Hermes exports, 527 API tests with 15 credential-gated E2E skips, 423 mobile tests, deployment/build safeguards, IPA tooling, and offline AI invariants.
- **Independent privacy/auth review:** Approved after identifying and resolving an in-flight analytics flush race. The final implementation permits only one active flush, rechecks consent and epoch inside the serialized queue-mutation boundary, filters the current queue instead of a stale snapshot, and cannot recreate queued events after denial. The reviewer also confirmed that the Beta token route is authenticated, derives ownership only from the principal, performs UPDATE-only persistence, and cannot create a request or alter review state.
- **Production release and device evidence:** Founder confirmation that no incompatible old clients remain closed [#98](https://github.com/AdamHikl/mizyun/issues/98). Production was promoted to exact commit `43917fa4b69acff04b931c4ef927dab21466a932` after backup `/srv/mizyun/backups/20260915T084930Z` and migration `20260914134000`. TestFlight Build 4 identifies as `Mizyun/4`. Its first consent attempt exposed a stale API process; after the scoped restart at 15:59:25 CEST, the real Build 4 recovery path completed `PUT 409 -> GET 200 -> PUT 200` with no serialization error. The new Beta token route returns HTTP 401 without authentication rather than 404, confirming the deployed route is loaded and protected.
- **Deployment incident and correction:** The promotion checkout and migration advanced, but Supabase's interactive migration prompt consumed the remaining streamed shell script beginning with `migrations_applied=true`; the API restart and release-journal tail therefore never executed, while the wrapper's generic health check passed against the old process. The Production API was manually restarted and is healthy locally and publicly. `promote-production.sh` now passes the documented global `--yes` flag to both migration dry-run and apply. A regression requires exactly those two non-interactive calls and proves the subsequent API restart. The focused safeguard suite passes 24/24, the fresh repository-wide `pnpm check` passes, and an independent deployment review approved the correction. Streamed-script isolation is retained as separate defense-in-depth work.
- **Remaining acceptance:** Existing pending Beta Pro rows are retained because historic automatic and explicit submissions are indistinguishable. Verify on a fresh account or after an explicitly authorized cleanup that Build 4 does not create a request before the button is pressed. Tracking: [#100](https://github.com/AdamHikl/mizyun/issues/100).

## Active handoff — Production native Apple sign-in enabled (2026-09-15)

- **Failure reproduced at the real boundary:** The founder confirmed installation through TestFlight, and the client identified itself as `Mizyun/3`. Four Production GoTrue requests from that client reached `POST /token` with `grant_type=id_token` and were rejected with HTTP 400 `provider_disabled`: `Provider (issuer "https://appleid.apple.com") is not enabled`. The native Apple sheet therefore succeeded far enough to return an Apple identity token. Production Auth rejected the provider before token audience and nonce validation, so those later checks still require a post-fix device attempt.
- **Production correction:** Added the native-only Apple provider mapping to `/srv/mizyun/supabase/docker-compose.yml` and its source values to `/srv/mizyun/supabase/.env`: enabled, accepted client ID `com.mizyun.app`, and nonce checking explicitly enabled (`GOTRUE_EXTERNAL_APPLE_SKIP_NONCE_CHECK=false`). No Apple OAuth Services ID or rotating client secret was introduced because the iOS app uses native `signInWithIdToken`, not web `signInWithOAuth`. Recoverable pre-change copies are `/srv/mizyun/supabase/.env.before-apple-auth-20260915T081520Z` and `/srv/mizyun/supabase/docker-compose.yml.before-apple-auth-20260915T081520Z`.
- **Scoped runtime operation and verification:** `docker compose config --quiet` passed, and only `supabase-auth` was force-recreated. GoTrue `v2.189.0` returned healthy with effective `GOTRUE_EXTERNAL_APPLE_ENABLED=true`, `GOTRUE_EXTERNAL_APPLE_CLIENT_ID=com.mizyun.app`, and nonce skipping disabled. The public Auth settings endpoint reports `external.apple=true`; the Production API remained healthy. No repository code, database, migration, Production API checkout, or backend SHA changed.
- **Independent auth review:** Approved the live activation with no blocking configuration or security finding. The reviewer independently confirmed the exact audience, enabled provider, enforced nonce policy, healthy Auth/API services, clean documentation diff, and no new `provider_disabled` event after the Auth recreation. It retained device acceptance as the hard gate because no post-fix Apple attempt had occurred at review time.
- **Remaining device acceptance:** Retry **Continue with Apple** in the same TestFlight Build 3 and confirm the first native Apple session reaches the dashboard. Then sign out and repeat to exercise the returning-user path. Inspect the matching sanitized Auth log if either attempt fails; do not mark device acceptance from provider settings alone.
- **Next exact action:** Complete the two TestFlight Apple sign-in journeys above and record the account/session result without retaining the Apple identity token or relay address.

## Active handoff — Google Play reviewer account prepared (2026-09-14)

- **Production reviewer access:** Created and email-confirmed the dedicated `play-review@mizyun.phiskel.com` Production Auth account through the Supabase admin boundary using a runtime-only password supplied by the founder. The password was not written to repository files, durable evidence, or command output. Password sign-in through Production Auth succeeded and the account has one email identity with no MFA factors.
- **Synthetic fixture:** Populated the account through authenticated Production `/v1` routes using the same bounded pattern as the App Store reviewer: one adult metric profile, one active maintenance goal, three recent body measurements, three meals, one exercise, one reusable routine, one completed session, and three completed sets. All records use new account-owned identifiers; the workout-set ownership validation reported zero errors. No photos, media objects, conversations, memories, analytics events, or real user data were created.
- **Reviewer tier and consent:** The account's Beta Pro request was approved in Production with note `Google Play reviewer account`; the database trigger set `profiles.plan_tier` to `paid`, and push delivery was skipped because no push token exists. AI and analytics consent remain ungranted so review exercises the actual disclosures and consent flow; adult eligibility is already satisfied.
- **Independent audit:** A non-author read-only audit verified the existing App Store fixture shape, Production ownership boundaries, absence of MFA/media, and the required post-create checks. Final database evidence for the Play account: Auth `1` confirmed, identity `1`, MFA `0`, profile `1` paid/adult, goals `1`, measurements `3`, food entries `3`, exercises `1`, workouts `2`, sets `3`, approved Beta request `1`, AI consents `0`, analytics consents `0`, media assets `0`, ownership errors `0`.
- **Remaining acceptance:** A Play-delivered Production Android build has not yet signed in with this account. Keep the Play Console password only in its secure sign-in-details field; do not add it to Git, screenshots, reviewer notes, or general documentation.
- **Next exact action:** Complete Play Console app-access details, then build and upload the verified Production AAB to Internal testing and confirm fresh Play-installed password sign-in plus the core reviewer journey.

## Active handoff — Production legal-page support email refreshed (2026-09-14)

- **Live correction:** The Production checkout at exact commit `bf4ef1a1c29d29b5fb71b145bdff23254ded931b` already contained `support@mizyun.phiskel.com` in the privacy, terms, support, and account-deletion routes, but the API process had been running since 2026-09-12 and still served the former `support@phiskel.com` value from memory. No source, database, migration, checkout, or backend SHA change was required.
- **Scoped operation:** Restarted only `mizyun-api.service`; it returned to `active`. The public Production health endpoint returned `{"status":"ok","service":"mizyun-api"}` and the Cloudflare-obfuscated address on `https://mizyun-api.phiskel.com/legal/privacy` decoded to `support@mizyun.phiskel.com` after the restart.
- **Verification:** `pnpm --filter @mizyun/api test src/modules/legal` passed 3/3 tests. A read-only helper audit confirmed that no tracked `support@phiskel.com` occurrence remains and independently identified the stale running process as the likely boundary. The existing Production hold for the workout lifecycle migration remains unchanged; current `main` was not deployed.
- **Next exact action:** Continue Google Play setup using the corrected public privacy URL; do not promote the held workout backend until Issue #98 is resolved.

## Active handoff — Production email-confirmation redirect corrected (2026-09-14)

- **Production configured:** The Production Supabase source of truth at `/srv/mizyun/supabase/.env` now uses the exact mobile callback for both `SITE_URL` and `ADDITIONAL_REDIRECT_URLS`: `mizyun://auth/callback`. The previous dead fallback, `https://mizyun.phiskel.com`, remains recoverable in `/srv/mizyun/supabase/.env.before-site-url-20260914`. Only the `auth` container was force-recreated; the Production API checkout, database, migrations, and current backend SHA were not changed.
- **Live verification:** The recreated `supabase-auth` container is healthy and reports effective `GOTRUE_SITE_URL=mizyun://auth/callback` and `GOTRUE_URI_ALLOW_LIST=mizyun://auth/callback`. Auth health passed through the public Supabase gateway with the publishable-key header, and `https://mizyun-api.phiskel.com/v1/health` remained healthy.
- **Durable client guard implemented:** `SupabaseMobileAuthClient.signUpWithPassword` now explicitly supplies `options.emailRedirectTo` from the current app variant, matching the existing explicit recovery and OAuth redirects. The focused adapter suite passes 15/15 tests across the Production and Dev schemes, and a fresh repository-wide `pnpm check` passed (including navigation, formatting, all typechecks, iOS/Android Hermes exports, 518 API tests with 15 credential-gated E2E skips, 414 mobile tests, deployment/build safeguards, and AI invariants). This source change is not in the existing Build 3 IPA and no replacement IPA was built; the live `SITE_URL` correction covers that existing client because it previously used the fallback.
- **Independent review:** Approved the exact mobile callback and scoped Auth recreation. A custom scheme is appropriate for the immediate mobile release, but a desktop browser without Mizyun installed cannot provide a useful completion page. A future real HTTPS confirmation landing/bridge is required for cross-device UX; that work must also point signup's explicit `emailRedirectTo` to the bridge (or omit it to use the new `SITE_URL`). Do not point Auth back to the currently nonexistent `mizyun.phiskel.com` host until that page and DNS exist.
- **Remaining acceptance:** Tracked in [#99](https://github.com/AdamHikl/mizyun/issues/99). Generate a fresh one-time confirmation link and verify it opens an installed Production app from both cold and warm states. Then verify password recovery and Google OAuth once because they share the callback allow-list. Confirmation links are single-use; do not interpret a reused or prefetched link as a redirect regression.

## Active handoff — Workout App Store IPA ready; Production backend promotion held (`FIX-WORKOUT-LIFECYCLE-001`, 2026-09-14)

- **Current Build 3 IPA ready:** Exact pushed commit `d53bd2487e79552391fca2bb2bae8743a59b0761` completed the guarded Production pipeline for version `1.0.0`, build `3`: frozen dependency installation, clean native prebuild, full `pnpm check`, Xcode archive, App Store Connect export, and post-export identity/signing/entitlement/runtime checks all passed. The 24,864,005-byte IPA is `apps/mobile/ios/build/app-store/1.0.0-3-d53bd2487e79552391fca2bb2bae8743a59b0761-20260914T170705Z/Mizyun-1.0.0-3-d53bd2487e79552391fca2bb2bae8743a59b0761-20260914T170705Z.ipa`, with SHA-256 `1dcacbadf31aadd3a7ae7b1c5d43966f9df95be4a600cfaf443925c2cb2775b9`. The adjacent `manifest.json` and `DistributionSummary.plist` are present and validated. It has not been uploaded.
- **Historical App Store artifact evidence:** Exact commit `8e3853d87f8ac092af552fb3d49063d31caa63a3` was previously checked out in a clean disposable worktree, prebuilt with the Production mobile environment, archived, and exported for App Store Connect. Its verified IPA was 23,599,231 bytes with SHA-256 `65654bd9ceb79b8ac0ce44359bea97b7bc54d34c5bd47e1f4a18c946293d496a`. The ignored local output copy is no longer present after the current session's required clean Dev native regeneration; this historical evidence is not a claim that an uploadable file remains in the repository workspace.
- **Reproducible build command:** Commit `dd7eeee1391b3b3ff34a895964c58d77d1727d17` added and pushed `pnpm mobile:founder-production:ios:ipa --sha <full-40-character-origin-main-sha> --build-number <positive-integer>`. It refuses unpushed candidates or candidate-mismatched release tooling, builds in a disposable detached worktree, clears inherited mobile environment values, generates fresh native projects, runs `pnpm check`, uses unique archive/export paths, and post-verifies bundle identity, requested build number, Production endpoints, distribution signing/entitlements, and checksum. It atomically emits the IPA, required `DistributionSummary.plist`, and a JSON manifest under the ignored `apps/mobile/ios/build/app-store/` tree; it does not upload or deploy.
- **Real scripted acceptance:** The command previously completed end-to-end for exact pushed commit `dd7eeee1391b3b3ff34a895964c58d77d1727d17`, version `1.0.0`, build `2`. The full clean-worktree `pnpm check`, CocoaPods installation, Xcode archive, App Store export, payload/signing/entitlement checks, distribution-summary validation, manifest validation, and disposable-worktree cleanup passed. The resulting 23,604,978-byte IPA had SHA-256 `f6bb533e2d3f3c36ef9c7aea43595fcaac80899ed48952343306621800cf527c`. Its ignored local output copy was also removed by the clean Dev regeneration. A fresh recovery run for exact `dd7eeee` repeated the full check and successfully archived, but export stopped with Xcode exit 70 (`No Accounts`; no `iOS Distribution` signing certificate). No replacement IPA is currently claimed.
- **Identity and signing evidence:** Bundle ID `com.mizyun.app`, version `1.0.0`, build `1`, arm64, team `LQJNDVBL43`, Cloud Managed Apple Distribution certificate, `aps-environment=production`, `beta-reports-active=true`, and `get-task-allow=false`. The runtime bundle contains the Production API and Supabase endpoints. It also contains an inert Dev Supabase hostname from the shared build-matrix validation constant exported through `@mizyun/config`; the active mobile configuration was sourced from `.env.production` and passed the Production prebuild safeguards.
- **Production backend was not promoted:** Preflight found Production pristine and healthy at `bf4ef1a1c29d29b5fb71b145bdff23254ded931b`. Deployment of `8e3853d` was stopped before backup, migration, checkout change, or service restart after an independent compatibility audit found that the one-time routine-classification migration plus the new API's routine-set rejection would break old Production mobile clients, which still open a routine directly and write sets to it. Production was rechecked unchanged, pristine, active, and healthy.
- **Safe rollout sequence:** Upload and process the new IPA first while the current Production backend remains compatible with it. After the new client is available and adopted, either promote the workout backend/migration or first add a bounded old-client compatibility path. Do not run `pnpm deploy:production 8e3853d` until the gate tracked in [#98](https://github.com/AdamHikl/mizyun/issues/98) is resolved.
- **Remaining acceptance:** App Store Connect upload/processing and TestFlight installation of Build 3 are not yet evidenced. App Store Connect will reject the upload if build `3` already exists for version `1.0.0`; uniqueness was not checked by this local build. The four physical workout lifecycle journeys remain to be explicitly accepted.

## Active handoff — Reusable workout routines separated from active sessions (`FIX-WORKOUT-LIFECYCLE-001`, 2026-09-14)

- **Implemented locally:** Saving a custom or Coach workout now creates a stable reusable routine with no running timer. **Start Session** creates a fresh session snapshot with its own `startedAt`; finishing completes only that session, and discarding deletes only that session. The source routine remains available in both cases. Direct legacy routine links are redirected to a newly created session before sets can be logged.
- **Legacy compatibility:** Migration `20260914134000_backfill_workout_routine_lifecycle.sql` classifies existing rows. A legacy planned workout that already owns sets remains the active/history session while a set-free routine copy is created, preventing deployment from consuming an in-progress routine. The API now rejects set writes against explicit routine rows.
- **Automatically verified:** Exact commit `8e3853d87f8ac092af552fb3d49063d31caa63a3` passed a clean-worktree `pnpm check` (15 workspace typechecks, iOS/Android Hermes bundles, core 261 tests, mobile 414 tests, API 518 tests with 15 credential-gated E2E tests skipped, deployment/build/AI gates). The same clean commit passed `pnpm db:verify`, applying all migrations and passing 107 pgTAP assertions. A rollback-only seeded execution of the exact migration exercised the legacy planned-plus-sets branch successfully. Focused lifecycle tests passed (mobile 85; independent API review rerun 38), and `git diff --check` passed.
- **Independent review:** Approved with no blocking findings. Pre-existing unrelated dirty-tree work, including concurrent branding changes in shared screens, was preserved. Tracking: [#96](https://github.com/AdamHikl/mizyun/issues/96). Non-blocking server pagination/idempotency/reference hardening is tracked separately in [#97](https://github.com/AdamHikl/mizyun/issues/97).
- **Dev deployed:** Commit `8e3853d87f8ac092af552fb3d49063d31caa63a3` was pushed to `origin/main` and deployed to Pi Dev. Migration `20260914134000` was applied. Post-deploy evidence: `/var/lib/mizyun/dev/repo` is pristine at the exact SHA, `mizyun-api-dev.service` and `mizyun-supabase-dev.service` are active, and `https://mizyun-api-dev.phiskel.com/v1/health` returned `{"status":"ok","service":"mizyun-api"}`.
- **Dev iOS installed / remaining gate:** A clean signed Release `com.mizyun.development` build from exact SHA `8e3853d` was installed successfully on physical device `Adam's Iphone 😋` and launched via CoreDevice on 2026-09-14. Physical behavior acceptance remains: verify that Save Routine does not advance time, Start begins near `00:00`, Finish preserves the routine, and Discard Session preserves the routine.

## Active handoff — Production App Store Connect `.ipa` build completed (2026-09-14)

- **App Store Connect build & IPA exported:** Built native Release archive `Mizyun.xcarchive` (`xcodebuild archive`) and exported distribution package `Mizyun.ipa` (`xcodebuild -exportArchive`) via `scripts/ios-export-options-production.plist`.
- **Artifacts:**
  - Archive: `apps/mobile/ios/build/Mizyun.xcarchive`
  - IPA package: `apps/mobile/ios/build/export/Mizyun.ipa` (24.8 MB)
  - Distribution summary: `apps/mobile/ios/build/export/DistributionSummary.plist`
- **Signing & Identity:**
  - Bundle Identifier: `com.mizyun.app`
  - Version: `1.0.0`, Build Number: `1`
  - Team: `LQJNDVBL43` (`itinn s.r.o.`)
  - Certificate: `Cloud Managed Apple Distribution` (SHA1 `E429BA7A349C5A8EDBD11536025213A196A4E1F9`, expires 2027-09-14)
- **Tooling & Commands:** Added `mobile:founder-production:ios:archive` and `mobile:founder-production:ios:ipa` to `package.json` and `scripts/mobile-founder-production-ios.sh` for 1-command reproducible App Store Connect builds. `pnpm format:check` and `pnpm test:build-matrix` green.
- **Next exact action:** Upload `Mizyun.ipa` to App Store Connect via Xcode Organizer (`open apps/mobile/ios/build/Mizyun.xcarchive` -> Distribute App -> App Store Connect) or Transporter / `xcrun altool`.

## Active handoff — Physical iOS production installation completed (2026-09-14)

- **Physical iOS installation completed:** Clean `pnpm mobile:founder-production:ios:prebuild` executed; native Release binary (`Mizyun.app`) compiled and signed via Xcode with development team `LQJNDVBL43` without errors. Installed on physical device `Adam's Iphone 😋` (`00008140-001114501A86801C` / CoreDevice `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`). Installed side-by-side with Dev (`com.mizyun.development`).
- **Target identity & config:** Bundle ID `com.mizyun.app` ("Mizyun", version 1.0.0, build 1). Configured against public production endpoints: API `https://mizyun-api.phiskel.com`, Supabase `https://mizyun-supabase.phiskel.com`, redirect scheme `mizyun://auth/callback`.
- **Preflight & backend health:** Full `pnpm check` passed cleanly (navigation, typechecks across all workspaces, Prettier, Hermes bundle export, unit tests, deployment safeguards, build matrix, and AI evaluation offline screener). Public production API verified healthy (`GET https://mizyun-api.phiskel.com/v1/health` -> HTTP 200 `{"status":"ok","service":"mizyun-api"}`).
- **Device launch:** Successfully launched `com.mizyun.app` on the unlocked iPhone via `xcrun devicectl device process launch`.
- **Next exact action:** Unlock iPhone and verify production journey / authentication against Pi production backend.

## Active handoff — Task tracking migrated to GitHub Issues (2026-09-14)

- **Migration executed:** Task tracking and executable inventory transitioned from `backlog.md` to GitHub Issues ([`AdamHikl/mizyun/issues`](https://github.com/AdamHikl/mizyun/issues)); the durable repository migration landed in `11c08ec`.
- **Scope & labels:**
  - Created 26 repository labels (`priority:P0`–`P3`, `status:active|ready|blocked|research|done|superseded`, `area:*`).
  - Created 54 open GitHub Issues (#1–#54) corresponding 1-to-1 with active/ready/blocked tasks from `backlog.md`.
  - Historical completed work (prior to 2026-09-14) remains in `completed-backlog.md` as an immutable local archive; completed issues are not duplicated on GitHub.
  - Updated `AGENTS.md`, `docs/SESSION_GUIDE.md`, `docs/START_HERE.md`, `README.md`, `plan.md`, `docs/BUSINESS_ALIGNMENT.md`, and agent skills to establish GitHub Issues as the canonical task system.
  - Added redirect notes and an issue number mapping table to `backlog.md`.
  - Retained the one-time migration script as evidence, but made it read-only by default and fail closed if an applied migration report already exists.
- **Next exact action:** Discover, manage, and close work items via `gh issue` commands; use GitHub Issues for active task tracking.

## Active handoff — Local Qwen agent paused by user decision (2026-09-14)

- **User decision:** The founder explicitly paused the use of the local Qwen agent because it is too slow ("pause the use of the qwen agent, it is too slow, do not use it, record this in the .MD files for future sessions").
- **Enforcement:**
  - Do NOT start the local MLX-LM server (`scripts/worker/run-mlx-server.sh`) or Ollama worker for automated development tasks.
  - Do NOT dispatch batch tasks to `batch-runner.mjs` or use the `qwen-task-dispatch` skill.
  - Background processes (`mlx_lm`) have been terminated and port 8080 cleared.
  - For substantive agent collaboration, use Antigravity built-in subagents (`invoke_subagent` with `research` or `self`) or perform work directly as coordinator.
- **Source:** The durable pause policy and GitHub Issues workflow landed together in `11c08ec`.
- **Next exact action:** Carry out all development, reviews, and backlog tasks using the primary model and built-in subagents; do not attempt local Qwen worker execution.

## Active handoff — Tonal app-opening splash background (`BRAND-SPLASH-001`, 2026-09-14)

- **Implemented and committed:** Commit `dccac84` replaces the flat dark startup handoff with `launch-blue-backdrop.png`, a generated blue-only full-screen tonal field matched to the approved ribbon-M icon. The foreground M is now the alpha-preserving `mizyun-mark.png`, not the opaque square launcher image, so it has no visible square boundary over the tonal background. Native startup uses `mizyun-native-splash-mark.png` composited on the same `#0C70ED` configured splash color, preserving a square-free centered mark before JavaScript renders.
- **Files:** `apps/mobile/app.json`, `apps/mobile/src/components/animated-icon.tsx`, and the three new `apps/mobile/assets/images/{launch-blue-backdrop,mizyun-mark,mizyun-native-splash-mark}.png` assets. The launcher icon itself remains unchanged.
- **Automatically verified:** `pnpm check` passed on 2026-09-14, including formatting, all typechecks, iOS and Android Hermes bundle exports (which include the two new opening assets), tests, deployment safeguards, build matrix, and AI invariant checks. A rendered 393×852 compositing preview was also inspected; the full-screen backdrop is fully opaque and the mark has no square edge. Expo SDK 57 uses a color-only standard native splash background, so this implementation provides a coherent flat native frame and a full tonal JavaScript handoff; it does not claim a native full-screen gradient.
- **Why it appeared to roll back:** An earlier dirty-tree Dev build temporarily contained these visuals, but the later exact-SHA `8e3853d` Dev installation replaced that app with committed source that did not yet contain them. The code was not reverted; it had never been committed until `dccac84`.
- **Dev device installation:** Current pushed `main` at `f464159` was verified with a fresh `pnpm check`, clean-prebuilt for Dev, compiled as a Release for `com.mizyun.development`, installed over the existing `Mizyun Dev` app on physical iPhone `Adam's Iphone 😋` (`00008140-001114501A86801C`), and launched successfully through CoreDevice. The existing app was not uninstalled. `OFFLINE-CACHE-001` remains absent. The Build 3 Production IPA was checksummed before backup and after restoration around the clean prebuild; its SHA-256 remained `1dcacbadf31aadd3a7ae7b1c5d43966f9df95be4a600cfaf443925c2cb2775b9`.
- **Remaining device gate:** Installation and launch are evidenced, but the tonal cold-start transition and mark/background seam have not yet been visually accepted by the founder.
- **Next exact action:** On the installed Dev app, force-close and cold-start several times, then visually accept the native-to-JavaScript transition and mark/background seam.

## Active handoff — Beta branding and dashboard copy (2026-09-14)

- **Implemented and committed:** Commit `dccac84` removes the dashboard's obsolete “Foundation mode” card. It adds the reusable `BrandWordmark` component, which renders `MIZYUN` with a compact `BETA` badge, to the primary Dashboard, Workouts, Meals, Coach, and Account headers, as well as the onboarding header, Coach thread list, and web tab rail.
- **Beta disclosure added:** The `BETA` pill is now an accessible button that opens a brief dismissible beta notice: bugs may occur, behavior may vary, some features may not yet be enabled, and feedback is highly valued. The same notice is visible in the first onboarding welcome step immediately before the Beta Pro Pass request card.
- **Automatically verified:** A fresh repository-wide `pnpm check` passed after all changes: navigation and formatting, 15 workspace typechecks, iOS/Android Hermes bundles, core 261 tests, mobile 414 tests, API 518 tests with 15 credential-gated E2E skips, deployment/build/IPA safeguards, and 56 AI invariants. The earlier focused onboarding suite also passed 36 tests.
- **Remaining device gate:** The committed candidate is installed and launches on the physical Dev iPhone. Founder visual acceptance remains for narrow headers, the clickable badge popup, first-page onboarding disclosure, Foundation-card removal, and splash cold starts.

## Active handoff — Offline cache paused (`OFFLINE-CACHE-001`, 2026-09-14)

- **State:** Deferred and tracked as `status:ready` in [GitHub Issue #14](https://github.com/AdamHikl/mizyun/issues/14). The founder rejected the partial prototype as insufficient quality on 2026-09-14; its local-only shelf branch was deleted and none of that implementation is retained in `main`, the shared worktree, or a remote branch.
- **Release boundary:** No `OFFLINE-CACHE-001` runtime integration is enabled or deployed. Existing SecureStore usage for unrelated features is unchanged.
- **Next exact action:** When the founder resumes `OFFLINE-CACHE-001`, redesign and implement it from scratch against Issue #14's owner isolation, purge, corruption, reconnect, verification, Dev deployment, and physical-device acceptance criteria.

## Implemented & verified handoff — Coach workout/meal intent disambiguation (`FIX-COACH-INTENT-001`, #15, 2026-09-21)

- **Implemented:** `apps/api/src/modules/coach/nutrition-action.ts` features a conservative classifier with Unicode property escapes (`\p{L}`, `\P{L}`, `/iu`) avoiding ASCII-only boundary failures on Slovak diacritics.
  - (1) **Workout-signal veto**: English workouts/exercises/runs/walks/squats/deadlifts/push-ups/pull-ups/sit-ups, and Slovak verb/noun forms (`(?:za|od)?cvič\p{L}*`, `(?:za|od)?beh\p{L}*`, `tréning\p{L}*`, `trénov\p{L}*`, `kráč\p{L}*`, `chôdz\p{L}*`, `prechádzk\p{L}*`, `drep\p{L}*`, `klik\p{L}*`, `zhyb\p{L}*`, `výpad\p{L}*`, `posilň\p{L}*`, `fitk\p{L}*`, `séri\p{L}*`) veto meal routing outright.
  - (2) **Food-context requirement**: A quantity with a unit or a common food/drink word (English and Slovak).
  - (3) **False-positive safeguards**: Narrowed Slovak honey matching (`med(?:om|u|y)?|medov\p{L}*`) to prevent colliding with preposition `medzi` ("between/among") or `medaila`, narrowed mid-morning snack (`desiat[au]|desiatej`) to avoid colliding with ordinal `desiaty` ("10th"), and supported diminutive `k[uú]s\p{L}*`.
- **Independent non-author review:** Conducted by built-in subagent (`Independent Classifier Reviewer`, conversation `865966da-8c37-4ecb-80f5-9548d29dcea6`). Identified and resolved 5 findings (Slovak preposition `medzi` false positive, ordinal `desiaty` false positive, hyphenated compound exercises `push-ups`/`pull-ups`, prefixed Slovak motion verbs `zacvičil`/`zabehol`, and diminutive `k[uú]s\p{L}*`). Review approved.
- **Verification:** 47/47 unit tests pass in `apps/api/src/modules/coach/nutrition-action.test.ts` (17 positive meal logging assertions, 30 negative non-meal/workout/question/note assertions). All 216 coach module tests pass (`vitest run apps/api/src/modules/coach`). Full deployment safeguards pass (39/39). API typecheck passes cleanly.
- **Acceptance status / next exact action:** Implemented and automatically verified. GitHub Issue #15 closed. Native device acceptance pending on next Dev build deployment.

## Active handoff — Native MLX Local Worker, Backlog Split & Coach Workout Intent (`LOCAL-WORKER-003`, `FIX-COACH-INTENT-001`, 2026-09-13)

- **Backlog separation & cleanup**:
  - Divided backlog into two distinct files: [`backlog.md`](../../../backlog.md) (retained exclusively for 53 to-do/active/ready/research/blocked items) and [`completed-backlog.md`](../../../completed-backlog.md) (dedicated archive for 114 completed/superseded work packages and implementation evidence). Formatted and verified with Prettier.
- **Coach workout vs meal intent bug (`FIX-COACH-INTENT-001`, P1, `ready`)**:
  - User demonstrated natural language workout logging ("Add two hour walk to my completed workouts today") being mistakenly intercepted as a meal draft.
  - Root cause reproduced: `isExplicitMealLoggingIntent` in `apps/api/src/modules/coach/nutrition-action.ts` matched prefix `/^(?:please\s+)?(?:log|add|record)\b/i`, but the negative lookahead `!/\b(?:workout|training|exercise|session)\b/i` failed because `\bworkout\b` does not match plural `workouts`, nor activity nouns like `walk`, `run`, `swim`, `cardio`.
  - Added `FIX-COACH-INTENT-001` to `backlog.md` and created bounded Qwen task packet [`.agents/tasks/task-coach-intent.json`](../../../.agents/tasks/task-coach-intent.json).
  - Local MLX Qwen batch run: `task-splash-color-001` completed in 134.7s, changing only `apps/mobile/app.json` and `apps/mobile/src/components/animated-icon.tsx`; the worker verification and a fresh coordinator `pnpm --filter @mizyun/mobile typecheck` both passed. `task-coach-intent-001` then exceeded the 300-second MLX request timeout before returning edits; its precise retry/help requirement is recorded under Session engineering in `backlog.md`. No commit, push, deployment, remote-infrastructure access, credential change, or remote configuration change was attempted.
  - Overnight-worker hardening: MLX request timeout is now configurable from the batch manifest and set to 15 minutes (bounded to 1–30 minutes); the batch supervisor converts worker exceptions into concrete blockers and continues to later tasks, but halts for coordinator review after any out-of-allowlist write. The MLX-LM/Qwen runtime supports thinking enabled/disabled, not a literal `xhigh` reasoning level; the stable local configuration is `enable_thinking: true` with a 4,096-token generation budget. An attempted 8,192-token configuration did not remain available, so it was not retained.
- **Previous additions**:
  - `OFFLINE-CACHE-001` (P1, `ready`): Offline profile & daily dashboard cache using SecureStore.
  - `BRAND-SPLASH-001` (P2, `ready`): Splash background color calibration from `#208AEF` to `#0B0F12` ([`.agents/tasks/task-splash-color.json`](../../../.agents/tasks/task-splash-color.json)).
- **Verification**: `pnpm navigation:check` passed (0 errors), `pnpm test:navigation` passed (27/27 tests), mobile typecheck passed.
- **Next exact action**: Retask `FIX-COACH-INTENT-001` only after reducing its MLX context or setting a longer bounded response timeout; retain its two-file allowlist and focused API test. The local Qwen batch monitor checks in every 30 minutes and reports only completion, failure, or a needed action.

## Active handoff — OpenCode local Qwen connection (`LOCAL-WORKER-002`, 2026-09-13)

- **Implemented:** project `opencode.json` now connects directly to MLX-LM on
  `127.0.0.1:8080/v1` using `@ai-sdk/openai-compatible`. Previous Responses
  bridges remain preserved but unused. Launcher disables thinking by default
  and raises the default output budget to 4096. Existing Ollama worker changes
  and mobile work were preserved.
- **Live local evidence:** exact `mlx-community/Qwen3.8-27B-8bit` returned
  `MLX_OK`; OpenCode 1.18.30 completed actual read/write/read tools and `DONE`
  in a disposable directory. MLX-LM 0.31.3 / MLX 0.32.2 on this Mac.
- **Source:** `1b02190b3665a813fe5875e3d33762dce34abf6b` plus uncommitted work;
  no commit, push, deployment, or device/release claim in this work package.
- **Verification:** `python3 scripts/worker/smoke-opencode.py` passed in 122.1s
  with completed read/write/read events and exact random file value. Shell/Python
  syntax, changed-file formatting, `git diff --check`, and `pnpm navigation:check`
  passed (navigation has 14 pre-existing stale-review warnings). `pnpm check`
  passed its 27 navigation tests, then stopped on pre-existing formatting in
  `scripts/worker/lib/task-runner.mjs`; subsequent full-gate stages did not run.
- **Independent review:** helper checked primary oMLX/OpenCode/model sources and
  reviewed the config, launcher, smoke test, and guide; no blocking defects.
  Keep MLX-LM for this working setup. oMLX remains an unbenchmarked alternative
  for cache/model-management or concurrent-serving needs.
- **Usage:** [local setup guide](../../tutorials/LOCAL_QWEN_OPENCODE.md) and
  [agent delegation runbook](../../../.agents/guides/LOCAL_QWEN_OPENCODE_AGENT_GUIDE.md).
  The server is running in this session's terminal; it must remain
  open or be restarted with `bash scripts/worker/run-mlx-server.sh`.
- **Next exact action:** start a new `opencode` session from this repository and
  use the selected local Qwen model for a bounded coding task. Large-context
  quality and sustained parallel throughput are not established by the smoke test.

## Active handoff — Regional Food Standards Decoupled from Coach Preferences (`COACH-PREF-002`, 2026-09-13)

- Decoupled Country / Regional food standards from `CoachPreferencesCard` into a dedicated first-class card and accordion under the **Profile & Goal** section of `SettingsScreen`.
- **Components & Data Layer**:
  - Authored `apps/mobile/src/features/settings/regional-food-standards-data.ts`: pure functions `getCountryStandardDisplay` and `saveCountryStandard` with normalization, ISO 3166-1 alpha-2 validation, and safe preservation of existing `profile.coachingPreferences`.
  - Authored `apps/mobile/src/features/settings/regional-food-standards-card.tsx`: displays active calibration state (`CountryFlag` + localized country name or Global standard icon), interactive `Pressable` trigger, `CountryPickerModal` integration, immediate background persistence, accessible feedback alert, and active activity spinner during saving.
  - Refactored `apps/mobile/src/features/settings/coach-preferences-card.tsx`: completely pruned country picker triggers, modals, and unused styles while guaranteeing `countryCode` is strictly preserved on coach preferences save.
  - Integrated into `apps/mobile/src/features/settings/settings-screen.tsx`: added `Regional Food Standards` CollapsibleSection under Section 1 (Profile & Physical Stats / "Profile & Goal" tab) with live country status in the section subtitle.
- **Worker Infrastructure Hardening** (`scripts/worker/lib/task-runner.mjs`):
  - Upgraded `TaskRunner.validatePath` to support monorepo package suffix matching (e.g. `src/...` resolving to `apps/mobile/src/...`) while strictly maintaining repo root containment and preventing directory traversal escapes (`!absPath.startsWith(this.repoRoot + path.sep)`).
  - Aligned context truncation threshold with skill documentation (>5,000 characters or >150 lines with `contextSnippet`) to prevent token timeouts on local Qwen execution.
- **Independent Audit & Verification**:
  - Independent review subagent verified two-way `countryCode` data preservation, accessibility roles/labels, monorepo boundaries, and security guardrails (**APPROVED - 100% PASS**).
  - Automated tests: all 9 tests in `regional-food-standards-data.test.ts` and all 48 tests in `src/features/settings/` pass.
  - Repository-wide checks: `pnpm check` passed cleanly (exit 0) with all unit tests, typechecks, bundle checks, build matrix, deployment safeguards, and AI evaluation benchmarks green.
- **Next exact action**: Commit and deploy to Pi Dev via `pnpm deploy:dev` to verify the new settings accordion and country picker on physical device.

## Active handoff — Multi-Tier Agent Orchestration (Gemini Coordinator + Qwen Local Worker + Astra Escalation) (`LOCAL-WORKER-001`, 2026-09-13)

- Implemented the local workhorse and control plane architecture connecting **Gemini 3.8 Flash** (Antigravity coordinator) to **Qwen3.8:27b-q8_0** (local Mac M1 Max Ollama worker) and **Astra** (architect & escalation reviewer).
- **Worker Engine & Transport** (`scripts/worker/`):
  - Built zero-dependency Node.js ESM client (`scripts/worker/lib/ollama-client.mjs`) communicating with Ollama REST API (`http://127.0.0.1:11434`), supporting connection health checks, tags listing, model availability checks, and structured JSON parsing.
  - Implemented `scripts/worker/lib/task-runner.mjs` enforcing the **Worker Contract**: whitelisted `allowedFiles` verification, path-traversal prevention, prohibited action rejection, automated verification command execution, and **bounded retries** (max 2 cycles; self-correction on attempt 1 failure).
  - Built standard Model Context Protocol (MCP) server (`scripts/worker/mcp-server.mjs`) over stdio, exposing `qwen_run_task` and `qwen_check_status` tools. Registered globally in `~/.gemini/config/mcp_config.json`.
  - Built CLI runner (`scripts/worker/run-task.mjs`) with `--check`, `--inline`, and file-based execution.
- **Routing Rules, Skills & Continuity**:
  - Authored `.agents/rules/model-routing.md`: Defines strict boundaries between Qwen (routine edits, tests, docs), Gemini (decomposition, integration, verification, git/deploy control), and Astra (auth/RLS, migrations, privacy, >2 retry escalation, release approval).
  - Authored `.agents/skills/qwen-task-dispatch/SKILL.md`: Operational guide for packet creation, execution evaluation, and escalation rules.
  - Created `docs/LOCAL_WORKER_BASELINE.md`: Living register to track 10–20 tasks across tokens, wall-clock time, retries, pass rates, and escalation rates.
  - Registered paths in `docs/feature-map.json` under `environment-build-deployment`.
- **Verification & Acceptance Evidence**:
  - Verified local daemon: Ollama is online with pinned `qwen3.8:27b-q8_0` (30.0 GB).
  - Verified MCP stdio protocol: `initialize` and `tools/list` respond with compliant JSON-RPC 2.0 payloads.
  - End-to-end task run (`task-smoke-001`): Qwen received bounded task, generated code, wrote `allowedFiles`, ran verification command, and returned `{ status: "success", attempts: 1 }` in 38.7s.
  - Repository checks: `pnpm navigation:check` (0 errors), `pnpm format:check` (100% clean), `pnpm typecheck` (all 15 packages passed).
- **Next exact action**: Log the first 10–20 development tasks in `docs/LOCAL_WORKER_BASELINE.md` using the MCP tool `qwen_run_task` or CLI runner for routine edits.

## Active handoff — Shared agent skills & context hygiene (`AGENT-SKILLS-001`, 2026-09-13)

- Implemented shared Codex and Antigravity skills in `.agents/skills/` pursuant to [`docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md`](../../AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md).
- **Stage A complete**: Compacted `status.md` by archiving 20 historical handoffs (Sep 10–12) into `docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`, shrinking startup status reading from ~65KB to ~11KB (~83% reduction) while preserving active items and open gates. Established living acceptance register in [`docs/AGENT_SKILLS_ACCEPTANCE.md`](../../AGENT_SKILLS_ACCEPTANCE.md).
- **Stage B complete**: Authored three core P0 shared skills:
  - `mizyun-session-context`: Fast focused startup checklist, `pnpm context <id>`, `pnpm impact` advisory radius, bounded context packet.
  - `mizyun-verify-handoff`: Tiered verification, quality gates (`docs/QUALITY_GATES.md`), mandatory non-author review, 5 distinct evidence levels.
  - `mizyun-plan-next-session`: Structured future-session planning, platform research, zero-mutation planning boundary.
- **Stage C complete**: Hardened operational skills & scripts:
  - `check-unprocessed-feedback`: Removed blanket sandbox escape directive, enforced bounded sanitized summaries, guarded against bulk marking.
  - `scripts/check-user-feedback.mjs`: Added stdin SQL piping and 30s timeout guard matching `check-beta-pro-requests.mjs`.
  - `check-beta-pro-requests`: Separated read-only query from tier mutation actions, documented APNs/Expo push side effects, and clarified ADR-0024 policy boundary (immediate AI Coach access upon adult consent; Beta Pro is photo quota upgrade only).
- **Stage D complete**: Registered `.agents/skills` under `environment-build-deployment` in `docs/feature-map.json`; `pnpm navigation:check` passes with 0 errors.
- **Independent Audit & Review**: Research subagent independently audited the diff against all 7 guide criteria; relative link depths in P0 skills resolved to `../../../`; certified **APPROVED (100% PASS)**.
- **Verification**: `pnpm check` passed cleanly (exit 0) with all unit tests, bundle exports, deployment safeguards, build matrix, and AI invariant tests green. Prettier formatting 100% clean (`pnpm format:check`).

## Active product handoff — Product analytics backend implemented & verified (`OBS-002`, 2026-09-13)

- Implemented the first-party product analytics backend (`OBS-002`) following [the architecture, privacy rules, and staged implementation plan](../../PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md), incorporating user disclosure update: removed legacy copy claiming data stays on device; updated disclosures in Onboarding and Settings to state coarse telemetry is sent to Mizyun servers to improve app UX, linked to user account with full export and erasure rights.
- **Database & RLS** (`supabase/migrations/20260913100000_product_analytics_backend.sql`):
  - Created `product_analytics_consents` and `product_analytics_events` with strict RLS (`user_id = auth.uid()`), `on delete cascade` referencing `auth.users(id)`, and direct client writes revoked (`GRANT SELECT ON ... TO authenticated`).
  - Implemented transactional SECURITY DEFINER RPCs: `record_product_analytics_events` (acquires `FOR UPDATE` lock on consent, verifies active epoch and consent granted), `update_product_analytics_consent` (increments revision, generates new epoch on re-grant or revoke, cascades event deletion on revoke), `clear_product_analytics_events` (deletes user events, rotates epoch, increments revision), and `cleanup_expired_product_analytics` (prunes events older than 90-day retention).
- **Contracts & Domain** (`packages/contracts`, `packages/core`):
  - Defined strict discriminated union `analyticsEventV2Schema` for version 2 events with UUIDs, session tracking, sequential numbering, and strict closed property sets. Explicitly rejects food names, nutrient values, health metrics, free-form text, and auth tokens.
  - Defined transport schemas: `analyticsConsentRequestSchema`, `analyticsConsentResponseSchema`, `analyticsBatchIngestRequestSchema` (max 50 events), `analyticsBatchIngestResponseSchema`, `analyticsClearRequestSchema`, `analyticsClearResponseSchema`, and `analyticsEventsListResponseSchema`.
  - Added `productAnalyticsEvents` to `ExportManifest.counts` and `productAnalytics` to `AccountExport`.
- **API & Adapters** (`apps/api`, `packages/adapters/supabase-server`):
  - Added `GET /v1/analytics/consent`, `PUT /v1/analytics/consent`, `POST /v1/analytics/events` (with 32KB payload limit, clock skew checks < 5m future and < 72h past), `DELETE /v1/analytics/events`, and `GET /v1/analytics/events`.
  - Wired `ProductAnalyticsRepository` into `apps/api` composition root and in-memory adapter; wired analytics data into `exportForUser` and `deleteForUser`.
  - Enforced strict 30-day read-time retention filtering across server repository queries, in-memory repository, mobile client export, and local event store reads.
- **Mobile Integration** (`apps/mobile`):
  - Implemented `NetworkAnalyticsClient` with offline queue (up to 500 events), session tracking with 30m inactivity timeouts, optimistic pending denial retries, and batch flushing.
  - Updated `AnalyticsConsentPrompt` on Onboarding and `AnalyticsCard` on Settings with truthful server disclosure copy. Enabled Export and Clear buttons based on active consent status.
  - Integrated with central `AuthProvider` (`auth-context.tsx`): resets local session and clears queue on logout, expiry, account switch, or preview mode; syncs consent on valid session.
  - Adopted a 30-minute inactivity boundary in `_layout.tsx` before emitting `app_session_started` on foreground returns.
- **Operator Tooling & Navigation**:
  - Implemented `scripts/product-analytics.mjs` and npm script `pnpm analytics` (`summary`, `features`, `navigation`, `flows`, `retention`) using secure stdin-fed `psql` transactions and `--json` support. Includes ordered 24h activation tracking and matured D1/D7 cohort retention. Added 10 unit tests in `scripts/product-analytics.test.mjs`.
  - Added `docs/adr/0026-first-party-product-analytics-backend.md` and updated `docs/RESEARCH_LOG.md`.
  - Registered all paths in `docs/feature-map.json`; `pnpm navigation:check` passes (0 errors).
- **Independent Security & Privacy Review**:
  - Non-author security subagent certified CONDITIONAL APPROVAL; all recommendations (safe local session reset on sign-out, settings UI button enablement, in-memory deletion cascade) implemented and verified.
  - Independent plan auditor completed item-by-item verification against `docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md`.
- **Verification**:
  - Full `pnpm check` passed cleanly (exit 0): 44 mobile test files (403 tests), 34 API test files (498 tests), 73 contract tests, 258 core tests, 76 supabase-server tests, 10 CLI unit tests, iOS and Android Hermes bundle checks, 23 deployment safeguards, 16 build matrix checks, and 56 AI invariants.
  - Prettier formatting 100% clean (`pnpm format:check`).
- **Next exact action**: Deploy migration and API to Dev on the Raspberry Pi via `pnpm deploy:dev`, then verify consent grant, event tracking, and settings export/clear on the physical Dev iPhone build (`com.mizyun.development`).

## Environment & deployment snapshot

| Environment       | Host & Location                | Deployed SHA             | Health & Status                                           | Notes                                                                           |
| ----------------- | ------------------------------ | ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Local Mac**     | Apple Silicon (`darwin-arm64`) | `f464159` + handoff docs | `pnpm check` passed; Dev Release built and installed      | Build 3 IPA preserved; Dev app launched on physical iPhone                      |
| **Pi Dev**        | Raspberry Pi 5 (`mizyun-pi`)   | `fe19eda`                | HTTP 200 (`https://mizyun-api-dev.phiskel.com/v1/health`) | Port 4100 API / 8100 Kong / 5433 DB; UID 999 unprivileged; worker leases active |
| **Pi Production** | Raspberry Pi 5 (`mizyun-pi`)   | `3bad20c`                | HTTP 200 (`https://mizyun-api.phiskel.com/v1/health`)     | Port 4000 API / 8000 Kong / 5432 DB; all forward migrations applied             |
| **Windows PC**    | Windows / WSL2 (`mizyun-pc`)   | `—`                      | Standby hot backup                                        | Retained as secondary backup per ADR-0020                                       |

## Implementation versus release gate status

- **Implemented & Deployed to Dev on Pi (`fe19eda`)**:
  - `PUSH-001`: Direct Apple APNs HTTP/2 gateway authentication and push token auto-registration bridge (`PushRegistrationBridge`) in `_layout.tsx`. Fixed repository push token updates for approved accounts in `SupabaseBetaProRepository` and `InMemoryBetaProRepository`. Added `scripts/send-push.mjs` CLI.
  - `LOCAL-WORKER-001`: Multi-tier agent orchestration with local Qwen3.8:27b-q8_0 worker via MCP & CLI, baseline tracking register, and workout history card overflow fix.
  - `OBS-002`: Product analytics backend migration `20260913100000_product_analytics_backend.sql` applied on Pi Dev.
  - `PROD-GATE-001`: Progress photos gated to Dev variant; Production runs lean 3-action dock and feedback-only shortcuts.
  - Sub-fixes verified: `FIX-WORKOUT-001` (comma parsing), `FIX-MEAL-001` (stale draft timestamps), `FIX-AI-PHOTO-001` (UTC photo scan quota matching UI).
  - Apple Push Notifications (APNs) direct HTTP/2 gateway authentication enabled and live verified.
- **Physical Device Installation & Push Delivery Verified (Gate R3 Part B)**:
  - Compiled and installed updated release build on physical iPhone (**Adam's Iphone 😋** / iPhone 16 Pro, UDID `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`):
    - `Mizyun Dev` (`com.mizyun.development`, Release configuration, commit `fe19eda`, **Push Notifications enabled** via renewed Apple provisioning profile `29598fbb-4d6a-4de7-9be8-7e0281303dc5`, targeting `https://mizyun-api-dev.phiskel.com`).
    - Verified fix `AUTH-001`: `profileLoading` no longer blocks app startup on `<LoadingScreen />`; abort timeout added to `fetchProfile()`.
    - Verified `PUSH-001`: Device APNs push token (`2e1a63c2362b71ec0fd6d85c815fa14aa36ec32cf6b112744e1d29ae4d14cedf`) auto-registered on launch. Live APNs test notification successfully dispatched and accepted with HTTP 200 by Apple APNs sandbox gateway (`api.sandbox.push.apple.com`, topic `com.mizyun.development`) for `adam.hikl@outlook.com`.
- **Open Implementation Work (Remediation Checklist)**:
  - Q2: Durable unknown-outcome persistence for ambiguous retries across network drops.
  - Q7/Q8: Consent UI context preservation and live model evaluation.
  - Q9: Remote readiness probe identity and live promotion proof.
- **Explicitly Held / Blocked Release Gates**:
  - **Gate R8**: Physical device journey on iPhone (standalone without Metro, Auth redirect, meal logging, export, deletion) & off-device backup restore rehearsal.
  - **Production Promotion**: Separately gated milestone requiring explicit user authorization, clean pre-promotion backup, and accepted physical device evidence.

## Current blockers & known contradictions

1. **Release Gate R8**: Physical device journey testing and off-device recovery rehearsal remain open dependencies before promoting candidate to Production.

## Next exact action

1. Verify the app navigation and workout history card layout on the installed **Mizyun Dev** build on physical iPhone (`Adam's Iphone 😋`).
2. For **Release Gate R8**: Physical device journey testing and off-device recovery rehearsal on installed release builds.

## Evidence & archive links

- Skills Implementation Guide: [`docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md`](../../AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md)
- Skills Acceptance Register: [`docs/AGENT_SKILLS_ACCEPTANCE.md`](../../AGENT_SKILLS_ACCEPTANCE.md)
- Historical status archive (Sep 10–12): [`docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`](../../archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md)
- Historical status archive (Through Sep 9): [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](../../archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md)
- Product Analytics Plan: [`docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md`](../../PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md)
- Remediation evidence checklist: [`docs/REMEDIATION_EVIDENCE_CHECKLIST.md`](../../REMEDIATION_EVIDENCE_CHECKLIST.md)
- Navigation acceptance register: [`docs/AGENT_NAVIGATION_ACCEPTANCE.md`](../../AGENT_NAVIGATION_ACCEPTANCE.md)
