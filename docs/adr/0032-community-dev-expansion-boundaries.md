# ADR-0032: Explicit Community expansion boundaries on Dev

Invisible foreground navigation records may survive ordinary blur under [ADR-0033](0033-community-foreground-navigation-reads.md) (2026-10-02). Displayed data/intents still retire on blur and reused expansion results retain their original ten-second deadline.

Date: 2026-10-01. Status: Accepted for Dev implementation.

Adam explicitly authorized #156–162 development before the original post-pilot sequence. This authorizes implementation, isolated verification and Dev deployment/install; it does not supply participant, operator, legal, Store or physical acceptance evidence. Production remains excluded.

Each expansion has an independent database-authoritative default-off switch, subordinate to current adult consent, cohort, suspension and master controls. Reductions such as leave/delete/opt-out remain available when expansion engagement is off. No existing card changes audience, no enrollment publishes private records, and no address book is collected.

Comments and messaging start bounded plain text. Private groups require explicit admission and show history only from the current membership. Challenges use separately declared artifacts and deterministic consistency scoring with rest alternatives. Routine imports make independent private copies with attribution. Community photos are separately derived uploads in a private bucket, quarantined pending human moderation, served through current-authorization checks without durable signed URLs. Broader discovery starts an independently consenting, bounded prefix experiment; public posting and contact collection remain excluded pending specific decisions.

Supabase [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [functions](https://supabase.com/docs/guides/database/functions) require least-privilege grants, explicit caller checks for definer RPCs and a fixed empty search path. [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) reinforces current authorization on originals and derived assets. SDK 57 [reference](https://docs.expo.dev/versions/v57.0.0/) is the native API authority.

Expansion screens retire protected text, identity, aggregates and image bytes a bounded time after the fresh authorization request starts (ten seconds originally; sixty seconds since Adam's 2026-10-23 decision, see ADR-0033). This deadline is independent of later pending operations; background/blur/account changes retire authority immediately. Expiry can never replay a mutation or a discovery query. Since 2026-10-23 ([ADR-0033 amendment](0033-community-foreground-navigation-reads.md), #265) a screen renews an idempotent protected read shortly before the deadline and swaps in the fresh result; the original deadline still retires content when that renewal keeps failing or is late, and a denial retires it at once. The owner's own bouldering and meal share previews have no display deadline. Private owner previews remain separate so users can review a routine or selected photo before explicit confirmation. Server source-version checks still govern publication.

Every package remains open until its original acceptance criteria are met. Source, automated checks, Dev deployment, installation and actual device acceptance are recorded separately.
