---
name: log-github-issue
description: >-
  Quickly capture a user-described Mizyun bug, feature request, or idea as a GitHub issue in the current repository. Use when the user says to log, save, add, or create an issue for later; skip issue analysis or implementation unless explicitly requested.
---

# Log GitHub Issue

Create the issue with the least work needed while preserving the user's intent.

## Default: Quick Capture

When the user asks to record an issue for later:

1. Write a short, descriptive title from the user's words.
2. Use the user's wording for the body, with only light grammar or clarity edits. Keep it to one short paragraph unless the user supplied more detail.
3. Add the smallest appropriate label set described below and create the issue in the current repository with `gh issue create`.
4. Return the issue number and clickable URL.

Do not inspect implementation code, browse documentation, develop acceptance criteria, propose a solution, create a plan, or delegate research in quick-capture mode. Do not add facts, scope, technical assumptions, or requirements that the user did not provide.

Pure issue capture is a small administrative action, not a substantive engineering work package. Do not update `status.md`, `plan.md`, or other continuity files solely because an issue was captured.

## Labels

Mizyun issues require one `priority:*`, one `status:*`, and one `area:*` label. Reuse labels already loaded in context; otherwise `gh label list --limit 100` is the only preflight lookup.

- Follow labels explicitly supplied by the user.
- For unscheduled future work, default to `priority:P2`.
- Default to `status:ready` for captured future work. Use another status only when the user explicitly supplies it and that label exists.
- Select the single closest existing `area:*` label from the subject, such as `area:nutrition` for meals, `area:workout` for workouts, or `area:session` for developer tooling.
- Add `bug` or `enhancement` only when the distinction is obvious from the user's wording.

Choosing labels is triage, not permission to expand or analyze the issue body.

## Safety and Failure Handling

- The request to create the GitHub issue authorizes that issue creation only. It does not authorize implementation, commits, pushes, deployments, or other remote changes.
- Exclude credentials, tokens, private health data, full email addresses, and other secrets even if they appear in raw notes. If removing sensitive content would make the issue unclear, ask for a safe replacement.
- Do not ask for confirmation when the repository and requested issue are clear.
- If the repository cannot be determined, ask one concise question.
- If `gh` reports an authentication, permission, or connectivity failure, report that failure or use the environment's normal approval flow to retry the same issue creation. Do not silently target a different repository.

## Detailed Mode

Only when the user explicitly asks for analysis, reproduction steps, acceptance criteria, technical scoping, or labels, gather the requested context and expand the issue accordingly. Keep that extra work proportional to the request.
