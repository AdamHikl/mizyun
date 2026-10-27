/**
 * Client capability signal for release compatibility.
 *
 * Every request from the current API client carries `x-mizyun-api-compat`.
 * Installed Store builds up to 1.0.9 (9) predate it, so a request without the
 * header is a legacy client: the server keeps its responses parseable by that
 * build's strict schemas (for example a non-null goal `targetDate`).
 *
 * The value is a date-stamped compatibility level. The server treats any
 * non-empty value as current; later levels may add further capabilities.
 */
export const API_COMPAT_HEADER = "x-mizyun-api-compat";

/** Compatibility level sent by this source tree's API client. */
export const API_COMPAT_VERSION = "2026-10-21";

/**
 * REL-01: the phone's current IANA zone, sent by the current API client on
 * every request. The server uses it only while the stored profile zone is
 * still the default, so a missing or invalid value (older builds) keeps the
 * stored zone.
 */
export const DEVICE_TIME_ZONE_HEADER = "x-mizyun-time-zone";
