# InVenture: from testing to a product people recommend

> Decision date: 2026-09-23. Owner: Adam. Work package: [INVENTURE-001 / #125](https://github.com/AdamHikl/mizyun/issues/125). Acceptance into the program is founder-reported. This is a preparation and validation plan, not evidence of release readiness or growth. Longer-term ambition: **over 100,000 users**; no delivery date or traction claim is implied.

## The opportunity and the immediate win

The [official program page](https://digitalnakoalicia.sk/inventure-mind-program-slovakia/), checked 2026-09-23, lists a Bratislava kickoff on October 2–3, online modules October 5–November 19, mentoring November 23–January 21, and a late-January finale. Teaching is in English. Prepare an English pitch and use the whole program for customer discovery, distribution experiments and mentor accountability. Admission does not imply endorsement of Mizyun. Ask organizers about bringing an existing project, team formation and presentation format before assuming a pitch slot.

By October 3, aim for a demo people understand, five relevant follow-up conversations, two introductions to gym/community/creator operators, and one person willing to help run a small pilot. These are proposed targets, not commitments already secured. A public app launch is not required to have a useful meeting.

## Positioning to test

**Less tracking, more progress. Your food and training history become one clear next step.**

Initial audience: adult intermediate gym-goers who already train but lose consistency when food, workouts and progress live in different places. Start with reachable Slovak/English-speaking gym communities; this is a recruitment beachhead, not a permanent geography limit.

Draft 30-second English pitch:

> I’m building Mizyun for people who take training seriously but find tracking becomes a second job. It brings meals, workouts and body progress into one private record, with a coach designed to explain a useful next step from the information you confirm. I’m testing whether that makes people more consistent. I’m looking for a gym community or creator to help run a small pilot, and someone who enjoys turning a useful product into a story people share.

Replace “designed to” with a concrete demonstrated claim only after accepting that behavior on the event build. Add one real founder experience and a measured result when available; do not invent testimonials, time savings or traction.

### What is distinctive, and what still needs proof

| Hypothesis                                                         | Evidence needed                                                                                                               | Claim boundary                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Connected food, training and body context makes advice more useful | One recommendation referencing the correct confirmed inputs, with an understandable explanation                               | Code support is not proof of advice quality or superior outcomes |
| Capture feels easier enough to sustain                             | Observe five target users performing the same tasks in Mizyun and their existing workflow; record time, errors and assistance | No “fastest” or quantified saving before measurement             |
| User-controlled context builds trust                               | Demonstrate editable estimates and inspect/correct/delete memory on the accepted build                                        | No blanket provider privacy or perfect recall claims             |
| People want to tell a friend                                       | Ask retained users why they would recommend it; track voluntary introductions and referred activation                         | Virality is a hypothesis, not a launch feature or promise        |

Competitor research, checked 2026-09-23: [MyFitnessPal Meal Scan](https://support.myfitnesspal.com/hc/en-us/articles/360045761612-How-to-use-the-Meal-Scanner) already supports photo-assisted logging; its [Nutrition Coach](https://support.myfitnesspal.com/hc/en-us/articles/45212266254221-Introducing-Nutrition-Coach-Your-Nutrition-Assistant) overlaps with coaching. [MacroFactor](https://macrofactor.com/) markets both nutrition and workout products. [Fitbod](https://help.fitbod.me/hc/en-us/articles/30721437384215-How-to-Navigate-the-Exercise-Details-Screen) describes recommended sets, repetitions and weight. These are vendor descriptions, not a hands-on comparison. “AI,” “photo calories,” and “all in one” alone cannot establish uniqueness. Compete on a specific observed experience and audience fit; revisit the wedge if interviews show no reason to switch.

## Nine-day preparation sequence

| Dates                  | Focus                                                                | Deliverable / exit check                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| September 23–24        | Choose one audience/problem; inspect the current installed candidate | Five short problem interviews; baseline demo recording; ranked friction list; exact build/environment identified                                                                                          |
| September 25–27        | Repair only demo and first-use blockers                              | Sign-in/onboarding, meal review/save/reopen, dashboard refresh, workout history and one grounded answer accepted on the chosen physical phone; resolve data-loss/privacy blockers before expanding access |
| September 28–29        | Make the story understandable                                        | 90-second demo, five-slide English deck, one-page brief and verified QR destination; five outsiders can retell the problem and benefit                                                                    |
| September 30–October 1 | Rehearse and freeze                                                  | Three consecutive complete demo runs without founder repair; backup screen recording; tested phone/charging/network setup; critical fixes only                                                            |
| October 2–3            | Discover collaborators and test the story                            | Record objections and requested introductions; agree named next steps with dates; capture opt-in contact details                                                                                          |
| October 4–5            | Convert interest into action                                         | Founder sends personalized follow-ups within 48 hours; schedule pilot and mentor sessions; rank findings by frequency and severity                                                                        |

Adam owns delivery and outreach. A helper can review the pitch or observe demo tests; every commitment still needs an owner and date. Interviews can proceed while software acceptance is blocked.

Priority order: broken sign-in or lost records → correctness and visible error states → confusing first-use flow → core screen readability → cosmetic polish. Use existing #102/#117/#96 and release-gate issues where relevant. Defer general refactoring, HealthKit/Health Connect, social feeds, new provider work, subscriptions and #118–#123 enhancements unless observed failure makes a narrow change necessary for this demo. Do not add a feature simply to fill a pitch slide.

### The 90-second demo

1. **0–15 seconds:** Describe one real frustration: “I train regularly, but keeping food and training connected takes too much effort.” Show the goal and a clearly disclosed sample history.
2. **15–40 seconds:** Turn a meal description or photo into an editable draft, correct an estimate, explicitly save, and show the refreshed total. Use manual capture if AI is not accepted for this candidate.
3. **40–60 seconds:** Show one logged workout and previous performance beside the relevant progress history. Avoid a tour of every tab.
4. **60–80 seconds:** Ask one bounded question about the recorded week. Show the inputs behind the answer and acknowledge missing logs. If grounded Coach acceptance is incomplete, use the confirmed dashboard and explain coaching as the next validation step.
5. **80–90 seconds:** Make one specific ask: “Can you introduce me to a gym community willing to help test this with ten adults?”

Rehearse both live and recorded versions. Record real app behavior; disclose sample data and label any recording. No fabricated AI responses or staged health outcomes. No personal body photos on the projector. Demonstrate from the founder-controlled account; the existing Dev testing exception is not authorization to enroll the room. Some program participants may be minors: keep adult eligibility intact and use demonstrations or non-sensitive problem interviews for everyone else.

### Presentation kit

- Five slides: recognizable problem; target user/current workaround; demonstrated solution; evidence and honest gaps; specific next experiment and help needed.
- One page: same promise, three real screenshots, current testing status, founder contact and a clear call to action.
- One QR destination with a reliable demo/interest route. Verify any install link on a fresh device before promising access; otherwise offer an opt-in pilot-interest route. Collect contact/role only, not health records.
- Website work belongs in `/Users/adam/Documents/mizyun-website`; this plan does not publish changes there. Create the brief, deck, recording and intake route in later execution; they are not completed by this document.

## Get useful help from the program

Use a one-page weekly mentor update: hypothesis → experiment → counts/results → what changed → one decision or introduction needed. Attend live sessions and bring actual user observations. Use peer teams to test communication and distribution, rather than treating every participant as the target customer.

| Person                            | Specific ask                                                          | Evidence to bring                                                      |
| --------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Product mentor                    | Challenge the switching reason and design a retention experiment      | Five interviews, demo and dropout observations                         |
| Gym/community operator            | Introduce ten adult target users for a bounded pilot                  | Recruitment criteria, support owner and readiness boundaries           |
| Creator/storytelling collaborator | Co-design three short demo narratives and one small distribution test | Actual app footage and a measurable landing-to-activation funnel       |
| Experienced founder/growth mentor | Diagnose one channel and the activation bottleneck                    | Cohort counts, acquisition source and cost assumptions                 |
| Technical/operations mentor       | Review readiness for the next cohort size                             | Current acceptance gaps, provider cost, capacity and recovery evidence |

Ask discovery questions about recent behavior: “What did you log yesterday?”, “When did you last stop tracking?”, “Show me your workaround”, “What would make switching worth it?” End with a concrete opt-in next step. Praise is weak evidence; a scheduled pilot, repeated use, introduction or willingness to pay is stronger. Do not exchange equity or promise roles merely for enthusiasm; start with a bounded project and evaluate contribution.

## From the meeting to 100,000+ users

Treat over 100,000 registered users as the long-term reach ambition, with **monthly active and retained users reported alongside it**. This is a working metric definition for the otherwise unspecified word “users.” Downloads, signups, activated users and paying customers must never be substituted for one another. There is no evidence yet that January or any particular channel can deliver this scale.

| Stage                           | Main question                                      | Advance only with                                                                                                                           |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Founder + 10–30 design partners | Can people reach value and keep using it?          | Required access/release gates, observed activation, repeated weekly use, resolved core failures and interviews with leavers                 |
| 30–100 active customers         | Does the value survive beyond friends?             | Multiple dated cohorts, four-week retention, pricing research and support/cost records; paying users counted separately                     |
| 1,000 active users              | Can one channel repeatedly recruit suitable users? | Repeated channel experiments, attributable activation, retention and cost; capacity checked for expected concurrency                        |
| 10,000 active users             | Does the channel remain sustainable?               | Stable cohorts, manageable support, model budgets, operational recovery and sustainable acquisition economics                               |
| Over 100,000 registered users   | Can reach grow while the product remains useful?   | Transparent MAU/retention, repeatable distribution, funded operations and measured capacity; no assumption the current server is sufficient |

Working scorecard: activation = onboarding plus first confirmed core record within seven days of signup; retained week four = at least one core logging action on days 22–28 after activation; MAU = unique users with a core logging/review action in the preceding 30 days. Report cohort dates, numerator/denominator and consent coverage; distinguish confirmed logging from app opens and partial meal logs from complete-day nutrition. Where analytics consent is absent, use voluntary interviews/diaries and disclose missing data.

For a first 20-person eligible pilot, propose at least 14 activations within seven days and at least eight of those activated users returning in week four before expanding the next cohort. These are provisional internal decision thresholds, not industry benchmarks or statistically reliable product-market-fit evidence. Freeze definitions before recruitment; report failures instead of moving targets after results arrive.

First growth experiment after admission gates: one gym/community partner, 10–20 adults, two weeks of supported use, then four-week follow-up. Test a simple invitation after a user reports value; no social feed required. Any shared screenshot/result is voluntary, previewed and excludes health details by default. Compare three creator narratives using real demonstrations; count qualified visitors → eligible opt-ins → activated users → retained users. Stop or revise channels that attract clicks without use.

For planning arithmetic only: 1,000 qualified visitors × 20% signup × 60% activation × 30% week-four retention = 36 retained users. None of these rates is measured. The point is to improve conversion and retention before purchasing reach. Review AI/infrastructure cost per active user and eventual gross margin before scaling.

Program checkpoints: October modules establish the problem and first eligible pilot; November work compares cohort behavior and one channel experiment; December–January mentoring strengthens retention, economics and the pitch. January success is a defensible story with real users and a repeatable next experiment, not a promised 100,000-user deadline.

## Evidence and outstanding work

Current repository status reports native meal-draft founder acceptance, local meal/history/dashboard improvements and remaining account lifecycle, AI evaluation, distribution and device gates. That does not accept the exact meeting candidate. Preserve [current status](../status.md), [quality gates](QUALITY_GATES.md) and the [remediation checklist](REMEDIATION_EVIDENCE_CHECKLIST.md). Do not mark those gates closed from this plan.

Next exact action: record the proposed 90-second journey on the current physical build, identify its source/build/environment, and list every interruption or unsupported claim. Use that evidence to select the smallest preparation slice. No current retention baseline, tested event artifact, demo recording or confirmed program introduction was produced in this planning session.
