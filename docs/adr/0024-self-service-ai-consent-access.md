# ADR-0024 — Self-service AI access after consent

Status: accepted 2026-09-10 by explicit user request. Deployment evidence belongs in status.md.

Authenticated users with an adult-eligible profile and current, granted, unrevoked AI consent may use enabled AI features immediately. There is no administrator confirmation, invitation queue, or per-email enrollment. The mobile consent controller already awaits persistence and resumes its pending request; no worker or polling is needed.

`AI_ALLOWED_EMAILS` and legacy in-process email options are deprecated compatibility inputs with no authorization effect, including when populated. Do not reintroduce manual admission as a Q8-A requirement. Existing environment files need no email-list edits for the updated code.

Authentication, declared adult eligibility, current consent/revocation, provider enablement/kill switch and existing usage limits remain. This changes AI admission, not Supabase email-verification settings, subscription policy, or release acceptance. Existing deletion behavior is unchanged; this decision does not establish complete deletion barriers.

An eligible account can consume its permitted AI budget; the old list no longer limits account growth. Aggregate abuse/cost controls and provider evaluation remain separate work. No new accounting infrastructure is introduced here.

Regression: unrelated nonempty old list and principal without email; deny before consent, accept consent, immediately generate a synthetic draft, revoke, deny again with no additional provider call. Configuration must start without a list when external AI is enabled. Existing mobile continuation/failure/account-switch and API limit tests remain required.

Supabase [Auth configuration](https://supabase.com/docs/guides/auth/general-configuration), reviewed 2026-09-10, treats email confirmation as a separate sign-in requirement. No founder approval is necessary for AI consent; changing Auth confirmation is outside this decision. Local verification does not imply a Production rollout.
