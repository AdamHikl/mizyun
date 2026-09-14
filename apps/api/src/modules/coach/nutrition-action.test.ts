import { describe, expect, it } from "vitest";

import { isExplicitMealLoggingIntent } from "./nutrition-action.js";

describe("isExplicitMealLoggingIntent", () => {
  it.each([
    "I had 250g of tuna for dinner",
    "I ate two eggs and toast",
    "Please log 180 g chicken and rice",
    "Zjedol som 250 g tuniaka na večeru",
    "Pridaj dve vajcia na raňajky",
    "Add 300g grilled chicken with rice",
    "Log 2 eggs and oatmeal",
    "Please record my lunch: 200g pasta and 100g chicken",
    "I've eaten a protein shake and a banana",
    "Pridaj 100 g ryže s kuracím mäsom",
    "I had sushi for dinner",
  ])("recognizes explicit meal logging: %s", (text) => {
    expect(isExplicitMealLoggingIntent(text)).toBe(true);
  });

  it.each([
    "How much protein is in tuna?",
    "Should I eat more at dinner?",
    "I had a great workout",
    "Explain my calorie target",
    "What did I log yesterday?",
    "Add two hour walk to my completed workouts today",
    "Log my morning run",
    "I ran 5k this morning",
    "Add 3 sets of squats to today's log",
    "I had 5 squats this morning",
    "Add a swim before my training",
    "Record my morning yoga session",
    "Zapíš môj tréning na pondelok",
  ])(
    "leaves nutrition questions and training statements with the grounded Coach: %s",
    (text) => {
      expect(isExplicitMealLoggingIntent(text)).toBe(false);
    },
  );
});
