---
name: test-ios-simulator
description: >-
  Test Mizyun features in the iOS Dev simulator using a compatible Debug binary,
  an owned Metro server, native DeviceHub interactions and synthetic Dev accounts.
  Use for simulator feature or UI/IA acceptance; physical installation and
  Production or Store release use their separate workflows.
---

# Test Mizyun in the iOS simulator

Use the repository helper for setup and `cua_repl` for native UI input. The helper never types credentials, provisions accounts, erases simulators or kills unidentified servers. Repository root is the parent of `.agents`; run commands there. Read [native interaction and scenario reference](references/native-testing.md) before interacting, and only the relevant feature scenarios.

## 1. Pin the candidate and session

Inspect `git -c core.fsmonitor=false status --short` and `git rev-parse HEAD`; preserve concurrent edits. Identify the changed feature and its observable result before opening the app. Record source paths/hashes, exact simulator UUID, native binary version, Metro port and initial boot/text/appearance state. Debug native binary and current Metro JavaScript are separate candidates.

Historical successful device: iPhone17Pro `F4939E5D-BA85-4479-AA1E-92B21441FB8C`; verify it still exists. Prefer the existing simulator/test account rather than creating more. Do not use `booted`, a physical UDID or a Production app. Select another explicit UUID if this one is unavailable.

```bash
pnpm mobile:simulator:ios doctor --device F4939E5D-BA85-4479-AA1E-92B21441FB8C --port 8085
```

If CoreSimulator access fails only in the sandbox, retry the authorized read/setup command once in normal host context; do not diagnose it as a missing device or rewrite config. `doctor` validates canonical `.env.dev`, exact iOS simulator and a free task port. It never reads `.env.local`. Keep the current native-bound environment guard and Expo Debug resolver: reviewed shell/manifest values alone previously failed to prevent Production Auth routing (#211). Never recreate `.env.development.local` as a workaround. If Dev runtime configuration fails, fix the safeguard before entering credentials.

## 2. Reuse a compatible Debug binary; build once when necessary

For JavaScript-only changes, reuse a previously verified Debug simulator artifact. Run `doctor --app <absolute Debug-iphonesimulator/MizyunDev.app path>` to check its native ID/platform/public manifest. This is an identity/routing check, not proof of all native compatibility. Require a build record and compare its saved native-input hashes with current app config, dependencies, local plugins and modules before reuse (`shasum -a 256 -c <build>/native-inputs.sha256`). Missing provenance or changed inputs means rebuild. Rebuild when native dependencies/plugins/permissions/app config or native version change, or the manifest is stale. A clean prebuild uses the shared ignored `apps/mobile/ios` directory: coordinate native resources first and preserve another session's build.

One cold-build recipe, after selecting the UUID above:

```bash
# Save this printed directory as the session's SIM_BUILD; do not reuse another task's path.
set -euo pipefail
SIM_BUILD=$(mktemp -d /private/tmp/mizyun-ios-simulator.XXXXXX)
echo "$SIM_BUILD"
{ printf '%s\n' apps/mobile/app.json apps/mobile/app.config.js apps/mobile/package.json pnpm-lock.yaml
  git ls-files --cached --others --exclude-standard apps/mobile/plugins apps/mobile/modules
} | sort -u > "$SIM_BUILD/native-paths.txt"
while IFS= read -r path; do shasum -a 256 "$path"; done < "$SIM_BUILD/native-paths.txt" > "$SIM_BUILD/native-inputs.sha256"
pnpm mobile:founder-dev:ios:prebuild
bash -c '
  set -euo pipefail
  set -a
  source apps/mobile/.env.dev
  set +a
  export EXPO_NO_DOTENV=1 MIZYUN_APP_VARIANT=dev
  xcodebuild -workspace apps/mobile/ios/MizyunDev.xcworkspace \
    -scheme MizyunDev -configuration Debug -sdk iphonesimulator \
    -destination "id=F4939E5D-BA85-4479-AA1E-92B21441FB8C" \
    -derivedDataPath "$1" CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
' _ "$SIM_BUILD" > "$SIM_BUILD/build.log" 2>&1
shasum -a 256 -c "$SIM_BUILD/native-inputs.sha256"
```

In each fresh shell call, assign SIM_BUILD to the exact directory printed earlier; tool invocations do not preserve shell variables. Before reuse and after a build, regenerate the same native path list and compare it with `native-paths.txt` (including newly added tracked/untracked files), then verify checksums. A changed inventory also requires rebuild. Run these dependent steps sequentially and stop on any failure; a receipt is valid only after Build Succeeded and post-build hashes match. For native files not tracked yet, add their paths to the manifest explicitly; also compare native build flags used by app.config.js. Keep `.env.dev` contents private. Artifact: `<SIM_BUILD>/Build/Products/Debug-iphonesimulator/MizyunDev.app`. Use that exact path in later helper calls; the helper resolves relative paths but does not expand placeholders. `mobile:founder-dev:ios` without `:prebuild` builds **Release**; it is not this Debug loop. Never try to install a physical iPhone `.app` or IPA into a simulator. Wait on a build in30–60-second tool waits; inspect one bounded completion/error summary.

## 3. Start owned Metro first, then launch

Run `serve` in a retained tool session, with its log in a private temporary path. Record that session ID for cleanup. It reads public `.env.dev` values, drops inherited public/variant overrides, sets `EXPO_NO_DOTENV=1` and Dev variant, and fails if the chosen port is occupied. Pick another free port instead of killing or guessing the identity of an existing listener. Do not use `--clear` for every iteration.

```bash
pnpm mobile:simulator:ios serve --device F4939E5D-BA85-4479-AA1E-92B21441FB8C --port 8085
```

The helper keeps CI disabled so Metro watch/Fast Refresh stays enabled; do not replace it with CI=1 for convenience. Wait for the Metro startup message, then launch in another tool call. Save or normally Close existing drafts before **any replacement install or relaunch**. First installation/rebuilt artifact:

```bash
pnpm mobile:simulator:ios launch --device F4939E5D-BA85-4479-AA1E-92B21441FB8C \
  --port 8085 --app "$SIM_BUILD/Build/Products/Debug-iphonesimulator/MizyunDev.app" --install
```

On later JavaScript iterations omit `--install`; the helper compares installed native executable/config with the cached artifact. Use `--relaunch` only after drafts are saved/closed and a fresh process is actually needed. Fast Refresh is normally sufficient. The helper waits for boot, checks Metro status and passes `-RCT_jsLocation localhost:8085` as process-scoped launch arguments. This avoids the earlier “No script URL provided” loop and persistent defaults writes. An Expo development-client deep link was ineffective for our bare Debug binary; do not repeat it without evidence that the binary includes that client.

Launch/PID and Metro status only prove setup. A non-terminating launch can return an already-running process and leave its original script URL unchanged. Confirm a fresh iOS bundle request in the retained task Metro log and the current feature in native pixels/AX before attributing results to this JavaScript candidate. If the running process still belongs to another Metro, normally save/Close its drafts and perform one explicit `--relaunch`; never infer attachment from PID alone. Observe the actual app before proceeding. Simulator builds must be ad-hoc signed: an unsigned build rendered during validation but Expo SecureStore reported a missing Keychain entitlement. The helper refuses unsigned/invalid artifacts; use the signed recipe and verify fresh sign-in rather than bypassing secure storage. If no script URL persists, confirm matching port and perform one saved/closed relaunch; inspect the native screen and Metro log. Bound setup retries; record an unresolved tool/runtime blocker instead of looping through unrelated configuration changes.

## 4. Test one concrete feature result

Use an existing synthetic **Dev** test account through normal UI. Keep credentials in an ignored mode0600 private file or user-provided input; never put them in this skill, shell logs, screenshots or issue bodies. Fresh normal sign-in plus an authenticated synthetic read/mutation is the routing/feature check; restored cached content is weaker evidence. Decline password storage and unrequested permissions; do not opt into AI/analytics or accept terms as incidental setup. No service-role access, real health data or provider calls are implied.

Read [native-testing.md](references/native-testing.md) for the tested DeviceHub controls, bounded recovery and feature scenarios. Verify each action's expected native result before continuing. For UI/IA requests, reviewers can examine captured pixels concurrently; only one coordinator controls the simulator. Use appropriate independent review for changed safeguards under repository instructions.

## Two accounts on two simulators

For focused paired-account runs, use [test-ios-simulator-pair](../test-ios-simulator-pair/SKILL.md). It adds retained A/B sessions, minimal retesting, device grounding, finite control recovery and original-criteria closure; setup mechanics remain here.

For live recipient/revocation tests, retain one synthetic account on each of two explicit iOS UUIDs instead of repeatedly signing out. Inventory existing devices first; prefer a compatible existing second device. Record its initial boot/install state, verify native provenance once, and install the same signed Dev Debug artifact only where absent or incompatible. Use one owned canonical Dev Metro for both; verify each fresh bundle/native actor independently. Never copy Keychain/Auth data between devices. Do not use a generic `booted` destination.

One controller serializes native input. In the observed DeviceHub workflow, normal Show in Device Hub exposes the sidebar; select the intended device and inspect Info for its UUID. Before each consequential action require the actual standard window title, selected sidebar row and current account/source content to agree. Tool-output prefixes and cached inspector metadata have disagreed with the actual selected device: a UUID observed earlier alone is insufficient. Do not invent a direct UUID input API. Keep separate recipient baseline and post-mutation results; expiry before mutation does not prove revocation. If navigation leaves the retained detail, qualify fresh-feed disappearance separately from stale-detail denial.

An exposed Capture Keyboard toggle may be tried once for a newly grounded input failure; record and restore its initial state. A visible caret or successful tool return does not prove entered text. If typeText/paste stays blank, stop unchanged retries and record a control blocker rather than changing app authorization or claiming an application defect. Obtain any specifically required permission/share/report authorization for the concrete synthetic action; an approval for one action does not approve unrelated actions.

Cleanup only task-owned Metro/awake processes and devices this task booted. Preserve an initially booted device, both account sessions and synthetic data. A pending native handoff may retain task setup explicitly; otherwise shut down only the task-booted UUID without erasing it.

## 5. Capture and restore

Capture actual native pixels using the pinned UUID, never a source mockup:

```bash
xcrun simctl io F4939E5D-BA85-4479-AA1E-92B21441FB8C screenshot /private/tmp/mizyun-feature-result.png
```

Inspect/redact before adding evidence to the repository. Record initial/action/result, source/native identity, exact account environment without credentials, repeated/cold/live conditions, and any incomplete checks. Debug+Metro evidence does not prove physical standalone/Release/Android/VoiceOver/Store acceptance.

Normally save/Close drafts and return to Home/Hub before lifecycle cleanup. Restore appearance and every text-size increment using the same UI controls; do not assume a relaunch restores settings. Send Ctrl-C to **the recorded task Metro session**. If this task booted a previously shutdown simulator, shut down only that UUID; if it was already booted, leave it booted. Never erase or delete synthetic records as routine cleanup. Check source hashes/unrelated edits, then update evidence/status/issues and run the applicable settled-source checks once.
