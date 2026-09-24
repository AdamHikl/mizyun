---
name: check-beta-pro-requests
description: >-
  Inspect, triage, and manage Beta Pro Pass tier requests submitted by users across Dev and Production environments. Separates read-only inspection from tier mutation and push notification delivery. Use when managing user beta requests; skip for general AI access issues.
---

# Check Beta Pro Requests Skill

Use this skill whenever the user asks:

- "Check any pending requests on both production and dev for beta pro pass"
- "Are there any beta pro requests?"
- "Show me pending beta pro requests"
- "Approve beta pro pass for user <email>"
- "Reject beta pro pass for user <email>"

---

## Important Policy Boundary (ADR-0024)

> [!IMPORTANT]
> **Beta Pro Tier vs. AI Feature Access**:
>
> - Under **ADR-0024**, authenticated adult users receive **immediate access to AI features** (Coach chat, text drafts) upon saving informed consent, without requiring founder approval or email-list enrollment.
> - The **Beta Pro Pass** elevates `profiles.plan_tier` from `'free'` to `'paid'`, raising the daily photo meal draft limit from 3 to 100 scans/day.
> - **Never** treat Beta Pro approval as a prerequisite or allowlist for basic AI feature admission.

---

## 1. Read-Only Query & Inspection (Default)

Always prefer read-only queries unless explicitly directed to approve or reject:

```bash
# Check pending requests on both Dev and Production (default):
node scripts/check-beta-pro-requests.mjs

# Check a specific environment:
node scripts/check-beta-pro-requests.mjs --env dev
node scripts/check-beta-pro-requests.mjs --env production

# View all requests (including previously approved and rejected):
node scripts/check-beta-pro-requests.mjs --all

# Output machine-readable JSON:
node scripts/check-beta-pro-requests.mjs --json
```

---

## 2. Tier Mutation Actions (Admin Authorization Required)

> [!CAUTION]
> Approving or rejecting a request produces live remote and external side effects:
>
> 1. Modifies `public.beta_pro_requests` in the remote database on the Hetzner primary host.
> 2. Database trigger `trg_beta_pro_approval` mutates `public.profiles.plan_tier = 'paid'` (or `'free'`).
> 3. Dispatches a live push notification across the internet to the user's phone via Apple APNs HTTP/2 or Expo Push.
>
> Only execute these commands when explicitly instructed by the user to approve or reject.

```bash
# Approve a user's request (requires explicit environment flag):
node scripts/check-beta-pro-requests.mjs --approve <email-or-uuid> --env dev --note "Early tester"
node scripts/check-beta-pro-requests.mjs --approve <email-or-uuid> --env production --note "Approved"

# Reject a user's request:
node scripts/check-beta-pro-requests.mjs --reject <email-or-uuid> --env dev --note "Reason"
```

---

## Data Model Reference

- **Database Table**: `public.beta_pro_requests` on `supabase-db` (Prod) or `mizyun-dev-db` (Dev).
- **Trigger**: `trg_beta_pro_approval` on `public.beta_pro_requests`.
  - `status = 'approved'` -> sets `public.profiles.plan_tier = 'paid'`.
  - `status = 'rejected'` -> reverts `public.profiles.plan_tier = 'free'`.
- **Push Transport**:
  - Direct Apple APNs HTTP/2 using `.env` credentials (`api.sandbox.push.apple.com` for Dev, `api.push.apple.com` for Prod).
  - Expo Push API (`https://exp.host/--/api/v2/push/send`) as fallback.
