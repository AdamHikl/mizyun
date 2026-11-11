# Mizyun roadmap

The detailed, current work list is in
[GitHub Issues](https://github.com/AdamHikl/mizyun/issues) (about 190 open items,
labelled by priority, status and area). [`plan.md`](plan.md) holds phase
sequencing and exit criteria. This page summarizes the work ahead by theme.

## Store release and account lifecycle

- Fix the iPad adult-consent button and resolve the remaining App Review
  findings, then submit the accepted iOS build for public release (#135, #136, #9).
- Publish the accepted Google Play release (#6).
- Finish complete account export and deletion, including recovery and
  outside-app requests (#25, #26).
- Finish native Sign in with Apple, revocation and deletion acceptance (#7).

## Reliability and offline use

- Keep the Workouts tab populated offline after a restart (#346, #352).
- Stop live workouts losing logged sets after the phone locks (#290).
- Finish durable retries for the remaining logging actions (#31).
- Remove duplicate evening catch-up notifications (#307).
- Avoid unexpected sign-outs during short Auth outages (#270).

## Nutrition and cooking

- Rate-based goal modes with weekly calorie self-adjustment (#248).
- Local-first meal photos with optional backup (#321).
- A photo-first "What can I cook?" assistant (#297) and fixed ingredient-photo
  analysis (#295).

## Coach and AI

- Native grounded Coach conversations with read-only tools (#36).
- Crisis resources for crisis text entered in logging fields (#344).
- Keep AI usage cost below subscription revenue (#336).

## Subscriptions and activation

- Store billing for the Pro tier (#332, #38).
- Two-minute first value and activation measurement (#335).

## Infrastructure

- Verify Dev and Production isolation and finish promotion recovery (#21, #23).
- Tighten Dev delivery safeguards (#231).
- Domain-authenticated transactional email (#49).
