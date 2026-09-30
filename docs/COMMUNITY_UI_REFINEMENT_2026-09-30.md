# Community UI refinement — 2026-09-30

Adam explicitly requested a more refined, understandable Community page and an information architecture agent. Baseline `66e46907e0489cdd1b8eb06546333390b5a49067`, branch `codex/community-140-145`, initial tree clean; #150 with enrollment #142. DEV ONLY.

## Information architecture and implementation

Information architect reviewed current form/hub, product contract and ADR-0031. Flat joining paragraphs, equal-weight utility actions and consent before identity fields made the flow hard to scan. Four small pills obscured destination contents. The approved bounded structure retains a single scroll page and visible optional fields, avoiding new wizard state, hidden consent or discarded drafts.

Joining: short introduction and private-choice summary → Your Community profile → Optional details → Discovery → Before you join (audience, earlier still-shared cards, directional approval, eligibility and separate unchecked declarations/rules) → primary Join, secondary private exit → Help & safety. Editing uses Profile & privacy, explicit Save and separate participation/withdrawal controls. Existing validation/admission/principal/retry/recovery logic remains. Current coverage limitations remain truthful.

Enrolled hub: descriptive wrapping navigation cards for Find friends, Friends & requests, Inbox and Profile & privacy; explicit Following feed heading and audience explanation. Sharing guidance links to saved workouts and explains generic category, selected day and optional duration only. A failed feed read now says activity is unavailable rather than claiming no shared workouts. Existing routes and permission freshness remain unchanged.

Existing theme colors, fluid centered max width, tab clearance,48-point actions, wrapping/scalable text and accessible headings/hints support narrow layouts. No new dependencies, backend configuration, database mutation, auto enrollment/sharing, Production, main merge or Store action. Visual source improvement is distinct from physical appearance/accessibility/usability acceptance.

## Ownership and evidence

Information architect owns only settings screen/tests; coordinator owns feed/test changes, shared documents, GitHub and native resources. Separate non-author review approved consent/privacy copy, failure states and lifecycle preservation after correcting small secondary text contrast on new light card surfaces (normal cards now use theme.background). Reviewer focused checks69/5files PASS; coordinator same focused suite69/5files plus mobile typecheck PASS. Controlled rendering tests mock hooks/effects; controller coverage supplements them, not native acceptance. Initial full gate was interrupted deliberately for the contrast correction; fresh corrected-source `pnpm check` PASS, exit0: mobile1019/API730,15 existing policy/credential-gated API skips, dual Hermes exports/typechecks/navigation/formatting/safeguards/offline/Community operations and7 Dev Apple capability checks. No runtime writes after the rerun began. Ephemeral full log `/private/tmp/community-ui-refinement-pnpm-check.log`; this is the durable qualified record. Installed-candidate evidence follows separately; historical checks are not reused as fresh.

## Remaining acceptance

Exact installed build still needs real joining/decline/error/retry, profile persistence, keyboard, large text, dark/light, small-device/VoiceOver and enrolled navigation/feed interaction. Only Adam is admitted; separate partner authorization is needed for real following/feed interactions. Existing Android, operator/legal/restore/push/pilot gates remain separate and issues stay open.
