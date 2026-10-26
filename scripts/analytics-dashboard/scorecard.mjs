import { readFileSync } from "node:fs";

export const SCORECARD_SQL = readFileSync(
  new URL("./scorecard.sql", import.meta.url),
  "utf8",
);

export const SCORECARD_COLUMNS = [
  "metric",
  "cohort_start",
  "cohort_end",
  "dimension",
  "numerator",
  "denominator",
];

export const SCORECARD_METRICS = new Set([
  "installs",
  "activated",
  "first_record_kind",
  "day_7_return",
  "week_4_return",
  "first_record_cohort",
  "mau",
  "registrations",
  "registered_accounts",
  "consenting_accounts",
]);

const DIMENSION = /^(all|unanswered|[a-z_]{2,32}|[0-9]{4}-W[0-9]{2})$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const COUNT = /^[0-9]{1,9}$/;

/** Parse `psql -A -t` output and refuse anything but aggregate rows. */
export function parseScorecard(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() && !/^(BEGIN|SET|COMMIT)$/.test(line.trim()))
    .map((line) => {
      const [
        metric,
        cohortStart,
        cohortEnd,
        dimension,
        numerator,
        denominator,
      ] = line.split("|");
      if (
        line.split("|").length !== SCORECARD_COLUMNS.length ||
        !SCORECARD_METRICS.has(metric) ||
        (cohortStart !== "" && !DATE.test(cohortStart)) ||
        !DATE.test(cohortEnd) ||
        !DIMENSION.test(dimension) ||
        !COUNT.test(numerator) ||
        (denominator !== "" && !COUNT.test(denominator))
      )
        throw new Error("Scorecard row is not an aggregate count");
      return {
        metric,
        cohortStart: cohortStart || null,
        cohortEnd,
        dimension,
        numerator: Number(numerator),
        denominator: denominator === "" ? null : Number(denominator),
      };
    });
}
