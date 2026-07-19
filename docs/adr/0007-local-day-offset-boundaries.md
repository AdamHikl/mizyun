# ADR 0007: Explicit UTC offsets for local-day food queries

- Status: accepted
- Date: 2026-07-19

## Context

Food timestamps are stored as UTC instants, while NUT-02 promises totals for the user's calendar day. Treating a `YYYY-MM-DD` query as a UTC day misclassifies entries near midnight for most users. The API cannot infer the device timezone from an authenticated request.

## Decision

Food list and summary queries accept an optional `utcOffsetMinutes`, positive east of UTC and bounded from -840 to 840. The API converts the requested local date to UTC repository bounds, and the pure core aggregator shifts each instant by that same offset before deriving its calendar-date bucket. Omitting the parameter preserves the existing UTC behavior.

The mobile app sends `-date.getTimezoneOffset()`, matching the contract's positive-east convention.

## Sources consulted

- MDN `Date.prototype.getTimezoneOffset()`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getTimezoneOffset
- IETF RFC 9110: https://datatracker.ietf.org/doc/rfc9110/

## Consequences

- Today's food list and calorie/macro totals respect the device's local calendar day, including entries that cross UTC midnight.
- Existing callers remain compatible and retain UTC semantics until they opt into an offset.
- One offset is exact for a daily query. A future long historical range spanning a daylight-saving transition should use the user's IANA timezone or issue per-day requests with the offset for each date.
