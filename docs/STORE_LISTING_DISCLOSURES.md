# Mizyun Store Listing & Review Disclosures Guide

This document contains copy-pasteable metadata, App Privacy responses, Data Safety declarations, and Reviewer Notes for submitting **Mizyun** to **Apple App Store Connect** and **Google Play Console**.

**Status (2026-10-21):** updated for the Production release Adam decided on 2026-10-21 (Community, indoor bouldering, AI evening stretch, Health run import, retained meal photos, recipe ideas and cooking assistant, per-feature AI vendors). This is preparation text only. Nothing here has been entered in App Store Connect or Play Console, and no Store label, form, age rating or review submission is accepted. The exact manual changes are listed in Section 5.

---

## 1. App Store & Google Play Metadata

### Basic Information

- **App Name:** Mizyun
- **Subtitle (iOS, max 30 chars):** AI Fitness & Nutrition Tracker
- **Short Description (Android, max 80 chars):** Private nutrition, workout logger, weight tracking, and intelligent AI coach.
- **Category:** Health & Fitness
- **Content Rating:** 12+ (iOS) / Everyone (Android) with standard advisory for user-initiated web/AI interaction.
- **Support URL:** `https://mizyun-api.phiskel.com/legal/support` (or `https://phiskel.com`)
- **Privacy Policy URL:** `https://mizyun-api.phiskel.com/legal/privacy` (or `https://phiskel.com/privacy`)
- **Marketing URL:** `https://phiskel.com`

### Keywords (iOS, max 100 chars, comma-separated)

```text
fitness,calorie tracker,workout log,macro tracker,gym log,body weight,nutrition AI,diet,exercise,TDEE
```

### Full Description

```text
Mizyun is your private, all-in-one fitness and nutrition workspace. Designed for intermediate and dedicated gym-goers, Mizyun unifies your food tracking, workout progression, and body metrics with an intelligent, memory-aware AI coach and an optional adults-only Community.

KEY FEATURES:

📊 Trustworthy Daily Nutrition
• Fast manual food logging or smart AI-assisted draft estimates from photos and text descriptions.
• Real-time calorie and macronutrient breakdown (protein, carbs, fat).
• Deterministic energy balance formulas (BMR, TDEE, surplus/deficit) with full calculation transparency.

🏋️ Complete Workout & Gym Logger
• 880+ exercise catalog covering free weights, machines, cables, and bodyweight movements.
• Custom routine builder and interactive active workout logger (sets, reps, load, RPE, rest).
• Longitudinal progressive overload tracking, 1RM estimates, and personal records.

📈 Longitudinal Body & Weight Trends
• Fast weight logging with smoothed moving-average trendlines.
• Body circumference tracking (waist, chest, etc.).

🤖 Memory-Aware AI Coach
• Context-aware guidance grounded strictly in your confirmed nutrition, workouts, and personal goals.
• Conversational routine modifications and multi-session training proposals.
• User-controlled long-lived memories: inspect, edit, or delete remembered facts at any time.
• Optional AI recipe ideas from a photo of your ingredients and a cooking assistant you can chat with, and an evening stretch tailored to your training day.

🧗 Running, Bouldering & Health Import
• Log runs, and import the runs you choose from Apple Health or Health Connect.
• Indoor bouldering sessions with grades, projects, and challenge days.

🤝 Optional Community (adults only)
• Join with a handle, follow approved friends, and share the workouts, meals, and bouldering sessions you choose to share, with a preview first.
• Reactions, comments, messages, spaces, and challenges, with reporting, blocking, and muting built in.
• Private tracking works exactly the same if you never join.

🔒 Private & Transparent by Default
• Your health data and photos are strictly yours. Built with database Row Level Security.
• Nothing is shared unless you choose to share it. No selling data and no advertising.
• AI features are optional and adults-only. Before you use one, the app names the providers (Anthropic and Google) and what each receives.
• Optionally keep one compressed photo with a meal, stored privately on Mizyun's servers; remove it any time.
• Complete data export and staged in-app account deletion; operational backups age out under a 90-day retention policy.

Note: Mizyun is an informational fitness and nutrition tool and is not intended to replace professional medical advice, diagnosis, or treatment.
```

---

## 2. Apple App Privacy Details ("Nutrition Labels")

When completing the **App Privacy** questionnaire in App Store Connect, for the Production release that includes Community, retained meal photos, Health run import and Anthropic/Google AI processing. Rows marked **NEW** or **CHANGED** differ from the previous (Gemini-only, no Community) answers; see Section 5 for the manual steps.

| Data Category        | Data Type                | Collected? | Linked to User? | Used for Tracking? | Purpose of Collection                                                                                                                                                                                                                                             |
| :------------------- | :----------------------- | :--------- | :-------------- | :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contact Info**     | Email Address            | **Yes**    | **Yes**         | **No**             | App Functionality (Account authentication, password reset, security notices)                                                                                                                                                                                      |
| **Contact Info**     | Name (**NEW**, see note) | **Yes**    | **Yes**         | **No**             | App Functionality (Community display name; the optional profile display name)                                                                                                                                                                                     |
| **Health & Fitness** | Health                   | **Yes**    | **Yes**         | **No**             | App Functionality (Nutrition logs, body weight, BMR/TDEE calculations; runs the user selects to import from Apple Health; sent to AI processors only as listed in Section 4 of the Privacy Policy)                                                                |
| **Health & Fitness** | Fitness                  | **Yes**    | **Yes**         | **No**             | App Functionality (Workouts, runs including selected Health imports, bouldering sessions; Community sharing the user chooses)                                                                                                                                     |
| **User Content**     | Photos or Videos         | **Yes**    | **Yes**         | **No**             | App Functionality (Meal photo and ingredient photo analysis by AI processors, **retained meal photos stored on Mizyun servers** (**CHANGED**), private progress photos (only where that feature is enabled in the build) and bouldering photos, Community photos) |
| **User Content**     | Emails or Text Messages  | **Yes**    | **Yes**         | **No**             | App Functionality (**NEW**: Community direct messages and comments)                                                                                                                                                                                               |
| **User Content**     | Other User Content       | **Yes**    | **Yes**         | **No**             | App Functionality (Workout notes, custom exercises, Coach and cooking-assistant messages, Community posts, bios, reports; bouldering notes)                                                                                                                       |
| **Identifiers**      | User ID                  | **Yes**    | **Yes**         | **No**             | App Functionality (Database user identification; Community handle)                                                                                                                                                                                                |
| **Diagnostics**      | Crash Data / Performance | **Yes**    | **No**          | **No**             | Analytics / App Functionality (Error request IDs without PII)                                                                                                                                                                                                     |

- **Data Tracking:** Answer **"No"** (Mizyun does not track users across third-party apps or websites for advertising).
- **Third-party partners:** Data sent to Anthropic (Coach chat, typed meal estimates and draft changes, Log activity descriptions) and Google (photo drafts, ingredient photos, cooking assistant, evening stretch, meal illustrations) is processed to provide the feature the user invoked and is covered by the user's AI consent; it is not used for advertising or tracking. Confirm in App Store Connect how Apple's definitions treat these processors before answering any third-party-sharing or "used for tracking" question.
- **Name note:** Apple's "Name" type covers first or last name; a display name chosen by the user is not necessarily a legal name. Adding it is the conservative answer. Adam decides.
- Imported Health runs, Community content and retained meal photos are linked to the account and deleted with it (Privacy Policy Sections 6 and 7).

---

## 3. Google Play Data Safety Form

When filling out Google Play Console **Data Safety** for the Production release:

1. **Does your app collect or share any user data?** -> **Yes**
2. **Is all user data encrypted in transit?** -> **Yes** (HTTPS/TLS)
3. **Do you provide a way for users to request that their data be deleted?** -> **Yes** (Direct in-app account deletion under Account Settings and online contact). Users can also remove an individual retained meal photo, withdraw from Community, and remove shared items in the app.
4. **Data Types Collected**:
   - **Personal info**: Email address (Account management); **Name** (**NEW**: Community display name, App functionality). User IDs (Account management; Community handle).
   - **Health and fitness**: Fitness info (workouts, runs including runs the user selects to import from Health Connect, bouldering sessions); Health info (body weight and measurements, nutrition) (App functionality).
   - **Photos and videos**: Photos (Meal photo and ingredient photo analysis; **retained meal photos stored on Mizyun servers**; private progress photos (only where enabled) and bouldering photos; Community photos) (App functionality).
   - **Messages**: Other in-app messages (AI Coach and cooking-assistant conversations; **NEW**: Community direct messages and comments) (App functionality).
   - **App activity / Other user-generated content**: Community posts, bios, reports (App functionality).
   - **App info and performance**: Crash logs, diagnostics (App functionality).
   - **Device or other IDs**: User ID (Account management).
5. **Data Sharing**: Mizyun **does NOT share** data with third-party advertisers or data brokers. The AI providers (Anthropic and Google) process data on Mizyun's behalf to provide the AI features the user invokes, and Community content is visible only to the audience the user chooses. Confirm against Google's current definition of "sharing" (service providers acting on the developer's behalf and user-initiated transfers) before answering "No" to sharing; if Google treats the AI transfer as sharing, declare Photos, Health and fitness, and Messages as shared with Anthropic/Google for App functionality.
6. **Health apps declaration and Health Connect permissions:** Production reads Health Connect running sessions and distance (READ_EXERCISE, READ_DISTANCE) and steps only when the user starts the feature; data from Health Connect is not used for advertising and not sold. Complete the Play Console Health apps declaration and Health Connect permissions form to match.
7. **User-generated content:** Community is user-generated content. Complete the Play Console UGC and app content declarations (reporting, blocking, moderation) and check whether the Child Safety Standards declaration applies (see `docs/COMMUNITY_LEGAL_STORE_CHECKLIST.md`).

---

## 4. App Store Reviewer Information (App Review Notes)

Provide this in the **App Review Information** section in App Store Connect:

### Reviewer Login Credentials

- **Sign-in Required:** Yes
- **Username / Email:** `appstore-review@mizyun.phiskel.com`
- **Password:** _(Generate a strong test password, e.g. `MizyunReviewer2026!`)_

### Notes for the Reviewer

```text
Hello Apple App Review Team,

Thank you for reviewing Mizyun!

Key Information about Mizyun:
1. Account & Demo Data:
We have pre-configured a test account with existing sample meals, workouts, and weight entries so you can immediately explore the Home Dashboard, Workouts tab, Meals tab, and Coach tab.
- Credentials: appstore-review@mizyun.phiskel.com / [Password]

2. AI Nutrition & Coach Features:
- Mizyun features an AI-assisted meal draft estimator, a conversational fitness coach, recipe ideas from an ingredient photo with a cooking assistant, and an AI-tailored evening stretch.
- Third-party AI providers: Anthropic (Claude) serves Coach chat, typed meal estimates and draft changes, and Log activity descriptions (on devices without Apple Intelligence, or when the on-device model fails). Google (Gemini) serves meal/label/Coach photo drafts, ingredient photos, the cooking assistant, the evening stretch, and meal illustrations. The in-app consent screen (Coach tab, or Account > Data) names both providers, lists the data each receives and states retention; consent and an adult birth year are required before any AI feature runs, and consent can be revoked under Account > Data.
- Strict Human-in-the-Loop: In accordance with App Store guidelines, all AI meal scans and suggestions are generated as PROPOSALS/DRAFTS and require explicit user review and confirmation before being saved to the user's permanent timeline.
- Medical Disclaimer: Mizyun is an informational fitness tool and does not provide medical diagnosis. Disclaimers are clearly presented during onboarding and in the Coach tab.

2a. Community (optional, adults only):
- Community is opt-in. Joining requires an adult declaration and acceptance of the Community rules; declining or withdrawing does not affect private tracking.
- Users share only items they choose after a preview. Safety tools: report, block and mute on profiles and posts; moderation and appeals; reporting is available without browsing. Test accounts: [synthetic reviewer accounts to be provided by Adam; none are recorded here].
- Demonstration path: Community tab > Join Community; Report and Block appear on profiles, comments, invitations, challenges and spaces.

2b. Health data:
- Steps (optional) and Import runs (optional) read Apple Health only after the user grants permission. Only the runs the user selects are saved to their Mizyun account. Health data is not used for advertising or sold.

2c. Photos:
- Photos for meal estimates are sent to the AI provider named above. The optional Keep photo with meal setting stores one compressed photo in private storage; it can be removed at any time and is deleted with the meal or account.

3. Account Deletion:
Users can start permanent account deletion directly within the app by going to: Account Tab > Settings & Privacy > Delete Account. After the staged deletion succeeds, associated personal data is removed from active systems; operational backups age out under a 90-day retention policy.

Please let us know if you need any additional information or have any questions.
```

---

## 5. Manual Store changes for the 2026-10-21 Production release (Adam)

**Use [STORE_PRIVACY_CHECKLIST_2026-10-21.md](STORE_PRIVACY_CHECKLIST_2026-10-21.md) for the click-by-click steps.** It was checked against Apple's and Google's definitions on 2026-10-21 and adds the opt-in product analytics rows (Apple Product Interaction, Google App interactions) that this section omits.

Date prepared: 2026-10-21. These are Adam's manual actions in the Store consoles. Preparing this list does not change any label, and none of them is recorded as done. Perform them before submitting the new Production build, and only after `docs/PRIVACY_POLICY.md` has been published at the Privacy Policy URL (publishing the website is a separate action in `/Users/adam/Documents/mizyun-website`). ADR-0077 requires the policy, this document and the Store labels to name Anthropic before a Store build carries the new consent wording.

### 5.1 App Store Connect > App Privacy (edit the existing answers, then Publish)

Compare against the previous answers (Section 2 before this update: Email Address, Health/Fitness, Photos or Videos, Other User Content, User ID, Crash Data/Performance).

1. **Contact Info > Name**: ADD. Collected, linked to user, not used for tracking, purpose App Functionality (Community display name). Judgement call; see the Name note in Section 2.
2. **Health & Fitness**: keep **Health** and **Fitness** collected, linked, not tracking, App Functionality. Reconfirm both are selected now that selected runs are imported from Apple Health and saved to the account.
3. **User Content > Photos or Videos**: keep collected, linked, not tracking, App Functionality. The change is only the description: meal photos can now be stored on Mizyun servers.
4. **User Content > Emails or Text Messages**: ADD. Collected, linked, not tracking, App Functionality (Community direct messages and comments).
5. **User Content > Other User Content**: keep; now also covers Community posts, bios and reports.
6. **Identifiers > User ID**: keep (also covers the Community handle).
7. **Tracking**: keep **No**.
8. Check the third-party-partners question as described in Section 2 (Anthropic and Google process AI data on Mizyun's behalf). Apple definitions were not re-verified in this preparation; read the current App Store Connect help text when answering.
9. **Privacy Policy URL**: unchanged URL, but the page must show the version effective 2026-10-21.

### 5.2 App Store Connect > other fields

- **Age rating questionnaire**: re-answer for user-generated content and messaging/chat (Community has comments, direct messages and shared photos). The current 12+ rating was set before Community; confirm the resulting rating.
- **App Review Information**: paste the updated notes from Section 4 and supply synthetic reviewer accounts that can demonstrate report, block, and Health-run import. Apple App Review Guideline 1.2 (user-generated content) expects filtering, reporting, blocking and published contact details; the in-app Community standards and support route must be reachable from the build (see `docs/COMMUNITY_LEGAL_STORE_CHECKLIST.md`).
- **Description / What's New**: use Section 1 text. The previous description advertised a private progress photo timeline; `enableProgressPhotos` is still Dev-only in `apps/mobile/app.config.js` (checked 2026-10-21), so that bullet was removed. Re-add it, and the progress-photo rows' wording, only if the Production build enables progress photos.
- **Health data (Guideline 5.1.3)**: confirm Health data is not used for advertising or data mining and is not stored in iCloud; the privacy policy states the Health run import behaviour.

### 5.3 Google Play Console > Data safety (edit and Submit)

1. **Personal info**: ensure **Email address**, **User IDs** and **Name** are declared as collected (Name is NEW for the Community display name), purpose App functionality, not shared with advertisers.
2. **Health and fitness**: **Health info** and **Fitness info** collected, App functionality. Fitness info now includes runs imported from Health Connect, runs, bouldering and Community-shared workouts.
3. **Photos and videos > Photos**: collected, App functionality; retained meal photos are stored on Mizyun servers (before this release photos were described as used for analysis and private progress photos).
4. **Messages > Other in-app messages**: ensure declared (Coach chat and cooking assistant; NEW Community direct messages and comments).
5. **App activity > Other user-generated content**: ADD (Community posts, bios, reports) if not already declared.
6. **Data sharing**: re-evaluate AI providers per Section 3 item 5 using Google's current definition. Data transferred to a service provider on Mizyun's behalf is not "sharing" under Google's published definition as understood when this was prepared; confirm with the current Play Console help.
7. **Data deletion / retention**: describe in-app account deletion, per-item removal, and the 90-day backup retention. Keep the deletion URL current.
8. Complete **Health apps** and **Health Connect permissions** declarations (running sessions and distance, steps) and the **user-generated content** declaration; check the **Child Safety Standards** applicability (Community checklist) and the **content rating** questionnaire for UGC and messaging.

### 5.4 Not verified by this preparation

- Neither console's current wording, category names or definitions were opened. Label names above are those in this document's earlier version plus the categories named in Apple's and Google's questionnaires as known when this was written.
- That the Production build and backend actually behave as the policy and these answers describe (routing by feature, consent-version handling, meal photo storage enabled, Health run import enabled, Community retention cleanup running) is not established by documentation edits; it needs the release's own verification.
- No legal review of the Community terms, privacy lawful basis, GDPR/DSA applicability or child-safety applicability has been supplied; see `docs/COMMUNITY_LEGAL_STORE_CHECKLIST.md`.
