# ADR 0012: User-scoped private media persistence

- Status: accepted
- Date: 2026-07-21

## Context

Progress photos are sensitive user-owned data split between `public.media_assets` metadata and bytes in the private `private-media` bucket. The existing in-memory implementation could exercise routes but could not survive an API restart. The storage port also omitted the verified access token, which left a production adapter choosing between anonymous requests and overly broad service-role authority.

Supabase uses RLS on `storage.objects` for private bucket operations. Signed upload URLs have a provider-fixed two-hour lifetime, while signed download URLs accept a caller-defined lifetime. Object deletion must go through the Storage API to remove physical bytes.

## Decision

- Every media metadata and Storage operation receives the verified principal's access token. Per-request Supabase clients install it synchronously in the Authorization header; ordinary user operations never use the service role.
- `SupabaseMediaAssetRepository` persists metadata behind the existing core port, and `SupabaseMediaStorage` implements signed upload, signed download, and idempotent deletion behind the API storage port.
- The upload response reports Supabase's actual two-hour signed-upload expiry. Download expiry remains caller-controlled and short-lived.
- Server-generated UUID paths remain nested under `<userId>/`, matching the existing RLS policy and preventing callers from choosing another user's path.
- Deletion removes Storage bytes before soft-deleting the metadata row. If the second step fails, a retry can repeat the idempotent object removal and finish the metadata update; private bytes are not hidden while still retained.
- When validated Supabase server configuration is present, the API composition root selects all Supabase repositories and the Storage adapter. In-memory implementations remain the no-configuration test/development fallback.

## Consequences

- Metadata and bytes survive API restarts and stay isolated by both table and Storage RLS.
- Upload clients must complete the signed PUT within two hours; the provider does not support the API's shorter requested upload TTL.
- A client crash after metadata creation but before byte upload can leave a metadata row without bytes. The mobile flow must delete the pending asset when an upload fails; a future explicit upload-confirmation state may close the crash-only gap if alpha evidence shows it matters.
- Account-wide deletion still needs a dedicated external-resource orchestration pass to enumerate and remove all private objects before deleting the auth identity.
