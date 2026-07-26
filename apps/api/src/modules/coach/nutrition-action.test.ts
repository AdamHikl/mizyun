import { describe, expect, it } from "vitest";

import { isExplicitMealLoggingIntent } from "./nutrition-action.js";

describe("isExplicitMealLoggingIntent", () => {
  it.each([
    "I had 250g of tuna for dinner",
    "I ate two eggs and toast",
    "Please log 180 g chicken and rice",
    "Zjedol som 250 g tuniaka na večeru",
    "Pridaj dve vajcia na raňajky",
  ])("recognizes explicit meal logging: %s", (text) => {
    expect(isExplicitMealLoggingIntent(text)).toBe(true);
  });

  it.each([
    "How much protein is in tuna?",
    "Should I eat more at dinner?",
    "I had a great workout",
    "Explain my calorie target",
    "What did I log yesterday?",
  ])("leaves nutrition questions with the grounded Coach: %s", (text) => {
    expect(isExplicitMealLoggingIntent(text)).toBe(false);
  });
});
