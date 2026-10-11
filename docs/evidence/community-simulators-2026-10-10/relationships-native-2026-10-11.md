# Relationships #143 native checkpoint — 2026-10-11

**Resumed native Mute / Unmute PASS.** The initial locked session below remains historical evidence; the user subsequently reported unlocking, and the missing sequence actually passed in the resumed session recorded below.

## Actual observation

Initial full Device Hub AX observation took 6.8 seconds and showed the actual iPhone 17 Pro Max window, selected Max sidebar and refreshed Info UUID `74C55221-5CFB-434F-BE42-492349429896` in agreement. The simulator was stopped and showed Start, with no native actor, draft, modal or keyboard. Capture Keyboard was off/disabled. The retained Pro row was present but was not newly inspected.

After root signaled launch/Metro/fixture READY, the one fresh full AX request took 22.8 seconds and failed with: “The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.” No fresh actor state or actionable controls were returned. The controller stopped CUA requests and waited for a material unlock signal; none arrived during this bounded session. No locked UI retry, guessed input, screenshot stall, blind paste, account switching, lifecycle restart or authorization bypass was attempted.

## Prepared scope, separate from native proof

Root reported retained A/Max and B/Pro Dev sessions, signed reused Debug 1.0.9 build 9 / `com.mizyun.development`, root-owned Metro 8085/session 28387 and fresh bundle requests. Root created one temporary approved A → B follow through normal owner-authenticated invite/request/approval routes, revoked the setup invitation and confirmed both active, B search off, no blocks/mutes, A Following 1/B Following 0 and authorized A read of B profile. Those are root setup/API receipts, not native relationship acceptance.

| Selected missing action                                                  | Result                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------- |
| Ground fresh A actor after task launch                                   | CONTROL-BLOCKED: locked Mac prevented fresh AX |
| A native Mute B                                                          | NOT RUN                                        |
| Fresh Muted list persistence and B profile still available               | NOT RUN                                        |
| A native Unmute and fresh Muted list empty                               | NOT RUN                                        |
| A Following B retained; B fresh Followers A retained/private mute absent | NOT RUN                                        |

Earlier passed native approvals, removals, block/unblock were not repeated. The requested mute/unmute action must actually pass before it can support #143 closure. Source checks, API setup and this stopped attempt do not substitute for it.

## Finish and next action

Controller STOP with no native social mutation or draft created. Root owns exact temporary follow restoration, Metro cleanup and shutdown of only task-booted Max; retained Pro and both accounts/private records must be preserved. Resume after manual Mac unlock: obtain fresh actual window/sidebar/refreshed Info UUID/current actor, establish the selected authorized prerequisite if root removed it, then perform the native Mute → fresh Muted/profile access → Unmute → fresh empty Muted/retained follow sequence. Do not automatically rebuild, sign out, repeat passed unrelated actions or retry an unchanged lock blocker.

## Resumed acceptance after manual unlock

The user's unlock message provided the material control change. A fresh full AX request succeeded in 4.2 seconds, showing the stopped Max with matching title/sidebar/Info UUID. Root then launched A/B against its new owned Metro 8085/session 40224, retained signed Debug artifact, and prepared the exact approved A → B follow without native approval repeats. Root reported A PID 72031, B PID 71448 and fresh iOS bundle requests; it owned all fixture/setup operations. The controller independently observed Home welcoming Synthetic Community A and actual Max/sidebar/Info UUID `74C55221-5CFB-434F-BE42-492349429896` in agreement before feature input.

| Actual resumed native action                                                  | Fresh observed result                                                                                                                                                                                                                                       | Verdict                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Settings → Privacy & data → Community → Requests/followers/safety → Following | Exact `@sim_b_f9732c7f83` row with enabled View profile and Options.                                                                                                                                                                                        | PASS                            |
| Options for exact B → Mute, pressed once                                      | “Muted. Your follow and their access are unchanged.”                                                                                                                                                                                                        | PASS                            |
| Requests → expanded Safety & preferences → Muted                              | Fresh selected Muted people list contained exact B with enabled View profile, Options and Unmute. Copy: “Hidden from your feed. Muting keeps following and access unchanged.” Controller held this state for root API read and pinned-device pixel capture. | PASS                            |
| View B profile from Muted → Refresh profile                                   | Fresh profile showed Synthetic Community B, exact B handle and Following; No shared workouts was expected because this fixture shared none. Mute did not deny authorized profile access.                                                                    | PASS                            |
| Normal Back → Unmute, pressed once                                            | “Unmuted.” and “No muted people.”                                                                                                                                                                                                                           | PASS                            |
| Requests → Muted again                                                        | Fresh list remained empty with “No muted people” and explanatory route to mute from Following. Held for root API read and pinned-device pixel capture.                                                                                                      | PASS                            |
| Following after fresh empty Muted read                                        | Exact B row still present with enabled View profile/Options.                                                                                                                                                                                                | PASS                            |
| Minimal native B Followers counterpart                                        | NOT RUN: the sidebar selection expired; after one fresh binding, root directed stopping optional navigation recovery because the selected core sequence was complete. No B mutation.                                                                        | NOT RUN, optional corroboration |

The mute action appeared in a distinct exact-handle Options menu beside Unfollow, Report and Block. Muted list and action-result copy clearly distinguished quiet feed/delivery preferences from following/access. Unmute was available directly on the exact muted row. No destructive/follow removal action was selected, and the menu was left closed by normal navigation. No keyboard, draft, system prompt, appearance or text-size change was involved. Capture Keyboard remained off.

### Separate API and pixel evidence

At the actual muted checkpoint, root reported one exact private A → B mute, approved A → B follow unchanged, B Following 0/mutes 0, both active/B search off and A-authorized B profile HTTP 200. A's logical inbox approval count changed 1 → 0. At the actual unmuted checkpoint, root reported mutes 0, same approved follow and profile HTTP 200, with one current approval restored; old approval resolved 404 and current approval 200. These reads corroborate the native actions rather than replacing them. Root owns temporary follow restoration and final fixture read.

Root captured and inspected actual pinned-Max screenshots at both held checkpoints: exact B row/Unmute and unchanged-access copy were readable while muted, and the empty Muted list was readable after unmute. The controller's evidence is native action/AX output; root owns the pixel artifacts and their visual inspection. A Debug warning overlay was observed by root at the bottom and is unrelated to this relationship result. No release-quality, maximum-font or VoiceOver claim is made.

### Control budget and finish

Resumed feature calls generally took 2.1–9.2 seconds. One user-changed-app warning before Muted selection was handled by fresh AX before one supported selection. One final optional B sidebar selection returned stale-element `-10005` in 7.5 seconds; one fresh binding took 6.1 seconds, then the controller stopped without further navigation recovery. There was no repeated Mute/Unmute, slow screenshot loop or authorization bypass.

Controller STOP after the fresh A Following read, leaving A People → Following with B present, no open Options/draft/modal. B remained retained and signed in; no B native interaction occurred in the resumed segment. Both native mute state and the initial lock blocker have been resolved for the selected #143 flow. Root owns follow cleanup, stopping owned Metro/awake process, shutdown of task-booted Max and issue closure. Retain initially booted Pro, both account sessions and private data. Physical standalone, Android, offline/lease, VoiceOver and release acceptance were outside this selected missing action.
