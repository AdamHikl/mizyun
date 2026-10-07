# ADR-0050: Apple revocation within accepted account deletion

- Status: accepted for implementation; Dev/provider/native acceptance pending
- Date: 2026-10-07
- Related: ADR-0021, APPLE-003, #7, #25, #26

## Context

The deletion route currently exchanges/revokes a client-supplied Apple code before the repository accepts the deletion challenge. It does not bind the Apple subject to the account, and provider failures still allow `deleted:true`. The existing durable deletion job must own acceptance and cleanup ordering.

## Decision

1. Invoke a provider-neutral cleanup callback only after the repository accepts the challenge and acquires its worker lease. Invalid challenges invoke no provider operations. An accepted failed job retains its confirmation token and remains retryable after the original challenge expires; issuing another challenge must not replace it.
2. Read linked provider subjects from the server's Supabase Auth Admin user record. Never bind Apple accounts by email or client-supplied metadata. Verify the exchanged Apple identity token's signature, issuer, expiry, exact configured audience and subject before retaining or revoking its refresh token.
3. Persist per-job provider cleanup state in a separate service-role-only table with RLS and a user index. It survives Auth deletion and is excluded from export. Record `not_required` for accounts without that identity so post-Auth recovery does not require a deleted Auth record.
4. Encrypt the refresh token using AES-256-GCM, a fresh nonce and associated data binding the environment audience, account, job and Apple subject. Use a dedicated environment-owned 32-byte key; do not derive it from the Apple signing key or put it in mobile configuration. Missing configuration fails Apple cleanup explicitly. This session does not create or change operational keys.
5. Persist a verified token before revocation. After successful revocation, clear ciphertext and persist the completion marker before the repository proceeds with Storage, Memory and Auth deletion. Existing Community withdrawal and recurring-meal disabling triggers still run when the deletion job is accepted; provider failure therefore leaves an accepted account pending with those changes applied. Failure remains resumable and cannot report success. An exchange response lost before durable token storage requires fresh Apple authorization on the same accepted job; a stored token resumes without exchanging the single-use code again. Mint client secrets for 300 seconds per attempt.
6. Keep provider errors and secrets out of deletion-job/public errors and logs. Existing tombstone/backup/restore retention gates remain open; no live-grant or full account-erasure claim follows from source changes.
7. Preserve accepted jobs using a per-account database transaction fence shared by challenge insertion and acceptance. Every provider state write checks the current worker and unexpired lease while locking the owning job. Terminal provider markers are immutable. Preserve the dedicated encryption key while any pending token exists; key rotation needs explicit re-encryption/recovery tooling before an operational key is replaced.

## Sources checked 2026-10-07

- [Apple token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens): authorization codes are single-use and valid for five minutes.
- [Apple public keys](https://developer.apple.com/documentation/signinwithapplerestapi/fetch-apple%27s-public-key-for-verifying-token-signature): choose the signing key by `kid`.
- [Apple token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens): revoke the associated grant using server credentials.
- [Supabase Auth Admin getUserById](https://supabase.com/docs/reference/javascript/auth-admin-getuserbyid): server-side administrative identity lookup.

## Acceptance

Independent security review and batched regressions must cover challenge rejection, account/audience/signature mismatch, provider failure, persistence failure, code reuse, lost responses, restart, duplicate confirmation and secret exclusion. Operational key/migration delivery and real synthetic Apple grant revocation, native recovery and complete Auth/data/local cleanup remain separate exits.
