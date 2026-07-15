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

The first product is for an individual adult who:

- has a concrete goal such as gaining muscle, losing fat, maintaining weight, improving strength, or building consistency;
- wants one place for food, workouts, measurements, progress photos, steps, and coaching context;
- values fast logging and useful trends more than social features;
- expects private data ownership and the ability to inspect or delete remembered information.

Professional coaching teams, medical treatment, children, competitive judging, and social networks are outside the initial target.

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
- iOS and Android support from one Expo application.

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
7. **Small replaceable modules.** Features depend on domain ports, not vendor SDKs or another feature's internals.
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

## Non-negotiable release constraints

- No cross-user read or write may succeed.
- No server, service-role, or model secret may ship in a mobile bundle.
- Body photos remain private and are never used to diagnose or assert precise body composition.
- Photo-derived food data remains unconfirmed until the user accepts or edits it.
- AI stays disabled until `docs/BEFORE_TESTING.md` is complete for the selected provider.
- Every release candidate passes `docs/QUALITY_GATES.md`.
