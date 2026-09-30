import { describe, expect, it } from "vitest";
import {
  formatCategory,
  formatDuration,
  formatPublishedAt,
  formatSharedDay,
} from "./formatters";

describe("feed formatters", () => {
  describe("formatSharedDay", () => {
    it("formats calendar day without timezone conversion", () => {
      expect(formatSharedDay("2026-09-29")).toBe("Sep 29, 2026");
      expect(formatSharedDay("2026-01-01")).toBe("Jan 1, 2026");
      expect(formatSharedDay("2026-12-31")).toBe("Dec 31, 2026");
    });

    it("falls back gracefully for invalid string", () => {
      expect(formatSharedDay("invalid")).toBe("invalid");
    });
  });

  describe("formatPublishedAt", () => {
    it("returns formatted date or empty on invalid ISO", () => {
      expect(formatPublishedAt("invalid")).toBe("");
      const formatted = formatPublishedAt("2026-09-30T10:00:00Z");
      expect(formatted).toBeTruthy();
      expect(formatted).toContain("Sep 30");
    });
  });

  describe("formatDuration", () => {
    it("returns null for null or negative duration", () => {
      expect(formatDuration(null)).toBeNull();
      expect(formatDuration(-10)).toBeNull();
    });

    it("formats short durations", () => {
      expect(formatDuration(15)).toEqual({
        text: "< 1m",
        accessible: "less than one minute",
      });
      expect(formatDuration(60)).toEqual({
        text: "1m",
        accessible: "1 minute",
      });
      expect(formatDuration(1800)).toEqual({
        text: "30m",
        accessible: "30 minutes",
      });
    });

    it("formats hour durations", () => {
      expect(formatDuration(3600)).toEqual({
        text: "1h",
        accessible: "1 hour",
      });
      expect(formatDuration(4500)).toEqual({
        text: "1h 15m",
        accessible: "1 hour and 15 minutes",
      });
    });
  });

  describe("formatCategory", () => {
    it("formats known categories", () => {
      expect(formatCategory("strength")).toBe("Strength workout");
      expect(formatCategory("running")).toBe("Running");
      expect(formatCategory("cycling")).toBe("Cycling");
      expect(formatCategory("hiit")).toBe("HIIT");
      expect(formatCategory("mobility")).toBe("Mobility");
      expect(formatCategory("walking")).toBe("Walking");
      expect(formatCategory("unknown")).toBe("Workout");
    });
  });
});
