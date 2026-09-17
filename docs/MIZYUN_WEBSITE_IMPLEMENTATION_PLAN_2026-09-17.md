# Mizyun website implementation plan

Date: 2026-09-17. Work package: `WEB-MIZYUN-001`. Original state: planning only. Implementation progress is recorded below; this document retains the original staged acceptance criteria.

## Implementation update — 2026-09-17

- A separate Sites project was registered (project ID `appgprj_6aabc531f930819198d95c529d97f1e1`) with a dedicated local checkout at `/Users/adam/Documents/mizyun-website` (moved from temporary storage after local checks). GitHub issue [#103](https://github.com/AdamHikl/mizyun/issues/103) tracks the package. The local site has a responsive landing page, source-grounded app capture, support/deletion pages, **draft** privacy/terms, metadata and a real Proxy redirect test matrix. Local build and five route tests passed; no public version or www custom domain was deployed.
- Cloudflare read-only inspection resolved four proxied www A records and found **an active Phiskel chat application** at www, including chat, model, upload, feedback and sign-in routes. Binding the Site to www would replace that app; the original assumption that ordinary www pages could simply redirect is incomplete. The founder must decide whether those functional routes remain available, then their full routing/auth ownership must be implemented and reviewed before cutover.
- Independent review found that the installed Vinext runtime issues **308** for `/mizyun/` before the candidate Proxy's intended **301** can run; `/auth/*` and `/.well-known/*` are merely exempt from redirects, not preserved on the new Site. Legal/provider-retention copy and screenshot publication approval remain open. No Pi connection, backend probe or DNS/rule change occurred.
- Source push/review deployment was rejected by the execution approval boundary because the draft legal and routing inventory would be exported to the Sites repository. Do not retry via another channel. Retain the local candidate and obtain explicit user approval after explaining what is exported before any source push or deployment.

## A. Context and scope

Create a public marketing website at **https://www.phiskel.com/mizyun**. Redirect other ordinary page URLs on **www.phiskel.com** to that canonical landing page. The Raspberry Pi is temporarily down: do not connect to it, probe its public services, run SSH/Tailscale checks, or deploy to it until the founder explicitly says it is available again.

The website must remain useful when the app backend is unavailable. Host its content and assets independently of the Pi and the proposed Hetzner backend migration.

In scope:

- A polished responsive landing page explaining Mizyun through real app visuals and accurate feature descriptions.
- Locally hosted logo, images, styles, privacy/terms/support/account-deletion information, basic search metadata, favicon and sitemap.
- HTTPS, canonical `/mizyun` routing, safe redirects from legacy website URLs, custom-domain activation, verification and rollback instructions.
- Public release availability checked before adding store download links. Until verified, show honest availability text and a support contact instead of fake download buttons.

Non-goals: mobile/backend implementation or deployment, Supabase/Auth callback changes, subscriptions/pricing launch, waitlist database, health-data collection, analytics/tracking scripts, backend migration, or store submission. Do not change `goals.md` or roadmap sequencing for this package.

Interpretation of “everything”: ordinary legacy pages redirect; the landing page, its assets, legal destinations and required machine-readable files must stay reachable. Do not apply a zone-wide wildcard to API, Supabase, email or other subdomains. The bare apex `phiskel.com` is an optional compatibility follow-up after inspecting existing use; the explicit requested redirect scope is `www.phiskel.com`.

## B. Baseline and constraints

Local source inspected at `ed4a19784a66082a59558388fe29688545887441`.

Pre-existing changes at planning startup, owned by other work:

- `apps/mobile/src/features/settings/account-data-management.ts`
- `packages/adapters/supabase-mobile/src/index.ts`
- `apps/mobile/src/features/offline-cache/` (untracked)
- `docs/HETZNER_BACKEND_MIGRATION_PLAN_2026-09-17.md` (untracked)
- `docs/RESEARCH_LOG.md` and `status.md` (modified; preserve their existing entries when adding this handoff).

No dedicated marketing-site project was found in the focused local inventory. Current hosting, DNS, redirects, certificates and domain-account access are **unverified**. No request was made to phiskel.com or Pi-backed hosts. `gh issue list` failed twice with `error connecting to api.github.com`; issue deduplication/creation remains pending, not completed.

Grounding:

- [Product goals](../goals.md): “less tracking, more progress”; nutrition, training and progress together for busy gym-goers. Pricing remains a hypothesis, not website copy.
- [Business alignment](BUSINESS_ALIGNMENT.md): use stable positioning; its older implementation matrix is historical.
- [Current status](../status.md) and [release evidence](REMEDIATION_EVIDENCE_CHECKLIST.md): implemented features do not establish public release availability or universal acceptance.
- [Legal route source](../apps/api/src/modules/legal/routes.ts), [privacy source](PRIVACY_POLICY.md), [terms source](TERMS_OF_SERVICE.md), and [store disclosures](STORE_LISTING_DISCLOSURES.md): existing content and published URL dependencies require reconciliation before copying.
- Mobile brand reference: `apps/mobile/src/constants/theme.ts` and `apps/mobile/assets/images/mizyun-icon.png`. Existing screenshot candidates live under `screenshots/app-store/iphone-6.9/`; see `screenshots/app-store/README.md` for provenance and publication caveats; inspect for personal data, outdated UI and BETA marks before reuse. Never fabricate app screens or expose real health data.

Recommended implementation surface: use the available Sites building/hosting workflow in a **separate dedicated website checkout**, with a small static-content site and a minimal server redirect handler where needed. Keep the app repository as product/context documentation, not a nested Sites repository. Reuse any existing registered Site if next-session discovery finds one. No new framework is required merely for marketing content; preserve the supported starter/build approach selected by Sites.

Sites custom-domain tooling accepts a bare hostname (`www.phiskel.com`) and returns actual DNS/validation records. `/mizyun` is an application route, not part of the DNS record. This capability was inspected, but no Sites account mutation or registration was performed. Cloudflare Pages is an alternative only if the existing website already uses it or the founder selects it; do not create two competing deployments.

## C. Staged implementation

### Stage 1 — Establish ownership and a safe website target

Files: `[NEW]` website `README.md`; `[NEW]` package-specific implementation/release evidence file in the website checkout. `[MODIFY]` this plan with the resolved checkout and hosting project identity.

1. Recheck local status and the newest handoff. Use `pnpm context legal-compliance` and focused mobile context for any feature copy that needs confirmation.
2. Retry GitHub access; search for an existing website issue before creating `WEB-MIZYUN-001: Public Mizyun website and www redirects`. Use existing appropriate `priority:P2`, `status:ready`/`status:active`, and area labels; inspect labels rather than inventing an unavailable name. If unavailable, retain the local inventory entry and continue independent work.
3. Inspect DNS/hosting control-plane records without contacting the Pi: current www records, proxy state, redirects/Page Rules/Workers, TLS/CAA, existing site ownership and known legacy paths. Read existing configuration first; do not replace records blindly. Avoid public HTTP probes until configuration proves they do not reach the Pi.
4. Record an export/sanitized snapshot sufficient to restore old www DNS and redirect configuration. Inspect current use of `/privacy`, `/terms`, `/support`, `/delete-account`, `/auth/*`, `/.well-known/*`, robots and sitemap paths. Active authentication or domain-verification endpoints must not be swallowed by marketing redirects; preserve them or report the exact conflict.
5. Select the separate checkout and hosting project; use Sites portable setup on this Mac when creating a new Site. Only the coordinating owner registers, edits or publishes the Site. A helper can review copy/assets or routing independently, with no overlapping writes and no Sites operations.

Acceptance: resolved domain ownership and reversible target configuration, or a precise cutover blocker. Lack of DNS access blocks publication at the requested domain but does not block building and previewing the complete website. Do not purchase hosting or change nameservers as an incidental step.

### Stage 2 — Build the landing page and supporting content

Paths below are logical paths in the selected website checkout; map them to the chosen starter once rather than introducing a second framework.

Files: `[NEW]` `src/pages/mizyun.*`, `src/styles/mizyun.css`, `public/mizyun/assets/*`, `src/pages/mizyun/{privacy,terms,support,delete-account}.*`, `public/robots.txt`, and `public/sitemap.xml`; `[NEW/MODIFY]` supported package/build configuration and `.openai/hosting.json` through the Sites workflow. No edits to app runtime packages are expected.

Design brief:

- Mobile-first, dark charcoal and the app's verified accent colors, clear type, generous spacing and real device screens. Inspect the actual theme before selecting colors.
- Hero: Mizyun logo, “Less tracking. More progress.”, a short explanation of food, workouts and progress in one place, one verified availability/contact action, and a clear product screenshot.
- Three focused feature sections: nutrition and editable AI-assisted drafts; workouts/routines and training history; daily overview and progress trends. Show only behavior supported by the release being advertised.
- A concise Coach section explaining that suggestions and food estimates require judgment/confirmation, with user-controlled AI consent. Do not claim medical advice, exact image-derived calories, guaranteed results, clinician endorsement or full offline functionality.
- Footer: support contact, privacy, terms, account-deletion instructions and accurate company identity from the approved legal source. No made-up testimonials, user counts, pricing or “available now” claims.

Keep the site static from the visitor's perspective: no API/Supabase calls, sign-in, cookies, tracking or contact form. Use local optimized images/fonts. Contact may use the currently documented `support@mizyun.phiskel.com`; verify intended mailbox details before publication without sending test email in this task.

Publish support and legal information under `/mizyun/*` so it does not depend on the down backend. Reconcile existing legal texts against current consent/analytics/provider behavior; verify existing provider training/retention and instant-deletion claims against current evidence before reuse. These claims need reconciliation; this planning review does not establish that they are false. Preserve original approved wording unless a discrepancy is resolved from evidence. Do not change actual account deletion behavior: this page provides verified existing instructions/contact, not a newly implemented deletion service.

Accessibility: semantic headings/navigation, descriptive image alternatives, visible keyboard focus, contrast, reduced-motion support, large touch targets, and no essential text embedded only in images. Ensure navigation and legal content work without client JavaScript.

Acceptance: complete local preview at `/mizyun`, functional legal/contact links, no private user data in assets, and a feature-to-source/release checklist. If public store listings cannot be verified, use non-download availability copy and keep screenshots faithful to the actual app.

### Stage 3 — Implement deterministic routing

Files: `[NEW]` website routing module, e.g. `src/redirects.ts`; `[NEW]` `tests/redirects.test.*`; `[NEW]` `docs/domain-routing.md`. If Cloudflare rules own redirects, store their sanitized exact expressions and order here instead of duplicating behavior in two layers.

Apply ordered rules scoped to exact `www.phiskel.com`:

| Request                                                                                   | Expected behavior                                                     |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| HTTPS `/mizyun`                                                                           | 200 HTML; canonical URL exactly `https://www.phiskel.com/mizyun`      |
| HTTPS `/mizyun/`                                                                          | 301 to `/mizyun`, without a slash loop                                |
| `/` or ordinary legacy `/about`, `/anything/deep`                                         | 301 to `https://www.phiskel.com/mizyun`                               |
| `/privacy`, `/terms`, `/support`, `/delete-account`, and corresponding `/legal/*` aliases | 301 to matching `/mizyun/*` page, preserving visitor intent           |
| `/mizyun/privacy`, `/mizyun/terms`, `/mizyun/support`, `/mizyun/delete-account`           | 200 independent of backend                                            |
| `/mizyun/assets/*` and any required framework asset paths                                 | Serve asset with correct MIME type; missing asset returns 404         |
| `/robots.txt`, `/sitemap.xml`, favicon and verified `/.well-known/*` endpoints            | Serve correct resource; do not redirect into HTML                     |
| Unknown `/mizyun/*` page                                                                  | 404 with a return-to-home link; not an endless redirect or soft 404   |
| `/mizyun-old` or `/mizyunfoo`                                                             | Legacy-page redirect, not falsely treated as the `/mizyun/` namespace |
| HTTP variants                                                                             | Canonical HTTPS destination, at most two hops overall                 |
| Other hosts, including API/Supabase/mail subdomains                                       | No match and no configuration changes                                 |

Default legacy redirects discard arbitrary query strings; do not transfer credentials or adopt `next`/`url` parameters as destinations. Use fixed destination URLs. Document any deliberate campaign-query preservation separately. Browser fragments are not visible to the server; do not rely on redirects to process or sanitize auth fragments. Do not introduce an Auth bridge in this package.

Use temporary 302 redirects during cutover validation, then 301 for the intended permanent legacy redirects. Test normalization before changing codes, and account for cached permanent redirects in rollback. Do not use blanket `/* /mizyun 301`: it catches `/mizyun` and assets. Do not assume Cloudflare Pages `_redirects` semantics apply to a Sites Worker.

Acceptance: route tests prove no loop, no broken assets, explicit legal mappings, fixed targets and exact-host isolation. The deployed host must serve `/mizyun` without automatic trailing-slash rules fighting the chosen canonical URL.

### Stage 4 — Review, publish, bind www and retain rollback

Files: `[MODIFY]` website release evidence and domain-routing runbook; `[MODIFY]` `docs/STORE_LISTING_DISCLOSURES.md` marketing/support URLs after the new destinations are verified; `[MODIFY]` app-repository `status.md` with qualified results. No store-console changes in this package.

1. Obtain independent non-author review of routing and deployment configuration, while the coordinator finalizes content and rollback notes.
2. Complete the relevant local gates. Follow Sites version/publishing instructions with exact source provenance in its dedicated repository. Do not commit, package or upload unrelated app source, secrets, user data or parent-repository dirty changes.
3. Publish the website to its provider URL and verify it. The intended final website is public; prove unauthenticated/incognito access. A private preview or a provider URL alone does not fulfill the requested custom-domain result.
4. Add `www.phiskel.com` using the hosting provider's custom-domain workflow. Apply only returned DNS/validation records needed for that hostname. Check certificate activation and avoid changing apex/MX/TXT/API/Supabase records or Pi tunnels.
5. Activate ordered redirects after the target works. Check www only once it is confirmed routed to the new independent host. No backend probes while the Pi is unavailable.
6. Record deployed version/source SHA, domain status, TLS, redirect/asset response evidence and mobile-browser screenshots. Promote temporary redirects to permanent only after acceptance.
7. Rollback: disable new redirect rules first if faulty, restore the previous website version or the recorded www DNS/rule state, then verify only an allowed non-Pi endpoint. Restoring an old Pi-backed origin may restore configuration but cannot restore availability while the Pi is down; retain the known-good independent landing page where possible.

Acceptance: exact requested URL publicly serves the complete page, old ordinary www URLs redirect correctly, legal/assets work, all tests below pass, rollback state is recorded, and no backend or unrelated-domain configuration changed.

## D. Verification and evidence

For this planning session: targeted Markdown formatting, `git diff --check`, and `pnpm navigation:check`; no builds, backend checks or runtime tests are justified. Record pre-existing failures separately.

Next implementation session:

- Run the website's actual declared build and test scripts; route regressions must exercise the real handler/configuration rather than duplicate a decision table disconnected from deployment.
- Test routing locally across the table, including query strings, trailing slashes, percent-encoded/normalized paths, nested paths, missing assets, HEAD and GET, and ignored non-www hosts. Assert no open redirects, no canonical redirect loop, and no HTML returned as CSS/JS/images.
- Browser verification at 375 px, 768 px and 1440 px, plus physical iPhone Safari and Android Chrome when available. Check overflow, keyboard navigation, image loading, reduced motion, link behavior and incognito/public access. Missing physical-browser evidence is reported explicitly; do not imply native app acceptance.
- Inspect network requests to prove no Pi/API/Supabase dependency and no unintended trackers; verify the site remains fully readable with JavaScript disabled.
- After www cutover, use bounded HTTP requests with a maximum redirect count to capture status/Location/final URL/content type. Test only confirmed independent website endpoints. Confirm HTTPS and certificate validity, canonical metadata and sitemap URLs.
- In the Mizyun repository run `pnpm navigation:check`, `pnpm format:check`, and full `pnpm check` before any app-repository commit as required by AGENTS. Format only session-owned files. Do not run provider integration tests or database-reset suites. If unrelated changes fail a check, report the exact blocker instead of fixing or resetting another session's work.
- A website-only deployment does not establish Dev deployment, device acceptance or Production release of the mobile app/backend. Do not close existing Q1–Q9/R8 gates for website work.

Definition of done: complete approved content and assets; working public canonical URL; accepted redirect matrix; hosting independent of Pi; recorded source/deployment evidence and rollback; matching GitHub issue updated when reachable. A DNS/account blocker leaves only publication blocked and must not be reported as a completed website launch.

### Planning-session evidence (2026-09-17)

- Read-only helper audited source claims, screenshot privacy, legal dependencies and Auth callback scope; findings incorporated. Its final plan review found no blocking contradictions; the suggested legal-claim wording correction was incorporated.
- Targeted Prettier check passed for this plan, research log and status. `git -c core.fsmonitor=false diff --check` passed.
- `pnpm navigation:check`: internal links and architectural boundaries passed; overall failure was the pre-existing untracked `apps/mobile/src/features/offline-cache` coverage gap in the feature map. No unrelated fix attempted.
- No full `pnpm check`, app/website build, runtime test, remote probe, domain mutation or publication was performed for this documentation-only package.

## E. Next-session prompt

> Implement `WEB-MIZYUN-001` using `docs/MIZYUN_WEBSITE_IMPLEMENTATION_PLAN_2026-09-17.md`. First run `git -c core.fsmonitor=false status --short`, read root AGENTS.md, the latest status.md handoff and docs/START_HERE.md, then resolve the current www hosting/DNS ownership from control-plane data without probing the Pi. The Raspberry Pi is temporarily down: no Pi SSH, Tailscale checks, public backend probes or deployments until I explicitly confirm it is back. Build a public Mizyun marketing website at https://www.phiskel.com/mizyun, redirect ordinary legacy www paths to it, preserve assets/legal destinations and any verified functional endpoints, and leave all API/Supabase/email subdomains untouched. Use a separate Sites checkout unless an existing website project should be reused; the coordinator alone owns Site operations, DNS, GitHub tracking and continuity files. Delegate a bounded copy/assets or redirect review, require independent deployment review, and do not use local Qwen. Preserve all pre-existing mobile/offline-cache and documentation work. Finish the complete preview, tests and review before custom-domain cutover. Do not invent store links, availability, health claims, pricing or testimonials. If DNS/account access blocks launch, deliver the complete tested site with the exact remaining action. Record what is implemented, tested and publicly published separately.
