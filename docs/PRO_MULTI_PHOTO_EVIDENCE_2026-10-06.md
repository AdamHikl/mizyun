# Pro multi-photo implementation evidence — 2026-10-06

Issue [#217](https://github.com/AdamHikl/mizyun/issues/217); [ADR-0046](adr/0046-pro-multi-photo-drafts.md).

## Implemented behavior

Meals and Coach submit up to three photos per request for server-authorized Pro or approved Launch Pro; Free retains one. Multiple angles are analyzed together without intentionally multiplying portions; distinct meals return separate editable drafts. Each meal requires its own Save. Meals retains remaining candidates in the recoverable user-scoped draft and durably advances after saving. A lost response replays the same operation; next-draft storage failure cannot authorize a changed duplicate Save. Replacing with a recent/text meal clears the old queue. Downgrade masks queued advanced fields, and account changes cannot send or present the previous account's pending operation.

Coach submits the typed question alongside photos and retains it in the transcript. Non-meal menus, labels and training context can return advisory text without a meal Save card. Safety screening runs on input and photo advice at both provider and route boundaries; deterministic screening remains heuristic. The server verifies actual entitlement independently of development quota overrides, rejects excess/empty/MIME-invalid/aggregate-over15MiB input before inference, and releases reservations on validation failure. Photo bytes remain transient. Photo provenance is `nutrition-photo-v5` / `coach-photo-v1`; text/refinement provenance is unchanged.

## Candidate and verification

Baseline HEAD `f40e8941afc5307efce6d5c5909c0146ed1f3dda`; task-only isolated candidate `/private/var/folders/54/xppg48y95cj6g1p49c30k8zw0000gn/T/mizyun-pro-photos-7nn6zeyp`. [SHA256 manifest](evidence/pro-multi-photo/source-manifest-2026-10-06.json) fingerprints24 owned overlays. Current source correspondence PASS. This candidate excludes the concurrent health-preview/settings/native/version changes, analytics test changes, simulator tooling and shared-document changes; it does not accept the combined working tree.

Fresh focused results:

- Mobile Meals + Coach:319PASS, including picker3/overflow/downgrade, sequential confirmation, lost-save replay, storage-failure duplicate guard, restart queue, token refresh and account change during persistence.
- API photo routes54PASS; Gemini vision42PASS; API client33PASS; contracts29PASS.
- Independent High non-author review: no remaining actionable findings after corrections; separate runtime46, routes54, provider42 and mobile screen70PASS.
- Mobile final typecheck and diff whitespace checks PASS. Source-based tests do not prove native interactions or live inference quality.
- Full `pnpm check`:PASS for input SHA256 `acb8305c6887000f39d4552a3f1052e38d34432360f669490f36844e2ce91ce5`, including navigation, formatting, typechecks, mobile Metro bundles, workspace tests, deployment/build/operation safeguards and offline AI evaluation. The first attempt required process-status permission, and the first isolated run stopped at navigation because the archive lacked Git metadata. Added baseline-only local Git metadata, then reran the canonical gate. No source fix was needed for either setup issue.

[Focused logs](evidence/pro-multi-photo/) contain synthetic fixtures only. Backend and client authors had disjoint ownership; the coordinator wrote mobile screen/recovery changes, inspected actual diffs and owns final acceptance.

## Exact remaining acceptance

Dev deployment/install and Production release have not occurred. Next: accept this exact candidate on Dev with1/2/3 photo selections and repeated camera capture on iOS/Android; denied/cancelled picker, oversized uploads, offline retry, Free/Pro/Launch Pro/revoked access, batch review/Save/restart/storage failure, transcript reopen and large text/VoiceOver/TalkBack. Run the gated live-provider evaluation for repeated angles, distinct meals, ambiguous relationships, non-meal advice and image-text injection before claiming model accuracy or wider rollout. Existing broader provider/release gates remain open.
