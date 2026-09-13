import { describe, expect, it } from "vitest";
import {
  COUNTRIES,
  CountryItem,
  getCountryByCode,
  getEmojiFlag,
  getLocalizedCountryName,
  POPULAR_COUNTRY_CODES,
  searchCountries,
} from "./country-data";

describe("country-data", () => {
  it("contains exactly 249 ISO 3166-1 alpha-2 countries and territories", () => {
    expect(COUNTRIES.length).toBe(249);
  });

  it("ensures every country code matches strictly 2 uppercase letters", () => {
    const iso2Regex = /^[A-Z]{2}$/;
    for (const country of COUNTRIES) {
      expect(country.code).toMatch(iso2Regex);
      expect(country.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate country codes", () => {
    const seenCodes = new Set<string>();
    for (const country of COUNTRIES) {
      expect(seenCodes.has(country.code)).toBe(false);
      seenCodes.add(country.code);
    }
    expect(seenCodes.size).toBe(249);
  });

  it("all popular country codes exist in the dataset", () => {
    for (const code of POPULAR_COUNTRY_CODES) {
      const found = COUNTRIES.find((c) => c.code === code);
      expect(found).toBeDefined();
    }
  });

  it("generates correct Unicode emoji flags from 2-letter codes", () => {
    expect(getEmojiFlag("SK")).toBe("🇸🇰");
    expect(getEmojiFlag("CZ")).toBe("🇨🇿");
    expect(getEmojiFlag("US")).toBe("🇺🇸");
    expect(getEmojiFlag("GB")).toBe("🇬🇧");
    expect(getEmojiFlag("DE")).toBe("🇩🇪");
    expect(getEmojiFlag("sk")).toBe("🇸🇰"); // case-insensitive
    expect(getEmojiFlag("")).toBe("");
    expect(getEmojiFlag("USA")).toBe("");
    expect(getEmojiFlag(null)).toBe("");
    expect(getEmojiFlag(undefined)).toBe("");
  });

  it("resolves countries by code correctly", () => {
    const slovakia = getCountryByCode("SK");
    expect(slovakia).toBeDefined();
    expect(slovakia?.name).toBe("Slovakia");
    expect(slovakia?.dialCode).toBe("+421");

    const unitedStates = getCountryByCode("us");
    expect(unitedStates).toBeDefined();
    expect(unitedStates?.name).toBe("United States");
    expect(unitedStates?.dialCode).toBe("+1");

    expect(getCountryByCode("XX")).toBeUndefined();
    expect(getCountryByCode(null)).toBeUndefined();
    expect(getCountryByCode(undefined)).toBeUndefined();
  });

  it("resolves localized country names with fallback", () => {
    const name = getLocalizedCountryName("SK", "Slovakia", "en");
    expect(name).toBe("Slovakia");

    const fallback = getLocalizedCountryName("ZZ", "Unknown Land", "en");
    expect(fallback).toBe("Unknown Land");
  });

  it("searches countries by name, code, and dial code", () => {
    // Exact code search
    const skResults = searchCountries("SK");
    expect(skResults.length).toBeGreaterThanOrEqual(1);
    expect(skResults[0]?.code).toBe("SK");

    // Substring name search
    const gerResults = searchCountries("germany");
    expect(gerResults.some((c) => c.code === "DE")).toBe(true);

    // Dial code search
    const dialResults = searchCountries("+421");
    expect(dialResults.some((c) => c.code === "SK")).toBe(true);

    const dialDigitsResults = searchCountries("421");
    expect(dialDigitsResults.some((c) => c.code === "SK")).toBe(true);

    // Empty query returns all countries
    expect(searchCountries("").length).toBe(249);
    expect(searchCountries("   ").length).toBe(249);

    // Non-matching query
    expect(searchCountries("XYZNonExistentCountry1234").length).toBe(0);
  });

  it("prioritizes exact code and prefix matches in search relevance ranking", () => {
    // Searching "US" should rank United States first, ahead of Australia/Austria (which contain 'us')
    const usResults = searchCountries("US");
    expect(usResults[0]?.code).toBe("US");

    // Searching "SK" should rank Slovakia first
    const skResults = searchCountries("SK");
    expect(skResults[0]?.code).toBe("SK");

    // Searching "DE" should rank Germany first
    const deResults = searchCountries("DE");
    expect(deResults[0]?.code).toBe("DE");

    // Prefix name match ranks before substring match
    const slovResults = searchCountries("Slov");
    expect(slovResults[0]?.code).toBe("SK"); // Slovakia (prefix)
  });
});
