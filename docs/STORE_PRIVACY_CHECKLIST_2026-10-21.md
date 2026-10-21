# Store privacy checklist — release 1.0.10 (10), 2026-10-21

Adam's manual steps in App Store Connect and Play Console for the 2026-10-21 Production release ([ADR-0078](adr/0078-production-feature-release-2026-10-21.md)). Do them after the updated privacy policy is live at https://www.phiskel.com/mizyun/privacy and before submitting build 1.0.10 (10). Nothing here is recorded as done.

Definitions were checked on 2026-10-21 against Apple's [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) and Google's [Data safety help](https://support.google.com/googleplay/android-developer/answer/10787469). Console button names can differ slightly from this text.

What changed in the app and why the answers change:

- **Community:** profiles with handle and display name, posts and cards, comments, direct messages, reactions, follows, groups, challenges, reports and blocks.
- **Retained meal photos:** now stored on Mizyun servers.
- **Health run imports:** reads the runs the user picks (HealthKit or Health Connect) and saves them to the account.
- **Indoor bouldering:** sessions, grades and projects.
- **AI vendors:** Anthropic (Claude) now processes Coach chat, typed meal estimates and draft changes, and Log activity. Google (Gemini) does everything else.

## 1. App Store Connect — App Privacy

App Store Connect → Apps → Mizyun → **App Privacy** (sidebar) → **Data Types: Edit**. Changes apply without a new build.

1. In the data-type list, make sure these boxes are ticked. The ones marked **ADD** are new.
   - **Contact Info:** Email Address; **Name (ADD)**.
     - Community profiles have a user-chosen display name. Apple defines Name as "first or last name". Ticking it is the conservative answer.
   - **Health & Fitness:** Health; Fitness.
     - Apple's Health type explicitly includes HealthKit API data, so the run import keeps Health required.
   - **User Content:** Photos or Videos; **Emails or Text Messages (ADD)**; Other User Content.
     - Apple: "You offer in-app private messaging between users … Declare emails or text messages."
   - **Identifiers:** User ID. Apple's definition includes a screen name or handle.
   - **Usage Data → Product Interaction (ADD):** opt-in product analytics, stored with the account ID (section 4).
   - **Diagnostics:** keep the current answer.
   - Leave **Location, Contacts, Financial, Sensitive Info, Browsing/Search History, Purchases, Audio** unticked. None of these are collected. Run imports carry distance and time, not routes.
2. Select **Save**, then answer the questions for each ticked type. For every type: **Linked to the user: Yes**, **Used for tracking: No**.
   - **Purposes:** **App Functionality** for every type.
   - Add **Analytics** on Product Interaction, and on Diagnostics if it is already there.
   - Don't tick Third-Party Advertising, Developer's Advertising or Marketing, or Product Personalization.
3. On the summary, check that **Data Used to Track You** is empty, then select **Publish**.
4. App Store Connect → Mizyun → **App Information**:
   - **Privacy Policy URL** stays `https://www.phiskel.com/mizyun/privacy`. Open it and check it shows the 2026-10-21 version.
   - Optionally set **Privacy Choices URL** to `https://www.phiskel.com/mizyun/delete-account`.
5. **Age Rating** (App Information → Age Rating → Edit):
   - Answer **Yes** to user-generated content and to messaging or chat.
   - Keep the medical/health answers as before.
   - Save the resulting rating. The current rating is 12+, set before Community existed. Community and AI check adult eligibility (18+) on the server, but the rest of the app has no age gate.
6. On the 1.0.10 version page:
   - **App Review Information → Notes:** paste the notes from `docs/STORE_LISTING_DISCLOSURES.md` section 4. They cover both AI providers, Community moderation, the Community Standards link, and Health import.
   - Give a working demo account. Reviewers check Guideline 1.2 for reporting, blocking, published standards and contact details.
   - **What's New and Description:** use section 1 of the same document.

## 2. Play Console — Data safety

Play Console → Mizyun → **Policy and programs → App content → Data safety → Manage**. Submit sends it to review with the next update.

1. **Data collection and security**:
   - Collects or shares required data: **Yes**.
   - Encrypted in transit: **Yes**. Every API and Supabase call is HTTPS.
   - Users can request deletion: **Yes**. In-app account deletion, plus `https://www.phiskel.com/mizyun/delete-account`.
2. **Data types**: tick these (**ADD** = new).
   - **Personal info:** Email address; **Name (ADD)**, since Google's definition includes a nickname; User IDs.
   - **Health and fitness:** Health info; Fitness info.
   - **Messages:** **Other in-app messages**. This covers Coach and cooking-assistant chat, plus the new Community messages and comments.
   - **Photos and videos:** Photos.
   - **App activity:**
     - **Other user-generated content (ADD):** posts, bios, reports, notes.
     - **Other actions (ADD):** reactions, follows, challenge joins.
     - **App interactions (ADD):** opt-in product analytics (section 4).
   - **App info and performance:** keep the current answer.
3. **Data usage and handling**, for each ticked type:
   - **Collected: Yes.** **Shared: No.** Google exempts transfers to service providers that process data on your behalf, which covers Anthropic, Google Gemini, hosting and email.
   - **Processed ephemerally: No.** It is stored.
   - **Required or optional:**
     - **Optional:** Name, messages, user-generated content and other actions (Community is optional); Photos; App interactions (opt-in).
     - **Required:** Email, User IDs, Health and Fitness info.
   - **Purpose: App functionality.** Add **Analytics** for App interactions.
4. Check the **Store listing preview**, then **Submit**.
5. **App content**, other declarations:
   - **Health apps:** declare fitness and nutrition tracking.
   - **Health Connect permissions:** read exercise sessions and distance (run import) and steps. Use the same wording as the permission rationale screen.
   - **Content rating** questionnaire: re-answer **Yes** for user interaction and user-generated content (users can interact and exchange content).
   - **Target audience:** keep the current age groups. The app itself has no global age gate, but Community and AI features check adult eligibility (18+) on the server. If the target audience includes under-18 groups, Play's Families requirements apply to the whole app, so choosing 18+ is simplest.
   - **Child Safety Standards** declaration: required for apps with user-generated content and social features. Link the published Community Standards (`https://www.phiskel.com/mizyun/community-standards`) and give the safety contact `adoh811@gmail.com`.

## 3. Builds to upload

- **iOS:** the IPA under `apps/mobile/dist/releases/ios/app-store/packages/1.0.10-10-…/`, uploaded with Transporter.
- **Android:** the signed AAB under `apps/mobile/dist/releases/android/google-play/`.

## 4. Product analytics (checked in code on 2026-10-21)

Production builds include optional product analytics: Settings → Support → "Help improve Mizyun". It is off by default and separate from AI consent.

- **What is sent:** coarse event names (session start, screen viewed, onboarding steps, logging flow outcomes, feature action results) with an event ID, session ID, platform, app version, build and timestamps.
- **Storage:** events are stored in `product_analytics_events`, linked to the account.
- **Retention:** events are deleted after 30 days. Turning analytics off or choosing Clear deletes them at once.
- **Export and deletion:** events are included in the account export and deleted with the account.
- **Third parties:** no third-party analytics SDK is used.

So the analytics rows above apply:

- **Apple:** **Usage Data → Product Interaction**. Linked: Yes. Tracking: No. Purpose: Analytics. Apple's exemption for product-improvement programs requires data not linked to the user, so it does not apply here.
- **Google:** **App activity → App interactions**. Collected: Yes. Shared: No. Optional. Purpose: Analytics.
