# Mizyun product goals

> Stable product intent. Change this document only when the product direction changes. Execution status belongs in `status.md`; sequencing belongs in `plan.md`.

## Mission

Help a person make better day-to-day fitness and nutrition decisions by combining their confirmed food, training, body, and activity data in one private mobile workspace with an AI coach that remembers relevant context under the user's control.

## Product promise

Mizyun should answer four questions clearly:

1. What have I eaten and how does it compare with my target?
2. What training have I completed and am I progressing?
3. What is changing in my body and activity over time?
4. What is the safest, most useful next action for my stated goal?

The app should reduce logging effort without pretending estimates are exact. AI may interpret, summarize, and suggest; deterministic code owns calculations and users confirm uncertain inputs.

## Target user

The first product is for a busy intermediate gym-goer who takes training seriously but does not want tracking to feel like a second job. The initial user:

- already trains consistently enough to care about calories, macros, weight, exercises, and progressive overload;
- has a concrete goal such as gaining muscle, losing fat, maintaining weight, improving strength, or building consistency;
- currently fragments their record across memory, notes, spreadsheets, calorie apps, photos, and disposable chatbot conversations;
- wants one place for food, workouts, measurements, progress photos, steps, and coaching context;
- values fast capture and useful longitudinal trends more than exhaustive manual data entry or social features;
- expects private data ownership and the ability to inspect or delete remembered information.

Professional coaching teams, medical treatment, children, competitive judging, and social networks are outside the initial target.

## Market position and launch wedge

Mizyun is not initially trying to replace every calorie tracker, workout logger, social network, and personal trainer feature at once. The launch wedge is:

1. capture a meal, workout, weight, or progress photo quickly;
2. keep those records together in a persistent private timeline;
3. show a clear daily dashboard and useful weekly progress review;
4. let an AI coach explain the record and suggest a practical next action after the manual workflows and safety gates are proven.

The product promise in market language is **less tracking, more progress**. The first differentiator is continuity across nutrition, training, body progress, and conversations rather than any single isolated logging feature.

Community sharing, challenges, and broader network effects are potential post-MVP growth features. They must not delay proof that the private self-service product is useful and retainable.

## Program-led growth priority — founder decision 2026-09-23

Use acceptance into InVenture Mind to move Mizyun from testing toward **over 100,000 users**. The October 2–3, 2026 meeting is the immediate presentation milestone: a reliable, understandable demo, a defensible reason to choose Mizyun, and specific collaborators or distribution partners willing to help. The ambition has no promised completion date; report registered, activated, monthly active, retained and paying users separately.

Focus the story on **your food and training history becoming one clear next step**, under the existing promise of **less tracking, more progress**. This is a differentiation hypothesis to validate with adult target users, not a claim of unique technology or proven results. Prioritize presentation-critical reliability, first-use clarity and evidence of repeated value before feature breadth. Keep privacy, consent and release gates intact. Follow the [InVenture preparation and growth plan](docs/INVENTURE_PROGRAM_PLAN_2026-09-23.md) for dates, experiments and program asks.

## Beachhead and 90-day freeze — founder decision 2026-10-26

Adopted from the [go-to-market plan](docs/GO_TO_MARKET_PLAN_2026-10-26.md). The recruitment beachhead is **climbers who also lift and watch their weight**: Mizyun already connects bouldering sessions, strength training, body weight and food, which no mainstream tracker combines. Positioning to test: _your climbing, lifting, food and weight in one private record, with a coach that only uses what you confirmed_. Intermediate lifters who use Hevy or Strong remain the fallback audience if the first twenty climber interviews reject the wedge; the wedge is a beachhead inside the target user, not a change of target.

For 90 days from 2026-10-26, new feature work is limited to Store billing, history import (Hevy, Strong, the user's own Strava export), a shareable session card without health data, a two-minute first value with activation telemetry, and the AI unit-economics guard, plus fixes users hit in their first sessions. Other ideas are recorded as issues labelled `status:blocked` ("after 100 activated users"). Bouldering features beyond the session card are added only when climber interviews ask for them.

## Primary outcomes

### O1 — Trustworthy daily energy picture

The user can log food manually or from a photo-assisted draft, see confirmed calories and macronutrients, and compare intake with a clearly explained expenditure estimate and target range.

### O2 — Measurable training progression

The user can create exercises and routines, record workouts and sets, and see progression in load, repetitions, volume, duration, or consistency.

### O3 — Useful longitudinal progress

The user can track weight, measurements, activity, and private progress photos over time without reducing progress to a single noisy measurement.

### O4 — Personalized, memory-aware guidance

The coach can use current goals, confirmed records, preferences, limitations, and selected prior conversations. The user can see, correct, delete, or disable durable memories.

### O5 — Replaceable infrastructure

Authentication, model providers, memory retrieval, storage, and health-platform integrations remain behind explicit interfaces so one component can be upgraded without rewriting features.

Managed services are acceptable for early product validation and production reliability. Durable user data must remain exportable and migratable to Mizyun-operated EU infrastructure without rewriting business features or surrendering user export/deletion guarantees. Mobile release artifacts are compiled and signed locally on founder macOS hardware via standard native platform tooling (Xcode & Gradle); no external Expo Application Services (EAS) cloud build or submission services are required or used for App Store or Google Play releases (ADR-0023).

## MVP scope

The first usable beta must include:

- private account creation, sign-in, sign-out, session restoration, and account deletion;
- onboarding with units, timezone, height, baseline weight, goal, experience, and relevant limitations;
- manual food logging with calories and macronutrients;
- editable photo/text-assisted food drafts after AI is safely enabled;
- custom exercises, workout templates, workout logging, and progress summaries;
- weight, measurements, steps/activity, and private progress photos;
- deterministic energy-target and surplus/deficit calculations with assumptions shown;
- a conversational coach using confirmed user data and controllable memories;
- export and deletion controls for user data and memories;
- iOS and Android support from one Expo application, built and signed locally on macOS (Xcode & Gradle) without EAS cloud dependencies (ADR-0023).

Detailed requirements and identifiers live in `docs/PRODUCT_REQUIREMENTS.md`.

## Non-goals for the first beta

- medical diagnosis, injury diagnosis, eating-disorder treatment, or emergency advice;
- claiming exact calorie content, body-fat percentage, or health status from a photo;
- autonomous changes to authoritative food, workout, goal, or measurement records;
- a public photo feed, follower system, marketplace, or competitive leaderboard;
- replacing a qualified clinician, dietitian, or trainer;
- real-time wearable coaching or an exhaustive food/barcode database;
- multiple model providers enabled simultaneously before one provider is evaluated well.

## Product principles

1. **User-confirmed facts beat AI guesses.** Estimates are drafts with provenance, confidence, and editable ranges.
2. **Trends beat false precision.** Weight, energy expenditure, photos, and performance are interpreted across time.
3. **Deterministic calculations stay deterministic.** AI explains calculations but does not invent their results.
4. **Private by default.** User data and media are isolated, minimally retained, and never made public implicitly.
5. **Memory is visible and reversible.** Users can review, correct, expire, and delete what the coach remembers.
6. **Recommendations explain why.** Guidance cites the goal and inputs that shaped it and communicates uncertainty.
7. **Small replaceable modules and portable data.** Features depend on domain ports, not vendor SDKs or another feature's internals; managed infrastructure must have an evidenced exit path.
8. **Safe defaults over feature theater.** Disabled infrastructure produces an honest setup state, not fabricated results.
9. **Accessible, low-friction logging.** Common actions should be reachable quickly and work with metric or imperial units.
10. **Build evidence before automation.** Manual workflows and evaluation datasets come before AI automation.

## Success measures

Targets will be finalized before external beta after instrumenting a consent-respecting baseline. We will track:

- activation: users who finish onboarding and create a first food, workout, or measurement record;
- logging efficiency: median time and taps for common food and workout entries;
- usefulness: users who return to review a trend or act on a recommendation;
- retention: weekly use among people who set an active goal;
- data quality: proportion of AI-assisted records reviewed and confirmed, plus error ranges against test data;
- safety: unsafe recommendation rate, cross-user access failures, and unresolved deletion requests;
- reliability: crash-free sessions, API availability, sync failure rate, and bundle/release-test success;
- trust: memory corrections/deletions, recommendation feedback, and privacy-control usage.

## Business model and validation milestones

The intended business model is freemium self-service:

- a useful free tier for core manual tracking and progress visibility;
- a paid tier for higher-cost AI capabilities such as conversational coaching, photo/text-assisted drafts, deeper personalized reviews, and advanced memory-aware guidance;
- pricing adopted 2026-10-26: Pro at EUR 7.99 per month or EUR 49.99 per year, a EUR 34.99 founding-member year for the first 100 payers with the price locked while subscribed, a 14-day Store trial with the price shown before any onboarding question and one-tap cancellation, and no lifetime plan while AI cost is recurring; a higher "Coach+" tier (USD 15–20) remains a later hypothesis to test only after paying users exist;
- two public promises: features shipped free stay free, and early subscribers keep their price;
- community features may later improve acquisition and retention, but are not required for the first paid product.

Before hiring a larger team or scaling paid acquisition, the product should prove a staged funnel:

1. **Private alpha:** the founder can use the complete daily loop with persistent data on iOS and Android.
2. **Design-partner beta:** 10–30 target users complete onboarding and repeatedly log at least one core record.
3. **Early paid validation:** 30–100 active customers, with paying users reported separately from free testers.
4. **Repeatable growth:** progress through 1,000 and 10,000 active users toward over 100,000 registered users, gated by cohort retention, repeatable acquisition, support capacity and sustainable costs; this is an ambition, not current traction.
5. **Pre-seed readiness:** credible activation, four- and twelve-week retention, conversion, churn, acquisition cost, AI cost per active user, gross margin, and qualitative evidence that Mizyun saves tracking time.

The current engineering plan must prioritize measurable end-to-end user journeys over accumulating disconnected backend endpoints. A feature counts as product-usable only when it persists across restarts, is reachable in the mobile UI, handles failure states, and has acceptance evidence on both platforms.

## Non-negotiable release constraints

- No cross-user read or write of private health, nutrition, workout, profile, coaching or media records may succeed. Separately opted-in social artifacts may be read only through the explicit audience policies in COMMUNITY-01–16 and ADR-0030; the private source tables remain closed. This post-MVP design exception does not change the first-beta follower exclusion or approve launch.
- No server, service-role, or model secret may ship in a mobile bundle.
- Body photos remain private and are never used to diagnose or assert precise body composition.
- Photo-derived food data remains unconfirmed until the user accepts or edits it.
- AI stays disabled until `docs/BEFORE_TESTING.md` is complete for the selected provider.
- Every release candidate passes `docs/QUALITY_GATES.md`.
