---
name: check-unprocessed-feedback
description: >-
  Inspect, triage, and track new or unprocessed user feedback and reviews submitted via the in-app feedback option from Supabase.
---

# Check Unprocessed Feedback Skill

Use this skill whenever the user asks:

- "Is there any new feedback?"
- "Check new user feedback"
- "Show me unprocessed feedback"
- "Review user suggestions / bug reports from the app"

## Overview

In Mizyun, users submit reviews, feature requests, change suggestions, and bug reports through the mobile app modal (`POST /v1/feedback`), which stores rows in PostgreSQL table `public.user_feedback`.

This skill provides an automated workflow to:

1. Fetch all submitted feedback directly from Supabase on the primary host (`rpserver`).
2. Compare submitted feedback against the local processed feedback ledger (`processed-feedback.json`).
3. Display newly received, unprocessed items with full context (user email, category, rating, message, attachments).
4. Mark items as processed with optional resolution notes once they have been reviewed or converted into backlog items.

---

## Quick Start

### 1. Show only new, unprocessed feedback:

```bash
node scripts/check-user-feedback.mjs
```

_(Or via the skill runner: `node .agents/skills/check-unprocessed-feedback/scripts/check-feedback.mjs`)_

### 2. Show all feedback (both new and processed):

```bash
node scripts/check-user-feedback.mjs --all
```

### 3. Mark feedback item as processed:

```bash
node scripts/check-user-feedback.mjs --mark <FEEDBACK_UUID> --note "Logged to backlog as issue #XYZ"
```

### 4. Mark all current feedback as processed:

```bash
node scripts/check-user-feedback.mjs --mark-all --note "Reviewed during triage session"
```

### 5. Check Dev environment instead of Production:

```bash
node scripts/check-user-feedback.mjs --env dev
```

---

## Procedure for Agents

When requested to check or triage user feedback:

1. **Run the script outside the sandbox**:
   Execute `node scripts/check-user-feedback.mjs` (requires SSH network access to `rpserver`).
2. **Review the output**:
   - If there is **no unprocessed feedback**, notify the user that all feedback has been reviewed.
   - If there **is unprocessed feedback**, present each item clearly:
     - **Date/Time**: When the user submitted it (UTC and local).
     - **User**: User email address.
     - **Category**: `like`, `change` (feature request), `bug` (bug report), `dislike`, or `general`.
     - **Rating**: Star rating if provided (1-5).
     - **Message**: The exact feedback text.
     - **Attachments**: Any media assets attached.
3. **Offer Action / Next Steps**:
   - Ask or propose adding valid feature requests or bug fixes to `backlog.md`.
   - Offer to mark the feedback as processed using `--mark <id>`.

---

## Data Model & Tracking Reference

### Supabase Table (`public.user_feedback`)

- `id` (uuid): Primary key.
- `user_id` (uuid): References `auth.users(id)`.
- `category` (text): One of `'like'`, `'dislike'`, `'change'`, `'bug'`, `'general'`.
- `rating` (smallint, nullable): 1 to 5.
- `message` (text): Up to 4000 characters.
- `context` (jsonb): Client-provided metadata (e.g. app version, screen).
- `media_asset_ids` (uuid[]): References `public.media_assets(id)`.
- `created_at` (timestamptz): Submission timestamp.

### Processed State Ledger

Path: `.agents/skills/check-unprocessed-feedback/processed-feedback.json`

Tracks:

```json
{
  "processed": [
    {
      "id": "uuid",
      "processedAt": "2026-09-09T09:30:00.000Z",
      "note": "Optional resolution or backlog reference"
    }
  ]
}
```
