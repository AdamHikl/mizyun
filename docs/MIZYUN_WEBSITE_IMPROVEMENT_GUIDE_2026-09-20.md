# Mizyun website improvement guide

Date: 2026-09-20. Work package: `WEB-MIZYUN-002` (follow-up to website issue #103). Deliverable: review and next-session implementation guide only.

## A. Assessment and scope

The live website has a good visual foundation: restrained dark colors, clear typography, a memorable headline and simple navigation. Keep that identity. Its main weakness is product communication: it currently feels like an introductory holding page because visitors cannot see the real app and cannot tell clearly how to get it.

The highest-value improvement is a real product demonstration plus a clearer next action. A redesign, extra animation, testimonials, pricing table or additional backend is unnecessary.

Reviewed live: [landing page](https://www.phiskel.com/mizyun), [privacy](https://www.phiskel.com/mizyun/privacy), [terms](https://www.phiskel.com/mizyun/terms), [support](https://www.phiskel.com/mizyun/support), and [deletion instructions](https://www.phiskel.com/mizyun/delete-account). Desktop viewport was 1280×720; responsive browser inspection used 375×812. At 375 px the landing document width and scroll width were both 375 px, with no horizontal overflow observed. This is browser evidence, not physical-phone acceptance or a complete accessibility audit.

In scope: copy, real approved app imagery, mobile information density, accessibility semantics, search/social metadata and narrowly related asset routing/tests. No live changes were made during review. No backend, Hetzner, Pi, DNS, Auth, account or store changes belong to this improvement package.

## B. Baseline and evidence limits

- Website checkout: `/Users/adam/Documents/mizyun-website`, clean at `1336d28f470417afc89b1bad498b9ca3ae820da1`. Current README identifies a dedicated Cloudflare Worker and `wrangler.cloudflare.jsonc`. Reuse this checkout and deployment system; do not initialize another Site or revert to an older private Sites deployment procedure.
- App repository: `/Users/adam/Documents/mizyun`, HEAD `5c79721090a971f9e92e8ab68304bb8d9b9aa3b2`. Pre-existing changes include legal/API/mobile consent/account-data files, backup tooling, package.json, research/status documents and store captures. Preserve all of them. Only add this guide and small research/status entries here.
- Live page content matches the inspected source for the reviewed components; the exact currently deployed SHA was not independently verified.
- The live landing page contains only the logo image, a decorative Food/Training/Progress panel, email actions and no store buttons. The logo loaded. The four supporting pages rendered through their navigation links; no email was sent.
- Live landing metadata includes title, description and the correct canonical URL. No Open Graph or Twitter metadata was present in the inspected DOM.
- Historical status/release notes still describe a private candidate without a custom domain. That is superseded for website reachability by this successful live review, but this review does not verify every retired host or alternate origin.
- No Lighthouse run, field Core Web Vitals, delivered asset-byte measurement, screen-reader session, 200% zoom test, physical-device test, redirect-status audit or legal-compliance certification was performed. Do not report these as passed or invent performance scores.
- A helper independently reviewed current source. GitHub issue #103 retrieval failed twice with `error connecting to api.github.com`; creating/deduplicating the follow-up issue remains pending.

## C. Improvements in priority order

### 1. High impact — Show the actual app

**Observed:** the hero's large tilted panel only repeats “Food,” “Training” and “Progress.” At phone width it occupies much of the next screen without demonstrating a feature. Feature sections contain text only.

**Change:** replace that panel with one clear, approved dashboard capture. Add two supporting captures next to the meal and workout explanations. Prefer a simple static presentation to an auto-playing carousel. Keep the current headline and dark visual style; reduce oversized decorative space on small screens.

Use real demo-account captures, not generated fictional UI. Remove the existing hero wrapper’s `aria-hidden="true"` when it contains meaningful screenshots, so descriptive image alternatives are exposed to assistive technology. Existing capture directories are candidates, not automatically approved public assets. Inspect for names, emails, personal health values, private conversations, notifications, BETA labels and outdated UI. If suitable captures are unavailable, complete copy/accessibility work first and leave imagery explicitly pending. Do not reinstate the previously removed unapproved workout image.

Files in website checkout:

- `[MODIFY]` `app/mizyun/page.tsx`, `app/globals.css`.
- `[NEW]` approved optimized captures under `public/mizyun/assets/` and a short asset provenance/approval record.
- `[MODIFY]` `proxy.ts` and `tests/routes.test.mjs`.

**Critical integration detail:** `proxy.ts` currently allows only `/mizyun/assets/mizyun-icon.png`. Add each new image to the allowed asset set; otherwise the route handler returns 404. Do not remove exact-host isolation or weaken retired-service handling to make images load. Verify direct image responses as well as any image-optimizer URLs.

Acceptance: a visitor sees an identifiable app screen in the initial desktop view and within roughly the first phone viewport plus one short scroll; screenshots remain legible, do not expose personal data, have appropriate alt text and reserved dimensions, and load with correct MIME types. A missing asset still returns 404.

### 2. High impact — Clarify availability and the primary action

**Observed:** “Ask about Mizyun” opens email. The adjacent text says public download availability “is being confirmed” and promises verified links later. This exposes internal preparation rather than giving a visitor a useful status.

Choose copy after verifying current release/access status:

| Verified status                         | Primary action                                           | Supporting text                                                                        |
| --------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Public app listing works                | Official store link(s)                                   | State supported platforms accurately                                                   |
| Beta applications are actively accepted | “Ask about beta access” using the existing email contact | Explain that access is limited, without guaranteeing admission                         |
| Access is not currently offered         | “See how Mizyun works” linking to the product section    | “Mizyun is in development. Contact us with questions.” only if that status is accurate |

Do not invent a launch date, waitlist, available store release or automatic beta approval. A contact link remains a reasonable secondary action. Show the plain support email on the support page (already present) so visitors can copy it without a configured mail client. The bottom call to action should reinforce the same access decision, rather than introduce another generic support prompt.

Files: `[MODIFY]` `app/mizyun/page.tsx`; support copy only if needed in `app/mizyun/support/page.tsx`.

Acceptance: visitors can answer “Can I use this today, and what happens when I click?” All actions work; no placeholder badges or unsupported status claims.

### 3. High impact — Make the copy concrete and easier to scan

Keep **“Less tracking. More progress.”** Add a direct explanation of what Mizyun is. Suggested copy, subject to matching the release shown:

| Position         | Proposed wording                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Hero description | “Track meals, log workouts, and see your progress in one fitness app.”                                                     |
| Nutrition title  | “Review your meal. Then log it.”                                                                                           |
| Nutrition body   | “Log food manually or start with an AI-assisted estimate. Adjust the details before saving.”                               |
| Training title   | “Keep your routines and sets together.”                                                                                    |
| Training body    | “Build a routine, record sets and reps, and review your workout history.”                                                  |
| Progress title   | “See how your days add up.”                                                                                                |
| Progress body    | “Review your nutrition and training over time, alongside your daily overview.”                                             |
| Coach title      | “Ask about the records you’ve logged.”                                                                                     |
| Coach body       | “Use optional AI coaching to explore your logged meals, workouts and goals. Review its suggestions; AI can make mistakes.” |

The current nutrition title, “Meals without the guesswork becoming the record,” requires unnecessary interpretation. The Coach section currently leads with limitations but barely explains its value. Give one grounded benefit first, then retain concise consent/advisory wording and a privacy link. Verify Coach grounding against current app behavior before using the proposed example. Do not add medical outcomes or claims about provider training, perfect privacy, exact calories, complete offline access, or instant deletion.

Suggested page sequence: hero and real dashboard → meal/workout/progress evidence → concise Coach explanation and control/privacy link → availability/contact action → existing legal footer. Reuse sections; do not lengthen the page with repetitive slogans or a generic FAQ.

Files: `[MODIFY]` `app/mizyun/page.tsx`, with small layout adjustments in `app/globals.css`.

Acceptance: after a brief read, someone unfamiliar with Mizyun can identify its purpose, core tasks and next action. Feature claims correspond to actual screens; no pricing or release promises are invented.

### 4. Medium impact — Correct landmarks and tighten mobile interaction

**Confirmed source/live structure:** global header and footer sit inside `<main>` in the homepage and `app/mizyun/_components/InfoPage.tsx`. Their implicit banner/contentinfo landmarks are lost, and the `#main` skip destination precedes the header navigation.

Use a neutral outer wrapper with sibling `<header>`, `<main id="main">` and `<footer>`. Keep one main region. Put the skip destination at the actual page content. Preserve the existing visible focus styling, skip-link visibility behavior and reduced-motion support. Extract a shared shell only if it simplifies the two existing layouts.

Files: `[MODIFY]` `app/mizyun/page.tsx`, `app/mizyun/_components/InfoPage.tsx`, `app/globals.css`; `[MODIFY]` `app/layout.tsx` only if the shared shell requires it.

At 375 px the layout fits, but the decorative hero uses substantial space; solve this through useful imagery and compact vertical spacing. Test 320 px, tablet, desktop and 200% text zoom. Prefer 44 px touch areas for navigation/footer links where practical; that is a usability target, not a claim that current links fail WCAG. WCAG 2.2 AA allows 24×24 CSS px targets or specified exceptions such as sufficient spacing. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Acceptance: keyboard skip lands beyond navigation, focus stays visible, screen-reader landmarks expose header/main/footer, no horizontal overflow or clipped legal headings, links remain distinguishable, and measured text contrast meets the applicable 4.5:1 normal-text / 3:1 large-text threshold. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

### 5. Medium impact — Improve shared-link previews and metadata

**Observed:** the canonical URL exists; search/social metadata is otherwise minimal. Keep what works and add:

- A descriptive home title, e.g. “Mizyun — Meal, Workout & Progress Tracking,” while retaining the slogan on the page.
- A concise factual description aligned with the revised hero.
- Open Graph title, description, URL, site name and a deliberate 1200×630 share image; Twitter large-image card metadata.
- Unique descriptions for support, privacy, terms and deletion pages, retaining their existing titles/canonical URLs.

Use the logo, slogan and approved product imagery in the share image. No fabricated ratings, offers or testimonials. A static image is sufficient. Ensure its route is admitted by `proxy.ts`; do not rely on a local preview to prove public image reachability.

Files: `[MODIFY]` `app/layout.tsx`, `app/mizyun/page.tsx`, metadata in `app/mizyun/{privacy,terms,support,delete-account}/page.tsx`; `[NEW]` `public/mizyun/assets/share-mizyun.jpg`; `[MODIFY]` asset allowlist/tests.

Acceptance: rendered HTML has correct absolute canonical/social URLs; the image is publicly retrievable; page-specific descriptions are distinct; no duplicate/conflicting tags. Verify actual Vinext output rather than assuming complete parity with Next.js. [Next.js metadata guidance](https://nextjs.org/docs/app/getting-started/metadata-and-og-images), [Google title guidance](https://developers.google.com/search/docs/appearance/title-link).

### 6. Verification first — Performance and operational housekeeping

The source logo is approximately 755 KB at 1024×1024 while displayed at 42×42. The live DOM uses an image-optimizer URL, so source size alone does not prove that visitors download 755 KB. Measure transferred bytes before calling this a live performance defect. Optimize the delivered logo if needed; give new screenshots responsive sizes, modern formats, explicit dimensions and below-fold lazy loading. Do not lazy-load the primary hero/LCP image.

Measure before/after using repeatable mobile lab settings; target LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1 for good field experience at the 75th percentile. Lab checks are diagnostic and do not establish field INP or real-user pass rates. [Web Vitals guidance](https://web.dev/articles/vitals).

`docs/release-evidence.md` in the website checkout still contains private-Sites/no-custom-domain instructions, whereas its README describes direct Cloudflare deployment. Resolve that drift against current deployment evidence before a future publish. Preserve the current three-host retirement behavior and temporary redirect policy; changing 302 to 301 is a separate acceptance decision, not a visual polish task. Never restore the retired Phiskel app as a routine rollback.

Files: `[MODIFY]` website `docs/release-evidence.md` and `docs/domain-routing.md` only as evidence requires. No framework migration, dependency purge or analytics installation is needed for this review.

## D. Execution and verification plan

1. Recheck both working trees and the current website instructions. Resolve deployed version/checkout identity read-only. Retry issue #103; deduplicate and create a linked `WEB-MIZYUN-002` improvement issue with existing priority/status/area labels when GitHub is reachable.
2. Verify release availability and select approved demo captures. Implement copy and semantic fixes while assets are prepared. Delegate a bounded independent copy/accessibility review; only the coordinator manages continuity and deployment.
3. Integrate captures and share image with asset allowlist updates and real response tests. Preserve exact-host rules, retired-service 410 responses, API/Supabase/email separation, and no runtime backend dependency.
4. Start the existing local website preview with `npm run dev`. `npm test` needs the local origin at `http://localhost:5173` (see website README); do not run route tests against Production by overriding `SITE_TEST_ORIGIN`. Run `npm test`, `npm run lint`, `npm run build`, targeted formatting and `git diff --check`. Never invoke `npm run deploy:cloudflare` as a build-only check.
5. Check all five public page layouts locally, at 320/375/768/1280 px and 200% text zoom; keyboard/skip/landmark behavior; image loading and metadata; JavaScript-disabled readability; and no new backend/tracker requests. Capture before/after views at consistent dimensions. Obtain physical iPhone Safari and Android Chrome evidence when available, labeling browser emulation separately.
6. In the app repository, format only guide/research/status additions and run `pnpm navigation:check`; use `pnpm format:check` and full `pnpm check` before any app-repository commit as required. Report unrelated failures without taking ownership of them. No app build is needed merely to write this guide.
7. Independently review any `proxy.ts` or deployment-related changes before publishing. A future implementation/publishing instruction may authorize the existing website release workflow; this review request does not authorize publication. Record exact source/deployed SHAs, screenshots, commands and unresolved limitations. Keep website publication distinct from mobile/backend Production release.

Exit criteria: approved product screens, clear truthful primary action, easier feature copy, working landmarks/skip link, accepted mobile layout, complete search/share metadata, correctly served new assets, passing relevant route/build checks and reviewed release evidence. If screenshots or release status remain unresolved, deliver the completed independent improvements and state that dependency explicitly.

## Review-session verification

Targeted Prettier and `git diff --check` passed. `pnpm navigation:check` passed with 0 errors and 14 pre-existing review-date warnings. Independent final guide review found no material errors; its hero accessibility and lint-check suggestions were incorporated. No website tests/build or full app `pnpm check` were run for this documentation-only review.

## E. Next-session prompt

> Implement `WEB-MIZYUN-002` from `/Users/adam/Documents/mizyun/docs/MIZYUN_WEBSITE_IMPROVEMENT_GUIDE_2026-09-20.md`. First inspect Git state in the app and `/Users/adam/Documents/mizyun-website` checkouts and read current instructions/handoffs. Keep the existing website style and current Cloudflare deployment setup. Prioritize approved real app screenshots, clear availability/CTA, direct feature copy, semantic header/main/footer and share metadata. Update the explicit asset allowlist and real route tests with every new image. Do not revive removed private captures or invent store availability. Preserve unrelated legal/mobile/backup work and all retired-host/service routing. Delegate a bounded independent review; coordinator owns shared docs and deployment. No Pi, Hetzner, backend, DNS, store or Auth changes. Finish local preview, tests/build and review, recording remaining asset/access blockers. Publish only if this session also authorizes publication.
