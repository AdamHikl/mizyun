# ADR-0046: Pro multi-photo drafts and Coach context

- Date: 2026-10-06
- Status: Accepted for implementation; native and live-provider acceptance pending
- Requirement: VISION-MULTI-001, NUTR-01/02, COACH-12
- Issue: [#217](https://github.com/AdamHikl/mizyun/issues/217)

## Decision

Meals and Coach accept up to three photos in one request for a server-verified Pro entitlement (paid profile or approved Launch Pro grant). Free retains one photo. Development quota overrides do not grant multi-photo capability. Photos remain transient, processed together in one inference under the existing combined 15 MiB limit, consent, kill switches and usage reservation.

Preserve the existing primary photo and candidate fields. Add optional additional photos to the provider-neutral port and repeated multipart `image` fields to transport. Meals adds optional `drafts` (one to three), with `draft` retaining the first candidate. Coach persists one assistant message with one proposal containing the first candidate and up to two additional candidates, preserving atomic message persistence and idempotent replay.

The prompt distinguishes repeated angles of one meal from distinct meals and records uncertainty when the relationship is unclear. Meals reviews and saves each candidate separately. The remaining queue is stored in the existing user-scoped recoverable draft; advancing after a save must persist the next draft before allowing a new save. Lost responses replay the same operation. No inferred meal is automatically saved. Access is rechecked before sending and queued advanced nutrients are masked if entitlement is revoked.

Coach sends the typed question with the photos. Menus, labels, equipment and other fitness context can produce advisory text without a meal proposal. Image text remains untrusted. Output screening rejects diagnostic, treatment and unsafe-target advice; all estimates remain uncertain and require confirmation.

## Consequences and acceptance

Existing single-photo clients remain compatible; multiple-photo input and multiple-candidate output are additive. No new storage, table, permission or vendor dependency is introduced. Maximum count and aggregate bytes are enforced independently at server and client boundaries. Full model accuracy for repeated angles, distinct meals and general photo advice still requires the gated live evaluation and exact-candidate iOS/Android native journeys.

Primary sources checked 2026-10-06: [Expo v57 ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), [FormData append](https://developer.mozilla.org/en-US/docs/Web/API/FormData/append), [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [Fastify multipart](https://github.com/fastify/fastify-multipart).
