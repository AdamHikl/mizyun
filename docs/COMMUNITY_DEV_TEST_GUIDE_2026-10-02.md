# Community Dev testing guide

Prepared 2026-10-02 for Adam and the existing Dev testing partner. Start with the solo pass, then do the two-person pass together, then try the failure cases. Budget roughly 20 minutes solo and 60–90 minutes together; these are planning estimates. You can split the checks across sessions.

Integration update (2026-10-02): Adam authorized merging the implementation into `main`. Start subsequent fixes on a new `codex/` branch from current main. Historical branch/artifact references below describe guide preparation. The latest recorded iPhone Dev source is `3eb8735767db371e61738a64d5003b958ee938a0`, installed and launched; backend source remains `5492c9a9d6bcffb226d52952cde55d3f6db72790`. Physical acceptance remains separate; see [current status](../status.md). The current expansion hub is **Activities & sharing**, renamed from Together.

This is a test plan, not a record of tests passed. Mark each case **PASS**, **FAIL**, **NOT TESTED**, or **BLOCKED**, and write down what happened. A pass applies only to the steps, device and build actually tested.

## Before you start

1. Unlock the iPhone and open **Mizyun Dev**, not Mizyun. Use your existing Dev login. The installed candidate is standalone and should work without Metro or the Mac running.
2. The last installed iPhone candidate is `com.mizyun.development`, version `1.0.6 (6)`, runtime source **`5492c9a9d6bcffb226d52952cde55d3f6db72790`**. Its installation succeeded, but automatic launch was blocked by the locked phone. Opening, sign-in and feature journeys remain to be accepted. Older binaries use the same version, so the version label alone does not identify the candidate. Ask me to verify/reinstall if uncertain.
3. Call yourself **A** and your partner **B** in test notes. Both need the current standalone Dev app and their separately admitted adult Dev accounts. Only A's installation is recorded for this candidate; verify B's build before counting two-person results. Two phones are best. With one phone, you can check account switching, but simultaneous revocation checks remain BLOCKED.
4. Use the existing founder/partner testing scope. If a feature says unavailable, record the account alias, screen and message; do not create more accounts or change server flags to get past it.
5. Start at the **Community** tab. Preferences are also under **Account → Privacy & data → Community**, or Account search for Community. The seven expansion features are under **Community → Together**.
6. Create harmless fixtures: a workout titled `TEST Community Oct 2`, a private note `PRIVATE NOTE — must never appear`, a routine with ordinary exercise names and numeric targets such as 3 sets of 8–12 reps at 10 kg, and a photo of a plain object. Use no health photos, personal details in custom exercise names, or real abusive content.
7. Leave your real history alone. Only delete fixtures you created for this test. Leave Community and account-deletion checks come last and have separate prerequisites below.

Current Dev push delivery is **off**. No notification on the lock screen is expected and does not prove a push bug. In-app updates/preferences can still be checked. Photos require independent moderator approval before followers can see them.

## Record your run

Copy this into your own notes. Keep screenshots and recordings redacted; do not put private health data, passwords, access tokens, full exports or private photos into Git commits or public issues.

```text
Date/time/timezone:
A: device / OS / confirmed build source:
B: device / OS / confirmed build source:
Network: Wi-Fi / mobile data / offline
Test fixtures created:

Case | PASS / FAIL / NOT TESTED / BLOCKED | What happened / bug reference
S1   |
S2   |
S3   |
C1–C7: record each separately
E1–E7: record each separately
F1–F6: record each separately
L1–L3: record each separately

Remaining checks / reasons:
Cleanup performed:
```

## Solo pass

| Case                           | What to do                                                                                                                                                                                                                                                                    | Expected result                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1 — launch and navigation** | Open Dev, sign in, switch Home → Workouts → Community → Account → Community several times. Open Together and return. Force-quit and reopen. Try the same with the Mac off or disconnected.                                                                                    | Standalone sign-in and navigation work. No repeated layout jump, endless spinner, blank unusable page or crash. Returning data may revalidate; loading should settle or offer a clear error/retry.                                                                                                         |
| **S2 — voluntary enrollment**  | If you have not joined, first decline/cancel and log a private workout. Then deliberately join, review adult/rules confirmations and choose your Community identity. If already joined, record enrollment as NOT TESTED until L1 rather than leaving now.                     | Declining preserves private tracking. Agreement is deliberate. Joining does not publish workouts, enable optional sharing, or automatically follow people. Community identity is separate from private account details.                                                                                    |
| **S3 — exact workout preview** | Complete the harmless test workout. Open **Share to Friends**. Review day/category, duration and **Include exercises, sets, reps and weights**. Toggle each optional choice and inspect the preview. Tap **Keep Private** once; then reopen and explicitly **Share to Feed**. | Optional details are separate choices; the preview matches every selected field. Cancelling shares nothing. Private workout title, notes, health integration, Coach context and unselected fields stay private. Custom exercise names are visible if details are selected, so inspect them before sharing. |

## Two-person core pass

Keep these relationships intact until the expansions are tested. Removal/blocking tests are later because they deliberately remove access.

| Case                                  | What to do                                                                                                                                                                                                                                                                                                                                             | Expected result                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1 — find and approve a friend**    | A enables exact-handle discovery in Community Profile. B searches A's complete handle and requests to follow. A checks requests and approves. Check requests/Followers/Following on both phones. Then A uses **Friends → Followers → Follow back** to request the reverse direction, and B separately approves; B need not enable exact-handle search. | Pending requests grant no workout access. Approval grants access in that direction only; it does not follow back. Both approvals are needed for mutual messaging. Approved followers can see still-published past workout cards; the publication preview discloses this.                                                                                   |
| **C2 — share link/QR**                | Share A's profile link/QR to B through a channel you already use. Open with Dev running, then closed, then signed out. Sign in and review the destination. Also try a malformed link.                                                                                                                                                                  | The intended Dev destination opens or safely explains sign-in/unavailability. A link never signs someone in, approves a follow, or exposes protected workouts. Wrong account/destination, silent Production routing or a crash is a bug. A broken app-link handoff should be reported with the exact redacted link type.                                   |
| **C3 — follower card and details**    | B refreshes the feed after S3, opens A's card and compares it with A's preview. A updates the card with optional details off using **Confirm Updated Card**. B refreshes again.                                                                                                                                                                        | Only deliberately shared fields appear. No private title/note/RPE/location/Coach data. Details disappear when removed; an older summary card does not gain details merely because the source contains them. Updating a card clears its encouragement reactions.                                                                                            |
| **C4 — encouragement and inbox**      | B adds then removes encouragement. A checks in-app updates, opens the related item, marks updates read and changes notification preferences.                                                                                                                                                                                                           | Repeated taps do not create duplicates. Counts/state recover after refresh. Inbox text does not reveal private workout details. With current delivery off, no device-push acceptance is claimed.                                                                                                                                                           |
| **C5 — unpublish and source changes** | A selects **Unpublish Workout** and confirms. B refreshes and retries the old card/link. A's private workout should remain. Share a second fixture, edit the private source and inspect the shared card; then delete only that fixture and retry access as B.                                                                                          | Unpublish removes current access. Private source edits do not silently rewrite the published snapshot; sharing an update needs a new explicit preview/confirmation. Deleting the source removes access to its shared card. Screenshots/copies someone already made cannot be recalled.                                                                     |
| **C6 — report and safety**            | Use a neutral fixture to submit one deliberate test report from a content/profile screen. Inspect reports/appeals/safety-contact navigation. Exercise cancel before submitting too.                                                                                                                                                                    | Correct target and reason are clear; cancelling sends nothing. Submission produces a clear outcome without exposing report text to the reported person. Staff response/timing is a separate operator check, not a promised immediate response.                                                                                                             |
| **C7 — relationship revocation**      | After E1–E7, test mute/unmute, B unfollowing A, A removing B as follower, then block/unblock. Keep B on a previously authorized content screen during each change; refresh and retry old links. Re-request/reapprove only when needed for the next case.                                                                                               | Mute hides the author from your feed; it is not a promise to revoke their access to your content. Unfollow/remove follower end access in the affected direction. Block ends both follows and pending requests and prevents interaction. Unblocking restores nothing; new requests/approvals are needed. No stale content returns on navigation or refresh. |

## The seven expansions

Do these before C7 and before leaving Community. Refresh/search/list again immediately before interacting if a protected result has expired; see F2.

### E1 — comments and mentions (#156)

1. A publishes a fixture workout; B opens **Comments and conversation choices**. Confirm that comments are closed until A selects **Open comments on this workout**.
2. B writes harmless plain text, confirms the audience and taps **Publish comment**. A refreshes the thread. Try **Reply to …**, **Edit my comment**, **Remove comment**, and a neutral **Report comment**.
3. Try an empty comment, paste over 500 characters, a URL and a typed contact detail. Native input may truncate text at its limit; inspect the actual draft before sending. A constrained input, disabled publish or clear refusal is expected; invalid text must not publish. Replies support one level; do not expect arbitrary nested conversations.
4. Test mentions only after the recipient explicitly chooses **Allow approved friends to mention me** and has access to the workout. Use the offered person selection, not typed `@` text. Turning mention consent off must remove eligibility; it must not enable itself again.
5. A closes comments or unpublishes the fixture. B refreshes the old thread. Closed conversations reject new comments; revoked workout access must not expose the old thread. Defer removing B's follow to C7 so later expansion prerequisites remain intact.

**Expected:** correct author/audience, deliberate writes, no duplicate comments, no unauthorized edits or hidden-content access. **Conversation and mentions** in Together opens preferences/updates; it is not itself a workout thread. Record whether author controls and retry states are understandable.

### E2 — private groups (#157)

1. A opens **Private groups → Create a private group** and creates `TEST Oct 2`. Invite B from approved following. Before accepting, B checks that a pending invite grants no member content; then B selects the group and **Accept this invitation**.
2. A posts harmless text after B joins, selecting **Confirm this text is for the current group members → Publish this group post**. B refreshes and sees it. Private workouts must not appear automatically.
3. Exercise the alternative entry on a separate fixture group: A chooses **Create a seven-day request code**; B enters it under **Private invitation code → Request to join**; A selects **Approve request**. A request alone grants no content.
4. **Run E3 before this step.** Test roles and membership with fixtures: remove B, attempt old content as B, request/join again, and inspect role changes. New members see posts created after their current join, not earlier group history. A ban should prevent joining; inspect the offered appeal path rather than expecting automatic reinstatement.
5. After E3, transfer ownership deliberately to the other tester, verify only current permissions work, and have the old owner leave. Test the final-owner guard or disband only your test group; do not strand a real group.

**Expected:** explicit acceptance, current-member audience, clear role restrictions, no access through old codes/links after removal. Order: E2 steps 1–3 → E3 → E2 steps 4–5.

### E3 — cooperative challenges (#158)

1. **B must join the group before A creates this challenge.** Inside that group select **Cooperative goals · add progress yourself**. The current native creation flow uses seven days, a four-day goal and the device timezone; it does not offer an arbitrary goal/date editor.
2. Both explicitly choose **I choose to join and share my consistency declarations**. Neither group membership nor private workout completion should automatically declare progress.
3. On one account, select **Confirm today as a rest or recovery day**. On the other, complete a new test workout **after joining the challenge**, then **Choose a completed workout from today → Confirm workout: …**.
4. Attempt to use an earlier-today workout completed before joining: refusal is expected. Try declaring both rest and workout for the same day: it must not count twice. Check any displayed removal/leave/cancel controls and refresh both phones.
5. Repeat on later days if you want to accept the full seven-day journey. Record that separately; a same-day pass cannot prove week completion, timezone rollover or final outcome.

**Expected:** missing days are “not declared”, not zero effort; rest is valid progress; one declaration per person/day. No calorie/weight competition, ranking or automatic activity exposure. Together's **Shared challenges** entry is for management; creation requires a group.

### E4 — mutual text messages (#159)

1. Confirm both follow directions from C1. With one person's consent off, try finding/messaging them: they should be unavailable.
2. Both explicitly choose **Enable messages from mutual friends**, then **Find mutual friends who enabled messages**. Select the other tester, type **Message**, and **Send message**. Refresh the recipient's conversation.
3. Test **Replace with current draft**, **Delete for both people**, and a neutral **Report message**. Empty text and URLs must not publish. Paste over 1,000 characters: native input truncation or a clear refusal is expected; inspect the actual draft. Repeated send taps/retries must not duplicate the message.
4. Turn messaging off on B while A has the conversation open. Recheck both phones. Neither should continue reading/sending through stale state. A can still use **Manage my sent messages** to delete A's own retained sent records.
5. Test **Block this friend** later, after other expansions, then unblock. Consent alone must not restore the removed mutual follows.

**Expected:** both independent consents plus mutual approved follows are required. Text only; there are no attachments, online presence or read receipts. Refresh is manual. This is not end-to-end encrypted messaging; do not use sensitive text as a fixture.

### E5 — selected photos and review (#160)

1. Open **Community photos → Choose a new image**. Cancel the native picker once. If a permission prompt appears, test denial/recovery without granting unrelated access. No photo should upload from cancelling or merely opening this screen.
2. Select the plain-object fixture. Add **Image description for accessibility**, review the image and pictured-person rights/permission choice, then **Confirm preview and submit for review**. Test **Discard selected image** separately.
3. Check that the submitted photo is pending and visible to its owner for management, while B cannot view its pixels. An ordinary account's **Moderator review** denial is expected; self-approval is forbidden.
4. **BLOCKED unless an independent named moderator with current MFA is available:** have that operator approve the fixture, then B refreshes and checks the approved image/description. Approval is never automatic and we do not turn a tester into staff for this test.
5. A uses **Manage my images → Remove image**. Retry as B, including any previously open approved image. Access must end; reported images may remain restricted case evidence under retention rules.

**Expected:** no automatic progress-photo sharing, precise selected preview, pending quarantine and immediate access revocation on removal. Real byte deletion/metadata stripping/retention cleanup need operator evidence; a phone screen alone cannot prove them.

### E6 — independent routine copies (#161)

1. A opens **Share a routine**, chooses the harmless private routine, enters **Public routine title**, selects **Preview exact shared targets**, then **Confirm and share this preview with approved followers**.
2. Check every exercise and numeric target in the preview. Private title/notes/unselected data must not be copied into the shared plan. Unsupported targets should refuse preview with useful guidance.
3. B selects **Import an independent private copy → Confirm import**, then finds and edits the new private routine in Workouts. Verify attribution and targets. Retry the same import: it should return the existing imported copy rather than create duplicates.
4. Before revoking the share, try **Report unsafe routine** on the neutral fixture once. Edit B's imported routine and verify A's source is unchanged. Edit A's source and verify B's existing copy is unchanged. B refreshes: the original share is now unavailable for new reads/imports because its source revision changed. A's stale preview/share/import must refuse that old revision. Retrying a completed import may still return the existing independent copy; it must not create a new copy of a revoked share.
5. A refreshes and explicitly previews/publishes a new share. B checks that it is newly available. A then uses **Manage my shared routines → Unshare routine** or deletes only the fixture source. B cannot newly access/create an import of that shared plan, but the already imported private copy remains; a retry may return that existing copy.

**Expected:** deliberate preview/import; independent copies; current access checked at import. Sharing uses bounded numeric repetition targets and kg/lb loads, not every private routine target type.

### E7 — consenting prefix discovery (#162)

1. A opens **Discover friends → Let members find my handle prefix**. B enters at least three starting characters under **First characters of a friend's handle**, then **Search consenting members**.
2. B tries the result's follow action. Because B already follows A from C1, **You already follow this person** is expected; it must not create a duplicate request. The new-request path is **Request to follow @… → Send request** when not already following. Test that path later after C7 if desired; keep the earlier mutual relationship intact for other expansions. Approval remains deliberate; search grants no workout access.
3. A chooses **Turn prefix discovery off**. B searches again: A must disappear from eligible prefix results. Existing approved follows need not disappear merely because search consent is off.
4. Compare this control with Profile's exact-handle search control. They are separate choices. Try fewer than three characters; guidance and a disabled Search button are expected. Use only a few queries: throttling/limits are deliberate, not a reason to exhaust the daily quota.

**Expected:** minimal consenting-member results, no public Explore, address-book upload or automatic following. The search is bounded, not a full member directory.

## Try to break it

| Case                                   | What to do                                                                                                                                                                                                                   | Expected result / what to report                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1 — no connection and retry**       | Turn off Wi-Fi and mobile data; Airplane Mode alone may leave Wi-Fi on. Open feed, send a fixture message/comment, or attempt sharing. Restore the connection and deliberately retry once.                                   | Clear unavailable/retry state; no false success, automatic delayed publication, duplicate content or endless busy state. If the first request might have reached the server, refresh first; do not assume an error means nothing was saved.                                                                                                                                                                                                                                   |
| **F2 — expired authority**             | On each expansion screen, refresh, inspect content, wait beyond 10 seconds, then try acting. Also leave a request pending by disconnecting.                                                                                  | Protected expansion results have a 10-second deadline measured from request start. Content/actions should retire, including stalled responses. Most screens need **Refresh**, search or list again; comments can hide then automatically reread. No automatic write occurs. Draft comments may survive idle expiry, but stale reply/edit/mention targets retire. Record confusing repeated retyping/reloading as a usability issue; expired data clearing itself is expected. |
| **F3 — background and account switch** | Open protected content/draft, lock the phone or switch apps, then return. Sign out and sign in as the other tester on a shared device; try an old link. Repeat during a loading request.                                     | Protected screen state clears on background/identity change; a late response must not restore the previous person's data. Expansion comment drafts clear on explicit blur/background. Deliberate private routine/photo previews are not published and must not cross accounts. No wrong-account data flash or write.                                                                                                                                                          |
| **F4 — revocation while viewing**      | B keeps content open while A unpublishes, removes membership/follow access, blocks, disables messaging, or removes a photo/routine. Test both foreground and background/return; wait beyond the expiry deadline and refresh. | Current access ends and old links/actions fail safely. Expansion authorization expires within its deadline; cached material must not reappear after refresh/account switch. Report any retained interactive access or resurrected content with exact timing.                                                                                                                                                                                                                  |
| **F5 — fast taps and old prompts**     | Double-tap send/confirm/import; open an edit/reply/share prompt, change its target or navigate away, then return and confirm.                                                                                                | At most one deliberate result. Old prompts cannot publish to the wrong workout/person/group or use stale consent. A refused stale confirmation should explain how to refresh and retry.                                                                                                                                                                                                                                                                                       |
| **F6 — accessibility and layout**      | Try light/dark appearance, large text, keyboard open, landscape if supported, and VoiceOver on enrollment, preview, comments, groups, messages and report/block controls.                                                    | Readable contrast and unclipped text; controls remain reachable above the keyboard; focus order, labels, checked state, audience and errors are spoken clearly. iPhone results do not accept Android/TalkBack. Mark missing hardware NOT TESTED.                                                                                                                                                                                                                              |

For VoiceOver, use **iPhone Settings → Accessibility → VoiceOver** and practice its gestures before testing. It changes how you operate the phone; Apple's [VoiceOver guide](https://support.apple.com/en-euro/guide/iphone/iph3e2e415f/ios) includes a tutorial and the on/off options.

## Cleanup and lifecycle — last

| Case                                 | Prerequisite and steps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Expected result                                                                                                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1 — leave and rejoin Community**  | **Optional; mark NOT TESTED if you want to preserve existing Community history.** Leaving withdraws that account's entire Community participation, choices, history and access, not just fixtures. Proceed only when the leaving tester accepts that consequence and both agree to rebuilding relationships. Transfer/disband owned groups first. Leave Community through its preferences. B checks old content/links; A checks private workouts/routines still exist. Rejoin deliberately only after checking withdrawal. | Private tracking remains. Old social profile/access/shares/relationships are not automatically restored by rejoining. Fresh choices are required. Cleanup can be asynchronous, but current access must close immediately. Do not treat rejoin as an undo button. |
| **L2 — export and account deletion** | **Operator-assisted, BLOCKED until a separately authorized disposable Dev account is prepared.** Inspect its export, delete it, and attempt old content/session/media access. Do not delete either tester's real account to run this case.                                                                                                                                                                                                                                                                                 | Export contains the account's allowed records without another person's private data. Deletion/retries remove current access and complete cleanup with operator evidence. A downloaded export is sensitive and stays outside Git.                                 |
| **L3 — fixture cleanup**             | Remove remaining test publications, comments/messages, photos, groups/challenges and imported/private fixture routines as appropriate. Clear only the fixtures you created; restore your desired consent settings deliberately.                                                                                                                                                                                                                                                                                            | No unexpected test content remains accessible. Record anything that could not be removed and its exact error rather than assuming cleanup succeeded.                                                                                                             |

## When you find a bug

Record one reproducible problem per report. For a privacy or wrong-account exposure, preserve redacted evidence and stop that particular flow; continue unrelated checks with harmless fixtures.

```text
Title: [Community Dev] <short observable problem>
Case ID / related issue:
Date/time/timezone:
Device / OS / confirmed source SHA:
Account aliases involved: A / B
Network and foreground/background state:
Steps: 1. ... 2. ... 3. ...
Expected:
Actually happened:
Reproduces: <times failed>/<attempts>
Impact: privacy/access / blocks task / confusing UX / cosmetic
Redacted screenshot/video or displayed request ID, if available:
Workaround / cleanup attempted:
```

Send me the report and I can reproduce, add a regression at the actual failure boundary, fix it, and retest. For GitHub tracking: core work is #140–155, comments #156, groups #157, challenges #158, messaging #159, photos #160, routines #161, discovery #162; current detailed-sharing work is #167. Existing closed issues stay closed unless a new regression warrants reopening or a linked issue.

## How we commit and push

The implementation is already backed up on **`origin/codex/community-140-145`**. As verified on 2026-10-02, the local and remote branch are both `d1ee160612bf5c6d25805b92fe71ab4ff5236b2e` before this guide change.

| Existing commit                            | Role                                             | Deployment evidence                                            |
| ------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------- |
| `5492c9a9d6bcffb226d52952cde55d3f6db72790` | Seven Community expansions and their checks      | Exact Dev backend and installed iPhone runtime candidate       |
| `3ef0744e9d4fcb8d98f4f571500edb53bdcb9f9b` | Storage/recovery safeguards and evidence         | Pushed; runtime/API/mobile/migrations unchanged from `5492c9a` |
| `d1ee160612bf5c6d25805b92fe71ab4ff5236b2e` | Qualified acceptance/synthetic recovery evidence | Pushed documentation; not a new deployment                     |

Keep that history. This guide gets its own documentation commit. Each bug fix then gets a small coherent commit containing its implementation, meaningful regression and evidence; avoid one final unreviewable “all bugs” commit.

Our sequence for each fix:

1. Capture/reproduce the case against the recorded candidate and attach the bug to the relevant issue. Keep missing acceptance open; use issue references without automatic closing keywords while exit criteria remain outstanding.
2. Inspect the working tree and preserve concurrent changes. Implement only the bounded fix. Get non-author review for authorization, account lifecycle, migration/RLS or deployment changes.
3. Format owned files, run the relevant regression, then a fresh serialized **`pnpm check`**. Inspect the exact diff, stage reviewed files explicitly, and commit. Do not sweep unrelated work into the commit.
4. Push normally to the same feature branch; verify the remote SHA. No force-push/history rewrite, `main` merge, Production deployment or Store upload is part of this Dev work.
5. For runtime changes, verify the exact candidate and Dev deployment safeguards, then deploy that SHA through the Dev runbook. Resolve the documented shared-tunnel freeze dependency before an operation that freezes Dev services; a command name does not prove isolation. Rebuild/install if mobile changed. Documentation-only commits do not need a backend deployment or iPhone reinstall.
6. Repeat the failed case plus related access/lifecycle/offline cases, record the new source/deployed/build identifiers, and update `status.md`/issue evidence. A successful push, health endpoint or installation does not count as device acceptance. Close only issues whose actual exit criteria are met.

This follows GitHub's [branch/commit/push review flow](https://docs.github.com/en/get-started/using-github/github-flow), while keeping this package Dev-only. A later PR can gather the reviewed branch; merging or releasing requires its own accepted scope and evidence.

## What this guide cannot accept by itself

Manual phone results complement the automated evidence; they do not replace operator checks. Named trained MFA moderation and contact/absence drills, real provider/device push, physical Storage retention, full-data recovery, durable external erasure reconciliation, legal/Store declarations, Android acceptance, adult research and the longer pilot remain separately tracked. Synthetic quarantined restore is not proof of full Dev recovery or restored erasure reconciliation. Do not open restored social traffic without that reconciliation.

The October 1 test counts and exact installed artifact are in [the expansion evidence](COMMUNITY_EXPANSIONS_DEV_EVIDENCE_2026-10-01.md), with [the runtime source manifest](COMMUNITY_EXPANSIONS_SOURCE_2026-10-01.json). They are dated automated evidence, not newly completed manual tests. The older [September 30 record](COMMUNITY_DEV_TESTING_2026-09-30.md) describes a historical candidate, not this seven-expansion build.
