---
name: check-unprocessed-feedback
description: >-
  Inspect, triage, and track new or unprocessed in-app user feedback from Supabase. Provides bounded, privacy-aware summaries and managed resolution tracking. Use when asked to review app suggestions or bug reports; skip for general bug triage.
---

# Check Unprocessed Feedback Skill

Use this skill whenever the user asks:

- "Is there any new feedback?"
- "Check new user feedback"
- "Show me unprocessed feedback"
- "Review user suggestions / bug reports from the app"

## Overview

Mizyun users submit reviews, feature suggestions, and bug reports through the mobile app modal (`POST /v1/feedback`), stored in table `public.user_feedback`.

This utility inspects the primary host (`rpserver`) database and compares results against the local tracking ledger (`processed-feedback.json`), displaying only unreviewed items.

---

## Usage Commands

### 1. Read-Only Inspection (Default)

Inspect unprocessed feedback from Production (default) or Dev:

```bash
# Production:
node scripts/check-user-feedback.mjs

# Dev environment:
node scripts/check-user-feedback.mjs --env dev

# Machine-readable JSON summary:
node scripts/check-user-feedback.mjs --json
```

> [!NOTE]
> Run using standard environment execution. If SSH network access to `rpserver` is restricted by your sandbox, request network elevation.

### 2. State Mutation (Mark as Processed)

> [!WARNING]
> Only mark items as processed when explicitly instructed by the user or when converting the feedback into a concrete backlog work item. Never run `--mark-all` automatically.

```bash
# Mark a single item as processed with a resolution note:
node scripts/check-user-feedback.mjs --mark <FEEDBACK_UUID> --note "Logged to backlog as MEAL-UX-005"

# Unmark an item if previously marked in error:
node scripts/check-user-feedback.mjs --unmark <FEEDBACK_UUID>
```

---

## Agent Procedure & Privacy Rules

1. **Query Unprocessed Feedback**:
   Execute `node scripts/check-user-feedback.mjs` (read-only).

2. **Present a Bounded, Sanitized Summary**:
   - Do **NOT** dump full raw email addresses, private user details, or unlimited message bodies into the conversation.
   - Present a structured summary table or list:
     - **ID**: First 8 characters of UUID (e.g. `9f2cd667...`)
     - **Date**: Relative or UTC date
     - **Category**: `like`, `change` (feature request), `bug` (bug report), `dislike`, or `general`
     - **Rating**: Star rating (1–5) if provided
     - **Summary**: Concise 1–2 sentence excerpt of the user's feedback
     - **Attachments**: Note count of media asset attachments if present

3. **Offer Next Steps**:
   - If a valid bug or feature is described, propose creating a GitHub issue via `gh issue create`.
   - Ask if the user wants to mark the item as processed.

---

## Data Model & Ledger Reference

- **Database Table**: `public.user_feedback` on `supabase-db` (Prod) or `mizyun-dev-db` (Dev).
- **Local Ledger**: `.agents/skills/check-unprocessed-feedback/processed-feedback.json` (records processed UUIDs, timestamps, and resolution notes).
