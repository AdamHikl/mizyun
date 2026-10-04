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
    "Dal som si proteínový shake a banán",
    "Zapíš 150g tvarohu s medom",
    "Zjedla som misku ovsených vločiek s mliekom",
    "Zaznamenaj 200g hovädzieho mäsa s ryžou",
    "Zjedol som 2 kúsky koláča",
    "Pridaj chlieb s medovým maslom",
  ])("recognizes explicit meal logging: %s", (text) => {
    expect(isExplicitMealLoggingIntent(text)).toBe(true);
  });

  it.each([
    "Log my breakfast automatically every day",
    "Add a recurring meal for breakfast",
    "Log two eggs each morning",
    "Log a recurring breakfast with 30 g protein",
    "Log two eggs every morning and create a full body workout",
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
    "Pridaj dve hodiny chôdze do dnešných tréningov",
    "Zabehol som 5 km dnes ráno",
    "Zapíš 3 série drepov",
    "Pridaj 20 klikov",
    "Zacvičil som si 15 minút",
    "Zaloguj môj ranný beh",
    "Dnes som mal ťažký tréning",
    "Pridaj 5 sérií výpadov",
    "Zapíš 10 zhybov na hrazde",
    "Dnes som bol vo fitku hodinu",
    "Add 20 push-ups to today's log",
    "Log 15 pull-ups after my run",
    "After my workout I ate 200g chicken",
    "Zacvičil som si a mal som 2 vajcia",
    "Pridaj medzi moje poznámky tento cieľ",
    "Zaznamenaj to medzi obľúbené položky",
    "Zaznamenaj môj desiaty deň v aplikácii",
  ])(
    "leaves nutrition questions and training statements with the grounded Coach: %s",
    (text) => {
      expect(isExplicitMealLoggingIntent(text)).toBe(false);
    },
  );
});
