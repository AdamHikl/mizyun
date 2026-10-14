# Latest local iPhone Dev delivery — 2026-10-12

## Authorized scope and source

Adam requested installing the latest Dev app on his iPhone. Build a standalone signed Release from an immutable snapshot of current local tracked and nonignored source, based on HEAD `0135228778059dc25c1a4925738f0b6934ed4f0c`, including disclosed uncommitted Community, first-render cache, retained meal photo, analytics reminders and REC-01/02 changes. No commit, push, backend deployment, Production artifact or Store upload is selected.

Current installed authority before this task is Oct11 Dev1.0.9(9), source0135228, launched PID29460; see [previous receipt](DEV_IPHONE_MAIN_DELIVERY_2026-10-11.md). Dev backend remains that Oct11 commit. Community meal sharing needs its undeployed routes/migration; UI fails to absent preview and prevents publishing. Recipes remain an internal foundation, with no recipe screen. Do not call this installation complete feature acceptance.

## Preflight and verification boundary

- Target: Adam's available paired physical iPhone16Pro (`00008140-001114501A86801C`). The initial sandbox device query could not reach CoreDevice; elevated detection confirmed the device.
- Actual iOS Dev ID is `com.mizyun.development`, scheme `MizyunDev`, team `LQJNDVBL43`; Android uses `com.mizyun.dev`. Source and installer agree. Version tuple remains1.0.9(9); no Production version increment.
- Independent fresh Sol High read-only helper reviewed installer/environment/native snapshot safeguards and client/backend compatibility. No source edits. Confirmed Dev API/Supabase/callback guards, signing, CocoaPods/native module requirements, fail-closed meal preview, and installer launch-error/port8081 limitations.
- Use equivalent guarded direct `xcodebuild`/`devicectl` steps to avoid the installer killing a Metro process belonging to another session. Native generation/build stays in the isolated snapshot. Workspace links point to its packages; vendor dependency store may be reused. Signed Apple capability guard and deep signature verification must pass before installation. Verify launch independently with process/PID evidence.
- Select/preflight the complete combined candidate before one fresh full `pnpm check`. Record exact hashes and exclusions before native build. Avoid changes to source while checks/build run; preserve other sessions' shared files.

## Pending outcomes

Combined candidate preparation, source/environment/native scaffold checks, full gate, signed Release build, installation and unlocked positive launch are pending. Durable manifests and outcomes will be post-check records under `docs/evidence/dev-iphone-local-2026-10-12/`. No unrun check is accepted.

## Remaining acceptance

Adam still owns signed-in native feature journeys, offline/restart/account changes, accessibility and paired Watch checks. Live provider, backend meal-sharing deployment, qualified recipe nutrition/food-safety review and Production/Store exits stay separate. No user health records or credentials belong in evidence.
