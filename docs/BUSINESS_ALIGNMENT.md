# Mizyun business and product alignment

> Stable bridge between product intent and execution. Strategy refreshed 2026-09-23 for InVenture; this is not a fresh runtime or release audit.

## Current direction and evidence

Adam reports acceptance into InVenture Mind. The immediate milestone is a persuasive, reliable October 2–3 demo; the longer-term ambition is over 100,000 users supported by retention and sustainable distribution. The [program plan](INVENTURE_PROGRAM_PLAN_2026-09-23.md) defines the schedule, differentiation tests, meeting asks and growth ladder.

[Current status](../status.md) is the authority for qualified implementation evidence: Hetzner hosts Dev and Production, Gemini is implemented, and selected founder/device journeys have evidence. Remaining account-lifecycle, AI evaluation, signed distribution and exact-candidate device gates prevent a blanket public-readiness claim. No current cohort retention or acquisition baseline was established in this strategy session. The former July implementation matrix and Windows/Pi execution sequence are superseded; historical evidence remains in dated audits and status archives.

**Adopted 2026-10-26 (Adam):** the [go-to-market plan](GO_TO_MARKET_PLAN_2026-10-26.md) now governs commercial direction: a climber beachhead inside the target user, Pro at EUR 7.99/month or EUR 49.99/year with a EUR 34.99 founding-member year, a 90-day feature freeze except Store billing, history import, a shareable session card, activation telemetry and the AI cost guard, and a six-week first-100-users sequence. Adam reports more than two months of daily founder use (founder statement, 2026-10-26; the alpha register has not been updated with it). The Google Play listing (`com.mizyun.app`) and an App Store external TestFlight link exist per Adam; the full App Store release remains open (#319). Pricing in the section below is superseded by `goals.md`.

## Customer and problem

### Initial customer

A busy intermediate gym-goer who takes training seriously but does not have time to maintain several detailed tracking systems.

They often keep calories in their head or a chatbot, workouts and weight in Notes, photographs in the camera roll, and progress in memory. The fragmentation makes logging feel like additional work and makes longitudinal progress hard to see.

### Job to be done

> Help me capture what I ate, trained, weighed, and observed quickly; keep it together over time; and tell me the most useful next action for my goal without making fitness tracking another job.

### Desired experience

**Less tracking, more progress.** Common inputs should take seconds, uncertain AI output must remain editable, and the payoff should appear as a useful dashboard, trend, weekly review, or explained recommendation.

## Product strategy

### Launch wedge

1. Fast meal, workout, weight, and progress-photo capture.
2. One persistent private longitudinal record.
3. A clear daily dashboard and weekly progress review.
4. Memory-aware AI coaching built on confirmed records after safety and quality evaluation.

### Product expansion

- **Free/core:** useful manual tracking, basic dashboard, history, and progress visibility.
- **Premium hypothesis:** conversational AI coach, photo/text-assisted food drafts, deeper personalized reviews, advanced memory-aware guidance, and other high-cost automation.
- **Pricing hypothesis:** approximately USD 15–20 per month, tested against model cost, retention, willingness to pay, and competitors before commitment.
- **Later growth loop:** community sharing, challenges, and network effects after the private self-service product retains users.

Mizyun must remain a fitness/wellness product rather than claiming medical diagnosis or precise body composition from images.

## Differentiation and proof

The proposed wedge is a connected confirmed record that makes the next fitness decision easier. Photo logging, AI coaching and combined product breadth already overlap with competitors; the [dated competitor sources and proof matrix](INVENTURE_PROGRAM_PLAN_2026-09-23.md#what-is-distinctive-and-what-still-needs-proof) define what to test. Do not claim that competitors lack a feature without direct verification.

Architectural strengths—deterministic calculations, provider-neutral boundaries, private records and controllable memory—support this experience. They become customer advantages only when users can demonstrate and value them. Measure switching reasons, effort saved, repeat use and willingness to recommend.

## Current business dependencies and execution order

1. Demonstrate one coherent journey and repair its observed friction; accept the exact physical build before showing capabilities as working.
2. Preserve required isolation, export/deletion, retry, consent, AI evaluation, recovery and distribution gates before expanding access. Hosting exists; broad release acceptance remains separate.
3. Prepare the InVenture story and secure opt-in introductions and pilot commitments. Use a demo/interest route if participant access is not yet accepted.
4. Complete founder dogfooding and admit 10–30 eligible design partners with consent-respecting measurement; interview both retained and departed users.
5. Validate 30–100 active customers, report paid conversion separately, then test one repeatable acquisition channel toward 1,000 and 10,000 active users.
6. Pursue over 100,000 registered users with MAU and retention disclosed, and capacity, support and unit economics evidenced. No fixed date is committed.

Freemium and the USD 15–20 price remain hypotheses. Billing implementation does not precede evidence that people value the product, and attendance or prizes do not establish demand. Defer social feeds, broad integrations and general refactoring during meeting preparation.

## Validation ladder

### Founder alpha

- Complete at least seven consecutive days of real use.
- No record loss through app/API restart, retry, edit, or deletion.
- Measure how many taps and seconds common food and workout actions require.

### Design-partner beta — 10–30 users

- Recruit people matching the busy intermediate-gym-goer profile.
- Measure onboarding completion and first meal/workout/weight activation.
- Interview churned as well as retained testers.
- Fix repeated friction before expanding feature breadth.

### Early paid validation — 30–100 customers

Report free users and paying customers separately. Track:

- weekly and monthly active users;
- four- and twelve-week cohort retention;
- free-to-paid conversion and subscription churn;
- median time/taps to log a meal and workout;
- AI/photo-draft acceptance and correction rates;
- acquisition source and customer-acquisition cost;
- model/infrastructure cost per active and paying user;
- gross margin and support burden;
- qualitative evidence that users save time and understand progress better.

### Pre-seed readiness

A credible financing story combines a working cross-platform product, retained paying users, trustworthy handling of sensitive data, measured unit economics, and a clear use of funds for engineering, infrastructure, and repeatable acquisition.

## Founder context

The July 2026 business notes describe a Slovak student founder who experienced the problem personally and operates through an s.r.o. Verify current biographical and company details before using them externally. The useful narrative is personal experience backed by a working product and customer evidence.

It also creates predictable diligence questions. The company should demonstrate:

- a realistic time commitment while school continues;
- an experienced technical/security and business advisory network;
- reliable accounting, legal, privacy, and company administration;
- a hiring plan that gives senior engineers clear ownership;
- company-controlled source, credentials, domains, contracts, and documentation rather than founder-only knowledge.

## Scope guardrails

- Do not add community before the private tracking loop retains users.
- Do not use grants or investor interest as a substitute for customer evidence.
- Do not send real-user data to AI before `docs/BEFORE_TESTING.md`, `docs/AI_IMPLEMENTATION_PLAN.md`, and the external AI release gates are satisfied.
- Do not call an API route “finished product” until persistence, mobile UI, platform verification, failure recovery, and acceptance evidence exist.
- Do not scale paid marketing before activation, retention, gross margin, and a repeatable acquisition hypothesis are measurable.

## Sources of truth

- Product intent and business milestones: `goals.md`
- Roadmap and exit criteria: `plan.md`
- Current audited implementation: `status.md`
- Executable work: [GitHub Issues](https://github.com/AdamHikl/mizyun/issues)
- Behavioral requirements: `docs/PRODUCT_REQUIREMENTS.md`
- Release definition: `docs/QUALITY_GATES.md`
- AI gate: `docs/BEFORE_TESTING.md`
