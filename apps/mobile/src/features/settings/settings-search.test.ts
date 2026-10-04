import { describe, expect, it } from "vitest";
import { SETTINGS_CATALOG } from "./settings-catalog";
import {
  damerauLevenshtein,
  normalizeSearchText,
  searchSettings,
} from "./settings-search";

describe("settings-search", () => {
  describe("normalization", () => {
    it("strips diacritics and accents", () => {
      expect(normalizeSearchText("métric célsius")).toBe("metric celsius");
    });

    it("preserves apostrophes in contractions like don't", () => {
      expect(normalizeSearchText("don't collect analytics")).toBe(
        "dont collect analytics",
      );
      expect(normalizeSearchText("can’t touch this")).toBe("cant touch this");
    });

    it("normalizes punctuation and collapses whitespace", () => {
      expect(normalizeSearchText("  Dark   Mode... (Appearance!)  ")).toBe(
        "dark mode appearance",
      );
    });
  });

  describe("damerauLevenshtein distance", () => {
    it("handles identical and empty strings", () => {
      expect(damerauLevenshtein("dark", "dark")).toBe(0);
      expect(damerauLevenshtein("", "dark")).toBe(4);
      expect(damerauLevenshtein("dark", "")).toBe(4);
    });

    it("calculates single edit distance correctly", () => {
      expect(damerauLevenshtein("dark", "drak")).toBe(1); // transposition
      expect(damerauLevenshtein("dark", "bark")).toBe(1); // substitution
      expect(damerauLevenshtein("dark", "dar")).toBe(1); // deletion
      expect(damerauLevenshtein("dark", "darks")).toBe(1); // insertion
    });

    it("respects maxBound early exit", () => {
      expect(damerauLevenshtein("verylongword", "short", 2)).toBe(Infinity);
    });
  });

  describe("plan table requirements (Cases 1 - 16)", () => {
    it("Case 1: matches appearance theme for dark mode variants including typo 'drak mode'", () => {
      const queries = [
        "dark mode",
        "make the app darker",
        "too bright",
        "drak mode",
      ];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("appearance");
      }
    });

    it("Case 2: matches profile units for 'pounds instead of kilos' and 'change kg to lb'", () => {
      const queries = ["pounds instead of kilos", "change kg to lb"];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("profile");
        expect(results[0].item.anchorId).toBe("units");
      }
    });

    it("Case 3: matches goal pace for 'lose weight more slowly' and 'change my target weight'", () => {
      const queries = ["lose weight more slowly", "change my target weight"];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("goal");
      }
    });

    it("Case 4: matches workout rest timer for 'timer takes too long' and 'stop rest timer sound'", () => {
      const queries = ["timer takes too long", "stop rest timer sound"];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("workout");
        expect(results[0].item.anchorId).toBe("rest-timer");
      }
    });

    it("Case 5: matches first-meal reminder for 'remind me to eat breakfast'", () => {
      const results = searchSettings(
        "remind me to eat breakfast",
        SETTINGS_CATALOG,
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.destinationId).toBe("reminders");
      expect(results[0].item.anchorId).toBe("first-meal");
    });

    it("Case 6: matches evening reminder for 'stop evening reminders'", () => {
      const results = searchSettings(
        "stop evening reminders",
        SETTINGS_CATALOG,
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.destinationId).toBe("reminders");
      expect(results[0].item.anchorId).toBe("evening-catch-up");
    });

    it("Case 7: matches health steps for 'connect Apple Health' and 'show my steps'", () => {
      const queries = ["connect Apple Health", "show my steps"];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("health-steps");
      }
    });

    it("Case 8: matches coach memory for 'what does the coach remember' and 'forget what AI knows about me'", () => {
      const queries = [
        "what does the coach remember",
        "forget what AI knows about me",
      ];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("memory");
      }
    });

    it("Case 9: matches account data ai consent for 'stop sharing with AI' and 'revoke AI consent'", () => {
      const queries = ["stop sharing with AI", "revoke AI consent"];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("account-data");
        expect(results[0].item.anchorId).toBe("ai-consent");
      }
    });

    it("Case 10: matches product analytics for 'stop usage tracking' and 'don't collect analytics'", () => {
      const queries = ["stop usage tracking", "don't collect analytics"];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("analytics");
      }
    });

    it("Case 11: matches account data export for 'download my data'", () => {
      const results = searchSettings("download my data", SETTINGS_CATALOG);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.destinationId).toBe("account-data");
      expect(results[0].item.anchorId).toBe("export");
    });

    it("Case 12: matches account data delete for 'delete my account' and 'erase my profile'", () => {
      const queries = ["delete my account", "erase my profile"];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("account-data");
        expect(results[0].item.anchorId).toBe("delete");
      }
    });

    it("Case 13: matches password security for 'change my password'", () => {
      const results = searchSettings("change my password", SETTINGS_CATALOG);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.destinationId).toBe("security");
    });

    it("Case 14: matches ai usage for 'more AI messages' and 'pro pass'", () => {
      const queries = [
        "more AI messages",
        "pro pass",
        "launch pro pass",
        "complimentary pro",
        "beta pro",
      ];
      for (const query of queries) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected results for '${query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe("ai-usage");
      }
    });

    it("Case 15: returns multiple notification-related settings for broad query 'stop notifications'", () => {
      const results = searchSettings("stop notifications", SETTINGS_CATALOG);
      expect(results.length).toBeGreaterThanOrEqual(3);

      const destinationKeys = results.map(
        (r) => `${r.item.destinationId}:${r.item.anchorId ?? ""}`,
      );
      expect(destinationKeys).toContain("workout:rest-timer");
      expect(destinationKeys).toContain("reminders:coach-reminders");
      expect(destinationKeys).toContain("reminders:first-meal");
      expect(destinationKeys).toContain("reminders:evening-catch-up");
    });

    it("Case 16: strictly returns 0 results for unrelated prose queries", () => {
      const unrelated = [
        "change bank account",
        "unrelated query about cooking",
        "what is the weather",
        "bake a cake",
        "my dog",
        "repair car engine",
        "hotel reservation tonight",
        "buy crypto bitcoin",
      ];
      for (const query of unrelated) {
        const results = searchSettings(query, SETTINGS_CATALOG);
        expect(results, `Query '${query}' should return 0 results`).toEqual([]);
      }
    });
  });

  describe("deduplication", () => {
    it("deduplicates coach-memory items pointing to destination 'memory'", () => {
      const results = searchSettings("coach memory", SETTINGS_CATALOG);
      const memoryMatches = results.filter(
        (r) => r.item.destinationId === "memory",
      );
      expect(memoryMatches.length).toBe(1);
    });

    it("deduplicates ai-consent items pointing to 'account-data:ai-consent'", () => {
      const results = searchSettings("revoke ai consent", SETTINGS_CATALOG);
      const consentMatches = results.filter(
        (r) =>
          r.item.destinationId === "account-data" &&
          r.item.anchorId === "ai-consent",
      );
      expect(consentMatches.length).toBe(1);
    });
  });

  describe("match ranking and match reasons", () => {
    it("assigns 'exact-label' with score 1000 for exact label match", () => {
      const results = searchSettings("Sign Out", SETTINGS_CATALOG);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchReason).toBe("exact-label");
      expect(results[0].score).toBe(1000);
    });

    it("assigns 'exact-intent' for exact intent phrase", () => {
      const results = searchSettings("lose weight faster", SETTINGS_CATALOG);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchReason).toBe("exact-intent");
      expect(results[0].score).toBe(900);
    });

    it("assigns 'alias' for exact alias match", () => {
      const results = searchSettings("dark theme", SETTINGS_CATALOG);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchReason).toBe("alias");
      expect(results[0].score).toBe(750);
    });

    it("assigns 'fuzzy' for typo queries", () => {
      const results = searchSettings("pasword", SETTINGS_CATALOG);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.destinationId).toBe("security");
      expect(results[0].matchReason).toBe("fuzzy");
    });
  });

  describe("40+ diverse held-out queries covering synonyms, typos, spacing, punctuation, and edge cases", () => {
    const heldOutCases: Array<{
      query: string;
      expectedDestinationId: string;
      expectedAnchorId?: string;
    }> = [
      // Units & profile
      {
        query: "switch to imperial",
        expectedDestinationId: "profile",
        expectedAnchorId: "units",
      },
      {
        query: "switch to kilograms",
        expectedDestinationId: "profile",
        expectedAnchorId: "units",
      },
      {
        query: "weight in pounds",
        expectedDestinationId: "profile",
        expectedAnchorId: "units",
      },
      { query: "how tall am i", expectedDestinationId: "profile" },
      { query: "change my birthday", expectedDestinationId: "profile" },
      // Goals & energy
      { query: "adjust calorie deficit", expectedDestinationId: "goal" },
      { query: "lose weight faster", expectedDestinationId: "goal" },
      { query: "daily calorie target", expectedDestinationId: "energy-setup" },
      { query: "adjust my macros", expectedDestinationId: "energy-setup" },
      { query: "set protein goal", expectedDestinationId: "energy-setup" },
      // Food standards & progress
      {
        query: "change food database region",
        expectedDestinationId: "food-standards",
      },
      {
        query: "slovak food standards",
        expectedDestinationId: "food-standards",
      },
      { query: "body progress chart", expectedDestinationId: "body" },
      { query: "view weight graph", expectedDestinationId: "body" },
      {
        query: "take progress photo",
        expectedDestinationId: "progress-photos",
      },
      { query: "physique timeline", expectedDestinationId: "progress-photos" },
      // Workouts
      {
        query: "shorter rest between sets",
        expectedDestinationId: "workout",
        expectedAnchorId: "rest-timer",
      },
      {
        query: "turn off rest timer beep",
        expectedDestinationId: "workout",
        expectedAnchorId: "rest-timer",
      },
      {
        query: "progressive overload setting",
        expectedDestinationId: "workout",
        expectedAnchorId: "weight-progression",
      },
      {
        query: "stop increasing workout weights",
        expectedDestinationId: "workout",
        expectedAnchorId: "weight-progression",
      },
      // Reminders
      {
        query: "stop daily reminder",
        expectedDestinationId: "reminders",
        expectedAnchorId: "coach-reminders",
      },
      {
        query: "weekly summary notification",
        expectedDestinationId: "reminders",
        expectedAnchorId: "coach-reminders",
      },
      {
        query: "first meal alert",
        expectedDestinationId: "reminders",
        expectedAnchorId: "first-meal",
      },
      {
        query: "morning food reminder",
        expectedDestinationId: "reminders",
        expectedAnchorId: "first-meal",
      },
      {
        query: "turn off dinner reminder",
        expectedDestinationId: "reminders",
        expectedAnchorId: "evening-catch-up",
      },
      {
        query: "remind me to finish logging",
        expectedDestinationId: "reminders",
        expectedAnchorId: "evening-catch-up",
      },
      // Theme & Appearance
      { query: "turn on dark mode", expectedDestinationId: "appearance" },
      { query: "switch to light mode", expectedDestinationId: "appearance" },
      { query: "follow system theme", expectedDestinationId: "appearance" },
      { query: "black screen", expectedDestinationId: "appearance" },
      // Health & Steps
      {
        query: "connect Health Connect",
        expectedDestinationId: "health-steps",
      },
      {
        query: "import steps from phone",
        expectedDestinationId: "health-steps",
      },
      {
        query: "disconnect apple health",
        expectedDestinationId: "health-steps",
      },
      // Coach & AI
      {
        query: "change coaching style",
        expectedDestinationId: "coach-preferences",
      },
      {
        query: "vegetarian coach advice",
        expectedDestinationId: "coach-preferences",
      },
      {
        query: "how many messages do i have left",
        expectedDestinationId: "ai-usage",
      },
      { query: "request launch pro pass", expectedDestinationId: "ai-usage" },
      { query: "delete coach memories", expectedDestinationId: "memory" },
      { query: "clear remembered facts", expectedDestinationId: "memory" },
      {
        query: "withdraw consent for ai",
        expectedDestinationId: "account-data",
        expectedAnchorId: "ai-consent",
      },
      // Privacy & Data
      { query: "export telemetry", expectedDestinationId: "analytics" },
      { query: "clear analytics events", expectedDestinationId: "analytics" },
      {
        query: "download workout history",
        expectedDestinationId: "account-data",
        expectedAnchorId: "export",
      },
      {
        query: "download meal history",
        expectedDestinationId: "account-data",
        expectedAnchorId: "export",
      },
      {
        query: "permanently remove my account",
        expectedDestinationId: "account-data",
        expectedAnchorId: "delete",
      },
      {
        query: "wipe everything",
        expectedDestinationId: "account-data",
        expectedAnchorId: "delete",
      },
      // Legal & Help
      {
        query: "read privacy policy",
        expectedDestinationId: "legal",
        expectedAnchorId: "privacy-policy",
      },
      {
        query: "view user agreement",
        expectedDestinationId: "legal",
        expectedAnchorId: "terms",
      },
      {
        query: "medical disclaimer",
        expectedDestinationId: "legal",
        expectedAnchorId: "medical-advisory",
      },
      {
        query: "how to delete account outside app",
        expectedDestinationId: "legal",
        expectedAnchorId: "external-deletion",
      },
      { query: "reset password", expectedDestinationId: "security" },
      { query: "which email am i using", expectedDestinationId: "identity" },
      { query: "finish onboarding", expectedDestinationId: "setup-wizard" },
      { query: "report a problem", expectedDestinationId: "feedback" },
      { query: "log me out", expectedDestinationId: "sign-out" },
      // Typos
      { query: "caloires", expectedDestinationId: "energy-setup" },
      { query: "target wieght", expectedDestinationId: "goal" },
      {
        query: "untis",
        expectedDestinationId: "profile",
        expectedAnchorId: "units",
      },
      {
        query: "exprot data",
        expectedDestinationId: "account-data",
        expectedAnchorId: "export",
      },
      {
        query: "deelte account",
        expectedDestinationId: "account-data",
        expectedAnchorId: "delete",
      },
    ];

    for (const testCase of heldOutCases) {
      it(`matches '${testCase.query}' -> ${testCase.expectedDestinationId}${testCase.expectedAnchorId ? `:${testCase.expectedAnchorId}` : ""}`, () => {
        const results = searchSettings(testCase.query, SETTINGS_CATALOG);
        expect(
          results.length,
          `Expected result for query '${testCase.query}'`,
        ).toBeGreaterThan(0);
        expect(results[0].item.destinationId).toBe(
          testCase.expectedDestinationId,
        );
        if (testCase.expectedAnchorId) {
          expect(results[0].item.anchorId).toBe(testCase.expectedAnchorId);
        }
      });
    }
  });

  describe("edge cases & empty queries", () => {
    it("returns empty array for empty string", () => {
      expect(searchSettings("", SETTINGS_CATALOG)).toEqual([]);
    });

    it("returns empty array for whitespace only", () => {
      expect(searchSettings("   \t  \n ", SETTINGS_CATALOG)).toEqual([]);
    });

    it("returns empty array for punctuation only", () => {
      expect(searchSettings("?!@#$%^&*()_+", SETTINGS_CATALOG)).toEqual([]);
    });

    it("returns empty array for generic stop words without intent", () => {
      expect(searchSettings("what is my", SETTINGS_CATALOG)).toEqual([]);
      expect(
        searchSettings("can you please help me", SETTINGS_CATALOG),
      ).toEqual([]);
    });
  });

  describe("speed and performance", () => {
    it("keeps the median warmed eight-query batch across the full catalog under 50ms", () => {
      const testQueries = [
        "dark mode",
        "pounds instead of kilos",
        "timer takes too long",
        "drak mode",
        "remind me to eat breakfast",
        "stop notifications",
        "delete my account",
        "change bank account",
      ];

      const runBatch = () => {
        for (const query of testQueries) {
          searchSettings(query, SETTINGS_CATALOG);
        }
      };

      // Warm the matcher before measuring its steady-state cost. A median of
      // complete batches tolerates isolated scheduler/GC pauses when Vitest runs
      // other files in parallel, while retaining the 50ms budget for all 8 searches.
      for (let warmup = 0; warmup < 2; warmup++) runBatch();
      const samples: number[] = [];
      for (let sample = 0; sample < 7; sample++) {
        const start = performance.now();
        runBatch();
        samples.push(performance.now() - start);
      }
      const median = [...samples].sort((a, b) => a - b)[3]!;

      expect(
        median,
        `Eight-query batch samples (ms): ${samples.map((sample) => sample.toFixed(2)).join(", ")}`,
      ).toBeLessThan(50);
    });
  });
});
