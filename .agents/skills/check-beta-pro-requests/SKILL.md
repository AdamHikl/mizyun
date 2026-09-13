---
name: check-beta-pro-requests
description: >-
  Inspect, triage, and manage pending or active Beta Pro Pass requests submitted by users across Dev and Production environments.
---

# Check Beta Pro Requests Skill

Use this skill whenever the user asks:

- "Check any pending requests on both production and dev for beta pro pass"
- "Are there any beta pro requests?"
- "Show me pending beta pro requests"
- "Approve beta pro pass for user"
- "Reject beta pro pass"

## Overview

In Mizyun, users can request a "Beta Pro Pass" from the Settings AI Usage card or during Onboarding (`POST /v1/coach/beta-pro/request`). This creates a row in PostgreSQL table `public.beta_pro_requests`.

When an admin approves a request, PostgreSQL trigger `trg_beta_pro_approval` updates the user's `profiles.plan_tier` to `'paid'`, raising their daily meal photo draft limit from 3 to 100 scans per day. If the user stored an Expo push token, an approval notification is dispatched to their device.

This utility inspects both Production (`supabase-db`) and Dev (`mizyun-dev-db`) PostgreSQL instances on the Raspberry Pi host (`rpserver`).

---

## Quick Start

### 1. Check pending requests on both Dev and Production:

```bash
node scripts/check-beta-pro-requests.mjs
# or:
pnpm beta-pro
```

### 2. Check a single environment:

```bash
# Production only:
node scripts/check-beta-pro-requests.mjs --env production

# Dev only:
node scripts/check-beta-pro-requests.mjs --env dev
```

### 3. Show all requests (including approved and rejected):

```bash
node scripts/check-beta-pro-requests.mjs --all
```

### 4. Output structured JSON:

```bash
node scripts/check-beta-pro-requests.mjs --json
```

### 5. Approve a request:

```bash
node scripts/check-beta-pro-requests.mjs --approve <email-or-id> [--env dev|prod] [--note "Early tester"]
```

### 6. Reject a request:

```bash
node scripts/check-beta-pro-requests.mjs --reject <email-or-id> [--env dev|prod] [--note "Reason"]
```

---

## Data Model Reference

### Supabase Table (`public.beta_pro_requests`)

- `id` (uuid): Primary key.
- `user_id` (uuid): References `auth.users(id)`.
- `email` (text): User email.
- `push_token` (text, nullable): Device Expo push token (e.g. `ExponentPushToken[...]`).
- `status` (text): One of `'pending'`, `'approved'`, `'rejected'`.
- `notes` (text, nullable): Optional admin or review notes.
- `created_at` (timestamptz): Submission timestamp.
- `reviewed_at` (timestamptz, nullable): Review timestamp.

### Automatic Database Trigger

On status update:

- `status = 'approved'` -> sets `public.profiles.plan_tier = 'paid'` and `reviewed_at = now()`.
- `status = 'rejected'` (when previously approved) -> sets `public.profiles.plan_tier = 'free'`.
