/**
 * AI-ACT-001 — conservative meal-logging intent detection.
 *
 * The Coach diverts explicit first-person food statements and logging
 * commands into the nutrition draft provider. Everything else — including
 * all training content — continues through the grounded text Coach.
 *
 * Two safeguards keep training content out of the meal draft path
 * (which would burn a draft slot and present the wrong UI):
 *
 * 1. A workout signal — workouts/training/exercise/sessions plus common
 *    activity and exercise names, including plurals ("workouts", "squats",
 *    "walk", "run", ...) — vetoes meal routing outright.
 * 2. The statement must carry food context: a quantity with a unit
 *    ("180 g", "two eggs" is covered by the food-word path below) or a
 *    common food/drink word. A bare command such as "Add two hour walk to
 *    my completed workouts today" matches neither.
 *
 * The lists are intentionally conservative and not exhaustive: when in
 * doubt the statement stays with the grounded Coach, which can still help
 * with meals. Missing a meal phrase costs a rephrase; misrouting a workout
 * into a meal draft costs a draft slot and user trust.
 */

const workoutSignal =
  /(?:^|\P{L})(?:workouts?|train(?:ing|ed|s?)|exercises?|sessions?|walk(?:ed|ing|s?)?|jog(?:ged|ging|s?)?|ran|running|runs?|rode|rides?|swam|swimming|swims?|cycl(?:ed|ing|es?)|hik(?:ed|ing|es?)|sprint(?:ed|ing|s?)|lift(?:ed|ing|s?)|cardio|gym|hiit|fitness|reps?|sets?|squats?|deadlifts?|bench(?:press)?|presses?|curls?|lunges?|planks?|push[- ]?ups?|pull[- ]?ups?|sit[- ]?ups?|burpees?|fitk\p{L}*|(?:za|od)?cvič\p{L}*|tréning\p{L}*|trénov\p{L}*|(?:za|od)?beh\p{L}*|bežal\p{L}*|behal\p{L}*|kráč\p{L}*|chôdz\p{L}*|prechádzk\p{L}*|drep\p{L}*|klik\p{L}*|zhyb\p{L}*|výpad\p{L}*|posilň\p{L}*|posilk\p{L}*|kardio|séri\p{L}*)(?:\P{L}|$)/iu;

const foodQuantity =
  /(?:\d+(?:[.,]\d+)?|(?:^|\P{L})(?:one|two|three|four|five|six|seven|eight|nine|ten|jedn[uao]|dve|tri|štyri|päť|šesť|sedem|osem|deväť|desať)(?:\P{L}|$))\s*(?:g\b|grams?|gramov|gramy|kg\b|kilograms?|kilos?|kilogramov|kilogramy|oz\b|ounces?|ml\b|l\b|litres?|liters?|litrov|litre|litra|cups?|šálk\p{L}*|tbsp|lyžic\p{L}*|tsp|lyžič\p{L}*|slices?|plátk\p{L}*|pieces?|k[uú]s\p{L}*|portions?|porci\p{L}*)/iu;

const foodWord =
  /(?:^|\P{L})(?:breakfast|lunch|dinner|supper|snacks?|meals?|drinks?|juice|smoothie|coffee|tea|water|milk|yogurt|yoghurt|cheese|butter|cream|eggs?|omelette|toast|bread|bagels?|baguette|crackers?|cereal|oatmeal|oats?|porridge|rice|pasta|noodles?|quinoa|couscous|pizza|burgers?|sandwich|wrap|waffles?|pancakes?|soup|stew|salads?|sushi|sashimi|chicken|beef|pork|lamb|turkey|tuna|salmon|fish|shrimp|prawns?|steak|bacon|ham|sausage|potatoes?|carrots?|broccoli|spinach|kale|cucumber|tomatoes?|avocado|bananas?|apples?|oranges?|mango|grapes?|berries?|strawberries?|blueberries?|chocolate|cocoa|honey|jam|peanuts?|almonds?|walnuts?|cashews?|nuts?|seeds?|protein bars?|protein|carbs?|fats?|raňajky|desiat[au]|desiatej|obiad|obed|olovrant\p{L}*|večera|večeru|svačina|ryža|kuskus|chlieb|chleba|pečivo|rož\p{L}*|vajíčka|vajcia|vajce|kuracie|kuracím|kuracina|hovädz\p{L}*|bravčov\p{L}*|morčac\p{L}*|tuniak\p{L}*|losos\p{L}*|ryb\p{L}*|mlieko|syry|syr|maslo|tvaroh\p{L}*|jogurt\p{L}*|jablk\p{L}*|hrozno|banán\p{L}*|ovsen\p{L}*|vločk\p{L}*|ovocie|zelenina|káva|čaj|voda|med(?:om|u|y)?|medov\p{L}*)(?:\P{L}|$)/iu;

const hasFoodContext = (text: string): boolean =>
  foodQuantity.test(text) || foodWord.test(text);

const mealLoggingPhrases: readonly RegExp[] = [
  /^(?:please\s+)?(?:log|add|record)\b/i,
  /\bi\s+(?:ate|consumed)\b/i,
  /\bi\s+had\b/i,
  /\bi['’]ve\s+(?:eaten|had)\b/i,
  /(?:^|\P{L})(?:zjedol|zjedla|jedol som|jedla som|mal som|mala som|dal som si|dala som si)(?:\P{L}|$)/iu,
  /^(?:prosím\s+)?(?:zapíš|pridaj|zaloguj|zaznamenaj)(?:\P{L}|$)/iu,
];

export const isExplicitMealLoggingIntent = (text: string): boolean => {
  const normalized = text.trim();
  return (
    normalized.length >= 2 &&
    !workoutSignal.test(normalized) &&
    hasFoodContext(normalized) &&
    mealLoggingPhrases.some((pattern) => pattern.test(normalized))
  );
};
