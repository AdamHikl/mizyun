# Mizyun go-to-market plan: differentiation, pricing and the first 1,000 users

> Proposed 2026-10-26 (Claude Code, planning session; no code, config or release change). Founder decision pending. This document proposes product direction and sequencing; `goals.md` and `plan.md` change only once Adam adopts it. Numbers marked _est._ are planning estimates, not measurements. External figures carry a source in Section 10.

## 1. Diagnosis in five sentences

1. Mizyun is barely findable: the Google Play listing is live (updated 2026-10-10, "1+ downloads", a generic description that never mentions climbing, privacy or the coach's honesty) and iOS is on an external TestFlight link, but the website's only call to action is "Ask about access" by email and the full App Store release is still open (#319). Corrected 2026-10-26 after Adam supplied both links.
2. Nobody can pay: `profiles.plan_tier` exists server-side and Beta Pro Pass requests work, but no App Store or Google Play purchase sets that tier.
3. The product is already broader than Hevy, Strava or Cal AI (meals, lifting, running, bouldering, weight, photos, coach, recipes, stretch, Health import, community), while the alpha register still shows 0 of 7 founder days and 0 design partners enrolled (Adam reports more than two months of daily founder use on 2026-10-26; the register was never updated).
4. The current positioning, "AI Fitness & Nutrition Tracker, private all-in-one", is the most crowded shelf in the category and is not a reason to switch.
5. The next 90 days should be spent on distribution and one sharp wedge, not on more features: publish, bill, pick a beachhead, recruit by hand, measure activation and week-four retention.

## 2. Where Mizyun stands (facts from the repository, 2026-10-26)

| Area                                       | State                                                                                                                                                                                                                                       | Consequence                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Public availability                        | Google Play live (`com.mizyun.app`, developer Itinn, PEGI 3, updated 2026-10-10, "1+ downloads"); iOS via external TestFlight `https://testflight.apple.com/join/BxFNXxS3`; App Store release open (#319); website says "Ask about access". | Step zero is pointing every surface at those two links and finishing the App Store release.                                    |
| Billing                                    | Server-owned `free`/`paid` tier (ADR-0029 rule: only verified entitlement may set `paid`); Beta Pro Pass request table; no StoreKit/Play Billing or RevenueCat dependency.                                                                  | One bounded engineering package stands between Mizyun and its first euro.                                                      |
| Free vs paid AI caps                       | Free: 10k tokens/day, 5 photo drafts/day. Paid: 100k tokens/day, 100 photo drafts/day (`packages/config/src/ai-tier.ts`).                                                                                                                   | A worst-case paid user can consume about 3M tokens/month. Model it against the subscription price before launch (Section 5.4). |
| Backlog                                    | 173 open issues, 24 at P1, 51 bugs. #290 (live workout loses sets after locking the phone) is a trust-breaker for lifters.                                                                                                                  | Freeze feature breadth; fix only what users hit in the first session.                                                          |
| Evidence                                   | No activation, retention or willingness-to-pay data from anyone outside friends.                                                                                                                                                            | Every claim in the pitch is still a hypothesis.                                                                                |
| Assets already built that competitors lack | Bouldering sessions with grades; coach answers grounded in confirmed records; editable memory; local-first photos; EU self-hosted backend; full export and staged deletion; forgiving weekly goal with no streak reset.                     | These are the raw material for the wedge in Section 3.                                                                         |

## 3. Differentiation: what to own

Do not try to out-Strava Strava (social cardio), out-Hevy Hevy (fast lifting log with a social loop) or out-Cal-AI Cal AI (photo calories, creator-driven). Each wins at one thing with a team and a budget. Mizyun wins by being the one record for a specific person whom none of them serves well, plus a coach that reasons across that record and tells the truth about uncertainty.

### 3.1 Beachhead: climbers who also lift and watch their weight

Why this person:

- Climbers care about all four things Mizyun already connects: bouldering sessions, strength training, body weight and nutrition. Strength-to-weight is the sport's central variable. No mainstream tracker combines them; climbing apps log sends, Hevy logs lifts, Cal AI logs calories.
- The community is dense, physical and reachable: boulder gyms are social hubs, r/climbharder and r/bouldering are active and less saturated with app spam than r/Fitness. Bratislava has several boulder gyms (K2, Vertigo, Spot, Block Dock listed by secondary sources; verify locally).
- Adam can be a credible member of the community rather than a marketer.
- It is a beachhead inside the stated target (an intermediate trainee who tracks food, training and body), not a pivot.

Alternative if interviews reject it: intermediate lifters who already use Hevy or Strong and want nutrition and a coach beside their log. Same playbook, different communities, with "import your Hevy/Strong history" as the hook. Choose one within two weeks; do not run both.

### 3.2 The honest coach

Cal AI's recurring complaint is accuracy presented as fact. MyFitnessPal's coach reasons over a database-first log. Mizyun already does the rarer thing: estimates are drafts with ranges, the user confirms, and the coach's answer cites the records it used and says what is missing. Make this visible in every demo and screenshot: "Here is the estimate, here is why, you decide."

### 3.3 Kind tracking

The engagement research (`docs/research/TRACKING_ENGAGEMENT_PSYCHOLOGY_2026-10-17.md`) gives a defensible, evidence-backed stance competitors do not take: no streak resets, a forgiving weekly "X of Y days" goal, celebrate the log not the number, hide numbers on request, one notification a day at most. This is a positioning line, not a feature: _tracking that does not become a second job and does not guilt you_.

### 3.4 Your data stays yours

EU servers you operate, photos on the device by default, full export, staged deletion, no ads, no data sale, AI providers named before use. Research found no evidence that privacy alone sells; it is the trust gate that lets a stranger install a health app from an unknown Slovak founder, and the ticket into privacy communities. Say it on the page, do not lead with it.

### 3.5 Two promises competitors broke

Strava and MyFitnessPal moved shipped free features behind paywalls in the last year; Apple removed Cal AI over billing design. Two public promises cost nothing and are rare: **features shipped free stay free**, and **the price is shown before any question is asked, cancelling is one tap, early subscribers keep their price**. Put both on the website and in the Store description.

### 3.6 One-line positioning to test

> **Mizyun: your climbing, lifting, food and weight in one private record, with a coach that only uses what you confirmed.**

Replace "climbing" with "training" if the lifter alternative wins.

### 3.7 The only four things worth building in the next 90 days

| #   | Build                                                                                                                                                                                                                                                                                                   | Why                                                                                                                    | Size (est.)            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | **Store billing**: Pro subscription on iOS and Android, entitlement verified server-side, sets `plan_tier = paid`, restores purchases, downgrades on expiry. RevenueCat or native StoreKit 2 + Play Billing; the entitlement webhook/receipt check lives in `apps/api`, never a client flag (ADR-0029). | Nothing else produces revenue.                                                                                         | 1–2 weeks incl. review |
| 2   | **Import your history**: Hevy and Strong CSV, Strava's own account export (ZIP), and a generic workout CSV. Preview, map exercises, confirm. (Strava's API policy forbids AI and aggregation uses, so import the user's own export file, never the API.)                                                | Switching cost is the main objection from anyone with a year of logs. Hevy grew partly by importing Strong data.       | 1–2 weeks              |
| 3   | **Shareable session card**: an image of a bouldering session or workout (grades, sends, volume, PR) with no food, weight or health data, exported to Instagram/WhatsApp from the app. Opt-in, previewed.                                                                                                | Word of mouth needs an artifact. Community already has preview-before-share rules; reuse them.                         | 3–5 days               |
| 4   | **Two-minute first value + activation telemetry**: new users reach a logged boulder session or workout and one coach answer within two minutes; consent-respecting events for onboarding done, first record, day-7 return, day-28 return.                                                               | Habit Pixel sat at $28 MRR for months because onboarding scared users off; you cannot improve what you do not measure. | 1 week                 |

Everything else (new AI features, wearables, community expansions, recipes polish) waits until 100 external users have activated. Record new ideas as issues labelled `status:blocked` with the note "after 100 activated users".

### 3.8 What to stop

- Stop adding AI surfaces. Each one costs provider budget, consent copy, Store disclosures and review time, and none of them is why someone installs.
- Stop widening Community before ten strangers use the private app weekly; `goals.md` already says this and the backlog drifted.
- Stop treating device-acceptance backlogs as the product. The audit of 173 issues is a maintenance plan, not a growth plan.

## 4. Who the competitors are (checked 2026-10-26)

Prices are US App Store unless marked SK (Slovak App Store). Complaint evidence comes from store-review mining and press; Reddit could not be read by the research tools. Items marked (unverified) rest on one weak or conflicting source.

| App              | Known for                                                                                                                       | Price                                                                                                | Recurring complaints 2025–26                                                                                                                                                                                                                                  | Privacy posture                                                                                                                 | Where Mizyun is different                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strava**       | Segments, kudos, the cardio social loop; 150M+ registered users (company claim); confidential IPO filing Jan 2026               | $11.99/mo, $79.99/yr; SK €7.99/mo, €49.99/yr; 30-day trial                                           | Of 2,407 reviews Oct 2025–Oct 2026: crashes 26%, pricing 22%, missing features 15%; Year in Sport went subscriber-only Dec 2025; steep 2023 price rises                                                                                                       | Activities public by default; ad networks; de-identified data licensing; AI training with opt-out; non-US data stored in the US | Not a wedge competitor. A source of run history through the user's own account export (its API policy forbids AI and aggregation uses)                                                       |
| **Hevy**         | Free social lifting log; 17M+ users (company claim); bootstrapped, organic, Apple "Apps We Love" 2020, Play top five Jan 2022   | $2.99/mo, $23.99/yr, $74.99 lifetime; SK ≈€3.49/mo, €26.49/yr, €89.99 lifetime                       | Free caps: 4 routines, 7 custom exercises, 3 months of stats; no Garmin sync (application rejected)                                                                                                                                                           | Spanish company; Adjust and Google Analytics for ad retargeting; silent on data sale and AI training                            | No nutrition, no body-weight guidance, no bouldering. Mizyun: fuel, training and body in one record, a coach across them, private by default, Hevy CSV import                                |
| **Cal AI**       | Photo calories; 15M+ downloads, $30M+ revenue, 7 staff; acquired by MyFitnessPal (closed Dec 2025); grew on paid micro-creators | Free tier has no photo scan; 3-day trial; $29.99/yr most common; SK €2.99–34.99                      | Conference abstract: underestimated meal energy by about 345 kcal on average, the worst of four apps that all ran about 33% low; Apple pulled it Apr 2026 over in-app-purchase bypass and deceptive billing; alleged 3.2M-record breach Mar 2026 (unverified) | Targeted ads, cross-device tracking, US-based, hosting undisclosed                                                              | Estimates with ranges and confirmation, deterministic targets, training in the same record, EU, no ads. "Speed over accuracy" is their buyer, per MyFitnessPal's CEO; honesty is the opening |
| **MacroFactor**  | Research-credible adaptive nutrition from Stronger By Science; 600k users Sep 2026 built on the founders' audience              | No free tier; $11.99/mo, $71.99/yr; Workouts bundle $89.99/yr                                        | Subscribe loop; price shown only after a long questionnaire                                                                                                                                                                                                   | Health data linked to analytics per its App Store label                                                                         | The premium anchor for serious trainees. Mizyun: free manual tier, price up front, climbing and lifting beside nutrition                                                                     |
| **MyFitnessPal** | Food database, barcode, Meal Scan, Nutrition Coach; 280M registered (unverified)                                                | $19.99/mo, $79.99/yr; free tier carries ads; May 2026 moved scan-a-meal and recipe import to Premium | April 2026 "Today" redesign: more taps, hidden diary, cancellations and refund requests                                                                                                                                                                       | Targeted ads, US-based; 2018 breach of 150M accounts (secondary)                                                                | Do not compete on database size. Compete on two-tap logging that never regresses and on honesty                                                                                              |
| **Fitbod**       | Generated gym workouts; 300k+ paid subscribers Dec 2022                                                                         | No free tier; 7-day trial; $15.99/mo, $95.99/yr                                                      | Price hike; little explanation behind recommendations                                                                                                                                                                                                         | Health data linked to you; usage data used for tracking per its label                                                           | Proof that about $96/yr is payable for training guidance when the value is clear; the coach must explain itself                                                                              |

### 4.1 Openings the complaints point to

1. **Price below the stack.** Hevy + Cal AI + Strava costs about $134/yr together. A single record at €49.99/yr undercuts the stack and matches Strava's Slovak price.
2. **Honest AI nutrition.** Every photo app tested ran about a third low. Draft-then-confirm with visible ranges and deterministic targets is the answer, and it is already built.
3. **Verifiable privacy.** Competitors run ad networks, process in the US or default activities to public. Back "EU servers, no ads, no sale, export and delete" with the App Store label and a one-page data sheet on the website.
4. **Billing trust.** Apple removed Cal AI over billing design; MacroFactor and MyFitnessPal draw subscribe-loop and refund complaints. Show the price before any onboarding question, cancel in one tap, grandfather early subscribers.
5. **A free-tier pledge.** Strava (Dec 2025) and MyFitnessPal (May 2026) moved free features behind paywalls. "Features shipped free stay free" is a promise Mizyun can keep because its free tier is manual logging.
6. **Fuel plus training plus climbing in one.** Hevy has no food, MacroFactor sells two apps, Strava has neither strength nor food, and bouldering lives in small single-purpose apps. The research found this gap unfilled.
7. **Never break fast logging.** MyFitnessPal's redesign backlash came from extra taps and a hidden diary. Treat taps-to-log as a release gate.
8. **Build on Apple Health and Health Connect, not Garmin.** Garmin rejected Hevy's API application and reportedly paused new applications in 2026 (unverified).

## 5. Business model

### 5.1 Free vs Pro boundary

| Free (forever, no card)                                                                    | Pro                                                                                                         |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Unlimited manual meals, workouts, bouldering, runs, weight, measurements, photos on device | Coach conversations beyond the free daily budget                                                            |
| 5 AI photo drafts/day, small coach budget (already in `ai-tier.ts`)                        | 100 photo drafts/day, larger coach budget                                                                   |
| Weekly review, trends, export, deletion                                                    | Advanced nutrients (ADR-0029), recipes and cooking assistant, evening stretch, Health exports, photo backup |
| Import history                                                                             | Priority on new coach capabilities                                                                          |

Rule: the free tier must be good enough that a climber keeps logging without paying. Retention comes from the record; revenue comes from the coach.

### 5.2 Price

Benchmarks (RevenueCat State of Subscription Apps 2026, Health & Fitness, calendar-2025 data): median $9.99/month, $39.94/year; download-to-paid median 2.9%; trial-to-paid median 37.7%; European apps price 29–39% above North America; AI apps earn 41% more per payer but churn 30% faster; trials of 17–32 days convert at 42.5% versus 25.5% for trials under four days. Slovak purchasing power is about 75% of the EU average (Eurostat via IZ), so expect more price sensitivity than EU medians.

Recommendation, replacing the USD 15–20 hypothesis in `goals.md`:

| Plan                   | Price (EUR, VAT incl.)                                                                                         | Notes                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pro monthly            | 7.99                                                                                                           | Anchors against MacroFactor; above Hevy because AI costs real money                                                                                       |
| Pro yearly             | 49.99 (≈4.17/mo)                                                                                               | Default selection; annual is where fitness LTV lives. Equals Strava's Slovak yearly price and sits below the Hevy + Cal AI + Strava stack (about $134/yr) |
| Founding member yearly | 34.99, first 100 payers, price locked while subscribed                                                         | Reward for early risk; also the pitch for hand-recruited users                                                                                            |
| Trial                  | 14 days through the Store, no hard paywall at install, price shown before onboarding questions, one-tap cancel | Longer trials convert better; the free tier remains usable after; billing honesty is a differentiator (Section 4.1)                                       |
| Lifetime               | Not at launch                                                                                                  | AI cost is recurring; Hevy can because its marginal cost is near zero. A capped-AI lifetime plan can be tested later if founding members ask for it       |

Keep USD 15–20 as a later "Coach+" tier hypothesis with higher caps, tested only once paying users exist. Use Apple and Google price tiers; verify Slovak VAT handling in both consoles.

### 5.3 Revenue arithmetic (so expectations are honest)

| Installs | Payers at 2.9% (median) | Payers at 8% (hand-recruited, est.) | Yearly revenue at €49.99 |
| -------- | ----------------------- | ----------------------------------- | ------------------------ |
| 100      | 3                       | 8                                   | €150–400                 |
| 1,000    | 29                      | 80                                  | €1,450–4,000             |
| 10,000   | 290                     | 800                                 | €14,500–40,000           |

Store fees (15% under the small-business programmes) and AI cost come off these. 1,000 users is a learning milestone, not an income. The first revenue goal that matters: **10 paying founding members by the InVenture finale (late January 2027)**, which proves strangers pay; 100 payers is the mid-2027 target if one channel repeats.

### 5.4 Unit-economics guard

Before enabling Pro purchases, compute the worst case: paid cap 100k tokens/day × 30 = 3M tokens/month per user, split by feature across Anthropic and Gemini at current list prices. If the worst case exceeds the monthly price, lower the paid daily cap (40k/day is likely plenty for a coach conversation plus drafts) or route more calls to cheaper models. Record median and p95 tokens per paying user monthly in the evidence register; cancel or re-price if p95 cost exceeds 30% of revenue.

### 5.5 Later revenue levers (hypotheses, not now)

- Coach/trainer portal (assessed in `docs/DIFFERENTIATION_IMPLEMENTATION_PLANS_2026-10-12.md`): one coach brings ten clients; validate with 3–5 coaches after 100 users.
- Gym or climbing-gym bundles: a gym offers Pro to members at a group rate; the gym gets a shareable monthly "sessions logged" number. Only after one gym pilot works.

## 6. The first 100 users: a six-week plan

Targets are provisional thresholds, in the spirit of the InVenture plan: 20 invited → at least 14 activated within seven days → at least 8 returning in week four, per cohort. Define activation as onboarding plus a first confirmed record within seven days; retained-week-four as a core action on days 22–28.

### Week 0 (this week): make it downloadable

1. Google Play is already live and iOS is on the external TestFlight link. Finish the App Store release (#319: Transporter upload, App Privacy labels) so iOS users get a Store link rather than a beta prompt; until then recruit iOS testers through TestFlight.
2. Replace "Ask about access" on phiskel.com/mizyun with the Play badge and the TestFlight link, and one headline in the Section 3.6 wording. Rewrite the Play short and full description around the wedge (climbing, lifting, food, weight, honest coach, EU privacy); the current text is generic.
3. Record the founder usage in `docs/alpha/RESULTS.md` (Adam reports more than two months of daily use) and list the frictions still felt. Fix #290 first.
4. Set the Store subtitle and first three screenshots to the wedge: session with grades → workout → coach answer citing both.

### Weeks 1–2: twenty people by hand

- Write a two-line invitation ("I built a private app that keeps climbing, lifting, food and weight in one place. Would you try it for two weeks and tell me what is annoying?") and send it personally to 40 people: climbing partners, gym acquaintances, university sports club members, InVenture cohort members who train. Target 20 installs.
- Each person gets Founding Member pricing when billing ships and a short interview at day 3 and day 14 using the prompts in `docs/alpha/DESIGN_PARTNER_GUIDE.md`. Interview the ones who stop.
- Keep the roster, consent and notes outside Git. Record only aggregate counts in `docs/alpha/RESULTS.md`.

### Weeks 2–4: one boulder gym

- Ask one Bratislava boulder gym for a poster with a QR code at the front desk and one Instagram story, in exchange for a monthly "sessions logged at your gym" figure and free Pro for staff. Not a partnership contract, a favour.
- Run one "log your session" evening: stand by the mats with the app open for two hours. Target 20–40 installs over the month.
- Climbing-specific hook: the shareable session card (Section 3.7, item 3) with the gym's name on it.

### Weeks 2–5: value first in two communities

- Spend two weeks commenting usefully in r/climbharder (the weekly thread is where tools are discussed) and r/bouldering before posting once, where the rules allow, about _why_ the app has no streaks and shows estimate ranges, with the link in a comment. Check each live sidebar: r/loseit and r/Fitness30plus ban promotion; r/Fitness reportedly only allows it on Self-Promotion Saturday; r/SideProject welcomes it.
- Post one thread in the Privacy Guides forum Project Showcase (moderated; needs an affiliation check through a mizyun domain email) and on Mastodon. High intent, small numbers.
- Do not link-drop across ten subreddits; the documented result is karma and zero installs.

### Weeks 3–6: short-form demos

- Three 15–20-second videos a week on TikTok, Reels and Shorts: a boulder session logged in ten seconds; a meal photo becoming an editable estimate; a coach answer that cites last week's sessions and weight. No fabricated results, no body photos.
- Cal AI started with the founder's own TikToks; yield is bimodal (zero or hundreds). Cheap to try, stop after six weeks if nothing moves.

### Weekly scorecard (one page, every Monday, shared with the InVenture mentor)

| Metric                     | Definition                                                        |
| -------------------------- | ----------------------------------------------------------------- |
| Installs by source         | Store attribution plus the "how did you hear" onboarding question |
| Activated                  | Onboarding plus first confirmed record within seven days          |
| Day-7 and week-4 returning | Core action on day 7; any core action on days 22–28               |
| Paying                     | Separate from free, from billing ship date                        |
| Top three frictions        | From interviews, with counts                                      |
| AI cost per active user    | From provider dashboards                                          |

## 7. From 100 to 1,000: one channel that repeats

The research is unambiguous: every app that verifiably reached 1,000+ users did it through one concentrated channel (an audience, creators or store ranking), not a spread of launch posts. After the first 100, pick the channel with the best _activated users per founder hour_ from the six-week data and run it for eight more weeks before adding another.

| Candidate channel        | Run it if…                                                                     | How it scales                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Climbing gyms            | The first gym yields 20+ activated users and the owner volunteers a second gym | One gym per two weeks across Bratislava, then Vienna/Brno/Prague (same language reach for CZ); offer the group bundle in Section 5.5                                                               |
| Reddit/community content | A single value post produced 30+ activated users                               | One substantial post per month per community, each on a real design decision with data from your own users                                                                                         |
| Short-form video         | Any video passes 10k views with measurable installs                            | Daily posting, repurpose across three platforms, seed two Slovak micro-creators with free Pro (Modash lists ~32 Slovak fitness creators)                                                           |
| App Store optimisation   | Organic installs appear at all                                                 | Localise listing to SK/CZ/DE, collect 50 ratings via the in-app prompt (max three per year per user), nominate for Apple featuring 2–3 months ahead of January, use custom product pages per wedge |
| Import-driven switching  | Hevy/Strong importers retain better than others                                | "Bring your Hevy history" content and a comparison page; not an attack on Hevy, a complement for people who also want food and a coach                                                             |

Timing: January is the fitness season Hevy rode to the Play top five. Aim for Store readiness, billing, import and the first 100 users before the end of December 2026 so January traffic lands on a working funnel.

Paid acquisition: not before the funnel is measured. At the Health & Fitness benchmark of about $3 per download and 2.9% download-to-paid, a payer costs about $104 against a $40–50 yearly price. A €300 Apple Ads Basic test is reasonable only once activation and trial conversion are known (and Apple Ads availability in Slovakia is unverified).

## 8. InVenture asks (replace the generic list in the September plan)

- Product mentor: review the wedge choice (climbers vs lifters) against the first twenty interviews.
- Any mentor with a gym, climbing or sports-club connection: one introduction to a boulder gym owner.
- Storytelling mentor: critique three short demo videos.
- Growth mentor: pick the one channel in Section 7 after week six.
- Finale story (late January): "20 strangers tried it, N activated, M came back in week four, K paid; here is the one channel that works and the next experiment."

## 9. Decisions requested and proposed follow-ups

Decisions for Adam:

1. Adopt the climber beachhead (or the lifter alternative) and the Section 3.6 positioning.
2. Adopt the Section 5.2 pricing and the free/Pro boundary, replacing the USD 15–20 hypothesis.
3. Freeze new features for 90 days except the four items in Section 3.7 and first-session fixes.

Adopted by Adam on 2026-10-26; edits applied to `goals.md`, `docs/BUSINESS_ALIGNMENT.md` and `plan.md`, and issues #332–#336 opened (billing, import, session card, first value + telemetry, unit-economics guard). Original text: `goals.md` business-model section (price, beachhead), `docs/BUSINESS_ALIGNMENT.md` (wedge, validation ladder with the dates above), `plan.md` current focus (replace the September InVenture focus with publish → bill → recruit), and opens issues: Store billing (P1, area:auth/infra, needs independent review), history import (P2, area:workout), shareable session card (P2, area:community), two-minute first value + activation telemetry (P1, area:analytics), unit-economics guard (P1, area:ai).

## 10. Sources (checked 2026-10-26 by the research helpers; secondary or unverified items marked)

- RevenueCat, State of Subscription Apps 2026: https://www.revenuecat.com/state-of-subscription-apps (Health & Fitness conversion, prices, LTV; trial-length and freemium figures).
- Adapty, State of In-App Subscriptions 2026: https://adapty.io/state-of-in-app-subscriptions/ (Health & Fitness trial-to-paid 35%, first-renewal 30.3%, EU price premium).
- Adapty, Apple Search Ads costs (updated 2026-07-30): https://adapty.io/blog/apple-search-ads/ (Health & Fitness ~$3.02 per download).
- Hevy growth: https://www.revenuecat.com/blog/growth/guillem-ros-hevy-podcast ; https://www.hevyapp.com/how-we-built-hevy/ ; https://obj.ca/fitness-app-entrepreneur-pumped-by-hevys-progress-to-2m-in-annual-revenue/ ; https://thebridge.jp/2023/11/fitness-social-app-hevy-surpasses-millions-of-downloads-in-5-months-without-paid-promotion (ad-spend accounts conflict).
- Hevy Pro pricing (Recurdash, 2026-07-21, secondary): https://recurdash.com/subscription-pricing/hevy
- MacroFactor annual reports and pricing: https://macrofactor.com/annual-report-2022/ ; https://macrofactor.com/annual-report-2026/ ; https://help.macrofactorapp.com/en/articles/393-how-macrofactor-subscriptions-and-bundles-work
- Cal AI: https://www.fortune.com/2025/09/27/gen-z-founder-treats-college-like-vacation-30-million-app-by-18 ; https://techcrunch.com/2026/03/02/myfitnesspal-has-acquired-cal-ai-the-viral-calorie-app-built-by-teens ; creator-retainer detail from a sponsored newsletter (unverified).
- Indie first-users cases: https://www.indiehackers.com/post/how-i-got-my-first-100-users-2fc9d71c34 (1000 Pound Club, excerpt only) ; https://roddymunro.substack.com/p/soka-launch-retrospective ; https://www.indiehackers.com/post/from-0-to-1k-mrr-in-8-months-bootstrapping-habit-pixel-as-a-solo-dev-684b6c056d (excerpt) ; https://www.lennysnewsletter.com/p/how-the-biggest-consumer-apps-got
- Community rules: https://discuss.privacyguides.net/t/about-the-project-showcase-category/114 ; https://news.ycombinator.com/showhn.html ; https://redship.io/blog/reddit-self-promotion-rules-2026 (secondary); r/loseit and r/Fitness30plus rules read from mirrors (verify live).
- App Store product page and featuring: https://developer.apple.com/app-store/product-page/ ; https://developer.apple.com/app-store/getting-featured/ ; Apple Ads Basic: https://searchads.apple.com/help/basic/0039-promote-an-app/
- Strava API policy (AI/aggregation restrictions): https://www.strava.com/legal/api_policy ; Hevy API: https://api.hevyapp.com/docs/ ; Strong export: https://help.strongapp.io/article/235-export-workout-data
- Privacy as purchase driver: https://www.cisco.com/c/en/us/about/trust-center/consumer-privacy-survey.html ; https://proton.me/blog/then-vs-now
- Slovak purchasing power (secondary report of Eurostat): https://www.iz.sk/en/projects/EU-indicators/gdp-per-capita-in-pps-of-eu-average
- Bratislava climbing gyms (secondary): https://spectator.sme.sk/c/23235278/sports-bratislava.html ; https://multi-sport.sk/en/aktivity/partner/spot-climbing-gym
- Slovak fitness creators (Modash, 2026-07): https://www.modash.io/find-influencers/slovakia/fitness
- Strava: https://www.strava.com/subscription ; https://apps.apple.com/sk/app/strava-run-bike-hike/id426826309 ; https://www.strava.com/legal/privacy (effective 2026-01-01) ; https://siliconangle.com/2026/01/08/strava-makes-confidential-ipo-filing-amid-subscription-revenue-growth/ ; https://onestar.sh/r/orm3x-strava-what-do-subscribers-feel-they-paying (review mining) ; https://road.cc/content/news/strava-year-sport-now-only-subscribers-317425
- Hevy: https://apps.apple.com/sk/app/hevy-workout-tracker-gym-log/id1458862350 ; https://www.hevyapp.com/about-us/ ; https://www.starterstory.com/hevy-breakdown (third-party) ; https://www.iubenda.com/privacy-policy/75379905 (updated 2026-06-04) ; https://hunted.space/product/hevy/launches/hevy-1 ; free-tier caps and Garmin rejection via search excerpts of help.hevyapp.com (direct fetch 403)
- Cal AI: https://apps.apple.com/sk/app/cal-ai-calorie-tracker/id6480417616 ; https://www.calai.app/privacy (2026-05-21) ; https://9to5mac.com/2026/04/21/popular-calorie-tracker-briefly-pulled-from-app-store-over-iap-and-billing-violations/ ; https://www.healio.com/news/primary-care/20260804/ai-photobased-calorietracking-tools-underestimate-them-by-33 (conference abstract, not peer-reviewed) ; https://hackread.com/cal-ai-myfitnesspal-data-breach-3m-users/ (unverified breach) ; https://www.mynetdiary.com/diet-app-scorecard-april-2026.html (competitor-published review scan)
- MyFitnessPal: https://apps.apple.com/us/app/myfitnesspal-calorie-counter/id341232718 ; https://www.myfitnesspal.com/privacy-policy ; https://thenutritionmagazine.com/articles/myfitnesspal-paywall-changes-explained/ (2026-05-04) ; https://piunikaweb.com/2026/04/24/myfitnesspal-new-update-complaints/
- Fitbod: https://apps.apple.com/us/app/fitbod-workout-fitness-plans/id1041517543 ; https://insider.fitt.co/165-allen-chen-co-founder-ceo-of-fitbod
- Bouldering single-purpose apps (examples): https://apps.apple.com/ca/app/bould/id6746081490 ; https://apps.apple.com/us/app/id1535750808
- Internal: `goals.md`, `docs/BUSINESS_ALIGNMENT.md`, `docs/INVENTURE_PROGRAM_PLAN_2026-09-23.md`, `docs/DIFFERENTIATION_IMPLEMENTATION_PLANS_2026-10-12.md`, `docs/research/TRACKING_ENGAGEMENT_PSYCHOLOGY_2026-10-17.md`, `docs/STORE_LISTING_DISCLOSURES.md`, `docs/alpha/*`, `packages/config/src/ai-tier.ts`, ADR-0029, issue #319.
