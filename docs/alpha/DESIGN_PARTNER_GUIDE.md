# Design-partner alpha guide

## Target and sample

Recruit 10–30 consenting adults who broadly match the launch customer: an intermediate gym-goer already tracking at least some food, training, or body progress and who values faster private capture. Do not recruit children, medical patients for treatment, or people expecting diagnosis.

Keep the participant roster, contact details, consent record, distribution account, and raw feedback outside Git in an access-controlled company system. Assign a random study code there only if follow-up requires one; do not add that code to the in-app analytics export.

## Before inviting anyone

- Founder seven-day gate has no unresolved P0/P1 issue.
- Hosted backend, deletion scope, privacy policy, terms, feedback contact, support expectation, and incident contact are accurate for the distributed build.
- TestFlight/Google Play test build is installed from the intended distribution channel on at least one physical device per platform.
- Known limitations plainly state that AI is disabled and Mizyun is not medical advice.
- The tester can decline optional analytics and still complete every core task.

## Plain-language invitation/disclosure checklist

Explain before enrollment:

- this is an unfinished private alpha and data loss/bugs are possible;
- what account, fitness, nutrition, body, and optional photo data the app stores;
- where the backend is hosted, who can access support data, and the current deletion/export behavior;
- optional product analytics stays on device unless the tester deliberately exports it;
- declining analytics or an interview has no effect on app access;
- the expected test duration/tasks and how to stop participating or request deletion;
- no payment, prize, school/employment benefit, or pressure is conditioned on positive feedback.

Do not use this repository checklist as legal consent text. Obtain jurisdiction-appropriate privacy/legal review before external recruitment.

## Participant workflow

1. Install from TestFlight or Google Play testing and record platform/build in the private roster.
2. Create and confirm the participant's own account.
3. Complete onboarding and optionally choose analytics.
4. On at least three distinct days, complete one or more genuine core records and review the dashboard/history.
5. Exercise one correction/recovery path: edit/delete a mistaken synthetic test entry or recover a draft after a deliberate network interruption.
6. Restart the app and confirm session/records restore.
7. If willing, use Account → Optional product analytics → Export and share only that JSON through the agreed secure channel.
8. Request deletion at the end when the participant does not want the alpha account retained; verify the documented scope honestly.

Never ask participants to paste health values, tokens, screenshots of photos, or raw API errors into GitHub issues or chat.

## Interview prompts

Ask retained and churned testers the same neutral core questions:

1. What did you expect Mizyun to help you do?
2. Which action felt fastest, and which felt like work?
3. Where did you hesitate, retry, or stop?
4. Did the dashboard/history change a decision or merely repeat information?
5. What did you avoid entering, and why?
6. Did the privacy/analytics choices make sense in your own words?
7. What existing tool would Mizyun need to replace or complement?
8. Would you return next week without a reminder? Why or why not?

Capture only non-identifying themes in [`RESULTS.md`](./RESULTS.md). Preserve negative/churn feedback instead of optimizing the report for enthusiasm.
