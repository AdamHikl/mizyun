import { describe, expect, it } from "vitest";
import { HistoryImportFileError } from "./history-import";
import {
  isValidHistoryTimezone,
  parseHistoryDateTime,
  historyDateTimeToUtcMs,
  readHistoryCsv,
  readHistoryDecimal,
  readHistoryDuration,
  zonedWallTimeToUtcMs,
} from "./history-import-csv";

const fileError = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof HistoryImportFileError ? error.code : "other";
  }
};

describe("readHistoryCsv", () => {
  it("handles quotes, escaped quotes, embedded delimiters and newlines", () => {
    const table = readHistoryCsv('a,b,c\n1,"x, ""y""","line1\nline2"\n2,3,4\n');
    expect(table.header).toEqual(["a", "b", "c"]);
    expect(table.records.map((r) => r.cells)).toEqual([
      ["1", 'x, "y"', "line1\nline2"],
      ["2", "3", "4"],
    ]);
    expect(table.records.map((r) => r.line)).toEqual([2, 4]);
  });

  it("strips a BOM and accepts CRLF, LF and CR line ends", () => {
    for (const eol of ["\r\n", "\n", "\r"]) {
      const table = readHistoryCsv(`﻿a,b${eol}1,2${eol}3,4`);
      expect(table.header).toEqual(["a", "b"]);
      expect(table.records.map((r) => r.cells)).toEqual([
        ["1", "2"],
        ["3", "4"],
      ]);
    }
  });

  it("skips blank lines but keeps physical line numbers", () => {
    const table = readHistoryCsv("\na,b\n\n1,2\n\n3,4\n");
    expect(table.records.map((r) => r.line)).toEqual([4, 6]);
  });

  it("detects the delimiter from the header outside quotes", () => {
    expect(readHistoryCsv("a;b;c\n1;2;3").delimiter).toBe(";");
    expect(readHistoryCsv("a\tb\tc\n1\t2\t3").delimiter).toBe("\t");
    expect(readHistoryCsv('"a,b,c,d";"e"\n1;2').delimiter).toBe(";");
    expect(readHistoryCsv("a,b\n1,2").delimiter).toBe(",");
  });

  it("enforces content, row, column and cell limits", () => {
    expect(
      fileError(() => readHistoryCsv("a,b\n1,2", { maxContentLength: 3 })),
    ).toBe("too_large");
    expect(fileError(() => readHistoryCsv("a\n1\n2\n3", { maxRows: 2 }))).toBe(
      "too_many_rows",
    );
    expect(fileError(() => readHistoryCsv("a,b,c\n1", { maxColumns: 2 }))).toBe(
      "unknown_format",
    );
    const table = readHistoryCsv("a,b\n1,2,3\n4,abcdef", {
      maxColumns: 2,
      maxCellLength: 4,
    });
    expect(table.records.map((r) => r.oversize)).toEqual([true, true]);
  });

  it("reports empty input", () => {
    expect(fileError(() => readHistoryCsv(""))).toBe("empty");
    expect(fileError(() => readHistoryCsv("\n\r\n"))).toBe("empty");
  });
});

describe("number and duration readers", () => {
  it("parses decimals and rejects garbage", () => {
    expect(readHistoryDecimal("82.5", false)).toBe(82.5);
    expect(readHistoryDecimal("", false)).toBeNull();
    expect(readHistoryDecimal("82,5", false)).toBe("invalid");
    expect(readHistoryDecimal("82,5", true)).toBe(82.5);
    expect(readHistoryDecimal("abc", true)).toBe("invalid");
    expect(readHistoryDecimal("1e3", false)).toBe("invalid");
  });

  it("parses durations", () => {
    expect(readHistoryDuration("1h 5m", false)).toBe(3900);
    expect(readHistoryDuration("55m", false)).toBe(3300);
    expect(readHistoryDuration("45s", false)).toBe(45);
    expect(readHistoryDuration("1h", false)).toBe(3600);
    expect(readHistoryDuration("01:05:00", false)).toBe(3900);
    expect(readHistoryDuration("05:30", false)).toBe(330);
    expect(readHistoryDuration("1500", false)).toBe(1500);
    expect(readHistoryDuration("soon", false)).toBe("invalid");
    expect(readHistoryDuration("", false)).toBeNull();
  });
});

describe("date parsing", () => {
  it("accepts the supported formats", () => {
    const local = (text: string) => {
      const parsed = parseHistoryDateTime(text);
      return parsed?.kind === "local" ? parsed.local : parsed;
    };
    const expected = {
      year: 2026,
      month: 10,
      day: 26,
      hour: 7,
      minute: 30,
      second: 0,
    };
    expect(local("26 Oct 2026, 07:30")).toEqual(expected);
    expect(local("Oct 26, 2026, 7:30 AM")).toEqual(expected);
    expect(local("2026-10-26 07:30")).toEqual(expected);
    expect(local("2026-10-26T07:30:00")).toEqual(expected);
    expect(local("2026-10-26")).toEqual({ ...expected, hour: 12, minute: 0 });
    expect(local("Oct 26, 2026, 12:05:09 AM")).toEqual({
      ...expected,
      hour: 0,
      minute: 5,
      second: 9,
    });
    expect(local("Oct 26, 2026, 7:30 PM")).toEqual({ ...expected, hour: 19 });
  });

  it("rejects impossible dates", () => {
    for (const text of [
      "",
      "yesterday",
      "2026-02-30",
      "2026-13-01",
      "26 Foo 2026",
      "2026-10-26 25:00",
      "Oct 26, 2026, 13:00 PM",
    ]) {
      expect(parseHistoryDateTime(text)).toBeNull();
    }
  });

  it("honours explicit ISO offsets", () => {
    expect(historyDateTimeToUtcMs("2026-10-26T07:30:00Z", "Asia/Tokyo")).toBe(
      Date.UTC(2026, 9, 26, 7, 30),
    );
    expect(
      historyDateTimeToUtcMs("2026-10-26T07:30:00+02:00", "America/New_York"),
    ).toBe(Date.UTC(2026, 9, 26, 5, 30));
    expect(
      historyDateTimeToUtcMs("2026-10-26T07:30:00-0530", "Europe/Bratislava"),
    ).toBe(Date.UTC(2026, 9, 26, 13, 0));
  });
});

describe("zoned local time", () => {
  const at = (iso: string, zone: string, hour: number, minute = 0): string => {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    return new Date(
      zonedWallTimeToUtcMs(
        { year: y, month: m, day: d, hour, minute, second: 0 },
        zone,
      ),
    ).toISOString();
  };

  it("applies the right Europe/Bratislava offset around DST changes", () => {
    expect(at("2026-03-28", "Europe/Bratislava", 12)).toBe(
      "2026-03-28T11:00:00.000Z",
    );
    expect(at("2026-03-29", "Europe/Bratislava", 12)).toBe(
      "2026-03-29T10:00:00.000Z",
    );
    expect(at("2026-10-24", "Europe/Bratislava", 12)).toBe(
      "2026-10-24T10:00:00.000Z",
    );
    expect(at("2026-10-25", "Europe/Bratislava", 12)).toBe(
      "2026-10-25T11:00:00.000Z",
    );
    expect(at("2026-10-25", "Europe/Bratislava", 3, 30)).toBe(
      "2026-10-25T02:30:00.000Z",
    );
  });

  it("applies America/New_York offsets", () => {
    expect(at("2026-03-08", "America/New_York", 12)).toBe(
      "2026-03-08T16:00:00.000Z",
    );
    expect(at("2026-01-15", "America/New_York", 12)).toBe(
      "2026-01-15T17:00:00.000Z",
    );
    expect(at("2026-11-01", "America/New_York", 12)).toBe(
      "2026-11-01T17:00:00.000Z",
    );
  });
});

describe("timezone validation", () => {
  it("accepts named zones only", () => {
    expect(isValidHistoryTimezone("Europe/Bratislava")).toBe(true);
    expect(isValidHistoryTimezone("UTC")).toBe(true);
    expect(isValidHistoryTimezone("")).toBe(false);
    expect(isValidHistoryTimezone("localtime")).toBe(false);
    expect(isValidHistoryTimezone("posix/UTC")).toBe(false);
    expect(isValidHistoryTimezone("Mars/Olympus")).toBe(false);
    expect(isValidHistoryTimezone("+02:00")).toBe(false);
  });
});

describe("text hygiene", () => {
  it("drops control characters that Postgres cannot store and keeps tabs and newlines", async () => {
    const { readHistoryCsv } = await import("./history-import-csv");
    const table = readHistoryCsv('a,b\n"x\u0000y\u0007","line\none\tz"\n');
    expect(table.records[0]?.cells).toEqual(["xy", "line\none\tz"]);
  });

  it("cuts text by code point without splitting an emoji", async () => {
    const { sliceHistoryText } = await import("./history-import-csv");
    expect(sliceHistoryText("ab😀c", 3)).toBe("ab😀");
    expect(sliceHistoryText("ab", 3)).toBe("ab");
  });
});
