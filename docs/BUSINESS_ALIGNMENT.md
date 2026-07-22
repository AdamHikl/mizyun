# Mizyun business and product alignment

> Stable bridge between the business plan and engineering execution. Revisit after material customer research, pricing evidence, or product-positioning changes. Last audited: **2026-07-22**.

## Executive verdict

The repository supports the intended business **architecturally**, but not yet as a customer-ready product.

Mizyun has a strong modular, privacy-conscious, provider-neutral foundation and unusually broad tested domain/API coverage for its stage. The manual tracking and private-photo surfaces now pass authenticated, persistent standalone iOS and Android journeys against local Supabase and Storage, and consent-first local product analytics is implemented. The app remains a technical pre-alpha because hosted deployment, physical-device proof, participant analytics exports, and real-user repetition are incomplete and the AI coach is disabled.

The next business-critical milestone is not “add more backend endpoints,” select an analytics vendor, or “connect a chatbot.” It is founder and design-partner repetition of the now-working mobile loop, using voluntary privacy-safe exports to produce measurable activation, friction, reliability, and retention evidence.

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

## Audited implementation matrix

| Business promise                   | Current implementation                                                                | Readiness                     | Principal gap                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| Private personal workspace         | Supabase Auth, secure native sessions, RLS, persistent repositories, private Storage  | Local iOS/Android pass        | Hosted deployment and physical-device acceptance remain open                      |
| Low-friction calorie tracking      | Persistent food CRUD, mobile daily lifecycle, and calorie/macro summaries             | Local iOS/Android pass        | History breadth and text/photo drafts remain open                                 |
| Weight and body progress           | Persistent measurements, mobile raw/trend views, and private progress-photo lifecycle | Local iOS/Android pass        | Camera hardware and broader measurement breadth remain open                       |
| Gym progress and exercise planning | Persistent workout/set routes, mobile active session, and previous performance        | Local iOS/Android pass        | Templates and suggestions remain open                                             |
| Surplus/deficit guidance           | Versioned deterministic engine, real mobile dashboard, and calendar reviews           | Local iOS/Android pass        | Step input remains open                                                           |
| AI trainer                         | Provider-neutral orchestrator and disabled provider                                   | Interface only                | No Mistral adapter, tools, conversation lifecycle, evaluation, or UI              |
| Durable agent memory               | Memory port, in-memory search, and protected SQL schema                               | Interface/schema only         | No persistent adapter or user-visible review/correction controls                  |
| Photo analysis                     | Private Storage plus consent-gated mobile upload/timeline/compare/delete              | Native iOS/Android loops pass | Camera hardware and any evaluated vision model remain open                        |
| Android and iPhone                 | Shared Expo app; full local iOS and Android journeys pass                             | Simulator/emulator proof      | Physical devices and store builds remain unverified                               |
| Freemium/premium business          | Product hypothesis plus consent-first local validation analytics                      | Instrumentation only          | No participant dataset, entitlement model, paywall, subscription, or pricing test |
| Community sharing                  | Explicitly excluded from MVP                                                          | Intentionally deferred        | Reconsider only after private product retention                                   |

## What the architecture gets right

- Pure deterministic fitness calculations remain outside model code.
- Model providers, memory stores, identity, storage, and health platforms sit behind replaceable ports.
- User ownership and cross-user isolation are designed into the database rather than added at the end.
- AI-derived nutrition and photo observations are designed as uncertain drafts requiring confirmation.
- Mistral can be added as a provider package and selected in the API composition root without rewriting core features.
- Privacy, deletion, and user-controlled memory support a credible EU-first trust position.

These choices support future fundraising and technical hiring because engineers can work on vertical modules without coupling the entire application to one vendor.

## What currently blocks the business plan

1. **No retention evidence:** the local analytics/export boundary exists, but no founder/design-partner dataset or structured feedback has been collected.
2. **No paid value:** AI assistance, memory controls, billing, and entitlements are absent.
3. **No production environment:** hosted backend, real email flows, monitoring, policies, and store-distributed builds are not ready.
4. **No physical-device/repeated-user proof:** simulator acceptance does not replace device testing, founder dogfooding, or design-partner evidence.
5. **Local-only work risk:** completed slices remain ahead of GitHub until an explicit push is authorized.

## Required execution order

1. PERSIST-001 / PERSIST-002 / PERSIST-003 — real Supabase persistence and deletion.
2. MOB-DAILY-001 family — mobile food, workout, weight, and real dashboard flows.
3. MEDIA-MOB-001 — private mobile photo lifecycle.
4. AND-001 — Android runtime and journey verification.
5. OBS-001 — privacy-safe activation, friction, reliability, and retention measurement. (Implementation gate complete.)
6. ALPHA-001 — founder dogfooding followed by 10–30 design partners.
7. AI-001 / MEM-001 — evaluated Mistral provider, normalized tools, conversations, and visible memory controls.
8. VISION-001 — editable photo/text food drafts with a consent-based evaluation dataset.
9. BILL-001 — premium packaging, entitlements, pricing test, and subscription billing.
10. External beta and 30–100 active-customer validation before material paid acquisition or a large hiring plan.

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

The founder is an 18-year-old Slovak high-school student who experienced the problem personally and already operates through an s.r.o. This is a strong competition, recruiting, press, and fundraising narrative when paired with execution evidence.

It also creates predictable diligence questions. The company should demonstrate:

- a realistic time commitment while school continues;
- an experienced technical/security and business advisory network;
- reliable accounting, legal, privacy, and company administration;
- a hiring plan that gives senior engineers clear ownership;
- company-controlled source, credentials, domains, contracts, and documentation rather than founder-only knowledge.

## Scope guardrails

- Do not add community before the private tracking loop retains users.
- Do not use grants or investor interest as a substitute for customer evidence.
- Do not enable AI before `docs/BEFORE_TESTING.md` and the manual workflow gates are satisfied.
- Do not call an API route “finished product” until persistence, mobile UI, platform verification, failure recovery, and acceptance evidence exist.
- Do not scale paid marketing before activation, retention, gross margin, and a repeatable acquisition hypothesis are measurable.

## Sources of truth

- Product intent and business milestones: `goals.md`
- Roadmap and exit criteria: `plan.md`
- Current audited implementation: `status.md`
- Executable work: `backlog.md`
- Behavioral requirements: `docs/PRODUCT_REQUIREMENTS.md`
- Release definition: `docs/QUALITY_GATES.md`
- AI gate: `docs/BEFORE_TESTING.md`
