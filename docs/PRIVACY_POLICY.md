# Mizyun Privacy Policy

**Last Updated:** September 3, 2026

Welcome to **Mizyun** ("we", "our", or "us"). We provide a private fitness, workout, nutrition tracking, and AI-assisted coaching application. We are committed to protecting your privacy and treating your health and fitness data with the highest standards of confidentiality and security.

This Privacy Policy explains how we collect, use, disclose, and protect your information when you use our mobile application and related services (collectively, the "Service").

---

## 1. Information We Collect

### A. Account & Identity Information

- **Email Address & Password**: Used for authentication, session restoration, and password recovery.
- **User Identifier**: A unique cryptographic ID bound to your account session.

### B. Health, Fitness & Nutrition Data

- **Profile & Physical Attributes**: Height, birth year, baseline weight, sex at birth, activity level, and goal preferences.
- **Nutrition Entries**: Logged foods, meals, calories, macronutrients (protein, carbohydrates, fat), timestamps, and optional user notes.
- **Training & Workout Data**: Exercises, workout routines, completed sets, reps, load/weights, duration, distance, and perceived exertion (RPE).
- **Body Measurements & Progress History**: Weight logs and optional body circumferences (e.g., waist, chest).

### C. User Media (Photos)

- **Meal Photos**: Selected images sent securely to generate nutrition drafts.
- **Progress Photos**: Private longitudinal photos captured or selected by you. **These photos are stored in encrypted private buckets with Row-Level Security, accessible only via temporary, time-limited signed URLs generated for your authenticated session.**

### D. AI Conversations & Coach Interactions

- Chat messages, questions, and fitness guidance requests exchanged with the AI Coach.
- User-controlled long-lived memories and preferences that you explicitly review, edit, or delete.

---

## 2. How We Use Your Information

We use your data solely to provide, personalize, and improve your fitness tracking experience:

1. **Deterministic Calculations**: Calculating your basal metabolic rate (BMR), total daily energy expenditure (TDEE), and daily surplus/deficit.
2. **Progress & Progression Tracking**: Generating charts for workout volume, 1RM progression, weight trends, and longitudinal photo comparisons.
3. **AI-Assisted Logging & Coaching**: Providing structured nutrition estimates from meal descriptions/photos and contextualized fitness guidance based strictly on your confirmed logs.
4. **Account Administration**: Authenticating logins, sending verification and security emails, and managing your active session.

---

## 3. Privacy-First AI & Third-Party Processing

- **Advisory Drafts Only**: AI output (e.g. meal photo scans and coaching suggestions) is presented strictly as editable drafts. No AI estimate becomes authoritative or modifies your timeline without your explicit confirmation.
- **No Training on Your Private Photos or Health Data**: We do not use your private progress photos or personal health records to train third-party public models.
- **Google Gemini API Subprocessor**: AI features are powered by Google LLC (&ldquo;Google Gemini API&rdquo;). When you use AI Coach or meal photo drafting, your prompt, photo bytes, and relevant confirmed fitness logs (workout summaries, goals, confirmed meals, weight trends) are transmitted securely to Google for inference.
- **Processing & Retention**: Under Google Gemini API commercial terms, data is processed transiently to generate responses and is not used to train Google&rsquo;s public foundation models. Logs may be retained by Google for abuse monitoring for up to 30 days. Processing may occur in data centers internationally.
- **Adult Eligibility (18+)**: Under Google API Terms of Service, AI features require adult eligibility (18 years of age or older).

---

## 4. Data Storage, Security & Isolation

- **Row Level Security (RLS)**: Every user table in our database enforces strict Postgres Row Level Security. User A cannot view, mutate, or access User B's data under any circumstance.
- **Encrypted Storage & Transmission**: All data in transit is encrypted using modern TLS (HTTPS). Media is stored in private, unguessable storage paths with short-lived signed access tokens.
- **Strict Module Isolation**: Client applications never hold administrative or service-role keys.

---

## 5. Your Rights: Access, Export & Deletion (GDPR & CCPA)

You have full ownership of your data. Directly within the Mizyun app (under **Account > Settings & Privacy**), you can:

- **Export Your Data**: Request and download a complete JSON archive of all your profile, food, workout, body measurement, photo metadata, and conversation history.
- **Inspect & Delete AI Memories**: View all facts the AI Coach has retained, deactivate them, or delete them individually or entirely.
- **Permanent Account Deletion**: Trigger a permanent, irreversible two-step deletion of your account. This cascades and permanently deletes your auth identity, profile, goals, food entries, workouts, sets, body measurements, conversations, and all private media files.

---

## 6. Children’s Privacy & Age Restrictions

Mizyun is not directed to children under 13 (or under 16 in the EEA/UK). Furthermore, all third-party AI features (AI Coach and meal photo drafting) strictly require users to be at least 18 years of age in accordance with provider API terms. Minors are not permitted to use AI features.

---

## 7. Contact Us

If you have any questions, concerns, or requests regarding this Privacy Policy or your data, please contact us at:

- **Email:** support@mizyun.phiskel.com
- **Website:** https://phiskel.com
