/**
 * History import (#333): dependency-free CSV reader plus the number, duration,
 * date, unit and time-zone helpers the format parsers share. Pure TypeScript;
 * no Node-only APIs.
 */
import {
  HISTORY_IMPORT_LIMITS,
  HistoryImportFileError,
} from "./history-import";

export type HistoryImportLimitOverrides = Partial<
  Record<keyof typeof HISTORY_IMPORT_LIMITS, number>
>;
export type HistoryImportLimitValues = Record<
  keyof typeof HISTORY_IMPORT_LIMITS,
  number
>;

export const resolveHistoryImportLimits = (
  overrides?: HistoryImportLimitOverrides,
): HistoryImportLimitValues => ({ ...HISTORY_IMPORT_LIMITS, ...overrides });

export type CsvDelimiter = "," | ";" | "\t";

export interface CsvRecord {
  /** 1-based physical line on which the record starts. */
  readonly line: number;
  readonly cells: readonly string[];
  /** True when the record has too many columns or a cell that is too long. */
  readonly oversize: boolean;
}

export interface CsvTable {
  readonly delimiter: CsvDelimiter;
  /** Header cells, trimmed. */
  readonly header: readonly string[];
  /** Non-blank data records in file order. */
  readonly records: readonly CsvRecord[];
}

const DELIMITERS: readonly CsvDelimiter[] = [",", ";", "\t"];

const detectDelimiter = (text: string): CsvDelimiter => {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  let seenAny = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === '"') {
      inQuotes = !inQuotes;
      seenAny = true;
    } else if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (seenAny) break;
    } else if (inQuotes) {
      seenAny = true;
    } else {
      seenAny = true;
      if (ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
    }
  }
  let best: CsvDelimiter = ",";
  let bestCount = counts[","] ?? 0;
  for (const candidate of DELIMITERS) {
    const count = counts[candidate] ?? 0;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
};

/**
 * Read RFC 4180 CSV text. Strips a UTF-8 BOM, auto-detects the delimiter from
 * the header line, skips blank lines and records the starting line of each
 * record. Throws `HistoryImportFileError` for whole-file limits.
 */
export const readHistoryCsv = (
  input: string,
  limitOverrides?: HistoryImportLimitOverrides,
): CsvTable => {
  const limits = resolveHistoryImportLimits(limitOverrides);
  if (input.length > limits.maxContentLength) {
    throw new HistoryImportFileError("too_large");
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);

  const records: CsvRecord[] = [];
  let header: readonly string[] | null = null;
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let hadQuote = false;
  let atFieldStart = true;
  let line = 1;
  let recordLine = 1;
  let oversize = false;

  const pushField = (): void => {
    if (field.length > limits.maxCellLength) oversize = true;
    // NUL and other C0 controls cannot be stored in Postgres text or JSON.
    cells.push(field.replace(CONTROL_CHARACTERS, ""));
    field = "";
    atFieldStart = true;
  };
  const endRecord = (): void => {
    pushField();
    const blank = cells.length === 1 && cells[0] === "" && !hadQuote;
    if (!blank) {
      if (cells.length > limits.maxColumns) oversize = true;
      if (header === null) {
        if (oversize) throw new HistoryImportFileError("unknown_format");
        header = cells.map((cell) => cell.trim());
      } else {
        if (records.length >= limits.maxRows) {
          throw new HistoryImportFileError("too_many_rows");
        }
        records.push({ line: recordLine, cells, oversize });
      }
    }
    cells = [];
    hadQuote = false;
    oversize = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else if (ch === "\r") {
        if (text[i + 1] === "\n") i += 1;
        field += "\n";
        line += 1;
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      hadQuote = true;
      atFieldStart = false;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      field += ch;
      atFieldStart = false;
    }
  }
  if (field.length > 0 || cells.length > 0 || hadQuote) endRecord();

  if (header === null) throw new HistoryImportFileError("empty");
  return { delimiter, header, records };
};

// ---------------------------------------------------------------- text

/** C0 controls except tab, newline and carriage return, plus DEL. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** First `max` code points, so a cut never splits a surrogate pair. */
export const sliceHistoryText = (value: string, max: number): string => {
  const points = Array.from(value);
  return points.length <= max ? value : points.slice(0, max).join("");
};

/** Trim and collapse inner whitespace. */
export const collapseHistoryText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

// ------------------------------------------------------------- headers

export interface HistoryHeader {
  /** Lower case, parenthesised text removed, `_`/`-` as spaces, collapsed. */
  readonly key: string;
  /** Lower-cased text inside the last parentheses, if any. */
  readonly unit: string | null;
}

export const parseHistoryHeader = (cell: string): HistoryHeader => {
  const match = /\(([^()]*)\)\s*$/.exec(cell);
  const unit = match ? (match[1] ?? "").trim().toLowerCase() : null;
  const base = match ? cell.slice(0, match.index) : cell;
  return {
    key: base.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
    unit: unit === "" ? null : unit,
  };
};

export const parseHistoryHeaders = (
  header: readonly string[],
): readonly HistoryHeader[] => header.map(parseHistoryHeader);

/** First index whose key is one of `keys`, or -1. */
export const findHistoryColumn = (
  headers: readonly HistoryHeader[],
  keys: readonly string[],
): number => headers.findIndex((header) => keys.includes(header.key));

/** Last index whose key is one of `keys`, or -1. */
export const findLastHistoryColumn = (
  headers: readonly HistoryHeader[],
  keys: readonly string[],
): number => {
  for (let i = headers.length - 1; i >= 0; i -= 1) {
    if (keys.includes((headers[i] as HistoryHeader).key)) return i;
  }
  return -1;
};

export const countHistoryColumns = (
  headers: readonly HistoryHeader[],
  key: string,
): number => headers.filter((header) => header.key === key).length;

// ------------------------------------------------------------- numbers

export type HistoryNumber = number | null | "invalid";

/** Parse a decimal. Blank is `null`; garbage is `"invalid"`. */
export const readHistoryDecimal = (
  text: string,
  decimalComma: boolean,
): HistoryNumber => {
  let value = text.trim();
  if (value === "") return null;
  if (decimalComma && value.includes(",") && !value.includes(".")) {
    value = value.replace(",", ".");
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return "invalid";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "invalid";
};

const DURATION_UNITS =
  /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/i;

/**
 * Seconds from `1h 5m`, `55m`, `45s`, `01:05:00`, `05:30` (mm:ss) or plain
 * seconds. Blank is `null`.
 */
export const readHistoryDuration = (
  text: string,
  decimalComma: boolean,
): HistoryNumber => {
  const value = text.trim();
  if (value === "") return null;
  const plain = readHistoryDecimal(value, decimalComma);
  if (plain !== "invalid") return plain;
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(value);
  if (clock) {
    const a = Number(clock[1]);
    const b = Number(clock[2]);
    if (clock[3] === undefined) return a * 60 + b;
    return a * 3600 + b * 60 + Number(clock[3]);
  }
  const units = DURATION_UNITS.exec(value);
  if (units && (units[1] || units[2] || units[3])) {
    return (
      Number(units[1] ?? 0) * 3600 +
      Number(units[2] ?? 0) * 60 +
      Number(units[3] ?? 0)
    );
  }
  return "invalid";
};

// ---------------------------------------------------------------- units

export const KG_PER_LB = 0.45359237;
export const METERS_PER_MILE = 1609.344;

export type HistoryDistanceUnitName = "m" | "km" | "mi";

export const normalizeWeightUnit = (
  text: string | null | undefined,
): "kg" | "lb" | null => {
  switch ((text ?? "").trim().toLowerCase()) {
    case "kg":
    case "kgs":
    case "kilogram":
    case "kilograms":
      return "kg";
    case "lb":
    case "lbs":
    case "pound":
    case "pounds":
      return "lb";
    default:
      return null;
  }
};

export const normalizeDistanceUnit = (
  text: string | null | undefined,
): HistoryDistanceUnitName | null => {
  switch ((text ?? "").trim().toLowerCase()) {
    case "km":
    case "kms":
    case "kilometer":
    case "kilometers":
    case "kilometre":
    case "kilometres":
      return "km";
    case "mi":
    case "mile":
    case "miles":
      return "mi";
    case "m":
    case "meter":
    case "meters":
    case "metre":
    case "metres":
      return "m";
    default:
      return null;
  }
};

export const kgPerWeightUnit = (unit: "kg" | "lb"): number =>
  unit === "kg" ? 1 : KG_PER_LB;

export const metersPerDistanceUnit = (unit: HistoryDistanceUnitName): number =>
  unit === "m" ? 1 : unit === "km" ? 1000 : METERS_PER_MILE;

// ------------------------------------------------------------ time zone

/** Same rule as `isStorableRunTimezone` in contracts, reimplemented locally. */
const looksLikeNamedZone = (value: string): boolean =>
  /^[A-Za-z_]+(\/[A-Za-z0-9_+.-]+)*$/.test(value) &&
  !["Factory", "localtime"].includes(value) &&
  !/^(posix|right)\//.test(value);

/** A named IANA zone the runtime can format with. */
export const isValidHistoryTimezone = (value: string): boolean => {
  if (!looksLikeNamedZone(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export interface HistoryLocalDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, created);
  return created;
};

const wallClockAsUtc = (formatter: Intl.DateTimeFormat, ms: number): number => {
  const parts = formatter.formatToParts(ms);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const hour = get("hour") % 24;
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
};

/**
 * UTC milliseconds for a local wall time in a named zone. Iterative offset
 * solve so DST offsets are right; a time that does not exist (spring-forward
 * gap) or exists twice (fall-back) resolves deterministically.
 */
export const zonedWallTimeToUtcMs = (
  local: HistoryLocalDateTime,
  timeZone: string,
): number => {
  const wanted = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const formatter = formatterFor(timeZone);
  let guess = wanted;
  for (let i = 0; i < 4; i += 1) {
    const delta = wanted - wallClockAsUtc(formatter, guess);
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
};

// ---------------------------------------------------------------- dates

export type ParsedHistoryDateTime =
  | { readonly kind: "local"; readonly local: HistoryLocalDateTime }
  | { readonly kind: "instant"; readonly ms: number };

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const monthFromName = (name: string): number | null => {
  const lower = name.toLowerCase();
  if (lower.length < 3 || lower.length > 9) return null;
  const index = MONTHS.indexOf(lower.slice(0, 3));
  return index < 0 ? null : index + 1;
};

const buildLocal = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): HistoryLocalDateTime | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, hour, minute, second };
};

const withMeridiem = (hour: number, meridiem: string | undefined): number => {
  if (meridiem === undefined || meridiem === "") return hour;
  if (hour < 1 || hour > 12) return Number.NaN;
  const pm = meridiem.toLowerCase() === "pm";
  return (hour % 12) + (pm ? 12 : 0);
};

const TIME_PART = String.raw`(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?`;
const ISO_DATE =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const DAY_FIRST = new RegExp(
  String.raw`^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})` + TIME_PART + "$",
);
const MONTH_FIRST = new RegExp(
  String.raw`^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})` + TIME_PART + "$",
);

/**
 * Parse the date formats seen in Hevy, Strong, Strava and generic files:
 * `2026-10-26[ T]07:30[:00][Z|±hh:mm]`, `2026-10-26` (12:00 local),
 * `26 Oct 2026, 07:30`, `Oct 26, 2026, 7:30 AM`. Returns `null` when the text
 * is not a valid date.
 */
export const parseHistoryDateTime = (
  text: string,
): ParsedHistoryDateTime | null => {
  const value = text.trim();
  if (value === "") return null;

  const iso = ISO_DATE.exec(value);
  if (iso) {
    const dateOnly = iso[4] === undefined;
    const local = buildLocal(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      dateOnly ? 12 : Number(iso[4]),
      dateOnly ? 0 : Number(iso[5]),
      Number(iso[6] ?? 0),
    );
    if (!local) return null;
    const offset = iso[7];
    if (offset === undefined) return { kind: "local", local };
    let offsetMinutes = 0;
    if (offset.toUpperCase() !== "Z") {
      const digits = offset.slice(1).replace(":", "");
      const hours = Number(digits.slice(0, 2));
      const minutes = Number(digits.slice(2) || "0");
      if (hours > 14 || minutes > 59) return null;
      offsetMinutes =
        (offset.startsWith("-") ? -1 : 1) * (hours * 60 + minutes);
    }
    const ms =
      Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
      ) -
      offsetMinutes * 60_000;
    return { kind: "instant", ms };
  }

  const dayFirst = DAY_FIRST.exec(value);
  const monthFirst = dayFirst ? null : MONTH_FIRST.exec(value);
  const m = dayFirst ?? monthFirst;
  if (!m) return null;
  const month = monthFromName((dayFirst ? m[2] : m[1]) as string);
  if (month === null) return null;
  const day = Number(dayFirst ? m[1] : m[2]);
  const year = Number(m[3]);
  const hasTime = m[4] !== undefined;
  const hour = hasTime ? withMeridiem(Number(m[4]), m[7]) : 12;
  if (Number.isNaN(hour)) return null;
  const local = buildLocal(
    year,
    month,
    day,
    hour,
    hasTime ? Number(m[5]) : 0,
    Number(m[6] ?? 0),
  );
  return local ? { kind: "local", local } : null;
};

/** UTC milliseconds for the text, local times resolved in `timeZone`. */
export const historyDateTimeToUtcMs = (
  text: string,
  timeZone: string,
): number | null => {
  const parsed = parseHistoryDateTime(text);
  if (!parsed) return null;
  return parsed.kind === "instant"
    ? parsed.ms
    : zonedWallTimeToUtcMs(parsed.local, timeZone);
};
