# Mizyun Store Listing & Review Disclosures Guide

This document contains copy-pasteable metadata, App Privacy responses, Data Safety declarations, and Reviewer Notes for submitting **Mizyun** to **Apple App Store Connect** and **Google Play Console**.

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
Mizyun is your private, all-in-one fitness and nutrition workspace. Designed for intermediate and dedicated gym-goers, Mizyun unifies your food tracking, workout progression, body metrics, and progress photos with an intelligent, memory-aware AI coach.

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
• Encrypted, private progress photo timeline with side-by-side comparison.

🤖 Memory-Aware AI Coach
• Context-aware guidance grounded strictly in your confirmed nutrition, workouts, and personal goals.
• Conversational routine modifications and multi-session training proposals.
• User-controlled long-lived memories: inspect, edit, or delete remembered facts at any time.

🔒 Private & Transparent by Default
• Your health data and photos are strictly yours. Built with database Row Level Security.
• No public feeds, no selling data, and no third-party model training on your private progress photos.
• Complete data export and staged in-app account deletion; operational backups age out under a 90-day retention policy.

Note: Mizyun is an informational fitness and nutrition tool and is not intended to replace professional medical advice, diagnosis, or treatment.
```

---

## 2. Apple App Privacy Details ("Nutrition Labels")

When completing the **App Privacy** questionnaire in App Store Connect:

| Data Category        | Data Type                | Collected? | Linked to User? | Used for Tracking? | Purpose of Collection                                                            |
| :------------------- | :----------------------- | :--------- | :-------------- | :----------------- | :------------------------------------------------------------------------------- |
| **Contact Info**     | Email Address            | **Yes**    | **Yes**         | **No**             | App Functionality (Account authentication, password reset, security notices)     |
| **Health & Fitness** | Health / Fitness         | **Yes**    | **Yes**         | **No**             | App Functionality (Nutrition logs, workouts, body weight, BMR/TDEE calculations) |
| **User Content**     | Photos or Videos         | **Yes**    | **Yes**         | **No**             | App Functionality (Meal photo analysis, private progress photos)                 |
| **User Content**     | Other User Content       | **Yes**    | **Yes**         | **No**             | App Functionality (Workout notes, custom exercises, coach chat messages)         |
| **Identifiers**      | User ID                  | **Yes**    | **Yes**         | **No**             | App Functionality (Database user identification)                                 |
| **Diagnostics**      | Crash Data / Performance | **Yes**    | **No**          | **No**             | Analytics / App Functionality (Error request IDs without PII)                    |

- **Data Tracking:** Answer **"No"** (Mizyun does not track users across third-party apps or websites for advertising).

---

## 3. Google Play Data Safety Form

When filling out Google Play Console **Data Safety**:

1. **Does your app collect or share any user data?** -> **Yes**
2. **Is all user data encrypted in transit?** -> **Yes** (HTTPS/TLS)
3. **Do you provide a way for users to request that their data be deleted?** -> **Yes** (Direct in-app account deletion under Account Settings and online contact).
4. **Data Types Collected**:
   - **Personal info**: Email address (Account management).
   - **Health and fitness**: Fitness info, other health info (Nutrition, workouts, body measurements).
   - **Photos and videos**: Photos (Meal photo analysis, private progress photos).
   - **Messages**: In-app messages (AI Coach conversations).
   - **App info and performance**: Crash logs, diagnostics (App functionality).
   - **Device or other IDs**: User ID (Account management).
5. **Data Sharing**: Mizyun **does NOT share** data with third-party advertisers or data brokers.

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
- Mizyun features an AI-assisted meal draft estimator and a conversational fitness coach.
- Strict Human-in-the-Loop: In accordance with App Store guidelines, all AI meal scans and suggestions are generated as PROPOSALS/DRAFTS and require explicit user review and confirmation before being saved to the user's permanent timeline.
- Medical Disclaimer: Mizyun is an informational fitness tool and does not provide medical diagnosis. Disclaimers are clearly presented during onboarding and in the Coach tab.

3. Account Deletion:
Users can start permanent account deletion directly within the app by going to: Account Tab > Settings & Privacy > Delete Account. After the staged deletion succeeds, associated personal data is removed from active systems; operational backups age out under a 90-day retention policy.

Please let us know if you need any additional information or have any questions.
```
