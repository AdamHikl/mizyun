# Mizyun Account Data Export Inventory

> Authoritative inventory of user-owned personal data categories, schema fields, exclusions, pagination controls, and delivery formats (REL-AUD-001 / REL-AUD-002 / Finding Q5 / R1 / R2).

## 1. Export Overview & Consistency Model

The Mizyun account export delivers a versioned JSON document of the implemented user-owned categories under the authenticated session (`user_id = auth.uid()`). The category inventory and offline-media acceptance remain open in #25; JSON containing expiring links is not a portable photo archive.

- **Version**: `2026-09-08` (Manifest Schema Version 1)
- **Consistency Model**: Live ordered reads under the user RLS session. Separate pages/tables are not a transactional snapshot; concurrent inserts, edits or deletion can affect the resulting document.
- **Resource Bound**: Supabase reads request at most500 records/page and continue by the actual returned count until an empty page. Each category permits at most1000 page reads; exhaustion of this guard, a missing result or any page failure aborts the export. Results still accumulate in API memory on Hetzner; streaming, byte/concurrency bounds and large-account resource acceptance remain open.
- **Exclusion Policy**: Strict exclusion of administrative secrets, authentication hashes, refresh tokens, and internal state machine challenges.

---

## 2. Category Inventory & Field Mappings

### 2.1 Profile & Identity (`public.profiles`)

- **Table**: `public.profiles`
- **Ownership**: `id = auth.uid()`
- **Included Fields**:
  - `userId` (uuid)
  - `displayName` (string | null)
  - `unitSystem` ("metric" | "imperial")
  - `timezone` (string)
  - `birthYear` (number | null)
  - `heightCm` (number | null)
  - `activityLevel` ("sedentary" | "light" | "moderate" | "heavy" | "very_heavy" | null)
  - `sexAtBirth` ("male" | "female" | null)
  - `coachingPreferences` (json object)
  - `aiProvider` (string | null)
  - `planTier` ("free" | "paid")
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)
- **Exclusions**: Internal database triggers and PostgREST metadata.

### 2.2 Goals & Progression (`public.goals`)

- **Table**: `public.goals`
- **Ownership**: `user_id = auth.uid()`
- **Pagination**: Batch size 500 ordered by `created_at ASC, id ASC`.
- **Included Fields**:
  - `id` (uuid)
  - `userId` (uuid)
  - `kind` ("cut" | "bulk" | "maintain")
  - `status` ("active" | "completed" | "abandoned")
  - `pace` ("conservative" | "moderate" | "aggressive")
  - `target` (json: `{ weightKg, bodyFatPercent }`)
  - `startsOn` (ISO 8601 date string)
  - `targetDate` (ISO 8601 date string | null)
  - `reviewDate` (ISO 8601 date string | null)
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)

### 2.3 Food & Nutrition Entries (`public.food_entries`)

- **Table**: `public.food_entries`
- **Ownership**: `user_id = auth.uid()`
- **Pagination**: Deterministic keyset/offset batch pagination (500 per chunk) ordered by `consumed_at DESC, id DESC`.
- **Included Fields**:
  - `id` (uuid)
  - `userId` (uuid)
  - `clientOperationId` (uuid | null) — idempotent submission key
  - `name` (string)
  - `consumedAt` (ISO 8601 string)
  - `caloriesKcal` (number)
  - `proteinG` (number)
  - `carbohydrateG` (number)
  - `fatG` (number)
  - `source` ("manual" | "ai_vision" | "ai_text" | "barcode")
  - `confidence` (number | null)
  - `confirmedByUser` (boolean)
  - `details` (json: serving details, ingredients)
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)

### 2.4 Exercises Library (`public.exercises`)

- **Table**: `public.exercises`
- **Ownership**: `user_id = auth.uid()`
- **Pagination**: Batch size 500 ordered by `name ASC, id ASC`.
- **Included Fields**:
  - `id` (uuid)
  - `userId` (uuid)
  - `name` (string)
  - `instructions` (string | null)
  - `metadata` (json: equipment, muscle groups, movement pattern)
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)

### 2.5 Workouts & Set Logs (`public.workouts`, `public.workout_sets`)

- **Tables**: `public.workouts`, `public.workout_sets`
- **Ownership**: `user_id = auth.uid()`
- **Pagination**: Workouts paginated in batches of 500 ordered by `started_at DESC, id DESC`. Sets fetched per workout or in ordered batches.
- **Included Fields (Workouts)**:
  - `id` (uuid)
  - `userId` (uuid)
  - `name` (string)
  - `startedAt` (ISO 8601 string)
  - `completedAt` (ISO 8601 string | null)
  - `notes` (string | null)
  - `source` ("manual" | "coach_plan")
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)
- **Included Fields (Workout Sets)**:
  - `id` (uuid)
  - `userId` (uuid)
  - `workoutId` (uuid)
  - `exerciseId` (uuid)
  - `sequence` (number)
  - `repetitions` (number | null)
  - `loadKg` (number | null)
  - `distanceMeters` (number | null)
  - `durationSeconds` (number | null)
  - `rpe` (number | null)
  - `notes` (string | null)
  - `completedAt` (ISO 8601 string | null)
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)

### 2.5a Indoor bouldering (`public.boulder_ascents`, `public.boulder_operation_receipts`, `public.boulder_projects`)

- **Sessions** export as `workouts` rows with `details.activityType = "bouldering"` and `details.boulderSession` (Font scale, timezone, local day, optional gym name).
- **`bouldering.ascents`**: every boulder row (`grade_code`, `grade_rank`, `result`, `attempts`, `hold_colour`, `note`, `photo_asset_id`, `project_id`, `sequence`, `revision`, timestamps), ordered by `logged_at`, `id`. Photos are listed under private media (`purpose = workout`).
- **`bouldering.receipts`**: owner receipts (operation id, kind, session/ascent id, payload digest, accepted revision, deleted flag); no grades or notes. Ordered by `created_at`, `operation_id`.
- **`bouldering.projects`**: every project row (`grade_scale`, `grade_code`, `grade_rank`, `hold_colour`, `status` open/sent/archived, `first_logged_at`, `sent_at`, `sent_ascent_id`, `revision`, timestamps), ordered by `first_logged_at`, `id`. A project is derived from its linked boulders and is removed when none remain. Optional in the document shape so older exports still parse.
- **Erasure**: all three tables cascade from `auth.users`; ascents also cascade with their session, and a project without linked boulders is deleted. Photo bytes are swept with the account's `media_assets`. ([ADR-0066](adr/0066-indoor-bouldering-sessions.md))
- **Community cards**: a shared session exports under `community.activities` with `activity_kind = "bouldering"`, the private `source_workout_id` and the published `bouldering_details` allowlist (local day, top grade, sends, flashes, optional per-grade sends). The card is deleted with its session or account. ([ADR-0067](adr/0067-explicit-community-bouldering-publication.md))

### 2.6 Body Measurements & Weight (`public.body_measurements`)

- **Table**: `public.body_measurements`
- **Ownership**: `user_id = auth.uid()`
- **Pagination**: Batch size 500 ordered by `measured_at DESC, id DESC`.
- **Included Fields**:
  - `id` (uuid)
  - `userId` (uuid)
  - `measuredAt` (ISO 8601 string)
  - `weightKg` (number | null)
  - `measurements` (json: waistCm, chestCm, hipsCm, etc.)
  - `source` ("manual" | "scale")
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)

### 2.7 AI Coach Conversations & Messages (`public.conversations`, `public.messages`)

- **Tables**: `public.conversations`, `public.messages`
- **Ownership**: `user_id = auth.uid()`
- **Pagination**: Conversations ordered by `updated_at DESC, id DESC`. Messages ordered by `sequence ASC, created_at ASC`.
- **Included Fields (Conversations)**:
  - `id` (uuid)
  - `title` (string | null)
  - `status` ("active" | "archived")
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)
- **Included Fields (Messages)**:
  - `id` (uuid)
  - `role` ("user" | "assistant" | "system")
  - `text` (string)
  - `status` ("complete" | "failed")
  - `evidence` (json array: cited facts and sources)
  - `createdAt` (ISO 8601 string)

### 2.8 Durable Learned Memories (`public.memory_items` / MemoryStore)

- **Store**: PostgreSQL MemoryStore
- **Pagination**: Export-specific port; owner-scoped `created_at ASC, id ASC` pages, including every retained state without the UI10,000-record cap. Counts reflect the delivered records; failures abort the success envelope.
- **Ownership**: `userId = auth.uid()`
- **Included Fields**:
  - `id` (string)
  - `kind` (string)
  - `content` (string)
  - `source` (string)
  - `status` ("active" | "candidate" | "superseded" | "deleted"); expired records retain their status and expiry timestamp
  - `confidence` (number)
  - `importance` (number)
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)
  - `expiresAt` (ISO 8601 string | null)
  - `metadata` (json object)

### 2.9 User Feedback & Reviews (`public.user_feedback`)

- **Table**: `public.user_feedback`
- **Ownership**: `user_id = auth.uid()`
- **Pagination**: Batch size500 ordered by `created_at DESC, id ASC`; exhaustion/failure behavior follows the overview.
- **Included Fields**:
  - `id` (uuid)
  - `category` ("like" | "dislike" | "change" | "bug" | "general")
  - `rating` (number 1-5 | null)
  - `message` (string)
  - `context` (json: app version, platform)
  - `createdAt` (ISO 8601 string)

### 2.10 Private Media Metadata & Temporary Download URLs (`public.media_assets`)

- **Table**: `public.media_assets`
- **Storage Bucket**: `private-media`
- **Ownership**: `user_id = auth.uid()` and object path prefix `${user_id}/`
- **Pagination**: Batch size500 ordered by `created_at DESC, id ASC`; exhaustion/failure behavior follows the overview.
- **Included Fields**:
  - `id` (uuid)
  - `objectPath` (string)
  - `purpose` ("progress" | "meal")
  - `mimeType` (string)
  - `byteSize` (number)
  - `downloadUrl` (string | null) — 24-hour signed download link; no offline media bytes are embedded. Any export with listed private media is marked `partial`, including when signing succeeds
  - `createdAt` (ISO 8601 string)
  - `updatedAt` (ISO 8601 string)

---

### 2.11 Recurring meals and private suggestions

`recurringMeals` includes owned schedules and occurrences. The private suggestion data is in the top-level `recurringMealSuggestions` section as `states`, `preferences` and `receipts` (moved there 2026-10-21, ADR-0078, because the build 1.0.9 Store app parses `recurringMeals` strictly). New tables use authenticated owner reads and deterministic500-row pagination by their actual primary keys (`family_key`, `user_id`, `operation_id`), without assuming an `id` column. Receipts include private frozen schedule inputs/results for recovery. Account erasure clears suggestion state before schedules and database admission blocks recreation during deletion.

Mobile account export additionally includes `localRecurringMealSetup` from the active owner's encrypted operation journal; local account erasure retires callbacks and removes manifest/journal/chunks. Signout retains owner-keyed recovery for later same-owner resolution but cannot display or submit it as another account. These optional categories are present as arrays; the legacy summary manifest counts do not enumerate every optional category.

## 3. Deliberate & Justified Exclusions

| Excluded Resource                              | Justification                                                                                                                                                                                        |
| :--------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.users` Password Hashes & Salts           | Cryptographic credentials must never be exported to prevent offline brute-force attacks.                                                                                                             |
| Supabase Auth Session Refresh Tokens           | Ephemeral session tokens are revoked on export or signout to prevent session hijacking.                                                                                                              |
| `public.account_deletion_jobs` Tokens & Hashes | Internal challenge tokens are security controls for verification, not personal health records.                                                                                                       |
| `public.account_provider_revocations`          | Encrypted Apple refresh tokens and private recovery bindings are authentication cleanup secrets. They are never included in account exports; successful revocation clears the ciphertext (ADR-0050). |
| Server Secrets & API Keys                      | Infrastructure configuration is excluded by design.                                                                                                                                                  |
| Shared System Exercise Templates               | Universal exercise library definitions are public system records, not user-owned personal data.                                                                                                      |

---

## 4. Export Manifest Schema

Every export response includes a top-level `manifest` metadata block:

```json
{
  "schemaVersion": "2026-09-08",
  "generatedAt": "2026-09-08T16:25:00.000Z",
  "completeness": "complete",
  "counts": {
    "profiles": 1,
    "goals": 2,
    "foodEntries": 145,
    "exercises": 12,
    "workouts": 34,
    "workoutSets": 120,
    "bodyMeasurements": 28,
    "conversations": 6,
    "messages": 54,
    "memories": 8,
    "feedback": 2,
    "privateMedia": 5
  }
}
```

## Community subtree — COMM-12 / #151 (2026-10-11)

The existing top-level export envelope remains `2026-09-08`; the separate source-candidate `community` subtree has `schemaVersion: 2026-10-11` (older `2026-09-30` and `2026-10-01` subtrees remain readable), `consistency: live_keyset`, `completeness: complete`, per-category counts and explicit categories. This subtree is not a cross-table or database snapshot. Each category reads deterministic owner-scoped lexicographic keys in500-row pages with1000-page budget. RPC failure, missing/non-array/oversized page, malformed row, repeated/nonadvancing cursor or exhausted budget fails the export rather than claiming completeness. Concurrent inserts/withdrawal can affect different live category reads. Missing account-lifecycle acceptance from #25/#26 remains open. Requests without the `x-mizyun-api-compat` header (Store build 1.0.9 and older) receive the same subtree labelled `2026-10-01`, because that build accepts only the older labels (ADR-0078). Build 1.0.9 also drops top-level sections it does not know, such as `recurringMealSuggestions`, `bouldering` and `calorieAdjustmentProposals`, from the file it saves.

| Category                        | Included ownership                                                                                                                           | Excluded data                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| identity                        | Own social identity, generation and terms/adult acceptance receipts                                                                          | Other members' profiles                                                              |
| relationships                   | Incoming/outgoing own graph with permitted edge references/status/timestamps                                                                 | Other users' unrelated edges                                                         |
| blocks / mutes                  | Own safety choices                                                                                                                           | Who blocked/reported the exporter                                                    |
| activities / reactions          | Own published snapshots (`activity_kind`, `workout_details`, `meal_details`, `bouldering_details`)/source reference and own reaction records | Other people's private workouts, reaction identities on their unrelated cards        |
| invitations                     | Own invite metadata/expiry/revocation                                                                                                        | Bearer invitation token                                                              |
| reports / appeals               | Own reporter case status/text and own appeal                                                                                                 | Other reporters' identities, staff notes/operators/evidence, unrelated subject cases |
| notificationPreferences / inbox | Own settings and retained event metadata                                                                                                     | Private source health details                                                        |
| pushRegistrations / delivery    | Own installation metadata and delivery status/attempts/expiry                                                                                | Device push token, Auth session ID, lease IDs, internal dedupe keys                  |

The source candidate declares **33 categories**; the current Dev `2596a69b` export still declares31 at `2026-10-01` until the new forward migration and runtime are accepted/deployed together. In addition to the original categories above:

| Category                                                                     | Included ownership                                                                                        | Excluded data                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| comments / commentMentions                                                   | Own comments and own mention-event metadata                                                               | Unrelated discussions and other members’ private data          |
| commentPreferences / commentSettings                                         | Own mention consent and settings for own published cards                                                  | Another author’s thread settings                               |
| groupMemberships / groupPosts / groupAppeals / groupEvents / groupOperations | Own membership, authored posts, appeals, events and operation receipts                                    | Unrelated membership and private staff evidence                |
| routineShares / routineImports                                               | Own shared projections and own import receipts                                                            | Another person’s private routines                              |
| messages / messageOperations / messagingPreferences                          | Own authored messages, operation receipts and own consent/preferences                                     | Another person’s authored messages and unrelated conversations |
| broaderDiscoveryPreferences                                                  | Own explicit discovery consent                                                                            | Other members’ discoverability choices                         |
| challenges / challengeMemberships / challengeContributions                   | Own created challenges, own joined memberships (including another creator’s challenge), own contributions | Foreign memberships/contributions and private workouts         |
| media / mediaReviews                                                         | Own media metadata and permitted own review metadata                                                      | Signed URLs, unrelated assets and private reviewer evidence    |

Adding participant membership and per-card settings closes source inventory omissions; it does not certify archive coverage, Storage bytes, legal retention or a cross-category snapshot. New export results are withheld on malformed transport success instead of being marked complete.

Withdrawal keeps the account/private diary, safety blocks, preferences and current-day abuse counters; asynchronous durable generation cleanup physically removes old publication/inbox/device artifacts. Same-day reenrollment cannot reset invitation/publication quotas. Account deletion separately batches all introduced owner/incoming references before Auth erasure, guarded by the exact deletion-job lease. A reporter deletion preserves only an anonymized minimal case if needed for an active sanction's independent appeal; expired closed-case evidence is removed, and no retention/legal approval is inferred from the implementation.
